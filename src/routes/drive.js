const express = require('express');
const { getFileMetadata, getReadonlyAccessToken, buildPreviewUrl, buildViewUrl } = require('../services/drive');
const { requireSessionOrAdmin } = require('../middleware/auth');
const { issueDriveGrantToken, consumeDriveGrantToken } = require('../services/publicPdfSign');

const router = express.Router();

function isPdfLike(meta) {
  const mime = String(meta?.mimeType || '').trim().toLowerCase();
  const name = String(meta?.name || '').trim().toLowerCase();
  return mime === 'application/pdf' || name.endsWith('.pdf');
}

function isPublicReadable(meta) {
  const perms = Array.isArray(meta?.permissions) ? meta.permissions : [];
  return perms.some((p) => String(p?.type || '') === 'anyone' && String(p?.role || '').length > 0);
}

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

// Public viewer용 short-lived internal grant. 실제 Google access token은 별도 교환 단계에서만 발급.
router.post('/drive/token-grants', express.json(), async (req, res) => {
  const fileId = String(req.body?.fileId || '').trim();
  if (!fileId) return res.status(400).json({ ok: false, error: 'FILE_ID_REQUIRED' });
  try {
    const meta = await getFileMetadata(fileId);
    if (!isPdfLike(meta)) return res.status(400).json({ ok: false, error: 'PDF_ONLY' });
    const canDownload = meta?.capabilities?.canDownload;
    if (canDownload === false) return res.status(403).json({ ok: false, error: 'DOWNLOAD_DISABLED' });
    // NOTE: viewer 전체에 grant를 주기로 한 결정이라도, 현재 운영 전제(공개 PDF)와 맞는 파일만 허용한다.
    if (!isPublicReadable(meta)) return res.status(403).json({ ok: false, error: 'PUBLIC_REQUIRED' });
    const issued = issueDriveGrantToken({ fileId, ttlSec: 45 });
    return res.json({
      ok: true,
      fileId,
      grantToken: issued.token,
      grantExp: issued.exp,
      previewUrl: buildPreviewUrl(fileId),
      viewUrl: buildViewUrl(fileId)
    });
  } catch {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  }
});

router.post('/drive/access-token', express.json(), async (req, res) => {
  const grantToken = String(req.body?.grantToken || '').trim();
  if (!grantToken) return res.status(400).json({ ok: false, error: 'GRANT_REQUIRED' });
  const consumed = consumeDriveGrantToken(grantToken);
  if (!consumed.ok) return res.status(403).json({ ok: false, error: consumed.error || 'BAD_GRANT' });
  try {
    const meta = await getFileMetadata(consumed.fileId);
    if (!isPdfLike(meta)) return res.status(400).json({ ok: false, error: 'PDF_ONLY' });
    const { accessToken, expiresAt } = await getReadonlyAccessToken();
    return res.json({
      ok: true,
      fileId: consumed.fileId,
      accessToken,
      expiresAt,
      mimeType: String(meta?.mimeType || ''),
      previewUrl: buildPreviewUrl(consumed.fileId),
      viewUrl: buildViewUrl(consumed.fileId)
    });
  } catch {
    return res.status(500).json({ ok: false, error: 'TOKEN_EXCHANGE_FAILED' });
  }
});

module.exports = router;
