const $ = (id) => document.getElementById(id);

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
  ['meCard', 'mainCard', 'syncCard', 'parseErrorCard'].forEach((id) => {
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
    return;
  }
  const msg = s.running
    ? `RUNNING · startedAt=${s.startedAt}`
    : `endedAt=${s.endedAt || '-'} · processed=${s.processed ?? '-'} · skipped=${s.skipped ?? '-'} · hidden=${s.hiddenCount ?? '-'}`;
  $('syncStatusLine').textContent = msg;
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
        </div>
        ${s.driveUrl ? `<a href="${escapeHtml(s.driveUrl)}" target="_blank" class="muted">Drive 열기</a>` : ''}
      </div>
      <div>
        <button class="light" data-action="save">저장</button>
      </div>
    `;
    el.querySelector('[data-action="save"]').onclick = async () => {
      const payload = {};
      el.querySelectorAll('input[data-k]').forEach((inp) => (payload[inp.dataset.k] = inp.value));
      const rr = await apiJson(`/api/admin/songs/${encodeURIComponent(s._id)}`, 'PATCH', payload);
      if (!rr.ok) return alert('저장 실패');
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
  $('syncBtn').onclick = () => syncDrive().catch(() => {});
  $('reloadParseErrorsBtn').onclick = () => loadParseErrors().catch(() => {});
}

async function boot() {
  wire();
  const me = await refreshMe();
  if (me) {
    await loadMain();
    await loadDriveRoot();
    await loadSyncStatus();
    await loadParseErrors();
  }
}

boot().catch((e) => console.error(e));
