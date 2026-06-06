const $ = (id) => document.getElementById(id);
const setDisplay = (id, display) => {
  const el = $(id);
  if (el) el.style.display = display;
};
let syncRunning = false;
let syncPoller = null;

// TODO: Render 백엔드 배포 후 발급받은 새 주소를 여기에 입력할 예정
// (또는 public/config.js에서 window.API_URL을 설정)
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

// Back link: Render(/admin)에서 열릴 때는 /musicbook/ 경로가 없으므로 루트로 보정.
try {
  const a = document.getElementById('backToSongbook');
  if (a) {
    const host = String(window.location.hostname || '');
    if (host.endsWith('onrender.com') && window.location.pathname === '/admin') a.href = '/';
  }
} catch {}

function showAuthed(on) {
  setDisplay('loginCard', on ? 'none' : 'block');
  // CSV 임포트 기능은 더 이상 사용하지 않으므로 UI에서 제거
  // 진단/운영 콘솔은 /dev로 이관됨
  ['meCard', 'mainCard', 'usersCard'].forEach((id) => setDisplay(id, on ? 'block' : 'none'));
  ['syncCard', 'parseErrorCard', 'trafficCard'].forEach((id) => setDisplay(id, 'none'));
}

async function refreshMe() {
  const me = await apiGet('/api/admin/me');
  if (!me.ok) {
    showAuthed(false);
    return null;
  }
  if ($('meText')) $('meText').textContent = `${me.user.userId} (${me.user.role})`;
  showAuthed(true);
  return me.user;
}

