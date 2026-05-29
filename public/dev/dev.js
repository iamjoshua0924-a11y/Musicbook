const $ = (id) => document.getElementById(id);

const API_URL = String(window.API_URL || window.MB_API || window.location.origin || '').replace(/\/$/, '');
const apiUrl = (path) => {
  const p = String(path || '');
  if (!p) return API_URL;
  if (/^https?:\/\//i.test(p)) return p;
  return `${API_URL}${p.startsWith('/') ? '' : '/'}${p}`;
};

async function apiGet(url) {
  const res = await fetch(apiUrl(url), { credentials: 'include' });
  return res.json();
}
async function apiJson(url, method, body) {
  const res = await fetch(apiUrl(url), {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  return res.json();
}

function showAuthed(on) {
  $('loginCard').style.display = on ? 'none' : 'block';
  ['meCard', 'sessionsCard', 'syncCard', 'trafficCard'].forEach((id) => {
    const el = $(id);
    if (el) el.style.display = on ? 'block' : 'none';
  });
}

async function refreshMe() {
  const r = await apiGet('/api/dev/me');
  const authed = Boolean(r?.authed);
  $('meText').textContent = authed ? `authed · ${new Date(r.authedAt || Date.now()).toLocaleString()}` : 'not authed';
  showAuthed(authed);
  return authed;
}

async function login() {
  const token = ($('devToken')?.value || '').trim();
  if (!token) return;
  const r = await apiJson('/api/dev/auth', 'POST', { token });
  $('loginOut').textContent = JSON.stringify(r, null, 2);
  await refreshMe();
}

async function logout() {
  await apiJson('/api/dev/logout', 'POST', {});
  await refreshMe();
}

async function loadSessions() {
  $('sessionsOut').textContent = '로딩 중...';
  $('sessionsList').innerHTML = '';
  const r = await apiGet('/api/dev/sessions');
  if (!r.ok) {
    $('sessionsOut').textContent = `실패: ${r.error || ''}`;
    return;
  }
  const rooms = Array.isArray(r.rooms) ? r.rooms : [];
  $('sessionsOut').textContent = `총 ${rooms.length}개`;
  rooms.forEach((x) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div><span class="kbd">${String(x.roomCode || '')}</span> · members=${x.memberCount || 0} · page=${x.currentPageNo || 1}</div>
        <div class="muted">${String(x.currentFileId || '') ? `fileId=${String(x.currentFileId)}` : ''} ${x.rehearsalActive ? '· rehearsal=ON' : ''}</div>
      </div>
      <div class="muted">${x.ageMs != null ? `${Math.round(x.ageMs / 1000)}s` : ''}</div>
    `;
    $('sessionsList').appendChild(el);
  });
}

async function loadSync() {
  $('syncOut').textContent = '로딩 중...';
  const r = await apiGet('/api/dev/sync/status');
  if (!r.ok) {
    $('syncOut').textContent = `실패: ${r.error || ''}`;
    return;
  }
  const s = r.status || null;
  const diff = s?.diff;
  $('syncOut').textContent = diff ? `+${diff.addedCount || 0} ~${diff.changedCount || 0} -${diff.removedCount || 0}` : '-';
  $('syncJson').textContent = JSON.stringify(s, null, 2);
}

async function loadTraffic() {
  $('trafficOut').textContent = '로딩 중...';
  const r = await apiGet('/api/dev/metrics/traffic');
  if (!r.ok) {
    $('trafficOut').textContent = `실패: ${r.error || ''}`;
    return;
  }
  $('trafficOut').textContent = 'OK';
  $('trafficJson').textContent = JSON.stringify(r.data, null, 2);
}

async function resetTraffic() {
  const r = await apiJson('/api/dev/metrics/traffic/reset', 'POST', {});
  $('trafficJson').textContent = JSON.stringify(r.data || r, null, 2);
}

$('devLoginBtn').onclick = () => login().catch(() => {});
$('devLogoutBtn').onclick = () => logout().catch(() => {});
$('reloadSessionsBtn').onclick = () => loadSessions().catch(() => {});
$('reloadSyncBtn').onclick = () => loadSync().catch(() => {});
$('reloadTrafficBtn').onclick = () => loadTraffic().catch(() => {});
$('resetTrafficBtn').onclick = () => resetTraffic().catch(() => {});

refreshMe()
  .then((authed) => {
    if (authed) {
      loadSessions().catch(() => {});
      loadSync().catch(() => {});
      loadTraffic().catch(() => {});
    }
  })
  .catch(() => {});
