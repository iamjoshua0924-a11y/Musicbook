const $ = (id) => document.getElementById(id);
let syncRunning = false;
let autoPoller = null;
let syncPoller = null;

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
  ['meCard', 'usersCard', 'sessionsCard', 'connectionsCard', 'syncCard', 'parseErrorCard', 'trafficCard', 'errorsCard'].forEach((id) => {
    const el = $(id);
    if (el) el.style.display = on ? 'block' : 'none';
  });
}

async function refreshMe() {
  const r = await apiGet('/api/dev/me');
  const authed = Boolean(r?.authed);
  $('meText').textContent = authed ? `authed · ${new Date(r.authedAt || Date.now()).toLocaleString()}` : 'not authed';
  showAuthed(authed);
  if (!authed) stopSyncPolling();
  return authed;
}

async function login() {
  const token = ($('devToken')?.value || '').trim();
  if (!token) return;
  const r = await apiJson('/api/dev/auth', 'POST', { token });
  $('loginOut').textContent = JSON.stringify(r, null, 2);
  const authed = await refreshMe();
  if (authed) {
    startSyncPolling();
    // best-effort initial load
    loadSync().catch(() => {});
  }
}

async function logout() {
  await apiJson('/api/dev/logout', 'POST', {});
  await refreshMe();
}

function startSyncPolling() {
  if (syncPoller) return;
  syncPoller = setInterval(() => loadSync().catch(() => {}), 1200);
}
function stopSyncPolling() {
  if (!syncPoller) return;
  clearInterval(syncPoller);
  syncPoller = null;
}

