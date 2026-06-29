const express = require('express');
const { getFileMetadata, buildPreviewUrl, buildViewUrl } = require('../services/drive');
const { requireSessionOrAdmin } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
