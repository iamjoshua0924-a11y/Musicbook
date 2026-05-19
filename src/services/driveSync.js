const Song = require('../models/Song');
const { getDriveClient, buildViewUrl } = require('./drive');

function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim();
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
    // We can't know direction for sure; assume "artist - title" first.
    return { artist: parts[0], title: parts[1], parseError: '' };
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

async function syncDriveFolderTree({ rootFolderId, latestDays = 30, limit = 5000 }) {
  if (!rootFolderId) throw new Error('ROOT_FOLDER_ID_REQUIRED');
  const drive = getDriveClient();

  const queue = [{ folderId: rootFolderId, path: '' }];
  let processed = 0;
  const now = Date.now();
  const latestThreshold = now - latestDays * 24 * 60 * 60 * 1000;

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

        const { artist, title, parseError } = parseArtistTitle(stripExt(f.name));
        const displayTitle = title;
        const driveModifiedTime = f.modifiedTime ? new Date(f.modifiedTime) : null;
        const isLatest = driveModifiedTime ? driveModifiedTime.getTime() >= latestThreshold : false;

        const searchText = `${displayTitle} ${title} ${artist}`.toLowerCase();

        await Song.findOneAndUpdate(
          { googleFileId: f.id },
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
              searchText,
              hidden: false
            }
          },
          { upsert: true }
        );

        processed += 1;
      }

      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  }

  return { processed, reachedLimit: false };
}

module.exports = { syncDriveFolderTree, parseArtistTitle };

