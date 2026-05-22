const $ = (id) => document.getElementById(id);
let syncRunning = false;
let syncPoller = null;

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'include' });
  return res.json();
}
async function apiJson(url, method, body) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  return res.json();
}

function showAuthed(on) {
  $('loginCard').style.display = on ? 'none' : 'block';
  // CSV 임포트 기능은 더 이상 사용하지 않으므로 UI에서 제거
  ['meCard', 'mainCard', 'usersCard', 'syncCard', 'parseErrorCard'].forEach((id) => {
    $(id).style.display = on ? 'block' : 'none';
  });
}

async function refreshMe() {
  const me = await apiGet('/api/admin/me');
  if (!me.ok) {
    showAuthed(false);
    return null;
  }
  $('meText').textContent = `${me.user.userId} (${me.user.role})`;
  showAuthed(true);
  return me.user;
}

async function loadUsers() {
  const out = $('usersOut');
  const wrap = $('usersList');
  if (out) out.textContent = '로딩 중...';
  if (wrap) wrap.innerHTML = '';
  const r = await apiGet('/api/admin/users');
  if (!r.ok) {
    if (out) out.textContent = `불러오기 실패: ${r.error || ''}`;
    return;
  }
  const items = Array.isArray(r.items) ? r.items : [];
  if (out) out.textContent = `총 ${items.length}명`;
  items.forEach((u) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div><span class="kbd">${escapeHtml(u.userId || '')}</span> · <b>${escapeHtml(u.role || '')}</b> ${u.active === false ? '<span class="muted">(비활성)</span>' : ''}</div>
        <div class="muted">${escapeHtml(u.displayName || '')}</div>
      </div>
      <div class="row" style="justify-content:flex-end;">
        <button class="light" data-action="reset">비번 1234</button>
        <button class="light" data-action="toggle">${u.active === false ? '활성화' : '비활성'}</button>
      </div>
    `;
    el.querySelector('[data-action="reset"]').onclick = async () => {
      const rr = await apiJson(`/api/admin/users/${encodeURIComponent(u.userId)}`, 'PATCH', { password: '1234' });
      if (!rr.ok) return alert('실패');
      alert('비밀번호를 1234로 초기화했습니다.');
    };
    el.querySelector('[data-action="toggle"]').onclick = async () => {
      const next = !(u.active === false);
      const rr = await apiJson(`/api/admin/users/${encodeURIComponent(u.userId)}`, 'PATCH', { active: !next });
      if (!rr.ok) return alert('실패');
      await loadUsers();
    };
    wrap.appendChild(el);
  });
}

async function loadMain() {
  const r = await apiGet('/api/main');
  if (!r.ok) return;
  const d = r.data;
  $('titleImage').value = d.titleImage || '';
  $('bannerImage').value = d.bannerImage || '';
  $('notice').value = d.notice || '';
  $('discordUrl').value = d.discordUrl || '';
  $('youtubeUrl').value = d.youtubeUrl || '';
  $('chzzkUrl').value = d.chzzkUrl || '';
}

async function saveMain() {
  const fields = ['titleImage', 'bannerImage', 'notice', 'discordUrl', 'youtubeUrl', 'chzzkUrl'];
  for (const f of fields) {
    const v = $(f).value;
    const r = await apiJson('/api/main', 'PATCH', { field: f, value: v });
    if (!r.ok) {
      $('mainSaveOut').textContent = `저장 실패: ${r.error || ''}`;
      return;
    }
  }
  $('mainSaveOut').textContent = '저장 완료';
  setTimeout(() => ($('mainSaveOut').textContent = ''), 1200);
}

async function loadDriveRoot() {
  const r = await apiGet('/api/admin/drive-root');
  if (!r.ok) return;
  $('rootFolderId').value = r.rootFolderId || '';
}

async function saveDriveRoot() {
  const rootFolderId = $('rootFolderId').value.trim();
  const r = await apiJson('/api/admin/drive-root', 'PATCH', { rootFolderId });
  if (!r.ok) return alert('저장 실패');
  $('rootFolderId').value = r.rootFolderId || '';
}

async function syncDrive() {
  const payload = {
    rootFolderId: $('rootFolderId').value.trim(),
    latestDays: Number($('latestDays').value || 30),
    limit: 5000,
    incremental: Boolean($('incrementalToggle')?.checked),
    pruneMissing: Boolean($('pruneToggle')?.checked)
  };
  const r = await apiJson('/api/admin/sync/drive', 'POST', payload);
  $('syncOut').textContent = JSON.stringify(r, null, 2);
  await loadSyncStatus();
}

async function loadSyncStatus() {
  const r = await apiGet('/api/admin/sync/status');
  if (!r.ok) return;
  const s = r.status;
  if (!s) {
    $('syncStatusLine').textContent = '-';
    syncRunning = false;
    const btn = $('syncBtn');
    if (btn) btn.textContent = '동기화 실행';
    return;
  }
  const msg = s.running
    ? `RUNNING · processed=${s.processed ?? 0} skipped=${s.skipped ?? 0}${s.currentPath ? ` · path=${s.currentPath}` : ''}${s.currentFile ? ` · file=${s.currentFile}` : ''}`
    : `endedAt=${s.endedAt || '-'} · processed=${s.processed ?? '-'} · skipped=${s.skipped ?? '-'} · hidden=${s.hiddenCount ?? '-'}`;
  $('syncStatusLine').textContent = msg;
  syncRunning = Boolean(s.running);
  const btn = $('syncBtn');
  if (btn) btn.textContent = syncRunning ? '동기화 중지' : '동기화 실행';
}

function startSyncPolling() {
  if (syncPoller) return;
  syncPoller = setInterval(() => loadSyncStatus().catch(() => {}), 1200);
}
function stopSyncPolling() {
  if (!syncPoller) return;
  clearInterval(syncPoller);
  syncPoller = null;
}

async function loadParseErrors() {
  const r = await apiGet('/api/admin/songs/parse-errors?limit=200');
  if (!r.ok) return;
  const wrap = $('parseErrorList');
  wrap.innerHTML = '';
  $('parseErrorOut').textContent = `총 ${r.items?.length || 0}건`;

  (r.items || []).forEach((s) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.style.alignItems = 'flex-start';
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div><span class="kbd">${s.googleFileId}</span></div>
        <div class="muted">${s.folderPath || ''}</div>
        <div class="muted">${s.parseError || ''}</div>
        <div class="row" style="margin-top:6px;">
          <input data-k="artist" placeholder="artist" value="${escapeHtml(s.artist || '')}" />
          <input data-k="title" placeholder="title" value="${escapeHtml(s.title || '')}" />
          <input data-k="displayTitle" placeholder="displayTitle(옵션)" value="${escapeHtml(s.displayTitle || '')}" />
          <input data-k="key" placeholder="key(옵션)" value="${escapeHtml(s.key || '')}" style="max-width:110px;" />
        </div>
        <label class="muted" style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input type="checkbox" data-k="renameDriveName" checked />
          원본 파일명도 변경
        </label>
        ${s.driveUrl ? `<a href="${escapeHtml(s.driveUrl)}" target="_blank" class="muted">Drive 열기</a>` : ''}
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
      const rr = await apiJson(`/api/admin/songs/${encodeURIComponent(s._id)}`, 'PATCH', payload);
      if (!rr.ok) return alert('저장 실패');
      if (rr.renameError) alert(`저장은 됐는데 파일명 변경 실패: ${rr.renameError}`);
      el.remove();
    };
    wrap.appendChild(el);
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function wire() {
  $('loginBtn').onclick = async () => {
    const userId = $('loginId').value.trim();
    const password = $('loginPw').value;
    const r = await apiJson('/api/admin/login', 'POST', { userId, password });
    $('loginOut').textContent = JSON.stringify(r, null, 2);
    if (r.ok) location.reload();
  };

  $('logoutBtn').onclick = async () => {
    await apiJson('/api/admin/logout', 'POST', {});
    location.reload();
  };

  $('saveMainBtn').onclick = () => saveMain().catch(() => {});
  $('saveRootFolderBtn').onclick = () => saveDriveRoot().catch(() => {});
  $('syncBtn').onclick = async () => {
    if (syncRunning) {
      const r = await apiJson('/api/admin/sync/stop', 'POST', {});
      $('syncOut').textContent = JSON.stringify(r, null, 2);
      await loadSyncStatus();
      return;
    }
    await syncDrive();
  };
  $('reloadParseErrorsBtn').onclick = () => loadParseErrors().catch(() => {});

  $('reloadUsersBtn').onclick = () => loadUsers().catch(() => {});
  $('createUserBtn').onclick = async () => {
    const userId = $('newUserId').value.trim();
    const role = $('newUserRole').value;
    const displayName = $('newUserName').value.trim();
    if (!userId) return alert('userId를 입력하세요');
    const r = await apiJson('/api/admin/users', 'POST', { userId, role, displayName });
    if (!r.ok) return alert('생성 실패');
    $('newUserId').value = '';
    $('newUserName').value = '';
    alert(`생성 완료: ${userId} (PW: ${r.password || '1234'})`);
    await loadUsers();
  };
}

async function boot() {
  wire();
  const me = await refreshMe();
  if (me) {
    await loadMain();
    if (me.role === 'admin') await loadUsers();
    await loadDriveRoot();
    await loadSyncStatus();
    await loadParseErrors();
    startSyncPolling();
  } else {
    stopSyncPolling();
  }
}

boot().catch((e) => console.error(e));
