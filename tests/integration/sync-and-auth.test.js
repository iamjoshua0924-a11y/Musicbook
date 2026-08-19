/* 실행: npm run test:integration (또는 node tests/integration/sync-and-auth.test.js)
 * 필요: devDependencies(mongodb-memory-server-core). 최초 실행 시 mongod 바이너리(~80MB) 다운로드.
 * production/외부 시스템 접근 없음 — 전부 로컬 memory mongod + mock Drive.
 */
/* Phase 4+6 통합 검증 — 실 MongoDB(memory-server) + mock Drive
 * Part 1: 실제 syncDriveFolderTree를 require-cache 주입 mock Drive로 구동
 *   - DS-01: mtime 불변 → 수동 편집 보존 / mtime 변경 → 파싱값 덮어쓰기 / 신규 upsert
 *   - DS-08: '단발머리-최양락-Live' 미숨김, '가수-곡-3단' 숨김 (실 sync 경로)
 * Part 2: 실제 서버 spawn
 *   - DS-03b: 부팅 시 stale running:true 청소
 *   - NEW-1: 로그인 세션이 httpSessions 컬렉션에 영속
 *   - PB-2: session 롤 타인 userId 쓰기 403 / 본인 ok
 *   - PB-6: 공개 해제 유저의 private 곡 비노출 / 공개 시 노출 / 오너는 항상
 *   - smoke: GET /api/songs 정상
 * production 접근 없음 — 전부 로컬 memory mongod.
 */
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server-core');

const REPO = path.resolve(__dirname, '..', '..');
const results = [];
const check = (name, ok, extra = '') => { results.push([name, !!ok]); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? ` (${extra})` : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.error('GLOBAL TIMEOUT'); process.exit(3); }, 180000);

