const Song = require('../models/Song');
const { getDriveClient, buildViewUrl } = require('./drive');
const { normalizeSongFileName } = require('./songNameNormalizer');

function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim();
}

function extractBracketTags(name) {
  const tags = [];
  const re = /\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(name))) {
    tags.push(String(m[1] || '').trim());
  }
  return tags;
}

function extractKeyLegacy(name) {
  // legacy fallback examples: "Key C", "key:C#", "(Key Gm)", "[Key F]"
  const m =
    name.match(/(?:\bkey\b)\s*[:\-]?\s*([A-G](?:#|b)?m?)/i) ||
    name.match(/\((?:\s*key\s*)[:\-]?\s*([A-G](?:#|b)?m?)\s*\)/i);
  return m ? String(m[1] || '').trim() : '';
}

async function buildArtistFreqMap() {
  // lower-case artist -> count
  const rows = await Song.aggregate([
    { $match: { artist: { $exists: true, $ne: '' } } },
    { $group: { _id: { $toLower: '$artist' }, c: { $sum: 1 } } },
    { $sort: { c: -1 } },
    { $limit: 2000 }
  ]);
  const m = new Map();
  (rows || []).forEach((r) => m.set(String(r._id || '').trim(), Number(r.c || 0)));
  return m;
}

async function listChildren(drive, folderId, pageToken) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    // shortcutDetails: 폴더에 원본 대신 바로가기가 들어있는 경우를 감지/해석하기 위해 필요
    fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,size,shortcutDetails(targetId,targetMimeType))',
    pageSize: 1000,
    pageToken,
    // IMPORTANT: orderBy가 없으면 Drive는 결과 순서를 보장하지 않는다.
    // pageToken 기반 페이지네이션 도중 순서가 흔들리면 특정 파일이 통째로 누락될 수 있다.
    // (동기화를 여러 번 돌리면 들어오기도 하고 안 들어오기도 하는 증상의 유력한 원인)
    orderBy: 'name',
    // 현재 루트는 "공유된 일반 폴더"라 필수는 아니지만,
    // 나중에 공유 드라이브로 옮겨가도 조용히 누락되지 않도록 방어적으로 둔다.
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  }, {
    // DS-12: 소켓이 응답 없이 매달리면 동기화 루프 전체가 무기한 정지하고
    // /sync/stop도 shouldAbort 검사 지점에 도달하지 못한다. 상한을 둔다.
    timeout: 30_000
  });
  return res.data;
}

const TRANSIENT_DRIVE_ERROR_RE = /rateLimitExceeded|userRateLimitExceeded|backendError|internalError|quotaExceeded|ECONNRESET|ETIMEDOUT|socket hang up/i;

function isTransientDriveError(err) {
  const status = Number(err?.code || err?.response?.status || 0);
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  const reason = `${err?.errors?.[0]?.reason || ''} ${err?.message || ''}`;
  return TRANSIENT_DRIVE_ERROR_RE.test(reason);
}

// 일시적 오류(429/5xx/네트워크)로 폴더 조회가 실패하면 지수 백오프로 재시도한다.
// 예전에는 listChildren이 try/catch 밖에 있어서 이런 오류 한 번에 동기화 전체가 죽었다.
async function listChildrenWithRetry(drive, folderId, pageToken, { retries = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await listChildren(drive, folderId, pageToken);
    } catch (err) {
      lastErr = err;
      if (!isTransientDriveError(err) || attempt === retries) throw err;
      const backoffMs = Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

async function syncDriveFolderTree({
  rootFolderId,
  latestDays = 1,
  limit = 7000,
  incrementalSince = null,
  pruneMissing = true,
  shouldAbort,
  onProgress
} = {}) {
  if (!rootFolderId) throw new Error('ROOT_FOLDER_ID_REQUIRED');
  const drive = getDriveClient();
  const artistFreqMap = await buildArtistFreqMap();

  // T-07: diff summary (added/changed/removed)
  // NOTE: "removed" is derived from pruneMissing step (hiddenCount).
  const prevMap = new Map(); // googleFileId -> driveModifiedTimeMs
  // DS-06: SEEN_DROP 가드의 기준(prevCount)은 "이번 순회에서 다시 볼 수 있는 곡"이어야 한다.
  // Drive에서 이미 사라져 hidden 처리된 누적 문서까지 포함하면 seenCount가 영원히
  // 기준의 90%에 못 미쳐 prune이 영구 중단된다(자가 치유 불가). visible만 센다.
  let prevVisibleCount = 0;
  try {
    const prevRows = await Song.find({ syncRootId: rootFolderId }, { googleFileId: 1, driveModifiedTime: 1, hidden: 1 })
      .limit(30_000)
      .lean();
    (prevRows || []).forEach((r) => {
      const id = String(r.googleFileId || '').trim();
      if (!id) return;
      const ms = r.driveModifiedTime ? new Date(r.driveModifiedTime).getTime() : 0;
      prevMap.set(id, Number.isFinite(ms) ? ms : 0);
      if (r.hidden !== true) prevVisibleCount += 1;
    });
  } catch {
    // best-effort only
  }
  const diff = {
    addedCount: 0,
    changedCount: 0,
    removedCount: 0,
    // small sample for UI/debug
    added: [],
    changed: [],
    removed: []
  };

  const queue = [{ folderId: rootFolderId, path: '' }];
  let processed = 0;
  let skipped = 0;
  const now = Date.now();
  const startedAt = new Date();
  const latestThreshold = now - latestDays * 24 * 60 * 60 * 1000;
  const incSinceDate = incrementalSince ? new Date(incrementalSince) : null;

  // 순회 완전성 추적: 하나라도 불완전하면 pruneMissing(누락 숨김)을 돌리면 안 된다.
  let reachedLimit = false;
  let listFailureCount = 0;
  const listFailures = []; // { path, error } 샘플
  // 진단용: PDF가 아니라 건너뛴 항목(왜 노래책에 안 들어오는지 추적)
  let skippedNonPdfCount = 0;
  const skippedNonPdf = []; // { name, mimeType } 샘플
  // DS-12: DB 쓰기 1건 실패가 회차 전체를 죽이지 않도록 곡별로 격리해 집계한다.
  // 실패한 곡은 lastSeenAt이 안 찍히므로, 실패가 있으면 prune을 보류한다(오숨김 방지).
  let updateErrorCount = 0;
  const updateErrors = []; // { name, error } 샘플

  const abortResult = () => ({
    processed,
    skipped,
    hiddenCount: 0,
    reachedLimit,
    aborted: true,
    startedAt,
    diff,
    listFailureCount,
    listFailures,
    skippedNonPdfCount,
    skippedNonPdf,
    updateErrorCount,
    updateErrors
  });

  outer: while (queue.length) {
    if (typeof shouldAbort === 'function' && shouldAbort()) return abortResult();
    const { folderId, path } = queue.shift();
    try {
      Promise.resolve(onProgress?.({ phase: 'folder', processed, skipped, currentPath: path, queueLength: queue.length })).catch(() => {});
    } catch {}
    let pageToken = undefined;

    do {
      if (typeof shouldAbort === 'function' && shouldAbort()) return abortResult();

      let data;
      try {
        // eslint-disable-next-line no-await-in-loop
        data = await listChildrenWithRetry(drive, folderId, pageToken);
      } catch (err) {
        // 재시도까지 실패한 폴더는 건너뛰되, "불완전 순회"로 기록해서 prune을 막는다.
        listFailureCount += 1;
        if (listFailures.length < 20) listFailures.push({ path, error: String(err?.message || err) });
        break;
      }
      const files = data.files || [];

      for (const f of files) {
        if (typeof shouldAbort === 'function' && shouldAbort()) return abortResult();
        if (processed >= limit) {
          reachedLimit = true;
          break outer;
        }
        const mime = f.mimeType || '';
        if (mime === 'application/vnd.google-apps.folder') {
          queue.push({ folderId: f.id, path: path ? `${path}/${f.name}` : f.name });
          continue;
        }

        // 바로가기(shortcut)는 mimeType이 PDF가 아니라 그냥 건너뛰어졌다.
        // 대상이 PDF면 원본 fileId로 해석해서 정상 처리한다(뷰어는 원본 id로만 열 수 있다).
        let fileId = f.id;
        let effectiveMime = mime;
        if (mime === 'application/vnd.google-apps.shortcut') {
          const targetId = String(f.shortcutDetails?.targetId || '').trim();
          const targetMime = String(f.shortcutDetails?.targetMimeType || '').trim();
          if (!targetId) continue;
          fileId = targetId;
          effectiveMime = targetMime;
        }

        const isPdf = effectiveMime === 'application/pdf' || String(f.name || '').toLowerCase().endsWith('.pdf');
        if (!isPdf) {
          skippedNonPdfCount += 1;
          if (skippedNonPdf.length < 30) skippedNonPdf.push({ name: String(f.name || ''), mimeType: effectiveMime, folderPath: path });
          continue;
        }

        const nameNoExt = stripExt(f.name);
        const norm = normalizeSongFileName({ filenameNoExt: nameNoExt, artistFreqMap });
        const hiddenByPattern = norm.parseError === 'HIDDEN_BAD_PATTERN';
        const title = hiddenByPattern ? stripExt(f.name) : norm.title || stripExt(f.name);
        const artist = hiddenByPattern ? '' : norm.artist || '';
        // 괄호형 조성을 우선하고, 없으면 legacy key 추출(단, 기존 수동 입력이 있으면 덮어쓰지 않음)
        const keyFromName = hiddenByPattern ? '' : norm.key || extractKeyLegacy(nameNoExt);
        const parseError = norm.parseError || '';
        const displayTitle = title;
        const driveModifiedTime = f.modifiedTime ? new Date(f.modifiedTime) : null;
        const isLatest = driveModifiedTime ? driveModifiedTime.getTime() >= latestThreshold : false;
        const prevMs = prevMap.has(String(fileId)) ? prevMap.get(String(fileId)) : null;
        const nextMs = driveModifiedTime ? driveModifiedTime.getTime() : 0;
        // DS-01(2차 감사): 파일이 변경되지 않았으면(mtime 동일) 관리자가 DB에서 수동
        // 편집한 title/displayTitle/artist/parseError를 보존한다. Drive에서 파일명을
        // 실제로 바꾸면 mtime이 갱신되어 기존처럼 파싱값으로 덮인다("파일명=진실"은
        // 파일이 변한 경우에만). incremental skip 브랜치의 보존 철학과 동일.
        const fileUnchanged =
          prevMs !== null && Number.isFinite(prevMs) && Number.isFinite(nextMs) && nextMs !== 0 && prevMs === nextMs;

        if (incSinceDate && driveModifiedTime && driveModifiedTime.getTime() <= incSinceDate.getTime()) {
          // still mark as seen to avoid pruning when scanning the same root repeatedly
          // DS-05: upsert 금지 — skip 브랜치는 "기존 문서의 최소 갱신"만 담당한다.
          // 문서가 없으면(과거에 동기화된 적 없는 파일이 이동 등으로 나타난 경우)
          // 아래 full 파싱 경로로 내려보내 searchText/key/태그가 완전한 문서를 만든다.
          // 예전에는 여기서 upsert되어 검색/필터에서 빠지는 스텁 문서가 생겼다.
          let matchedExisting = false;
          try {
            const r = await Song.updateOne(
              { googleFileId: fileId },
              [
                {
                  $set: {
                    syncRootId: rootFolderId,
                    lastSeenAt: startedAt,
                    driveModifiedTime,
                    // 최소 정보는 항상 채워서 "제목없음" 스텁 데이터가 쌓이지 않게 한다.
                    driveUrl: buildViewUrl(fileId),
                    folderPath: path,
                    // IMPORTANT:
                    // pruneMissing(누락 파일 숨김)으로 hidden=true가 된 곡도,
                    // 실제로 Drive에서 "존재하는 파일"임이 확인되면 즉시 hidden=false로 복구되어야 한다.
                    // 단, 관리자가 수동으로 지정한 숨김/노출(hiddenManual)은 보존한다(DS-07).
                    hidden: { $cond: [{ $eq: ['$hiddenManual', true] }, '$hidden', hiddenByPattern] },
                    // 최신 배지(기존 값이 남아 있을 수 있어 갱신)
                    isLatest
                  }
                },
                {
                  // title/displayTitle/artist는 비어있을 때만 채운다(수동 편집 보존)
                  $set: {
                    title: { $cond: [{ $eq: [{ $ifNull: ['$title', ''] }, ''] }, title, '$title'] },
                    displayTitle: {
                      $cond: [{ $eq: [{ $ifNull: ['$displayTitle', ''] }, ''] }, displayTitle, '$displayTitle']
                    },
                    artist: { $cond: [{ $eq: [{ $ifNull: ['$artist', ''] }, ''] }, artist, '$artist'] }
                  }
                }
              ],
              { upsert: false }
            );
            matchedExisting = Boolean(r?.matchedCount);
          } catch (err) {
            updateErrorCount += 1;
            if (updateErrors.length < 10) updateErrors.push({ name: String(f.name || ''), error: String(err?.message || err) });
            continue;
          }
          if (matchedExisting) {
            skipped += 1;
            try {
              Promise.resolve(onProgress?.({ phase: 'skip', processed, skipped, currentPath: path, fileName: f.name || '' })).catch(() => {});
            } catch {}
            continue;
          }
          // 문서 없음 → full 파싱 경로로 계속 진행
        }

        const tags = extractBracketTags(nameNoExt);
        // Very loose tag mapping (safe defaults)
        const genre = tags.find((t) => ['KPOP', 'JPOP', 'POP', 'OST', '기타'].includes(t)) || '';
        const mood = tags.find((t) => ['발라드', '락발라드', '밴드송', '댄스', '뮤지컬', '힙합', '동요'].includes(t)) || '';
        const vocal = tags.find((t) => ['남솔로', '여솔로', '듀엣', '그룹곡'].includes(t)) || '';

        // IMPORTANT: 관리자 수동 태그 입력을 보존하기 위해, key/genre/mood/vocal은 "비어있을 때만" 채움.
        // 이를 위해 update pipeline을 사용(표현식 기반).
        try {
        await Song.updateOne(
          { googleFileId: fileId },
          [
            {
              $set: {
                // fileUnchanged면 기존 문서 값 보존($ifNull은 upsert 신규 문서에만 파싱값 적용)
                title: fileUnchanged ? { $ifNull: ['$title', title] } : title,
                displayTitle: fileUnchanged ? { $ifNull: ['$displayTitle', displayTitle] } : displayTitle,
                artist: fileUnchanged ? { $ifNull: ['$artist', artist] } : artist,
                driveUrl: buildViewUrl(fileId),
                folderPath: path,
                parseError: fileUnchanged ? { $ifNull: ['$parseError', parseError] } : parseError,
                isLatest,
                driveModifiedTime,
                // DS-07: 수동 숨김/노출(hiddenManual=true)은 파일명 패턴 재계산으로 덮지 않는다.
                hidden: { $cond: [{ $eq: ['$hiddenManual', true] }, '$hidden', hiddenByPattern] },
                syncRootId: rootFolderId,
                lastSeenAt: startedAt
              }
            },
            {
              $set: {
                key: {
                  $cond: [{ $eq: [{ $ifNull: ['$key', ''] }, ''] }, keyFromName, '$key']
                },
                genre: {
                  $cond: [{ $eq: [{ $ifNull: ['$genre', ''] }, ''] }, genre, '$genre']
                },
                mood: {
                  $cond: [{ $eq: [{ $ifNull: ['$mood', ''] }, ''] }, mood, '$mood']
                },
                vocal: {
                  $cond: [{ $eq: [{ $ifNull: ['$vocal', ''] }, ''] }, vocal, '$vocal']
                }
              }
            },
            {
              $set: {
                searchText: {
                  $toLower: {
                    $concat: [
                      { $ifNull: ['$displayTitle', ''] },
                      ' ',
                      { $ifNull: ['$title', ''] },
                      ' ',
                      { $ifNull: ['$artist', ''] },
                      ' ',
                      { $ifNull: ['$genre', ''] },
                      ' ',
                      { $ifNull: ['$mood', ''] },
                      ' ',
                      { $ifNull: ['$vocal', ''] },
                      ' ',
                      { $ifNull: ['$key', ''] }
                    ]
                  }
                }
              }
            }
          ],
          { upsert: true }
        );
        } catch (err) {
          // DS-12: 곡 1건 쓰기 실패(unique 충돌·일시적 Mongo 오류)로 회차 전체를 죽이지 않는다.
          updateErrorCount += 1;
          if (updateErrors.length < 10) updateErrors.push({ name: String(f.name || ''), error: String(err?.message || err) });
          continue;
        }

        // diff counting (best-effort)
        try {
          if (prevMs === null) {
            diff.addedCount += 1;
            if (diff.added.length < 20) diff.added.push({ googleFileId: fileId, name: f.name || '', folderPath: path });
          } else if (Number.isFinite(prevMs) && Number.isFinite(nextMs) && nextMs && prevMs && nextMs !== prevMs) {
            diff.changedCount += 1;
            if (diff.changed.length < 20) diff.changed.push({ googleFileId: fileId, name: f.name || '', folderPath: path });
          }
        } catch {}

        processed += 1;
        try {
          Promise.resolve(onProgress?.({ phase: 'file', processed, skipped, currentPath: path, fileName: f.name || '' })).catch(() => {});
        } catch {}
      }

      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  }

  let hiddenCount = 0;
  // pruneMissing은 "이번 순회에서 못 본 곡"을 전부 hidden 처리한다.
  // 따라서 순회가 조금이라도 불완전했다면 절대 돌리면 안 된다.
  // (돌리면 멀쩡한 곡이 무더기로 사라졌다가 다음 회차에 복구되는 현상이 생긴다)
  let pruneSkippedReason = '';
  if (pruneMissing) {
    if (typeof shouldAbort === 'function' && shouldAbort()) return abortResult();

    const seenCount = processed + skipped;
    const prevCount = prevVisibleCount;

    if (listFailureCount > 0) {
      pruneSkippedReason = `LIST_FAILURES:${listFailureCount}`;
    } else if (updateErrorCount > 0) {
      // 쓰기 실패한 곡은 lastSeenAt이 안 찍혀 prune이 오숨김할 수 있다.
      pruneSkippedReason = `UPDATE_ERRORS:${updateErrorCount}`;
    } else if (reachedLimit) {
      pruneSkippedReason = `REACHED_LIMIT:${limit}`;
    } else if (prevCount >= 50 && seenCount < Math.floor(prevCount * 0.9)) {
      // 이전 동기화보다 10% 이상 적게 봤다면 순회가 불완전했을 가능성이 높다.
      pruneSkippedReason = `SEEN_DROP:${seenCount}/${prevCount}`;
    } else {
      const r = await Song.updateMany(
        { syncRootId: rootFolderId, lastSeenAt: { $lt: startedAt }, hidden: { $ne: true } },
        { $set: { hidden: true } }
      );
      hiddenCount = r.modifiedCount || r.nModified || 0;
      diff.removedCount = hiddenCount;
      // removed list is expensive; skip for now (could be derived from query if needed)
    }
  }

  return {
    processed,
    skipped,
    hiddenCount,
    reachedLimit,
    startedAt,
    diff,
    // 진단 정보: 곡이 왜 안 들어왔는지 추적용
    listFailureCount,
    listFailures,
    skippedNonPdfCount,
    skippedNonPdf,
    pruneSkippedReason,
    seenCount: processed + skipped,
    prevCount: prevVisibleCount,
    updateErrorCount,
    updateErrors
  };
}

module.exports = { syncDriveFolderTree };