async function loadSessions() {
  $('sessionsOut').textContent = '로딩 중...';
  $('sessionsList').innerHTML = '';
  const [r, sr] = await Promise.all([apiGet('/api/dev/sessions'), apiGet('/api/dev/sessions/stats')]);
  if (!r.ok) {
    $('sessionsOut').textContent = `실패: ${r.error || ''}`;
    return;
  }
  const rooms = Array.isArray(r.rooms) ? r.rooms : [];
  const st = sr?.ok ? sr.stats : null;
  $('sessionsOut').textContent = st
    ? `룸 ${st.roomsCount} · 멤버 ${st.totalMembers} · unique ${st.uniqueMemberIds} · TURNER ${st.pageTurnerCount} · TOOL ${st.toolAuthorizedCount} · 요청 ${st.toolRequestedCount} · 합주 ${st.rehearsalEligibleCount}/${st.rehearsalReadyCount}`
    : `총 ${rooms.length}개`;
  rooms.forEach((x) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div><span class="kbd">${String(x.roomCode || '')}</span> · members=${x.memberCount || 0} · page=${x.currentPageNo || 1}</div>
        <div class="muted">${String(x.currentFileId || '') ? `fileId=${String(x.currentFileId)}` : ''} ${x.rehearsalActive ? '· rehearsal=ON' : ''}</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button type="button" class="light" data-action="detail">상세</button>
        <div class="muted">${x.ageMs != null ? `${Math.round(x.ageMs / 1000)}s` : ''}</div>
      </div>
    `;
    el.querySelector('[data-action="detail"]').onclick = () => openSessionDetail(String(x.roomCode || '')).catch(() => {});
    $('sessionsList').appendChild(el);
  });
}

function setHidden(id, hidden) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle('hidden', Boolean(hidden));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function openSessionDetail(roomCode) {
  const code = String(roomCode || '').trim().toUpperCase();
  if (!code) return;
  $('sessionDetailHead').textContent = `roomCode: ${code}`;
  $('sessionDetailRoom').textContent = '로딩 중...';
  $('sessionDetailMembers').innerHTML = '<div class="muted">로딩 중...</div>';
  setHidden('sessionDetailModal', false);

  const r = await apiGet(`/api/dev/sessions/${encodeURIComponent(code)}`);
  if (!r.ok) {
    $('sessionDetailRoom').textContent = `실패: ${r.error || ''}`;
    $('sessionDetailMembers').innerHTML = '';
    return;
  }
  const room = r.room || {};
  const members = Array.isArray(r.members) ? r.members : [];
  // Pretty render (keep JSON-ish but more readable)
  const lines = [];
  lines.push(`roomCode: ${room.roomCode || ''}`);
  lines.push(`ageSec: ${room.ageMs != null ? Math.round(Number(room.ageMs) / 1000) : '-'}`);
  lines.push(`memberCount: ${room.memberCount ?? '-'}`);
  lines.push(`pageTurnerSocketId: ${room.pageTurnerSocketId ? String(room.pageTurnerSocketId).slice(0, 10) : '-'}`);
  lines.push(`currentFileId: ${room.currentFileId || '-'}`);
  lines.push(`currentPageNo: ${room.currentPageNo || 1}`);
  lines.push(`scrollRatio: ${room.currentScrollRatio != null ? Number(room.currentScrollRatio).toFixed(3) : '-'}`);
  lines.push(`rehearsalActive: ${room.rehearsalActive ? 'ON' : 'OFF'}`);
  lines.push(`toolAuthorizedCount: ${room.toolAuthorizedCount ?? 0}`);
  lines.push(`toolRequestedCount: ${room.toolRequestedCount ?? 0}`);
  if (Array.isArray(room.annotationsFiles) && room.annotationsFiles.length) {
    lines.push(`annotationsFiles:`);
    room.annotationsFiles.slice(0, 30).forEach((f) => {
      lines.push(`  - ${String(f.fileId).slice(0, 10)}…  pages=${f.pageCount ?? 0}  updatedAt=${f.updatedAt || '-'}`);
    });
  } else {
    lines.push(`annotationsFiles: -`);
  }
  $('sessionDetailRoom').textContent = lines.join('\n');

  const wrap = $('sessionDetailMembers');
  wrap.innerHTML = '';
  if (!members.length) {
    wrap.innerHTML = '<div class="muted">멤버 없음</div>';
    return;
  }
  members.forEach((m) => {
    const name = String(m.displayName || m.nickname || m.memberId || '익명');
    const badges = [];
    if (m.isPageTurner) badges.push('<span class="badge blue">TURNER</span>');
    if (m.isToolAuthorized) badges.push('<span class="badge green">TOOL</span>');
    if (m.toolRequested) badges.push('<span class="badge red">요청</span>');
    if (m.isRehearsalEligible) badges.push(`<span class="badge ${m.isRehearsalReady ? 'green' : 'red'}">합주</span>`);
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div><b>${esc(name)}</b> <span class="muted">${esc(m.role || '')}</span></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">${badges.join(' ')}</div>
        <div class="muted" style="font-size:12px;">memberId=${esc(m.memberId || '')} · socketId=${esc(String(m.socketId || '').slice(0, 8))}</div>
      </div>
    `;
    wrap.appendChild(el);
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
    limit: 7000,
    incremental: Boolean($('incrementalToggle')?.checked),
    pruneMissing: Boolean($('pruneToggle')?.checked)
  };
  const r = await apiJson('/api/dev/sync/drive', 'POST', payload);
  $('syncJson').textContent = JSON.stringify(r, null, 2);
  startSyncPolling();
  await loadSync();
}

