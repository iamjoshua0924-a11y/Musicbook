/* Phase 1(P2 안정성) 통합 검증 — 실 MongoDB(memory-server) + mock Drive
 * 실행: node tests/integration/sync-p2.test.js (npm run test:integration에 포함)
 * production/외부 시스템 접근 없음 — 전부 로컬 memory mongod + require-cache 주입 mock Drive.
 *
 * 커버 항목:
 *  - DS-04: incremental 기준시각이 이전 회차 startedAt (endedAt이면 회차 실행 중 수정 파일 영구 누락)
 *  - DS-05: incremental skip 브랜치가 미존재 문서를 스텁으로 upsert하지 않고 full 파싱 경로로 처리
 *  - DS-06: hidden 누적 고아 문서가 SEEN_DROP 가드를 영구 발동시키지 않음(prevCount=visible 기준)
 *  - DS-07: hiddenManual=true인 곡은 sync가 hidden을 재계산하지 않음(수동 숨김/노출 보존)
 *  - DS-03a(lite): runDriveSync 종료 후 상태가 running:false로 확정(늦은 progress 쓰기에 안 덮임)
 */
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const results = [];
const check = (name, ok, extra = '') => { results.push([name, !!ok]); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? ` (${extra})` : '')); };
setTimeout(() => { console.error('GLOBAL TIMEOUT'); process.exit(3); }, 180000);

