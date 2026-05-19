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
  ['meCard', 'mainCard', 'syncCard', 'usersCard', 'availCard'].forEach((id) => {
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

async function loadUsers() {
  const r = await apiGet('/api/admin/users');
  if (!r.ok) return;
  const list = $('usersList');
  list.innerHTML = '';
  r.items.forEach((u) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div>
        <div><b>${u.userId}</b> <span class="kbd">${u.role}</span></div>
        <div class="muted">${u.displayName || ''} ${u.active === false ? '(비활성)' : ''}</div>
      </div>
    `;
    list.appendChild(el);
  });
  return r.items;
}

async function createUser() {
  const payload = {
    userId: $('newUserId').value.trim(),
    password: $('newPassword').value,
    role: $('newRole').value,
    displayName: $('newDisplayName').value.trim()
  };
  const r = await apiJson('/api/admin/users', 'POST', payload);
  if (!r.ok) return alert('생성 실패');
  $('newPassword').value = '';
  await loadUsers();
  await loadAvailUsers();
}

// Availability UI
let availSongs = [];
let availMap = new Map(); // fileId -> boolean

async function loadAvailUsers() {
  const r = await apiGet('/api/admin/users');
  if (!r.ok) return;
  const sel = $('availUserSelect');
  sel.innerHTML = '';
  r.items
    .filter((u) => u.role === 'session' || u.role === 'admin')
    .forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.userId;
      opt.textContent = `${u.userId} (${u.role})`;
      sel.appendChild(opt);
    });
}

async function loadAvail() {
  const userId = $('availUserSelect').value;
  if (!userId) return;
  const [songsRes, availRes] = await Promise.all([apiGet('/api/songs?limit=5000'), apiGet(`/api/availability?userId=${encodeURIComponent(userId)}`)]);
  if (!songsRes.ok) return;
  availSongs = songsRes.items || [];
  availMap = new Map();
  (availRes.items || []).forEach((a) => availMap.set(a.googleFileId, Boolean(a.available)));
  renderAvail();
  $('availOut').textContent = `불러옴: ${availSongs.length}곡`;
}

function renderAvail() {
  const q = $('availSearch').value.trim().toLowerCase();
  const wrap = $('availGrid');
  wrap.innerHTML = '';

  availSongs
    .filter((s) => !q || (s.searchText || '').includes(q) || (s.title || '').toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q))
    .slice(0, 2000)
    .forEach((s) => {
      const fileId = s.googleFileId;
      const checked = availMap.has(fileId) ? availMap.get(fileId) : false;
      const el = document.createElement('div');
      el.className = 'avail-row';
      el.innerHTML = `
        <div class="avail-left">
          <div class="avail-title">${s.displayTitle || s.title}</div>
          <div class="avail-sub">${s.artist || ''}</div>
        </div>
        <label><input type="checkbox" ${checked ? 'checked' : ''} /></label>
      `;
      el.querySelector('input').onchange = (e) => {
        availMap.set(fileId, Boolean(e.target.checked));
      };
      wrap.appendChild(el);
    });
}

async function saveAvail() {
  const userId = $('availUserSelect').value;
  if (!userId) return;
  const items = Array.from(availMap.entries()).map(([googleFileId, available]) => ({ googleFileId, available }));
  const r = await apiJson('/api/availability/bulk', 'POST', { userId, items });
  $('availOut').textContent = JSON.stringify(r, null, 2);
}

function wire() {
  $('loginBtn').onclick = async () => {
    const userId = $('loginId').value.trim();
    const password = $('loginPw').value;
    const r = await apiJson('/api/admin/login', 'POST', { userId, password });
    $('loginOut').textContent = JSON.stringify(r, null, 2);
    if (r.ok) {
      $('loginPw').value = '';
      await refreshMe();
      await loadMain();
      await loadUsers();
      await loadAvailUsers();
    }
  };

  $('bootstrapBtn').onclick = async () => {
    const payload = {
      token: $('bootToken').value.trim(),
      userId: $('bootUserId').value.trim(),
      password: $('bootPw').value,
      displayName: $('bootName').value.trim()
    };
    const r = await apiJson('/api/admin/bootstrap', 'POST', payload);
    $('bootstrapOut').textContent = JSON.stringify(r, null, 2);
    if (r.ok) {
      $('loginId').value = payload.userId;
      $('loginPw').value = payload.password;
      alert('생성 완료. 위 로그인으로 바로 로그인하세요.');
    }
  };

  $('logoutBtn').onclick = async () => {
    await apiJson('/api/admin/logout', 'POST', {});
    location.reload();
  };

  $('saveMainBtn').onclick = () => saveMain().catch(() => {});
  $('syncBtn').onclick = () => syncDrive().catch(() => {});
  $('createUserBtn').onclick = () => createUser().catch(() => {});

  $('availLoadBtn').onclick = () => loadAvail().catch(() => {});
  $('availSaveBtn').onclick = () => saveAvail().catch(() => {});
  $('availSearch').oninput = () => renderAvail();
}

async function boot() {
  wire();
  const me = await refreshMe();
  if (me) {
    await loadMain();
    await loadUsers();
    await loadAvailUsers();
    await loadSyncStatus();
  }
}

boot().catch((e) => console.error(e));
