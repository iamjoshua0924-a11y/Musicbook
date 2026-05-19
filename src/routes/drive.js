const express = require('express');
const { pipeline } = require('node:stream/promises');
const router = express.Router();

const { getDriveClient, getFileMetadata, buildPreviewUrl } = require('../services/drive');
const { requireSessionOrAdmin } = require('../middleware/auth');

/**
 * Streaming pipe endpoint (NO buffering in memory).
 * - Supports Range header (pass-through to Drive).
 * - If Drive blocks download, client can use /api/drive/preview/:fileId and fallback to iframe.
 */
router.get('/drive/pdf/:fileId', requireSessionOrAdmin, async (req, res) => {
  const { fileId } = req.params;
  const range = req.headers.range;

  try {
    const drive = getDriveClient();

    // Prefer streaming bytes directly.
    const driveRes = await drive.files.get(
      { fileId, alt: 'media' },
      {
        responseType: 'stream',
        headers: range ? { Range: range } : undefined
      }
    );

    // Propagate important headers.
    res.setHeader('Content-Type', driveRes.headers?.['content-type'] || 'application/pdf');
    if (driveRes.headers?.['content-length']) res.setHeader('Content-Length', driveRes.headers['content-length']);
    if (driveRes.headers?.['content-range']) res.setHeader('Content-Range', driveRes.headers['content-range']);
    res.setHeader('Accept-Ranges', 'bytes');

    // If upstream returned partial content, mirror status.
    const upstreamStatus = Number(driveRes.status) || 200;
    if (range && (upstreamStatus === 206 || driveRes.headers?.['content-range'])) {
      res.status(206);
    }

    await pipeline(driveRes.data, res);
  } catch (err) {
    // Do not leak details; client can use preview fallback.
    res.status(403).json({
      ok: false,
      error: 'DRIVE_STREAM_FAILED',
      fallback: { mode: 'iframe', previewUrl: buildPreviewUrl(fileId) }
    });
  }
});

// Public: preview URL builder does not access Drive API; safe for anonymous viewer mode.
router.get('/drive/preview/:fileId', async (req, res) => {
  const { fileId } = req.params;
  res.json({ ok: true, previewUrl: buildPreviewUrl(fileId) });
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

module.exports = router;
