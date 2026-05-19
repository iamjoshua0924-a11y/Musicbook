const $ = (id) => document.getElementById(id);
let syncRunning = false;
let syncPoller = null;
const importPollers = new Map(); // kind -> intervalId

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
  ['meCard', 'mainCard', 'syncCard', 'parseErrorCard', 'csvImportCard', 'csvImportUsersCard', 'csvImportAvailabilityCard'].forEach((id) => {
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

async function loadImportStatus(kind) {
  const r = await apiGet(`/api/admin/import/status?kind=${encodeURIComponent(kind)}`);
  if (!r.ok) return null;
  return r.status;
}

function startImportPolling(kind, outId, detailId) {
  const k = String(kind || '').trim().toLowerCase();
  if (importPollers.has(k)) return;
  const tick = async () => {
    const s = await loadImportStatus(k);
    if (!s) return;
    const out = $(outId);
    const detail = $(detailId);
    if (detail) detail.textContent = JSON.stringify({ ok: true, status: s }, null, 2);
    if (out) {
      if (s.running) out.textContent = `진행중 · ${s.processedRows ?? 0}/${s.totalRows ?? '?'} · created=${s.created ?? 0} updated=${s.updated ?? 0} skipped=${s.skippedSame ?? 0}`;
      else out.textContent = `완료 · ${s.processedRows ?? 0}/${s.totalRows ?? '?'} · created=${s.created ?? 0} updated=${s.updated ?? 0} skipped=${s.skippedSame ?? 0}`;
    }
    if (!s.running) {
      clearInterval(importPollers.get(k));
      importPollers.delete(k);
      setTimeout(() => {
        if (out) out.textContent = '';
      }, 2500);
    }
  };
  const id = setInterval(() => tick().catch(() => {}), 900);
  importPollers.set(k, id);
  tick().catch(() => {});
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

  $('importSongsCsvBtn').onclick = async () => {
    const f = $('songsCsvFile')?.files?.[0];
    if (!f) return alert('CSV 파일을 선택하세요.');
    $('importSongsCsvOut').textContent = '업로드/임포트 중...';
    const text = await f.text();
    const r = await apiJson('/api/admin/import/songs-csv', 'POST', { csvText: text });
    $('importSongsCsvDetail').textContent = JSON.stringify(r, null, 2);
    if (!r.ok) return ($('importSongsCsvOut').textContent = `실패: ${r.error || ''}`);
    startImportPolling('songs', 'importSongsCsvOut', 'importSongsCsvDetail');
  };

  $('importUsersCsvBtn').onclick = async () => {
    const f = $('usersCsvFile')?.files?.[0];
    if (!f) return alert('CSV 파일을 선택하세요.');
    $('importUsersCsvOut').textContent = '업로드/임포트 중...';
    const text = await f.text();
    const updatePasswordExisting = Boolean($('updateUserPwToggle')?.checked);
    const r = await apiJson('/api/admin/import/users-csv', 'POST', { csvText: text, updatePasswordExisting });
    $('importUsersCsvDetail').textContent = JSON.stringify(r, null, 2);
    if (!r.ok) return ($('importUsersCsvOut').textContent = `실패: ${r.error || ''}`);
    startImportPolling('users', 'importUsersCsvOut', 'importUsersCsvDetail');
  };

  $('importAvailabilityCsvBtn').onclick = async () => {
    const f = $('availabilityCsvFile')?.files?.[0];
    if (!f) return alert('CSV 파일을 선택하세요.');
    $('importAvailabilityCsvOut').textContent = '업로드/임포트 중...';
    const text = await f.text();
    const r = await apiJson('/api/admin/import/availability-csv', 'POST', { csvText: text });
    $('importAvailabilityCsvDetail').textContent = JSON.stringify(r, null, 2);
    if (!r.ok) return ($('importAvailabilityCsvOut').textContent = `실패: ${r.error || ''}`);
    startImportPolling('availability', 'importAvailabilityCsvOut', 'importAvailabilityCsvDetail');
  };
}

async function boot() {
  wire();
  const me = await refreshMe();
  if (me) {
    await loadMain();
    await loadDriveRoot();
    await loadSyncStatus();
    await loadParseErrors();
    startSyncPolling();
  } else {
    stopSyncPolling();
  }
}

boot().catch((e) => console.error(e));
