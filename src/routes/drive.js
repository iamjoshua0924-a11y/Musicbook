const express = require('express');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const router = express.Router();

const Song = require('../models/Song');
const { getDriveClient, getFileMetadata, buildPreviewUrl, buildViewUrl, getSignedDownloadUrl } = require('../services/drive');
const { normalizeSongFileName } = require('../services/songNameNormalizer');
const { getDriveRootFolderId } = require('../services/driveSyncRunner');
const { isFileOpenInRoom } = require('../sockets');
const { requireSessionOrAdmin } = require('../middleware/auth');
const { recordHttp, makeByteCounterStream } = require('../services/trafficMetrics');
const { buildSig, isValidSig, getHourlyExpiryUnix } = require('../services/publicPdfSign');

function extractDriveFileIdFromAny(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m1 = s.match(/\/file\/d\/([^/]+)/);
  if (m1) return m1[1];
  try {
    const u = new URL(s);
    const id = u.searchParams.get('id');
    if (id) return id;
  } catch {}
  return '';
}

function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim();
}

function safeName(name) {
  return String(name || '').replace(/[\\/]/g, '_').trim();
}

async function fetchPublicDriveDownload(fileId, { range } = {}) {
  const firstUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  let res = await fetch(firstUrl, {
    redirect: 'follow',
    headers: range ? { Range: range } : undefined
  });
  const ct = String(res.headers.get('content-type') || '');
  if (res.ok && !ct.includes('text/html')) return res;

  const html = await res.text().catch(() => '');
  // Google Drive download confirm patterns vary; support both "&amp;" and "&"
  const m =
    html.match(/confirm=([0-9A-Za-z_]+).*?(?:id=)([^&"']+)/i) ||
    html.match(/confirm=([0-9A-Za-z_]+)&(?:amp;)?id=([^&]+)/i);
  if (!m) throw new Error('PUBLIC_DOWNLOAD_CONFIRM_REQUIRED');
  const confirm = m[1];
  const id = m[2] || fileId;
  const url = `https://drive.google.com/uc?export=download&confirm=${encodeURIComponent(confirm)}&id=${encodeURIComponent(id)}`;
  res = await fetch(url, {
    redirect: 'follow',
    headers: range ? { Range: range } : undefined
  });
  if (!res.ok) throw new Error(`PUBLIC_DOWNLOAD_FAILED_${res.status}`);
  return res;
}

/**
 * Same-origin iframe target:
 * - tries to stream a PDF (Drive API -> public download fallback)
 * - if all fail, redirects to Drive preview URL so at least "view" might work.
 */
router.get('/drive/embed/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const range = req.headers.range;
  try {
    // iframe로 반복 접근되는 경우가 많아 캐시 허용(세션 파일 포함이므로 private)
    res.setHeader('Cache-Control', 'private, max-age=86400');

    // reuse the pdf streaming route logic by calling handlers inline:
    // 1) Drive API stream
    const drive = getDriveClient();
    const driveRes = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream', headers: range ? { Range: range } : undefined }
    );
    res.setHeader('Content-Type', driveRes.headers?.['content-type'] || 'application/pdf');
    if (driveRes.headers?.etag) res.setHeader('ETag', driveRes.headers.etag);
    if (driveRes.headers?.['last-modified']) res.setHeader('Last-Modified', driveRes.headers['last-modified']);
    if (driveRes.headers?.['content-length']) res.setHeader('Content-Length', driveRes.headers['content-length']);
    if (driveRes.headers?.['content-range']) res.setHeader('Content-Range', driveRes.headers['content-range']);
    res.setHeader('Accept-Ranges', 'bytes');
    const upstreamStatus = Number(driveRes.status) || 200;
    if (range && (upstreamStatus === 206 || driveRes.headers?.['content-range'])) res.status(206);
    const counter = makeByteCounterStream((bytes) => {
      recordHttp({ name: 'drive.embed', fileId, bytes, range: range || '' });
    });
    await pipeline(driveRes.data, counter, res);
  } catch {
    try {
      // 2) public download stream
      const dl = await fetchPublicDriveDownload(fileId, { range });
      const ct = String(dl.headers.get('content-type') || 'application/pdf');
      res.setHeader('Content-Type', ct.includes('pdf') ? 'application/pdf' : ct);
      const clen = dl.headers.get('content-length');
      const cr = dl.headers.get('content-range');
      if (clen) res.setHeader('Content-Length', clen);
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Accept-Ranges', 'bytes');
      const upstreamStatus = Number(dl.status) || 200;
      if (range && (upstreamStatus === 206 || cr)) res.status(206);
      const bodyStream = dl.body ? Readable.fromWeb(dl.body) : null;
      if (!bodyStream) throw new Error('PUBLIC_STREAM_EMPTY');
      const counter = makeByteCounterStream((bytes) => {
        recordHttp({ name: 'drive.embed.public', fileId, bytes, range: range || '' });
      });
      await pipeline(bodyStream, counter, res);
    } catch {
      // 3) last resort: redirect to Drive preview
      res.redirect(buildPreviewUrl(fileId));
    }
  }
});

async function allowSessionOrPublicFile(req, res, next) {
  const role = req.session?.user?.role;
  if (role === 'admin' || role === 'session') return next();
  const fileId = String(req.params?.fileId || '').trim();
  if (!fileId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  // 세션 참여자(로그인 없이 viewer로 접속)도 room 현재 파일은 볼 수 있어야 한다.
  // viewer에서 /viewer/:fileId?room=XXXX 형태로 접근하므로, room의 currentFileId와 일치하면 허용.
  const roomCode = String(req.query?.room || '').trim().toUpperCase();
  if (roomCode && isFileOpenInRoom(roomCode, fileId)) return next();

  try {
    const drive = getDriveClient();
    const meta = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: 'permissions(type,role)'
    });
    const perms = meta?.data?.permissions || [];
    const isPublic = perms.some((p) => p?.type === 'anyone' && typeof p.role === 'string' && p.role.length);
    if (!isPublic) {
      return res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        fallback: { mode: 'iframe', previewUrl: buildPreviewUrl(fileId) }
      });
    }
    return next();
  } catch {
    return res.status(403).json({
      ok: false,
      error: 'FORBIDDEN',
      fallback: { mode: 'iframe', previewUrl: buildPreviewUrl(fileId) }
    });
  }
}

