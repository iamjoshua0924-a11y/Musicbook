const Setting = require('../models/Setting');

function normalizePrefix(raw) {
  let p = String(raw || '').trim();
  // 기본: GitHub Pages 구조(/public/musicbook/) 그대로 사용
  if (!p) p = '/public/musicbook/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p;
}

async function getPrivateArchivePrefix() {
  // Dev에서 prefix를 저장할 수 있게 한다.
  // 예) /public/musicbook/private/  -> 최종 /public/musicbook/private/<userId>
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
