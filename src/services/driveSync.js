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
  limit = 5000,
  incrementalSince = null,
  pruneMissing = true,
  shouldAbort,
  onProgress
} = {}) {
  if (!rootFolderId) throw new Error('ROOT_FOLDER_ID_REQUIRED');
  const drive = getDriveClient();
  const artistFreqMap = await buildArtistFreqMap();

  const queue = [{ folderId: rootFolderId, path: '' }];
  let processed = 0;
  let skipped = 0;
  const now = Date.now();
  const startedAt = new Date();
  const latestThreshold = now - latestDays * 24 * 60 * 60 * 1000;
  const incSinceDate = incrementalSince ? new Date(incrementalSince) : null;

  while (queue.length) {
    if (typeof shouldAbort === 'function' && shouldAbort()) {
      return { processed, skipped, hiddenCount: 0, reachedLimit: false, aborted: true, startedAt };
    }
    const { folderId, path } = queue.shift();
    try {
      onProgress?.({ phase: 'folder', processed, skipped, currentPath: path, queueLength: queue.length });
    } catch {}
    let pageToken = undefined;

    do {
      if (typeof shouldAbort === 'function' && shouldAbort()) {
        return { processed, skipped, hiddenCount: 0, reachedLimit: false, aborted: true, startedAt };
      }
      const data = await listChildren(drive, folderId, pageToken);
      const files = data.files || [];

      for (const f of files) {
        if (typeof shouldAbort === 'function' && shouldAbort()) {
          return { processed, skipped, hiddenCount: 0, reachedLimit: false, aborted: true, startedAt };
        }
        if (processed >= limit) return { processed, reachedLimit: true };
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
                  folderPath: path
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
      return { processed, skipped, hiddenCount: 0, reachedLimit: false, aborted: true, startedAt };
    }
    const r = await Song.updateMany(
      { syncRootId: rootFolderId, lastSeenAt: { $lt: startedAt }, hidden: { $ne: true } },
      { $set: { hidden: true } }
    );
    hiddenCount = r.modifiedCount || r.nModified || 0;
  }

  return { processed, skipped, hiddenCount, reachedLimit: false, startedAt };
}

module.exports = { syncDriveFolderTree };
