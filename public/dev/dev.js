const $ = (id) => document.getElementById(id);
let syncRunning = false;

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
  ['meCard', 'sessionsCard', 'syncCard', 'parseErrorCard', 'trafficCard', 'errorsCard'].forEach((id) => {
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
  const r = await apiGet('/api/dev/sync/status');
  if (!r.ok) {
    return;
  }
  const s = r.status || null;
  const msg = s?.running
    ? `RUNNING · processed=${s.processed ?? 0} skipped=${s.skipped ?? 0}${s.currentPath ? ` · path=${s.currentPath}` : ''}${s.currentFile ? ` · file=${s.currentFile}` : ''}`
    : `endedAt=${s?.endedAt || '-'} · processed=${s?.processed ?? '-'} · skipped=${s?.skipped ?? '-'} · hidden=${s?.hiddenCount ?? '-'}${
        s?.diff ? ` · +${s.diff.addedCount ?? 0} ~${s.diff.changedCount ?? 0} -${s.diff.removedCount ?? 0}` : ''
      }`;
  if ($('syncStatusLine')) $('syncStatusLine').textContent = msg;
  syncRunning = Boolean(s?.running);
  const btn = $('syncBtn');
  if (btn) btn.textContent = syncRunning ? '동기화 중지' : '동기화 실행';
  $('syncJson').textContent = JSON.stringify(s, null, 2);
}

async function loadDriveRoot() {
  const r = await apiGet('/api/dev/drive-root');
  if (!r.ok) return;
  if ($('rootFolderId')) $('rootFolderId').value = r.rootFolderId || '';
}

async function saveDriveRoot() {
  const rootFolderId = ($('rootFolderId')?.value || '').trim();
  const r = await apiJson('/api/dev/drive-root', 'PATCH', { rootFolderId });
  if (!r.ok) return alert('저장 실패');
  if ($('rootFolderId')) $('rootFolderId').value = r.rootFolderId || '';
}

async function syncDrive() {
  const payload = {
    rootFolderId: ($('rootFolderId')?.value || '').trim(),
    latestDays: Number($('latestDays')?.value || 30),
    limit: 5000,
    incremental: Boolean($('incrementalToggle')?.checked),
    pruneMissing: Boolean($('pruneToggle')?.checked)
  };
  const r = await apiJson('/api/dev/sync/drive', 'POST', payload);
  $('syncJson').textContent = JSON.stringify(r, null, 2);
  await loadSync();
}

async function toggleSync() {
  if (syncRunning) {
    const r = await apiJson('/api/dev/sync/stop', 'POST', {});
    $('syncJson').textContent = JSON.stringify(r, null, 2);
    await loadSync();
    return;
  }
  await syncDrive();
}

async function loadParseErrors() {
  const r = await apiGet('/api/dev/songs/parse-errors?limit=200');
  if (!r.ok) return;
  const wrap = $('parseErrorList');
  if (wrap) wrap.innerHTML = '';
  if ($('parseErrorOut')) $('parseErrorOut').textContent = `총 ${r.items?.length || 0}건`;

  const escapeHtml = (str) =>
    String(str || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  (r.items || []).forEach((s) => {
    const parseLabel = (() => {
      const code = String(s.parseError || '').trim();
      if (!code) return '-';
      if (code === 'EMPTY_NAME') return '제목 인식 안됨';
      if (code === 'HIDDEN_BAD_PATTERN') return '패턴 불량(숨김)';
      if (code.startsWith('AMBIGUOUS')) return '제목/가수 모호';
      if (code.startsWith('NO_HYPHEN')) return '구분자(-) 없음';
      if (code.includes('KEY')) return '조성 인식 안됨';
      return code;
    })();
    const el = document.createElement('div');
    el.className = 'item';
    el.style.alignItems = 'flex-start';
    const driveName = String(s.driveName || '').trim() || '(원본 파일명 없음)';
    const driveUrl = String(s.driveUrl || '').trim();
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <b>원본파일명:</b> <span class="kbd">${escapeHtml(driveName)}</span>
          ${driveUrl ? `<a href="${escapeHtml(driveUrl)}" target="_blank" class="muted">파일 열기</a>` : ''}
        </div>
        <div class="muted"><b>오류형태:</b> ${escapeHtml(parseLabel)}</div>
        <div class="row" style="margin-top:6px;">
          <input data-k="title" placeholder="title" value="${escapeHtml(s.title || '')}" />
          <input data-k="key" placeholder="key(옵션)" value="${escapeHtml(s.key || '')}" style="max-width:110px;" />
          <input data-k="artist" placeholder="artist" value="${escapeHtml(s.artist || '')}" />
          <input data-k="displayTitle" placeholder="displayTitle(옵션)" value="${escapeHtml(s.displayTitle || '')}" />
        </div>
        <label class="muted" style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input type="checkbox" data-k="renameDriveName" checked />
          원본 파일명도 변경
        </label>
        ${s.folderPath ? `<div class="muted">${escapeHtml(s.folderPath)}</div>` : ''}
      </div>
      <div>
        <button class="light" data-action="save">저장</button>
      </div>
    `;
    el.querySelector('[data-action="save"]').onclick = async () => {
      const payload = {};
      el.querySelectorAll('input[data-k]').forEach((inp) => {
        if (inp.type === 'checkbox') payload[inp.dataset.k] = Boolean(inp.checked);
        else payload[inp.dataset.k] = inp.value;
      });
      const rr = await apiJson(`/api/dev/songs/${encodeURIComponent(s._id)}`, 'PATCH', payload);
      if (!rr.ok) return alert('저장 실패');
      if (rr.renameError) alert(`저장은 됐는데 파일명 변경 실패: ${rr.renameError}`);
      el.remove();
    };
    if (wrap) wrap.appendChild(el);
  });
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

async function loadErrors() {
  $('errorsOut').textContent = '로딩 중...';
  const r = await apiGet('/api/dev/errors');
  if (!r.ok) {
    $('errorsOut').textContent = `실패: ${r.error || ''}`;
    return;
  }
  const items = Array.isArray(r.items) ? r.items : [];
  $('errorsOut').textContent = `총 ${items.length}건`;
  $('errorsJson').textContent = JSON.stringify(items.slice(0, 50), null, 2);
}

async function clearErrors() {
  await apiJson('/api/dev/errors/clear', 'POST', {});
  await loadErrors();
}

$('devLoginBtn').onclick = () => login().catch(() => {});
$('devLogoutBtn').onclick = () => logout().catch(() => {});
$('reloadSessionsBtn').onclick = () => loadSessions().catch(() => {});
$('saveRootFolderBtn')?.addEventListener?.('click', () => saveDriveRoot().catch(() => {}));
$('syncBtn')?.addEventListener?.('click', () => toggleSync().catch(() => {}));
$('reloadParseErrorsBtn')?.addEventListener?.('click', () => loadParseErrors().catch(() => {}));
$('reloadTrafficBtn').onclick = () => loadTraffic().catch(() => {});
$('resetTrafficBtn').onclick = () => resetTraffic().catch(() => {});
$('reloadErrorsBtn').onclick = () => loadErrors().catch(() => {});
$('clearErrorsBtn').onclick = () => clearErrors().catch(() => {});

refreshMe()
  .then((authed) => {
    if (authed) {
      loadSessions().catch(() => {});
      loadDriveRoot().catch(() => {});
      loadSync().catch(() => {});
      loadParseErrors().catch(() => {});
      loadTraffic().catch(() => {});
      loadErrors().catch(() => {});
    }
  })
  .catch(() => {});