async function loadUsers() {
  const out = $('usersOut');
  const wrap = $('usersList');
  if (out) out.textContent = '로딩 중...';
  // UX: 새로고침 중 리스트를 비우면 레이아웃이 접혔다 펴지며 화면이 흔들린다.
  // 기존 DOM을 유지한 채로 "로딩 상태"만 표시하고, 응답이 오면 한 번에 replace한다.
  let prevH = 0;
  try {
    if (wrap) {
      prevH = Math.round(wrap.getBoundingClientRect().height || 0);
      if (prevH > 0) wrap.style.minHeight = `${prevH}px`;
      wrap.classList.add('loading');
    }
  } catch {}
  const r = await apiGet('/api/admin/users');
  try {
    if (wrap) wrap.classList.remove('loading');
  } catch {}
  if (!r.ok) {
    if (out) out.textContent = `불러오기 실패: ${r.error || ''}`;
    try {
      if (wrap) wrap.style.minHeight = '';
    } catch {}
    return;
  }
  const items = Array.isArray(r.items) ? r.items : [];
  if (out) out.textContent = `총 ${items.length}명`;
  const frag = document.createDocumentFragment();
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
        <button class="light" data-action="delete" style="border-color: rgba(255,107,107,0.5); color:#ffb3b3;">삭제</button>
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
    el.querySelector('[data-action="delete"]').onclick = async () => {
      if (!confirm(`정말 삭제할까요?\n- userId: ${u.userId}\n- 관련 가능곡(availability) 데이터도 함께 삭제됩니다.`)) return;
      const rr = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(u.userId)}`), { method: 'DELETE', credentials: 'include' }).then((x) =>
        x.json()
      );
      if (!rr.ok) return alert(`실패: ${rr.error || ''}`);
      await loadUsers();
    };
    frag.appendChild(el);
  });
  try {
    if (wrap) wrap.replaceChildren(frag);
  } catch {
    try {
      if (wrap) {
        wrap.innerHTML = '';
        wrap.appendChild(frag);
      }
    } catch {}
  }
  // 레이아웃 안정화가 끝나면 minHeight 해제
  try {
    if (wrap) setTimeout(() => (wrap.style.minHeight = ''), 0);
  } catch {}
}

async function loadMain() {
  const r = await apiGet('/api/main');
  if (!r.ok) return;
  const d = r.data;
  if ($('titleImage')) $('titleImage').value = d.titleImage || '';
  if ($('bannerImage')) $('bannerImage').value = d.bannerImage || '';
  if ($('notice')) $('notice').value = d.notice || '';
  if ($('discordUrl')) $('discordUrl').value = d.discordUrl || '';
  if ($('youtubeUrl')) $('youtubeUrl').value = d.youtubeUrl || '';
  if ($('chzzkUrl')) $('chzzkUrl').value = d.chzzkUrl || '';
}

async function saveMain() {
  const fields = ['titleImage', 'bannerImage', 'notice', 'discordUrl', 'youtubeUrl', 'chzzkUrl'];
  for (const f of fields) {
    const el = $(f);
    const v = el ? el.value : '';
    const r = await apiJson('/api/main', 'PATCH', { field: f, value: v });
    if (!r.ok) {
      if ($('mainSaveOut')) $('mainSaveOut').textContent = `저장 실패: ${r.error || ''}`;
      return;
    }
  }
  if ($('mainSaveOut')) $('mainSaveOut').textContent = '저장 완료';
  setTimeout(() => {
    if ($('mainSaveOut')) $('mainSaveOut').textContent = '';
  }, 1200);
}

async function loadDriveRoot() {
  const r = await apiGet('/api/admin/drive-root');
  if (!r.ok) return;
  if ($('rootFolderId')) $('rootFolderId').value = r.rootFolderId || '';
}

async function saveDriveRoot() {
  const rootFolderId = ($('rootFolderId')?.value || '').trim();
  const r = await apiJson('/api/admin/drive-root', 'PATCH', { rootFolderId });
  if (!r.ok) return alert('저장 실패');
  if ($('rootFolderId')) $('rootFolderId').value = r.rootFolderId || '';
}

async function syncDrive() {
  const payload = {
    rootFolderId: ($('rootFolderId')?.value || '').trim(),
    latestDays: Number($('latestDays')?.value || 30),
    limit: 7000,
    incremental: Boolean($('incrementalToggle')?.checked),
    pruneMissing: Boolean($('pruneToggle')?.checked)
  };
  const r = await apiJson('/api/admin/sync/drive', 'POST', payload);
  if ($('syncOut')) $('syncOut').textContent = JSON.stringify(r, null, 2);
  await loadSyncStatus();
}

async function loadSyncStatus() {
  const r = await apiGet('/api/admin/sync/status');
  if (!r.ok) return;
  const s = r.status;
  if (!s) {
    if ($('syncStatusLine')) $('syncStatusLine').textContent = '-';
    syncRunning = false;
    const btn = $('syncBtn');
    if (btn) btn.textContent = '동기화 실행';
    return;
  }
  const msg = s.running
    ? `RUNNING · processed=${s.processed ?? 0} skipped=${s.skipped ?? 0}${s.currentPath ? ` · path=${s.currentPath}` : ''}${s.currentFile ? ` · file=${s.currentFile}` : ''}`
    : `endedAt=${s.endedAt || '-'} · processed=${s.processed ?? '-'} · skipped=${s.skipped ?? '-'} · hidden=${s.hiddenCount ?? '-'}${
        s.diff ? ` · +${s.diff.addedCount ?? 0} ~${s.diff.changedCount ?? 0} -${s.diff.removedCount ?? 0}` : ''
      }`;
  if ($('syncStatusLine')) $('syncStatusLine').textContent = msg;
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
  if (wrap) wrap.innerHTML = '';
  if ($('parseErrorOut')) $('parseErrorOut').textContent = `총 ${r.items?.length || 0}건`;

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
      const rr = await apiJson(`/api/admin/songs/${encodeURIComponent(s._id)}`, 'PATCH', payload);
      if (!rr.ok) return alert('저장 실패');
      if (rr.renameError) alert(`저장은 됐는데 파일명 변경 실패: ${rr.renameError}`);
      el.remove();
    };
    if (wrap) wrap.appendChild(el);
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

function formatBytes(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function topFileIdsToText(map, topN = 8) {
  const entries = Object.entries(map || {})
    .map(([k, v]) => [k, Number(v?.bytes || 0), Number(v?.count || 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  if (!entries.length) return '-';
  return entries.map(([k, bytes, c]) => `${k} · ${formatBytes(bytes)} · ${c}x`).join('\n');
}

async function loadTraffic() {
  const out = $('trafficOut');
  const pre = $('trafficJson');
  if (out) out.textContent = '로딩 중...';
  if (pre) pre.textContent = '';
  const r = await apiGet('/api/admin/metrics/traffic');
  if (!r.ok) {
    if (out) out.textContent = `불러오기 실패: ${r.error || ''}`;
    return;
  }
  const d = r.data || {};
  const http = d.http || {};
  const ws = d.ws || {};

  let httpBytes = 0;
  let httpCount = 0;
  let httpRanges = 0;
  Object.values(http).forEach((m) => {
    httpBytes += Number(m?.bytes || 0);
    httpCount += Number(m?.count || 0);
    httpRanges += Number(m?.ranges || 0);
  });
  let wsBytes = 0;
  let wsCount = 0;
  Object.values(ws).forEach((m) => {
    wsBytes += Number(m?.bytes || 0);
    wsCount += Number(m?.count || 0);
  });

  if (out) out.textContent = `HTTP ${httpCount}건 / ${formatBytes(httpBytes)} (Range ${httpRanges}건) · WS ${wsCount}건 / ${formatBytes(wsBytes)}`;

  const report = {
    startedAt: d.startedAt,
    summary: {
      http: { count: httpCount, bytes: httpBytes, ranges: httpRanges },
      ws: { count: wsCount, bytes: wsBytes }
    },
    top: {
      drive_pdf: topFileIdsToText(http['drive.pdf']?.topFileIds),
      drive_embed: topFileIdsToText(http['drive.embed']?.topFileIds),
      public_pdf: topFileIdsToText(http['public.pdf']?.topFileIds),
      wb_update: topFileIdsToText(ws['wb.page.update']?.topFileIds)
    },
    http,
    ws
  };
  if (pre) pre.textContent = JSON.stringify(report, null, 2);
}

async function resetTraffic() {
  if (!confirm('트래픽 계측을 리셋할까요?')) return;
  const r = await apiJson('/api/admin/metrics/traffic/reset', 'POST', {});
  if (!r.ok) return alert('리셋 실패');
  await loadTraffic();
}

function wire() {
  $('loginBtn')?.addEventListener?.('click', async () => {
    const userId = ($('loginId')?.value || '').trim();
    const password = $('loginPw')?.value || '';
    const r = await apiJson('/api/admin/login', 'POST', { userId, password });
    if ($('loginOut')) $('loginOut').textContent = JSON.stringify(r, null, 2);
    if (r.ok) location.reload();
  });

  $('logoutBtn')?.addEventListener?.('click', async () => {
    await apiJson('/api/admin/logout', 'POST', {});
    location.reload();
  });

  $('saveMainBtn')?.addEventListener?.('click', () => saveMain().catch(() => {}));
  $('saveRootFolderBtn')?.addEventListener?.('click', () => saveDriveRoot().catch(() => {}));
  $('syncBtn')?.addEventListener?.('click', async () => {
    if (syncRunning) {
      const r = await apiJson('/api/admin/sync/stop', 'POST', {});
      if ($('syncOut')) $('syncOut').textContent = JSON.stringify(r, null, 2);
      await loadSyncStatus();
      return;
    }
    await syncDrive();
  });
  $('reloadParseErrorsBtn')?.addEventListener?.('click', () => loadParseErrors().catch(() => {}));
  $('reloadTrafficBtn')?.addEventListener?.('click', () => loadTraffic().catch(() => {}));
  $('resetTrafficBtn')?.addEventListener?.('click', () => resetTraffic().catch(() => {}));

  $('reloadUsersBtn')?.addEventListener?.('click', () => loadUsers().catch(() => {}));
  $('createUserBtn')?.addEventListener?.('click', async () => {
    const userId = ($('newUserId')?.value || '').trim();
    const role = $('newUserRole')?.value || '';
    const displayName = ($('newUserName')?.value || '').trim();
    if (!userId) return alert('userId를 입력하세요');
    const r = await apiJson('/api/admin/users', 'POST', { userId, role, displayName });
    if (!r.ok) return alert('생성 실패');
    if ($('newUserId')) $('newUserId').value = '';
    if ($('newUserName')) $('newUserName').value = '';
    alert(`생성 완료: ${userId} (PW: ${r.password || '1234'})`);
    await loadUsers();
  });
}

async function boot() {
  wire();
  const me = await refreshMe();
  if (me) {
    await loadMain();
    if (me.role === 'admin') await loadUsers();
    // 진단/운영 기능은 /dev로 이관됨
    stopSyncPolling();
  } else {
    stopSyncPolling();
  }
}

boot().catch((e) => console.error(e));
