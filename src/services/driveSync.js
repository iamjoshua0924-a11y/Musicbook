const Song = require('../models/Song');
const { getDriveClient, buildViewUrl } = require('./drive');

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

function extractKey(name) {
  // examples: "Key C", "key:C#", "(Key Gm)", "[Key F]"
  const m =
    name.match(/(?:\bkey\b)\s*[:\-]?\s*([A-G](?:#|b)?m?)/i) ||
    name.match(/\((?:\s*key\s*)[:\-]?\s*([A-G](?:#|b)?m?)\s*\)/i);
  return m ? String(m[1] || '').trim() : '';
}

/**
 * Parse rules (per requirement):
 * 1) "아티스트 - 곡제목.pdf"
 * 2) "곡제목 - 아티스트.pdf"
 */
function parseArtistTitle(filenameNoExt) {
  const base = stripExt(filenameNoExt);
  const parts = base.split(' - ').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2) {
    // Heuristic:
    // - if left looks like "곡" (contains key/tag markers) and right looks like person/team name, swap.
    // - else default "artist - title"
    const left = parts[0];
    const right = parts[1];
    const leftHasKey = /\bkey\b/i.test(left) || extractBracketTags(left).length > 0;
    const rightHasKey = /\bkey\b/i.test(right) || extractBracketTags(right).length > 0;
    if (leftHasKey && !rightHasKey) return { artist: right, title: left, parseError: '' };
    return { artist: left, title: right, parseError: '' };
  }
  const parts2 = base.split('-').map((s) => s.trim()).filter(Boolean);
  if (parts2.length === 2) {
    return { artist: parts2[0], title: parts2[1], parseError: '' };
  }
  return { artist: '', title: base, parseError: 'FILENAME_PARSE_FAILED' };
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

async function syncDriveFolderTree({ rootFolderId, latestDays = 30, limit = 5000, incrementalSince = null, pruneMissing = true }) {
  if (!rootFolderId) throw new Error('ROOT_FOLDER_ID_REQUIRED');
  const drive = getDriveClient();

  const queue = [{ folderId: rootFolderId, path: '' }];
  let processed = 0;
  let skipped = 0;
  const now = Date.now();
  const startedAt = new Date();
  const latestThreshold = now - latestDays * 24 * 60 * 60 * 1000;
  const incSinceDate = incrementalSince ? new Date(incrementalSince) : null;

  while (queue.length) {
    const { folderId, path } = queue.shift();
    let pageToken = undefined;

    do {
      const data = await listChildren(drive, folderId, pageToken);
      const files = data.files || [];

      for (const f of files) {
        if (processed >= limit) return { processed, reachedLimit: true };
        const mime = f.mimeType || '';
        if (mime === 'application/vnd.google-apps.folder') {
          queue.push({ folderId: f.id, path: path ? `${path}/${f.name}` : f.name });
          continue;
        }

        const isPdf = mime === 'application/pdf' || String(f.name || '').toLowerCase().endsWith('.pdf');
        if (!isPdf) continue;

        const nameNoExt = stripExt(f.name);
        const { artist, title, parseError } = parseArtistTitle(nameNoExt);
        const displayTitle = title;
        const driveModifiedTime = f.modifiedTime ? new Date(f.modifiedTime) : null;
        const isLatest = driveModifiedTime ? driveModifiedTime.getTime() >= latestThreshold : false;

        if (incSinceDate && driveModifiedTime && driveModifiedTime.getTime() <= incSinceDate.getTime()) {
          // still mark as seen to avoid pruning when scanning the same root repeatedly
          await Song.updateOne(
            { googleFileId: f.id },
            { $set: { syncRootId: rootFolderId, lastSeenAt: startedAt, driveModifiedTime } },
            { upsert: true }
          );
          skipped += 1;
          continue;
        }

        const tags = extractBracketTags(nameNoExt);
        const key = extractKey(nameNoExt);
        // Very loose tag mapping (safe defaults)
        const genre = tags.find((t) => ['KPOP', 'JPOP', 'POP', 'OST', '기타'].includes(t)) || '';
        const mood = tags.find((t) => ['발라드', '락발라드', '밴드송', '댄스', '뮤지컬', '힙합', '동요'].includes(t)) || '';
        const vocal = tags.find((t) => ['남솔로', '여솔로', '듀엣', '그룹곡'].includes(t)) || '';

        const searchText = `${displayTitle} ${title} ${artist} ${genre} ${mood} ${vocal} ${key}`.toLowerCase();

        await Song.findOneAndUpdate(
          { googleFileId: f.id },
          {
            $set: {
              title,
              displayTitle,
              artist,
              key,
              genre,
              mood,
              vocal,
              driveUrl: buildViewUrl(f.id),
              folderPath: path,
              parseError,
              isLatest,
              driveModifiedTime,
              searchText,
              hidden: false,
              syncRootId: rootFolderId,
              lastSeenAt: startedAt
            }
          },
          { upsert: true }
        );

        processed += 1;
      }

      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  }

  let hiddenCount = 0;
  if (pruneMissing) {
    const r = await Song.updateMany(
      { syncRootId: rootFolderId, lastSeenAt: { $lt: startedAt }, hidden: { $ne: true } },
      { $set: { hidden: true } }
    );
    hiddenCount = r.modifiedCount || r.nModified || 0;
  }

  return { processed, skipped, hiddenCount, reachedLimit: false, startedAt };
}

module.exports = { syncDriveFolderTree, parseArtistTitle };
