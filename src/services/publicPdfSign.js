const crypto = require('crypto');
const { sessionSecret } = require('../config/env');
const driveGrantStore = new Map();

function hmac(input) {
  return crypto.createHmac('sha256', String(sessionSecret || '')).update(String(input || '')).digest('hex');
}

function buildSig({ fileId, roomCode, exp }) {
  const fid = String(fileId || '').trim();
  const room = String(roomCode || '').trim().toUpperCase();
  const e = Number(exp || 0);
  if (!fid || !room || !Number.isFinite(e) || e <= 0) return '';
  return hmac(`publicpdf:${room}:${fid}:${e}`);
}

function isValidSig({ fileId, roomCode, exp, sig }) {
  const expected = buildSig({ fileId, roomCode, exp });
  const got = String(sig || '').trim();
  if (!expected || !got) return false;
  // timing-safe compare
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  } catch {
    return false;
  }
}

/**
 * Returns an expiry timestamp (unix seconds) snapped to the next hour,
 * so that all participants within the same hour get the same signed URL => cacheable.
 */
function getHourlyExpiryUnix(nowMs = Date.now(), ttlHours = 1) {
  const now = Math.floor(Number(nowMs) / 1000);
  const hour = 3600;
  const next = Math.ceil(now / hour) * hour;
  return next + Math.max(0, Number(ttlHours || 1) - 1) * hour;
}

function base64urlEncode(input) {
  return Buffer.from(String(input || ''), 'utf8').toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function pruneDriveGrantStore(nowSec = Math.floor(Date.now() / 1000)) {
  for (const [nonce, item] of driveGrantStore.entries()) {
    if (!item || Number(item.exp || 0) < nowSec - 30 || item.used) driveGrantStore.delete(nonce);
  }
}

function buildDriveGrantSig(body) {
  return hmac(`drivegrant:${String(body || '')}`);
}

function issueDriveGrantToken({ fileId, ttlSec = 45 } = {}) {
  const fid = String(fileId || '').trim();
  if (!fid) return { token: '', exp: 0 };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(10, Number(ttlSec || 45));
  const nonce = crypto.randomBytes(12).toString('hex');
  const body = base64urlEncode(JSON.stringify({ fileId: fid, exp, nonce }));
  const sig = buildDriveGrantSig(body);
  driveGrantStore.set(nonce, { fileId: fid, exp, used: false });
  pruneDriveGrantStore(now);
  return { token: `${body}.${sig}`, exp };
}

function consumeDriveGrantToken(token) {
  pruneDriveGrantStore();
  const raw = String(token || '').trim();
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return { ok: false, error: 'BAD_GRANT' };
  const body = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = buildDriveGrantSig(body);
  if (!expected || !sig) return { ok: false, error: 'BAD_GRANT' };
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return { ok: false, error: 'BAD_GRANT' };
  } catch {
    return { ok: false, error: 'BAD_GRANT' };
  }
  try {
    const parsed = JSON.parse(base64urlDecode(body));
    const fileId = String(parsed?.fileId || '').trim();
    const exp = Number(parsed?.exp || 0);
    const nonce = String(parsed?.nonce || '').trim();
    const now = Math.floor(Date.now() / 1000);
    if (!fileId || !nonce || !Number.isFinite(exp) || exp < now) return { ok: false, error: 'GRANT_EXPIRED' };
    const slot = driveGrantStore.get(nonce);
    if (!slot || slot.used || String(slot.fileId || '') !== fileId || Number(slot.exp || 0) !== exp) {
      return { ok: false, error: 'BAD_GRANT' };
    }
    slot.used = true;
    driveGrantStore.set(nonce, slot);
    return { ok: true, fileId, exp };
  } catch {
    return { ok: false, error: 'BAD_GRANT' };
  }
}

module.exports = {
  buildSig,
  isValidSig,
  getHourlyExpiryUnix,
  issueDriveGrantToken,
  consumeDriveGrantToken
};