// Cacheable signed public URL for session-open files (cookie-less, CDN friendly).
// NOTE: This does NOT mean "Drive anyone public" — it means "currently open in a session room".
router.get('/drive/cache-url/:fileId', async (req, res) => {
  const fileId = String(req.params?.fileId || '').trim();
  const roomCode = String(req.query?.room || '').trim().toUpperCase();
  if (!fileId || !roomCode) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  if (!isFileOpenInRoom(roomCode, fileId)) {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  }
  const exp = getHourlyExpiryUnix(Date.now(), 1);
  const sig = buildSig({ fileId, roomCode, exp });
  const url = `/api/public/pdf/${encodeURIComponent(fileId)}?room=${encodeURIComponent(roomCode)}&exp=${encodeURIComponent(
    String(exp)
  )}&sig=${encodeURIComponent(sig)}`;
  res.json({ ok: true, url, exp });
});

// Public(cookie-less) PDF streaming endpoint.
// Protected by signed URL (room+fileId+exp+sig). Intended for CDN caching.
router.get('/public/pdf/:fileId', async (req, res) => {
  const fileId = String(req.params?.fileId || '').trim();
  const roomCode = String(req.query?.room || '').trim().toUpperCase();
  const exp = Number(req.query?.exp || 0);
  const sig = String(req.query?.sig || '');
  const range = req.headers.range;

  if (!fileId || !roomCode || !exp || !sig) return res.status(400).send('BAD_REQUEST');
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(exp) || exp < now - 10) return res.status(403).send('EXPIRED');
  if (!isValidSig({ fileId, roomCode, exp, sig })) return res.status(403).send('FORBIDDEN');

  // Extra guard: must still be open in room (prevents link reuse after session changed)
  if (!isFileOpenInRoom(roomCode, fileId)) return res.status(403).send('FORBIDDEN');

  // Cache policy: public for CDN, but URL is exp/sig scoped.
  // Keep TTL <= exp window; for simplicity allow 1h edge cache.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.setHeader('Vary', 'Range');

  try {
    const drive = getDriveClient();
    const driveRes = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream', headers: range ? { Range: range } : undefined }
    );
    res.setHeader('Content-Type', driveRes.headers?.['content-type'] || 'application/pdf');
    if (driveRes.headers?.etag) res.setHeader('ETag', driveRes.headers.etag);
    if (driveRes.headers?.['last-modified']) res.setHeader('Last-Modified', driveRes.headers['last-modified']);
    if (driveRes.headers?.['content-length']) res.setHeader('Content-Length', driveRes.headers['content-length']);
    if (driveRes.headers?.['content-range']) res.setHeader('Content-Range', driveRes.headers['content-range']);
    res.setHeader('Accept-Ranges', 'bytes');
    const upstreamStatus = Number(driveRes.status) || 200;
    if (range && (upstreamStatus === 206 || driveRes.headers?.['content-range'])) res.status(206);

    const counter = makeByteCounterStream((bytes) => {
      recordHttp({ name: 'public.pdf', fileId, bytes, range: range || '' });
    });
    await pipeline(driveRes.data, counter, res);
  } catch (e) {
    res.status(403).send('STREAM_BLOCKED');
  }
});

