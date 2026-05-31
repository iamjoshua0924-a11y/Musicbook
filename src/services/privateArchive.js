function normalizePrefix(raw) {
  let p = String(raw || '').trim();
  // 안정적인 고정 경로(요구사항): /public/musicbook/u/<userId>
  if (!p) p = '/public/musicbook/u/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p;
}

async function getPrivateArchivePrefix() {
  // prefix는 더 이상 설정으로 바꾸지 않는다(혼동/깨짐 방지).
  return normalizePrefix('/public/musicbook/u/');
}

async function buildPrivateArchivePath(userId) {
  const uid = String(userId || '').trim();
  const prefix = await getPrivateArchivePrefix();
  return `${prefix}${encodeURIComponent(uid)}`;
}

module.exports = { getPrivateArchivePrefix, buildPrivateArchivePath, normalizePrefix };