(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server-core');
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri('musicbook_p2_test');
  console.log('[mongod]', uri);

  process.env.MONGODB_URI = uri;
  process.env.SESSION_SECRET = 'test_secret';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from(JSON.stringify({ type: 'service_account', token_uri: 'https://x' })).toString('base64');
  const mongoose = require('mongoose');
  await mongoose.connect(uri);

  // ---- mock Drive 주입 (실 코드 경로 그대로, Drive API만 대체) ----
  const drivePath = require.resolve(path.join(REPO, 'src/services/drive.js'));
  const fake = { foldersByParent: {} };
  require.cache[drivePath] = {
    id: drivePath, filename: drivePath, loaded: true, path: path.dirname(drivePath), exports: {
      getDriveClient: () => ({
        files: {
          list: async (params) => {
            const m = String(params?.q || '').match(/'([^']+)' in parents/);
            const files = fake.foldersByParent[m ? m[1] : ''] || [];
            return { data: { files, nextPageToken: undefined } };
          }
        }
      }),
      buildViewUrl: (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`
    }
  };
  const { syncDriveFolderTree } = require(path.join(REPO, 'src/services/driveSync.js'));
  const { runDriveSync } = require(path.join(REPO, 'src/services/driveSyncRunner.js'));
  const Song = require(path.join(REPO, 'src/models/Song.js'));
  const Setting = require(path.join(REPO, 'src/models/Setting.js'));

  // ===== DS-07: hiddenManual 보존 =====
  // (a) 패턴상 숨김 대상('…-3단')이지만 관리자가 수동으로 노출시킨 곡 → 노출 유지
  // (b) 패턴상 정상이지만 관리자가 수동으로 숨긴 곡 → 숨김 유지
  // (c) 대조군: 수동 지정 없는 패턴 숨김 곡 → 숨김
  const T = new Date('2026-08-10T00:00:00Z');
  await Song.create({ title: '수동노출곡', googleFileId: 'M1', syncRootId: 'ROOT7', driveModifiedTime: T, hidden: false, hiddenManual: true, searchText: 'x' });
  await Song.create({ title: '수동숨김곡', googleFileId: 'M2', syncRootId: 'ROOT7', driveModifiedTime: T, hidden: true, hiddenManual: true, searchText: 'x' });
  fake.foldersByParent.ROOT7 = [
    { id: 'M1', name: '가수-수동노출곡-3단.pdf', mimeType: 'application/pdf', modifiedTime: T.toISOString() },
    { id: 'M2', name: '수동숨김곡-가수.pdf', mimeType: 'application/pdf', modifiedTime: T.toISOString() },
    { id: 'M3', name: '가수-자동숨김곡-3단.pdf', mimeType: 'application/pdf', modifiedTime: T.toISOString() }
  ];
  await syncDriveFolderTree({ rootFolderId: 'ROOT7', latestDays: 30, pruneMissing: true });
  const m1 = await Song.findOne({ googleFileId: 'M1' }).lean();
  const m2 = await Song.findOne({ googleFileId: 'M2' }).lean();
  const m3 = await Song.findOne({ googleFileId: 'M3' }).lean();
  check('DS-07 수동 노출(패턴은 숨김)이 sync 후에도 노출 유지', m1 && m1.hidden === false, `hidden=${m1?.hidden}`);
  check('DS-07 수동 숨김(패턴은 정상)이 sync 후에도 숨김 유지', m2 && m2.hidden === true, `hidden=${m2?.hidden}`);
  check('DS-07 대조군: 수동 지정 없는 패턴 숨김은 그대로 숨김', m3 && m3.hidden === true);

  // incremental skip 브랜치에서도 동일 보존 확인 (M1/M2 mtime 그대로, since 이후로 skip 대상)
  await syncDriveFolderTree({ rootFolderId: 'ROOT7', latestDays: 30, pruneMissing: true, incrementalSince: '2026-08-11T00:00:00Z' });
  const m1b = await Song.findOne({ googleFileId: 'M1' }).lean();
  const m2b = await Song.findOne({ googleFileId: 'M2' }).lean();
  check('DS-07 skip 브랜치에서도 수동 노출 유지', m1b && m1b.hidden === false);
  check('DS-07 skip 브랜치에서도 수동 숨김 유지', m2b && m2b.hidden === true);

  // ===== DS-05: skip 브랜치가 미존재 문서를 스텁으로 만들지 않음 =====
  // 문서가 없는 파일 + mtime이 since 이전(=skip 자격) → full 파싱 경로로 완전한 문서 생성
  fake.foldersByParent.ROOT5 = [
    { id: 'N1', name: '새곡(C)-새가수.pdf', mimeType: 'application/pdf', modifiedTime: '2026-08-01T00:00:00Z' }
  ];
  const r5 = await syncDriveFolderTree({ rootFolderId: 'ROOT5', latestDays: 30, pruneMissing: false, incrementalSince: '2026-08-05T00:00:00Z' });
  const n1 = await Song.findOne({ googleFileId: 'N1' }).lean();
  check('DS-05 skip 자격 파일이라도 미존재 문서는 full 파싱으로 생성', !!n1, `doc=${!!n1}`);
  check('DS-05 생성 문서에 searchText 존재(스텁 아님)', n1 && String(n1.searchText || '').length > 0, `searchText=${n1?.searchText}`);
  check('DS-05 생성 문서에 key 파싱됨', n1 && n1.key === 'C', `key=${n1?.key}`);
  check('DS-05 processed로 집계(skipped 아님)', r5.processed === 1 && r5.skipped === 0, `p=${r5.processed} s=${r5.skipped}`);

  // 같은 조건 재실행 → 이번엔 문서가 있으므로 skip 처리(중복 full 파싱 없음)
  const r5b = await syncDriveFolderTree({ rootFolderId: 'ROOT5', latestDays: 30, pruneMissing: false, incrementalSince: '2026-08-05T00:00:00Z' });
  check('DS-05 기존 문서는 skip 브랜치로 처리', r5b.skipped === 1 && r5b.processed === 0, `p=${r5b.processed} s=${r5b.skipped}`);

  // ===== DS-06: hidden 고아 누적이 SEEN_DROP을 영구 발동시키지 않음 =====
  // visible 60곡(전부 Drive에 존재) + hidden 고아 20곡(Drive에 없음).
  // 예전 기준(prevCount=80)이면 seen 60 < 72 → SEEN_DROP 영구. 새 기준(visible 60)이면 prune 정상 실행.
  const files6 = [];
  for (let i = 0; i < 60; i += 1) {
    const id = `V${i}`;
    files6.push({ id, name: `곡${i}-가수${i}.pdf`, mimeType: 'application/pdf', modifiedTime: T.toISOString() });
    // eslint-disable-next-line no-await-in-loop
    await Song.create({ title: `곡${i}`, googleFileId: id, syncRootId: 'ROOT6', driveModifiedTime: T, hidden: false, searchText: 'x' });
  }
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Song.create({ title: `고아${i}`, googleFileId: `O${i}`, syncRootId: 'ROOT6', driveModifiedTime: T, hidden: true, searchText: 'x' });
  }
  fake.foldersByParent.ROOT6 = files6;
  const r6 = await syncDriveFolderTree({ rootFolderId: 'ROOT6', latestDays: 30, pruneMissing: true });
  check('DS-06 hidden 고아 20% 누적에도 prune 실행(SEEN_DROP 아님)', r6.pruneSkippedReason === '', `reason=${r6.pruneSkippedReason}`);
  check('DS-06 prevCount가 visible 기준', r6.prevCount === 60, `prevCount=${r6.prevCount}`);

  // 진짜 순회 불완전(대량 누락)은 여전히 SEEN_DROP으로 방어되는지 — 파일 절반만 보이게
  fake.foldersByParent.ROOT6 = files6.slice(0, 30);
  const r6b = await syncDriveFolderTree({ rootFolderId: 'ROOT6', latestDays: 30, pruneMissing: true });
  check('DS-06 실제 대량 누락은 여전히 SEEN_DROP 보호', String(r6b.pruneSkippedReason).startsWith('SEEN_DROP'), `reason=${r6b.pruneSkippedReason}`);

  // ===== DS-04 + DS-03a(lite): runner 경로 =====
  // 이전 회차: startedAt 10:00, endedAt 10:10 (정상 완료). 파일 mtime 10:05 (회차 실행 중 수정).
  // endedAt 기준이면 skip되어 title이 안 바뀌고, startedAt 기준이면 full 파싱으로 title이 갱신된다.
  const S = '2026-08-16T10:00:00.000Z';
  const E = '2026-08-16T10:10:00.000Z';
  await Setting.create({
    key: 'driveSyncStatus',
    value: JSON.stringify({ ok: true, running: false, startedAt: S, endedAt: E, pruneSkippedReason: '' })
  });
  await Song.create({
    title: '갱신전제목', googleFileId: 'R1', syncRootId: 'ROOT4',
    driveModifiedTime: new Date('2026-08-16T10:04:00Z'), hidden: false, searchText: 'x'
  });
  fake.foldersByParent.ROOT4 = [
    { id: 'R1', name: '갱신후제목-갱신후가수.pdf', mimeType: 'application/pdf', modifiedTime: '2026-08-16T10:05:00.000Z' }
  ];
  const r4 = await runDriveSync({ rootFolderId: 'ROOT4', incremental: true, pruneMissing: false, latestDays: 30 });
  const r1doc = await Song.findOne({ googleFileId: 'R1' }).lean();
  check('DS-04 이전 회차 실행 중 수정된 파일이 incremental에서 재처리됨', r1doc && r1doc.title === '갱신후제목', `title=${r1doc?.title}`);
  check('DS-04 runner 결과 ok', r4 && r4.ok === true, `err=${r4?.error}`);
  const stRow = await Setting.findOne({ key: 'driveSyncStatus' }).lean();
  const st = JSON.parse(stRow.value);
  check('DS-03a 최종 상태 running:false 확정', st.running === false, `running=${st.running}`);
  check('DS-03a 최종 상태 ok:true', st.ok === true);

  await mongoose.disconnect();
  await mem.stop();

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('TEST ERROR:', e);
  process.exit(2);
});
