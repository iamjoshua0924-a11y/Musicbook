const Setting = require('../models/Setting');

function normalizePrefix(raw) {
  let p = String(raw || '').trim();
  if (!p) p = '/public/musicbook/'; // 기본: GitHub Pages/정적 경로 호환
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p;
}

async function getPrivateArchivePrefix() {
  try {
    const doc = await Setting.findOne({ key: 'privateArchivePrefix' }).lean();
    return normalizePrefix(doc?.value || '');
  } catch {
    return normalizePrefix('');
  }
}

async function buildPrivateArchivePath(userId) {
  const uid = String(userId || '').trim();
  const prefix = await getPrivateArchivePrefix();
  return `${prefix}${encodeURIComponent(uid)}`;
}

module.exports = { getPrivateArchivePrefix, buildPrivateArchivePath, normalizePrefix };