async function toggleSync() {
  if (syncRunning) {
    const r = await apiJson('/api/dev/sync/stop', 'POST', {});
    $('syncJson').textContent = JSON.stringify(r, null, 2);
    startSyncPolling();
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

function formatRelTime(dateLike) {
  if (!dateLike) return { label: '기록 없음', title: '' };
  const t = new Date(dateLike).getTime();
  if (!Number.isFinite(t) || t <= 0) return { label: '기록 없음', title: '' };
  const diff = Date.now() - t;
  const title = new Date(t).toLocaleString();
  if (diff < 60 * 1000) return { label: '방금', title };
  if (diff < 60 * 60 * 1000) return { label: `${Math.floor(diff / 60000)}분 전`, title };
  if (diff < 24 * 60 * 60 * 1000) return { label: `${Math.floor(diff / 3600000)}시간 전`, title };
  if (diff < 30 * 24 * 60 * 60 * 1000) return { label: `${Math.floor(diff / 86400000)}일 전`, title };
  return { label: `${Math.floor(diff / (30 * 86400000))}개월 전`, title };
}

async function loadUsers() {
  const out = $('usersOut');
  const wrap = $('usersList');
  if (out) out.textContent = '로딩 중...';
  if (wrap) wrap.innerHTML = '';
  const r = await apiGet('/api/dev/users');
  if (!r.ok) {
    if (out) out.textContent = `불러오기 실패: ${r.error || ''}`;
    return;
  }
  const items = Array.isArray(r.items) ? r.items : [];
  if (out) out.textContent = `총 ${items.length}명`;
  items.forEach((u) => {
    const el = document.createElement('div');
    el.className = 'item';
    const seen = formatRelTime(u.lastSeenAt);
    const created = formatRelTime(u.createdAt);
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="kbd">${esc(u.userId || '')}</span>
          ${u.isPrivate ? '<span class="badge private">private</span>' : ''}
          <b>${esc(u.role || '')}</b>
          ${u.active === false ? '<span class="muted">(비활성)</span>' : ''}
        </div>
        <div class="muted">${esc(u.displayName || '')}</div>
      </div>
      <div style="display:grid; gap:6px; text-align:right; align-content:start;">
        <div class="muted" title="${esc(seen.title)}">lastSeen: <b>${esc(seen.label)}</b></div>
        <div class="muted" title="${esc(created.title)}">created: ${esc(created.label)}</div>
        ${u.isPrivate && u.archivePath ? `<button class="light" type="button" data-archive="1">개인 노래책 열기</button>` : ''}
        ${u.isPrivate ? `<button class="light" type="button" data-del-private="1">삭제</button>` : u.role !== 'admin' ? `<button class="light" type="button" data-del="1">삭제</button>` : ''}
      </div>
    `;
    el.querySelector('[data-archive="1"]')?.addEventListener?.('click', () => {
      const url = String(u.archivePath || '').trim();
      if (!url) return;
      window.open(url, '_blank', 'noopener');
    });
    el.querySelector('[data-del-private="1"]')?.addEventListener?.('click', () => deletePrivateUser(u.userId).catch(() => {}));
    el.querySelector('[data-del="1"]')?.addEventListener?.('click', () => deleteUser(u.userId).catch(() => {}));
    wrap.appendChild(el);
  });
}

async function loadPrivateArchivePrefix() {
  const out = $('privateArchiveOut');
  if (out) out.textContent = '로딩 중...';
  const r = await apiGet('/api/dev/private-archive');
  if (!r.ok) {
    if (out) out.textContent = `실패: ${r.error || ''}`;
    return;
  }
  if (out) out.textContent = `개인 노래책 URL 베이스: ${String(r.prefix || '')}`;
}

async function createPrivateUser() {
  const uid = String($('privateUserId')?.value || '').trim();
  const dn = String($('privateDisplayName')?.value || '').trim();
  if (!uid) return alert('private userId를 입력하세요.');
  const r = await apiJson('/api/dev/users/private', 'POST', { userId: uid, displayName: dn });
  if (!r.ok) return alert(`생성 실패: ${r.error || ''}`);
  const url = String(r?.user?.archivePath || '');
  alert(`생성 완료\n- userId: ${uid}\n- PW: 1234\n- archive: ${url || ''}`);
  await loadUsers();
}

async function deletePrivateUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  if (!confirm(`[private] 유저를 삭제할까요?\n- ${uid}\n(가능곡 데이터도 함께 삭제됩니다)`)) return;
  const r = await apiJson(`/api/dev/users/private/${encodeURIComponent(uid)}`, 'DELETE', {});
  if (!r.ok) return alert(`삭제 실패: ${r.error || ''}`);
  await loadUsers();
}

async function deleteUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  if (!confirm(`유저를 삭제할까요?\n- ${uid}\n(가능곡 데이터도 함께 삭제됩니다)`)) return;
  const r = await apiJson(`/api/dev/users/${encodeURIComponent(uid)}`, 'DELETE', {});
  if (!r.ok) return alert(`삭제 실패: ${r.error || ''}`);
  await loadUsers();
}

function drawLineChart(canvas, points, { color = '#64d2ff', fill = 'rgba(100,210,255,0.12)' } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // background grid
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i += 1) {
    const y = (h * i) / 5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const arr = Array.isArray(points) ? points : [];
  if (!arr.length) return;
  const max = Math.max(1, ...arr.map((p) => Number(p.c || 0)));
  const minT = Number(arr[0].t || 0);
  const maxT = Number(arr[arr.length - 1].t || 0);
  const spanT = Math.max(1, maxT - minT);

  const xOf = (t) => ((Number(t) - minT) / spanT) * (w - 20) + 10;
  const yOf = (c) => h - 20 - (Number(c || 0) / max) * (h - 40);

  // area fill
  ctx.beginPath();
  ctx.moveTo(xOf(arr[0].t), h - 20);
  arr.forEach((p) => ctx.lineTo(xOf(p.t), yOf(p.c)));
  ctx.lineTo(xOf(arr[arr.length - 1].t), h - 20);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // line
  ctx.beginPath();
  arr.forEach((p, i) => {
    const x = xOf(p.t);
    const y = yOf(p.c);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // labels (max + now)
  ctx.fillStyle = 'rgba(255,255,255,0.70)';
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  ctx.fillText(`max ${max}`, 10, 14);
  const last = arr[arr.length - 1];
  ctx.fillText(`now ${Number(last?.c || 0)}`, 10, 28);
}

async function loadConnections() {
  const out = $('connectionsOut');
  if (out) out.textContent = '로딩 중...';
  const r = await apiGet('/api/dev/connections');
  if (!r.ok) {
    if (out) out.textContent = `실패: ${r.error || ''}`;
    return;
  }
  const nowCount = Number(r.nowCount || 0);
  const pts = Array.isArray(r.points) ? r.points : [];
  if (out) out.textContent = `현재 ${nowCount} · ${pts.length}pt`;
  drawLineChart($('connectionsCanvas'), pts);
}

$('devLoginBtn').onclick = () => login().catch(() => {});
$('devLogoutBtn').onclick = () => logout().catch(() => {});
$('reloadUsersBtn')?.addEventListener?.('click', () => loadUsers().catch(() => {}));
$('createPrivateUserBtn')?.addEventListener?.('click', () => createPrivateUser().catch(() => {}));
$('reloadSessionsBtn').onclick = () => loadSessions().catch(() => {});
$('reloadConnectionsBtn')?.addEventListener?.('click', () => loadConnections().catch(() => {}));
$('saveRootFolderBtn')?.addEventListener?.('click', () => saveDriveRoot().catch(() => {}));
$('syncBtn')?.addEventListener?.('click', () => toggleSync().catch(() => {}));
$('reloadParseErrorsBtn')?.addEventListener?.('click', () => loadParseErrors().catch(() => {}));
$('reloadTrafficBtn').onclick = () => loadTraffic().catch(() => {});
$('resetTrafficBtn').onclick = () => resetTraffic().catch(() => {});
$('reloadErrorsBtn').onclick = () => loadErrors().catch(() => {});
$('clearErrorsBtn').onclick = () => clearErrors().catch(() => {});

$('sessionDetailCloseBtn')?.addEventListener?.('click', () => setHidden('sessionDetailModal', true));
$('sessionDetailModal')?.addEventListener?.('click', (e) => {
  if (e.target?.id === 'sessionDetailModal') setHidden('sessionDetailModal', true);
});

function setAutoRefresh(on) {
  const enabled = Boolean(on);
  try {
    localStorage.setItem('mb_dev_auto_refresh', enabled ? '1' : '0');
  } catch {}
  if (autoPoller) {
    clearInterval(autoPoller);
    autoPoller = null;
  }
  if (!enabled) return;
  autoPoller = setInterval(() => {
    // best-effort: these should not throw
    loadSessions().catch(() => {});
    loadConnections().catch(() => {});
    loadSync().catch(() => {});
    loadErrors().catch(() => {});
  }, 2000);
}

try {
  const v = localStorage.getItem('mb_dev_auto_refresh') === '1';
  if ($('autoRefreshToggle')) $('autoRefreshToggle').checked = v;
  setAutoRefresh(v);
} catch {}

$('autoRefreshToggle')?.addEventListener?.('change', (e) => setAutoRefresh(Boolean(e.target?.checked)));

refreshMe()
  .then((authed) => {
    if (authed) {
      loadPrivateArchivePrefix().catch(() => {});
      loadUsers().catch(() => {});
      loadSessions().catch(() => {});
      loadConnections().catch(() => {});
      loadDriveRoot().catch(() => {});
      loadSync().catch(() => {});
      loadParseErrors().catch(() => {});
      loadTraffic().catch(() => {});
      loadErrors().catch(() => {});
    }
  })
  .catch(() => {});