/**
 * Streaming pipe endpoint (NO buffering in memory).
 * - Supports Range header (pass-through to Drive).
 * - If Drive blocks download, client can use /api/drive/preview/:fileId and fallback to iframe.
 */
router.get('/drive/pdf/:fileId', allowSessionOrPublicFile, async (req, res) => {
  const { fileId } = req.params;
  const range = req.headers.range;

  try {
    // 트래픽 절감: 클라이언트 캐시 허용(파일이 자주 바뀌지 않는 전제)
    // - 공개 캐시가 아니라 "private"로만 (세션 파일 포함)
    // - Range 요청도 캐시될 수 있게 Accept-Ranges 유지
    res.setHeader('Cache-Control', 'private, max-age=86400');

    const drive = getDriveClient();

    // Prefer streaming bytes directly.
    const driveRes = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      {
        responseType: 'stream',
        headers: range ? { Range: range } : undefined
      }
    );

    // Propagate important headers.
    res.setHeader('Content-Type', driveRes.headers?.['content-type'] || 'application/pdf');
    if (driveRes.headers?.etag) res.setHeader('ETag', driveRes.headers.etag);
    if (driveRes.headers?.['last-modified']) res.setHeader('Last-Modified', driveRes.headers['last-modified']);
    if (driveRes.headers?.['content-length']) res.setHeader('Content-Length', driveRes.headers['content-length']);
    if (driveRes.headers?.['content-range']) res.setHeader('Content-Range', driveRes.headers['content-range']);
    res.setHeader('Accept-Ranges', 'bytes');

    // If upstream returned partial content, mirror status.
    const upstreamStatus = Number(driveRes.status) || 200;
    if (range && (upstreamStatus === 206 || driveRes.headers?.['content-range'])) {
      res.status(206);
    }

    const counter = makeByteCounterStream((bytes) => {
      recordHttp({ name: 'drive.pdf', fileId, bytes, range: range || '' });
    });
    await pipeline(driveRes.data, counter, res);
  } catch (err) {
    // Fallback: if Drive API streaming is blocked but link is public,
    // try public download streaming (so sessions can still view without Google login).
    try {
      const dl = await fetchPublicDriveDownload(fileId, { range });
      const ct = String(dl.headers.get('content-type') || 'application/pdf');
      res.setHeader('Content-Type', ct.includes('pdf') ? 'application/pdf' : ct);
      const clen = dl.headers.get('content-length');
      const cr = dl.headers.get('content-range');
      if (clen) res.setHeader('Content-Length', clen);
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Accept-Ranges', 'bytes');
      const upstreamStatus = Number(dl.status) || 200;
      if (range && (upstreamStatus === 206 || cr)) res.status(206);
      const bodyStream = dl.body ? Readable.fromWeb(dl.body) : null;
      if (!bodyStream) throw new Error('PUBLIC_STREAM_EMPTY');
      const counter = makeByteCounterStream((bytes) => {
        recordHttp({ name: 'drive.pdf.public', fileId, bytes, range: range || '' });
      });
      await pipeline(bodyStream, counter, res);
    } catch {
      // Do not leak details; client can use preview fallback.
      res.status(403).json({
        ok: false,
        error: 'DRIVE_STREAM_FAILED',
        fallback: { mode: 'iframe', previewUrl: buildPreviewUrl(fileId) }
      });
    }
  }
});

