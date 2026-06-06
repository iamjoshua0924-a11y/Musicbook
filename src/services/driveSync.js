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
    fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,size)',
    pageSize: 1000,
    pageToken
  });
  return res.data;
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
  try {
    const prevRows = await Song.find({ syncRootId: rootFolderId }, { googleFileId: 1, driveModifiedTime: 1 })
      .limit(30_000)
      .lean();
    (prevRows || []).forEach((r) => {
      const id = String(r.googleFileId || '').trim();
      if (!id) return;
      const ms = r.driveModifiedTime ? new Date(r.driveModifiedTime).getTime() : 0;
      prevMap.set(id, Number.isFinite(ms) ? ms : 0);
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

  while (queue.length) {
    if (typeof shouldAbort === 'function' && shouldAbort()) {
      return { processed, skipped, hiddenCount: 0, reachedLimit: false, aborted: true, startedAt, diff };
    }
    const { folderId, path } = queue.shift();
    try {
      onProgress?.({ phase: 'folder', processed, skipped, currentPath: path, queueLength: queue.length });
    } catch {}
    let pageToken = undefined;

    do {
      if (typeof shouldAbort === 'function' && shouldAbort()) {
        return { processed, skipped, hiddenCount: 0, reachedLimit: false, aborted: true, startedAt, diff };
      }
      const data = await listChildren(drive, folderId, pageToken);
      const files = data.files || [];

      for (const f of files) {
        if (typeof shouldAbort === 'function' && shouldAbort()) {
          return { processed, skipped, hiddenCount: 0, reachedLimit: false, aborted: true, startedAt, diff };
        }
        if (processed >= limit) return { processed, reachedLimit: true, diff };
        const mime = f.mimeType || '';
        if (mime === 'application/vnd.google-apps.folder') {
          queue.push({ folderId: f.id, path: path ? `${path}/${f.name}` : f.name });
          continue;
        }

        const isPdf = mime === 'application/pdf' || String(f.name || '').toLowerCase().endsWith('.pdf');
        if (!isPdf) continue;

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
        const prevMs = prevMap.has(String(f.id)) ? prevMap.get(String(f.id)) : null;
        const nextMs = driveModifiedTime ? driveModifiedTime.getTime() : 0;

        if (incSinceDate && driveModifiedTime && driveModifiedTime.getTime() <= incSinceDate.getTime()) {
          // still mark as seen to avoid pruning when scanning the same root repeatedly
          await Song.updateOne(
            { googleFileId: f.id },
            [
              {
                $set: {
                  syncRootId: rootFolderId,
                  lastSeenAt: startedAt,
                  driveModifiedTime,
                  // 최소 정보는 항상 채워서 "제목없음" 스텁 데이터가 쌓이지 않게 한다.
                  driveUrl: buildViewUrl(f.id),
                  folderPath: path,
                  // IMPORTANT:
                  // pruneMissing(누락 파일 숨김)으로 hidden=true가 된 곡도,
                  // 실제로 Drive에서 "존재하는 파일"임이 확인되면 즉시 hidden=false로 복구되어야 한다.
                  // incremental 모드에서 변경이 없다고 skip 처리되면 hidden이 그대로 남아
                  // UI에서 "전체 곡 수가 600/1200처럼 줄어드는" 현상이 생길 수 있다.
                  hidden: hiddenByPattern ? true : false,
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
            { upsert: true }
          );
          skipped += 1;
          try {
            onProgress?.({ phase: 'skip', processed, skipped, currentPath: path, fileName: f.name || '' });
          } catch {}
          continue;
        }

        const tags = extractBracketTags(nameNoExt);
        // Very loose tag mapping (safe defaults)
        const genre = tags.find((t) => ['KPOP', 'JPOP', 'POP', 'OST', '기타'].includes(t)) || '';
        const mood = tags.find((t) => ['발라드', '락발라드', '밴드송', '댄스', '뮤지컬', '힙합', '동요'].includes(t)) || '';
        const vocal = tags.find((t) => ['남솔로', '여솔로', '듀엣', '그룹곡'].includes(t)) || '';

        // IMPORTANT: 관리자 수동 태그 입력을 보존하기 위해, key/genre/mood/vocal은 "비어있을 때만" 채움.
        // 이를 위해 update pipeline을 사용(표현식 기반).
        await Song.updateOne(
          { googleFileId: f.id },
          [
            {
              $set: {
                title,
                displayTitle,
                artist,
                driveUrl: buildViewUrl(f.id),
                folderPath: path,
                parseError,
                isLatest,
                driveModifiedTime,
                hidden: hiddenByPattern ? true : false,
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
                      String(displayTitle || ''),
                      ' ',
                      String(title || ''),
                      ' ',
                      String(artist || ''),
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

        // diff counting (best-effort)
        try {
          if (prevMs === null) {
            diff.addedCount += 1;
            if (diff.added.length < 20) diff.added.push({ googleFileId: f.id, name: f.name || '', folderPath: path });
          } else if (Number.isFinite(prevMs) && Number.isFinite(nextMs) && nextMs && prevMs && nextMs !== prevMs) {
            diff.changedCount += 1;
            if (diff.changed.length < 20) diff.changed.push({ googleFileId: f.id, name: f.name || '', folderPath: path });
          }
        } catch {}

        processed += 1;
        try {
          onProgress?.({ phase: 'file', processed, skipped, currentPath: path, fileName: f.name || '' });
        } catch {}
      }

      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  }

  let hiddenCount = 0;
  if (pruneMissing) {
    if (typeof shouldAbort === 'function' && shouldAbort()) {
      return { processed, skipped, hiddenCount: 0, reachedLimit: false, aborted: true, startedAt, diff };
    }
    const r = await Song.updateMany(
      { syncRootId: rootFolderId, lastSeenAt: { $lt: startedAt }, hidden: { $ne: true } },
      { $set: { hidden: true } }
    );
    hiddenCount = r.modifiedCount || r.nModified || 0;
    diff.removedCount = hiddenCount;
    // removed list is expensive; skip for now (could be derived from query if needed)
  }

  return { processed, skipped, hiddenCount, reachedLimit: false, startedAt, diff };
}

module.exports = { syncDriveFolderTree };
