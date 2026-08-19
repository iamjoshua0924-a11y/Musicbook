const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getFileMetadata, getReadonlyAccessToken, buildPreviewUrl, buildViewUrl } = require('../services/drive');
const { requireSessionOrAdmin } = require('../middleware/auth');
const { issueDriveGrantToken, consumeDriveGrantToken } = require('../services/publicPdfSign');
const { pushError } = require('../services/errorLog');

const router = express.Router();

// 뷰어 PDF 로딩 실패 진단용 (동작 변경 없음, 로깅만).
// 실패 즉시 서버 콘솔 + /dev 에러뷰어(errorLog)에 fileId+정확한 사유를 남긴다.
function logDriveFail(step, reason, { fileId = '', meta = null, detail = '' } = {}) {
  const entry = {
    method: 'DRIVE',
    path: `/api/drive/${step}`,
    message: `${step} rejected: ${reason}`,
    code: reason,
    fileId,
    // permissions(type,role)만 요청했으므로 이메일 등 PII 없음 — 그대로 로깅 안전
    mimeType: meta?.mimeType || '',
    canDownload: meta?.capabilities?.canDownload,
    permissions: Array.isArray(meta?.permissions) ? meta.permissions : undefined,
    detail: detail || ''
  };
  // eslint-disable-next-line no-console
  console.error('[drive] load fail:', entry);
  try {
    pushError(entry);
  } catch {}
}

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
router.get('/drive/preview/:fileId', asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  res.json({ ok: true, previewUrl: buildPreviewUrl(fileId), viewUrl: buildViewUrl(fileId) });
}));

// New-tab helper: /view 는 iframe 임베드가 안 되는 경우가 많아(Drive X-Frame-Options),
// "새 탭으로 열기" 용으로만 제공한다.
router.get('/drive/view/:fileId', asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  res.redirect(buildViewUrl(fileId));
}));

router.get('/drive/meta/:fileId', requireSessionOrAdmin, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  try {
    const meta = await getFileMetadata(fileId);
    res.json({ ok: true, meta, previewUrl: buildPreviewUrl(fileId) });
  } catch (err) {
    res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  }
}));

// Public viewer용 short-lived internal grant. 실제 Google access token은 별도 교환 단계에서만 발급.
router.post('/drive/token-grants', express.json(), asyncHandler(async (req, res) => {
  const fileId = String(req.body?.fileId || '').trim();
  if (!fileId) return res.status(400).json({ ok: false, error: 'FILE_ID_REQUIRED' });
  try {
    const meta = await getFileMetadata(fileId);
    if (!isPdfLike(meta)) {
      logDriveFail('token-grants', 'PDF_ONLY', { fileId, meta });
      return res.status(400).json({ ok: false, error: 'PDF_ONLY' });
    }
    const canDownload = meta?.capabilities?.canDownload;
    if (canDownload === false) {
      logDriveFail('token-grants', 'DOWNLOAD_DISABLED', { fileId, meta });
      return res.status(403).json({ ok: false, error: 'DOWNLOAD_DISABLED' });
    }
    // NOTE: viewer 전체에 grant를 주기로 한 결정이라도, 현재 운영 전제(공개 PDF)와 맞는 파일만 허용한다.
    if (!isPublicReadable(meta)) {
      logDriveFail('token-grants', 'PUBLIC_REQUIRED', { fileId, meta });
      return res.status(403).json({ ok: false, error: 'PUBLIC_REQUIRED' });
    }
    const issued = issueDriveGrantToken({ fileId, ttlSec: 45 });
    return res.json({
      ok: true,
      fileId,
      grantToken: issued.token,
      grantExp: issued.exp,
      previewUrl: buildPreviewUrl(fileId),
      viewUrl: buildViewUrl(fileId)
    });
  } catch (err) {
    logDriveFail('token-grants', 'NOT_FOUND', { fileId, detail: err?.message || String(err) });
    return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  }
}));

router.post('/drive/access-token', express.json(), asyncHandler(async (req, res) => {
  const grantToken = String(req.body?.grantToken || '').trim();
  if (!grantToken) return res.status(400).json({ ok: false, error: 'GRANT_REQUIRED' });
  const consumed = consumeDriveGrantToken(grantToken);
  if (!consumed.ok) {
    // BAD_GRANT/GRANT_EXPIRED — 인메모리 grant 저장소가 프로세스 재시작/콜드스타트로 비었거나 45초 TTL 초과 가능성
    logDriveFail('access-token', consumed.error || 'BAD_GRANT', { detail: 'consumeDriveGrantToken failed' });
    return res.status(403).json({ ok: false, error: consumed.error || 'BAD_GRANT' });
  }
  try {
    const meta = await getFileMetadata(consumed.fileId);
    if (!isPdfLike(meta)) {
      logDriveFail('access-token', 'PDF_ONLY', { fileId: consumed.fileId, meta });
      return res.status(400).json({ ok: false, error: 'PDF_ONLY' });
    }
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
  } catch (err) {
    logDriveFail('access-token', 'TOKEN_EXCHANGE_FAILED', { fileId: consumed.fileId, detail: err?.message || String(err) });
    return res.status(500).json({ ok: false, error: 'TOKEN_EXCHANGE_FAILED' });
  }
}));

// 뷰어(브라우저)에서 서버를 거치지 않고 googleapis.com으로 직접 fetch하는 마지막 단계는
// 서버가 원래 볼 수 없는 실패(CORS/네트워크/컨텐츠타입 불일치 등)라서, 클라이언트가 실패 사유를
// best-effort로 여기에 보고하면 같은 errorLog(/dev)에 모아서 본다. 인증 불필요, 진단 전용.
router.post('/drive/client-fail', express.json(), (req, res) => {
  const fileId = String(req.body?.fileId || '').trim();
  const step = String(req.body?.step || 'client').trim();
  const reason = String(req.body?.reason || 'UNKNOWN').trim();
  const detail = String(req.body?.detail || '').slice(0, 500);
  logDriveFail(step, reason, { fileId, detail });
  res.json({ ok: true });
});

module.exports = router;