(async () => {
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri('musicbook_test');
  console.log('[mongod]', uri);

  // ---- mongoose 연결 (프로젝트의 mongoose 인스턴스 사용 — 모델 공유) ----
  process.env.MONGODB_URI = uri;
  process.env.SESSION_SECRET = 'test_secret';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from(JSON.stringify({ type: 'service_account', token_uri: 'https://x' })).toString('base64');
  const mongoose = require('mongoose');
  await mongoose.connect(uri);

  // ---- mock Drive 주입 (실 코드 경로 그대로, Drive API만 대체) ----
  const drivePath = require.resolve(path.join(REPO, 'src/services/drive.js'));
  const fake = { foldersByParent: { ROOT: [] } };
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
  const Song = require(path.join(REPO, 'src/models/Song.js'));
  const User = require(path.join(REPO, 'src/models/User.js'));
  const Setting = require(path.join(REPO, 'src/models/Setting.js'));

  // ===== Part 1: DS-01 / DS-08 =====
  const T1 = new Date('2026-08-01T00:00:00Z');
  const T2 = new Date('2026-08-15T00:00:00Z');
  await Song.create({
    title: '수동편집제목', displayTitle: '수동편집제목', artist: '수동편집가수', key: 'A',
    googleFileId: 'F1', parseError: '', syncRootId: 'ROOT', driveModifiedTime: T1,
    searchText: '수동편집제목 수동편집가수'
  });
  fake.foldersByParent.ROOT = [
    { id: 'F1', name: '파싱제목(B)-파싱가수.pdf', mimeType: 'application/pdf', modifiedTime: T1.toISOString() }
  ];
  await syncDriveFolderTree({ rootFolderId: 'ROOT', latestDays: 30, pruneMissing: true });
  let f1 = await Song.findOne({ googleFileId: 'F1' }).lean();
  check('DS-01 mtime 불변 → 수동 title 보존', f1.title === '수동편집제목', `title=${f1.title}`);
  check('DS-01 mtime 불변 → 수동 artist 보존', f1.artist === '수동편집가수');
  check('DS-01 mtime 불변 → searchText가 보존값 기준', String(f1.searchText).includes('수동편집제목'));
  check('DS-01 mtime 불변 → folderPath/lastSeenAt 등은 갱신', !!f1.lastSeenAt);

  fake.foldersByParent.ROOT[0].modifiedTime = T2.toISOString();
  await syncDriveFolderTree({ rootFolderId: 'ROOT', latestDays: 30, pruneMissing: true });
  f1 = await Song.findOne({ googleFileId: 'F1' }).lean();
  check('DS-01 mtime 변경 → 파싱 title 덮어쓰기', f1.title === '파싱제목', `title=${f1.title}`);
  check('DS-01 mtime 변경 → 파싱 artist 덮어쓰기', f1.artist === '파싱가수');
  check('DS-01 기존 key(A)는 filled-only 보존(기존 시맨틱)', f1.key === 'A', `key=${f1.key}`);
  check('DS-01 searchText 갱신', String(f1.searchText).includes('파싱제목'));

  fake.foldersByParent.ROOT.push(
    { id: 'F2', name: '단발머리-최양락-Live.pdf', mimeType: 'application/pdf', modifiedTime: T2.toISOString() },
    { id: 'F3', name: '가수-곡-3단.pdf', mimeType: 'application/pdf', modifiedTime: T2.toISOString() }
  );
  await syncDriveFolderTree({ rootFolderId: 'ROOT', latestDays: 30, pruneMissing: true });
  const f2 = await Song.findOne({ googleFileId: 'F2' }).lean();
  const f3 = await Song.findOne({ googleFileId: 'F3' }).lean();
  check('DS-08 정상 곡(단발머리-…-Live) 미숨김 (실 sync 경로)', f2 && f2.hidden !== true, `hidden=${f2?.hidden}`);
  check('신규 upsert 파싱값 정상', f2 && f2.title.length > 0);
  check('DS-08 스크랩 패턴(…-3단) 숨김 유지', f3 && f3.hidden === true);

  // ===== Part 2: 서버 spawn — DS-03b / NEW-1 / PB-2 / PB-6 =====
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  await User.create({ userId: 'alice', passwordHash: sha('pw1'), role: 'session', displayName: 'Alice' });
  await User.create({ userId: 'xowner', passwordHash: sha('pw2'), role: 'session', displayName: 'X', isPrivate: false, publicBookEnabled: false });
  await Song.create({ title: '비밀곡', googleFileId: 'local-priv1', scope: 'private', privateOwnerId: 'xowner', hasScoreFile: false, searchText: '비밀곡' });
  await Setting.create({ key: 'driveSyncStatus', value: JSON.stringify({ running: true, processed: 10, startedAt: new Date().toISOString() }) });

  const PORT = 3163;
  const srv = spawn('node', ['src/server.js'], {
    cwd: REPO,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), MONGODB_URI: uri, MONGO_URI: uri },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let srvLog = '';
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  const base = `http://127.0.0.1:${PORT}`;
  let up = false;
  for (let i = 0; i < 40; i++) { // ~20s
    await wait(500);
    try { const r = await fetch(`${base}/api/health`); if (r.ok) { up = true; break; } } catch {}
  }
  check('서버 부팅(health 200)', up);

  await wait(1000); // cleanup은 connect 후 비동기
  const st = await Setting.findOne({ key: 'driveSyncStatus' }).lean();
  const stv = JSON.parse(st.value);
  check('DS-03b 부팅 시 stale running:true → false', stv.running === false, `error=${stv.error}`);

  // NEW-1: 로그인 → 세션 쿠키 → me → httpSessions 영속
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'alice', password: 'pw1' })
  });
  const setCookie = login.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  check('로그인 성공 + 쿠키 발급', login.ok && cookie.startsWith('mb_admin_sid='));
  const me = await fetch(`${base}/api/admin/me`, { headers: { Cookie: cookie } });
  const meJ = await me.json().catch(() => null);
  check('세션 유지(/admin/me 200, alice)', me.ok && meJ?.user?.userId === 'alice');
  const sessCount = await mongoose.connection.db.collection('httpSessions').countDocuments();
  check('NEW-1 세션이 MongoDB(httpSessions)에 영속', sessCount >= 1, `count=${sessCount}`);

  // PB-2
  const putOther = await fetch(`${base}/api/availability`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ userId: 'xowner', googleFileId: 'F1', available: true })
  });
  check('PB-2 session 롤 타인 userId 쓰기 → 403', putOther.status === 403);
  const putSelf = await fetch(`${base}/api/availability`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ userId: 'alice', googleFileId: 'F1', available: true })
  });
  const putSelfJ = await putSelf.json().catch(() => null);
  check('PB-2 본인 쓰기 → ok', putSelf.ok && putSelfJ?.ok === true);

  // PB-6
  const hasPriv = async (cookieHdr) => {
    const r = await fetch(`${base}/api/songs/cards?privateOwnerId=xowner`, { headers: cookieHdr ? { Cookie: cookieHdr } : {} });
    const j = await r.json();
    const cards = j?.cards || j?.items || [];
    return JSON.stringify(cards).includes('비밀곡');
  };
  check('PB-6 공개 해제 상태: 익명에게 private 곡 비노출', (await hasPriv(null)) === false);
  const loginX = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'xowner', password: 'pw2' })
  });
  const cookieX = (loginX.headers.get('set-cookie') || '').split(';')[0];
  check('PB-6 오너 본인은 공개 해제여도 노출', (await hasPriv(cookieX)) === true);
  await User.updateOne({ userId: 'xowner' }, { $set: { publicBookEnabled: true } });
  check('PB-6 공개 시 익명에게 노출(기존 동작 보존)', (await hasPriv(null)) === true);

  // smoke parity
  const songs = await fetch(`${base}/api/songs?limit=5`);
  const songsJ = await songs.json().catch(() => null);
  check('smoke: GET /api/songs 정상', songs.ok && Array.isArray(songsJ?.items) && songsJ.items.length > 0);

  srv.kill();
  await mongoose.disconnect();
  await mem.stop();

  const fails = results.filter(([, ok]) => !ok);
  console.log(`\n== ${results.length - fails.length}/${results.length} PASS ==`);
  if (fails.length) { console.log('server log tail:\n' + srvLog.slice(-1500)); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('TEST ERROR:', e); process.exit(2); });
