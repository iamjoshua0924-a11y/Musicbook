const crypto = require('crypto');
const { sessionSecret } = require('../config/env');

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

module.exports = { buildSig, isValidSig, getHourlyExpiryUnix };