/**
 * Direct URL endpoint:
 * - Render가 PDF 바이트를 중계하지 않고, 브라우저가 Drive에 직접 요청할 URL을 반환한다.
 * - 권한 확인은 /drive/pdf 와 동일하게 allowSessionOrPublicFile을 사용한다.
 */
router.get('/drive/pdf-url/:fileId', allowSessionOrPublicFile, async (req, res) => {
  const { fileId } = req.params;
  try {
    const { url, expiresAt } = await getSignedDownloadUrl(fileId, 900); // 15분
    return res.json({
      ok: true,
      url,
      expiresAt,
      fileId,
      fallback: { mode: 'iframe', previewUrl: buildPreviewUrl(fileId) }
    });
  } catch (err) {
    // Drive API 접근 실패 시: 공개 파일이면 공개 다운로드 URL을 반환(※ confirm이 뜰 수 있어 실패 가능)
    const publicUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
    return res.json({
      ok: true,
      url: publicUrl,
      expiresAt: Date.now() + 3600 * 1000,
      fileId,
      isPublic: true,
      fallback: { mode: 'iframe', previewUrl: buildPreviewUrl(fileId) }
    });
  }
});

// Public: preview URL builder does not access Drive API; safe for anonymous viewer mode.
router.get('/drive/preview/:fileId', async (req, res) => {
  const { fileId } = req.params;
  res.json({ ok: true, previewUrl: buildPreviewUrl(fileId), viewUrl: buildViewUrl(fileId) });
});

// New-tab helper: /view 는 iframe 임베드가 안 되는 경우가 많아(Drive X-Frame-Options),
// "새 탭으로 열기" 용으로만 제공한다.
router.get('/drive/view/:fileId', async (req, res) => {
  const { fileId } = req.params;
  res.redirect(buildViewUrl(fileId));
});

router.get('/drive/meta/:fileId', requireSessionOrAdmin, async (req, res) => {
  const { fileId } = req.params;
  try {
    const meta = await getFileMetadata(fileId);
    res.json({ ok: true, meta, previewUrl: buildPreviewUrl(fileId) });
  } catch (err) {
    res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  }
});

/**
 * 외부 Drive 파일을 "동기화된 파일처럼" 세션에서 열 수 있도록 가져오기.
 * - 1순위: Drive API copy (서비스계정이 접근 가능한 경우)
 * - 2순위: public download(uc?export=download) -> 업로드 (링크 공개지만 API 접근이 막힌 경우)
 * - 가져온 파일은 rootFolderId 아래에 생성되고, Song DB에 즉시 반영된다.
 */
