const crypto = require('crypto');
const { sessionSecret } = require('../config/env');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sign(data) {
  return b64url(crypto.createHmac('sha256', sessionSecret).update(data).digest());
}

function createSocketMetaToken(meta) {
  const payload = b64url(JSON.stringify(meta));
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

function verifySocketMetaToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  if (sign(payload) !== sig) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const meta = JSON.parse(json);
    // minimal schema
    if (!meta || typeof meta !== 'object') return null;
    return meta;
  } catch {
    return null;
  }
}

module.exports = { createSocketMetaToken, verifySocketMetaToken };

