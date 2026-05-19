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
  ['meCard', 'mainCard', 'syncCard'].forEach((id) => {
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
}

async function boot() {
  wire();
  const me = await refreshMe();
  if (me) {
    await loadMain();
    await loadDriveRoot();
    await loadSyncStatus();
  }
}

boot().catch((e) => console.error(e));