router.post('/drive/import', requireSessionOrAdmin, async (req, res) => {
  const sourceUrl = String(req.body?.sourceUrl || '').trim();
  const sourceFileId = String(req.body?.sourceFileId || '').trim();
  const srcId = sourceFileId || extractDriveFileIdFromAny(sourceUrl);
  if (!srcId) return res.status(400).json({ ok: false, error: 'FILE_ID_REQUIRED' });

  const rootFolderId = String(await getDriveRootFolderId()).trim();
  if (!rootFolderId) return res.status(400).json({ ok: false, error: 'ROOT_FOLDER_ID_REQUIRED' });

  const drive = getDriveClient();
  /** @type {{id?:string,name?:string,mimeType?:string,modifiedTime?:string}|null} */
  let created = null;
  let originalName = '';

  // 1) Drive API copy
  try {
    const meta = await getFileMetadata(srcId);
    originalName = String(meta?.name || '').trim();
    const mime = String(meta?.mimeType || '').trim();
    const isPdf = mime === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ ok: false, error: 'PDF_ONLY' });

    const copied = await drive.files.copy({
      fileId: srcId,
      supportsAllDrives: true,
      requestBody: { parents: [rootFolderId], name: safeName(originalName || `${srcId}.pdf`) },
      fields: 'id,name,mimeType,modifiedTime'
    });
    created = copied.data;
  } catch {
    created = null;
  }

  // 2) Public download -> upload
  if (!created?.id) {
    try {
      const dl = await fetchPublicDriveDownload(srcId);
      const ct = String(dl.headers.get('content-type') || 'application/pdf');
      if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
        return res.status(400).json({ ok: false, error: 'PUBLIC_DOWNLOAD_NOT_PDF' });
      }
      const cd = String(dl.headers.get('content-disposition') || '');
      const fnm = cd.match(/filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
      originalName = safeName(decodeURIComponent(fnm?.[1] || fnm?.[2] || `${srcId}.pdf`));
      if (!originalName.toLowerCase().endsWith('.pdf')) originalName = `${stripExt(originalName)}.pdf`;

      const bodyStream = dl.body ? Readable.fromWeb(dl.body) : null;
      if (!bodyStream) return res.status(400).json({ ok: false, error: 'PUBLIC_DOWNLOAD_EMPTY' });

      const up = await drive.files.create({
        supportsAllDrives: true,
        requestBody: { name: originalName, parents: [rootFolderId], mimeType: 'application/pdf' },
        media: { mimeType: 'application/pdf', body: bodyStream },
        fields: 'id,name,mimeType,modifiedTime'
      });
      created = up.data;
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e?.message || 'IMPORT_FAILED') });
    }
  }

  const newId = String(created?.id || '').trim();
  if (!newId) return res.status(400).json({ ok: false, error: 'IMPORT_FAILED' });

  const name = String(created?.name || originalName || `${newId}.pdf`).trim();
  const nameNoExt = stripExt(name);
  const norm = normalizeSongFileName({ filenameNoExt: nameNoExt, artistFreqMap: null });
  const driveUrl = buildViewUrl(newId);

  const doc = await Song.findOneAndUpdate(
    { googleFileId: newId },
    {
      $set: {
        title: norm.title || nameNoExt,
        displayTitle: norm.title || nameNoExt,
        artist: norm.artist || '',
        key: norm.key || '',
        parseError: norm.parseError || '',
        driveUrl,
        folderPath: '[외부 가져오기]',
        hidden: false,
        syncRootId: rootFolderId,
        lastSeenAt: new Date(),
        driveModifiedTime: created?.modifiedTime ? new Date(created.modifiedTime) : null,
        searchText: `${norm.title || nameNoExt} ${norm.artist || ''} ${norm.key || ''}`.toLowerCase().trim(),
        updatedAt: new Date()
      }
    },
    { upsert: true, new: true }
  ).lean();

  res.json({
    ok: true,
    imported: {
      googleFileId: newId,
      driveUrl,
      name,
      title: doc?.displayTitle || doc?.title || '',
      artist: doc?.artist || '',
      key: doc?.key || '',
      parseError: doc?.parseError || ''
    }
  });
});

module.exports = router;
