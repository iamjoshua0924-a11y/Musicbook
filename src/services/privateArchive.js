// NOTE:
// "개인 도메인"은 DNS/서브도메인을 동적으로 만들 수 없으므로
// 한 도메인 내 고정 경로로 제공한다.
//
// 개인 아카이브 canonical path:
//   /public/musicbook/u/<userId>
//
// (정적 호스팅 딥링크 404는 404.html에서 SPA로 복구)

function normalizePrefix(raw) {
  let p = String(raw || '').trim();
  if (!p) p = '/public/musicbook/u/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p;
}

async function getPrivateArchivePrefix() {
  // 더 이상 설정으로 바꾸지 않는다(혼동 방지). 항상 고정.
  return normalizePrefix('/public/musicbook/u/');
}

async function buildPrivateArchivePath(userId) {
  const uid = String(userId || '').trim();
  const prefix = await getPrivateArchivePrefix();
  return `${prefix}${encodeURIComponent(uid)}`;
}

module.exports = { getPrivateArchivePrefix, buildPrivateArchivePath, normalizePrefix };
