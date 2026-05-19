/* global io */

// ---- State -----------------------------------------------------------------------
const state = {
  role: 'viewer', // viewer | session | admin
  displayName: '방문자',
  main: null,
  songsAll: [],
  songsFiltered: [],
  requests: [],
  requestManageMode: false,
  selectedRequestIds: new Set(),
  availabilityUserId: '',
  availabilitySet: null,

  sessionRoomCode: '',
  isPageTurner: false,
  sessionCurrentFileId: '',
  sessionCurrentPageNo: 1,

  sortField: 'createdAt',
  sortDir: 'desc',
  page: 1,
  pageSize: 100
};

// ---- DOM helpers -----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showLoading(on) {
  $('loadingScreen').classList.toggle('active', Boolean(on));
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

function openModal(id) {
  $(id).classList.add('active');
}
function closeModal(id) {
  $(id).classList.remove('active');
}

function switchPage(page) {
  $('mainPage').classList.toggle('active', page === 'main');
  $('songsPage').classList.toggle('active', page === 'songs');
  $('mainNavBtn').classList.toggle('active', page === 'main');
  $('songsNavBtn').classList.toggle('active', page === 'songs');
  if (page === 'songs') {
    $('songsTitleRow').style.display = 'flex';
  } else {
    $('songsTitleRow').style.display = 'none';
  }
}

// ---- API -------------------------------------------------------------------------
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

async function loadMainPage() {
  const data = await apiGet('/api/main');
  if (!data.ok) return;
  state.main = data.data;

  // banner/title
  $('bannerImage').src = state.main.bannerImage || 'https://placehold.co/1200x400?text=NO+IMAGE';
  $('songsTitleLogo').src = state.main.titleImage || '';
  $('songsTitleLogo').style.display = state.main.titleImage ? 'block' : 'none';

  // notice
  $('noticeContent').innerText = state.main.notice || '';

  // external links
  $('discordBtn').onclick = () => state.main.discordUrl && window.open(state.main.discordUrl, '_blank');
  $('youtubeBtn').onclick = () => state.main.youtubeUrl && window.open(state.main.youtubeUrl, '_blank');
  $('chzzkBtn').onclick = () => state.main.chzzkUrl && window.open(state.main.chzzkUrl, '_blank');
}

async function loadSongs(force = false) {
  if (!force && state.songsAll.length) return;
  const data = await apiGet('/api/songs?limit=5000');
  if (!data.ok) throw new Error('songs load failed');
  state.songsAll = data.items || [];
  if (!state.songsAll.length) {
    $('resultCount').textContent = '곡 데이터가 없습니다. /admin에서 Drive 동기화를 실행해 주세요.';
  }
}

function applySongFilters() {
  const q = $('searchInput').value.trim().toLowerCase();
  const genre = $('genreFilter').value;
  const mood = $('moodFilter').value;
  const vocal = $('vocalFilter').value;
  const latestOnly = $('latestOnlyToggle').checked;
  const availUserId = $('availUserFilter')?.value || '';
  const availOnly = $('availOnlyToggle')?.checked;

  const hideTags = $('hideTagsToggle').checked;

  let list = state.songsAll.slice();

  list = list.filter((s) => !s.hidden);
  if (latestOnly) list = list.filter((s) => s.isLatest);
  if (genre) list = list.filter((s) => s.genre === genre);
  if (mood) list = list.filter((s) => s.mood === mood);
  if (vocal) list = list.filter((s) => s.vocal === vocal);
  if (q) {
    list = list.filter((s) => (s.searchText || '').includes(q) || (s.title || '').toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q));
  }

  // Availability filter (optional; session/admin oriented)
  if (availUserId && state.availabilityUserId === availUserId && state.availabilitySet) {
    if (availOnly) list = list.filter((s) => state.availabilitySet.has(s.googleFileId));
  }

  // sort
  const f = state.sortField;
  const dir = state.sortDir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    const av = a?.[f] ?? '';
    const bv = b?.[f] ?? '';
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });

  state.songsFiltered = list;
  $('resultCount').textContent = `검색 결과: ${list.length}곡`;
  renderSongCards(hideTags);
  renderPager();
}

function renderSongCards(hideTags) {
  const wrap = $('songCardList');
  wrap.innerHTML = '';

  const totalPages = Math.max(1, Math.ceil(state.songsFiltered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const items = state.songsFiltered.slice(start, start + state.pageSize);

  items.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'song-card';
    const title = s.displayTitle || s.title || '(제목없음)';
    const availUserId = $('availUserFilter')?.value || '';
    const availChip =
      availUserId && state.availabilityUserId === availUserId && state.availabilitySet
        ? state.availabilitySet.has(s.googleFileId)
          ? `<span class="chip">가능</span>`
          : `<span class="chip">불가</span>`
        : '';

    el.innerHTML = `
      <div class="song-title">${esc(title)} ${s.isLatest ? `<span class="chip">NEW!</span>` : ''} ${availChip}</div>
      <div class="song-artist">${esc(s.artist || '')}</div>
      ${hideTags ? '' : `
        <div class="song-tags">
          ${s.key ? `<span class="chip">Key ${esc(s.key)}</span>` : ''}
          ${s.genre ? `<span class="chip">${esc(s.genre)}</span>` : ''}
          ${s.mood ? `<span class="chip">${esc(s.mood)}</span>` : ''}
          ${s.vocal ? `<span class="chip">${esc(s.vocal)}</span>` : ''}
        </div>
      `}
    `;
    el.onclick = () => {
      if (!s.googleFileId) return;
      // If joined in a live session and this user is page turner, broadcast follow-file.
      const roomCode = state.sessionRoomCode;
      if (roomCode && state.isPageTurner) {
        state._socket?.emit?.('session:follow:file', { roomCode, fileId: s.googleFileId }, () => {
          window.location.href = `/viewer/${encodeURIComponent(s.googleFileId)}?room=${encodeURIComponent(roomCode)}`;
        });
      } else if (roomCode) {
        window.location.href = `/viewer/${encodeURIComponent(s.googleFileId)}?room=${encodeURIComponent(roomCode)}`;
      } else {
        window.location.href = `/viewer/${encodeURIComponent(s.googleFileId)}`;
      }
    };
    wrap.appendChild(el);
  });
}

function renderPager() {
  const totalPages = Math.max(1, Math.ceil(state.songsFiltered.length / state.pageSize));
  $('pageInfo').textContent = `${state.page} / ${totalPages}`;
  $('prevPageBtn').disabled = state.page <= 1;
  $('nextPageBtn').disabled = state.page >= totalPages;
}

function pickRandomSong() {
  if (!state.songsFiltered.length) return toast('랜덤 대상 곡이 없습니다.');
  const s = state.songsFiltered[Math.floor(Math.random() * state.songsFiltered.length)];
  $('randomResult').innerHTML = `<div><b>${esc(s.displayTitle || s.title)}</b></div><div style="opacity:.75;margin-top:4px">${esc(s.artist || '')}</div>`;
  $('randomRerollBtn').style.display = 'inline-flex';
  openModal('randomModal');
}

// ---- Requests --------------------------------------------------------------------
async function loadRequests(force = false) {
  if (!force && state.requests.length) return;
  const data = await apiGet('/api/requests');
  if (!data.ok) return;
  state.requests = data.items || [];
  renderRequests();
}

function renderRequests() {
  const wrap = $('requestTableBody');
  wrap.innerHTML = '';
  state.selectedRequestIds.clear();

  const showManage = state.requestManageMode;
  $('requestManageBar').style.display = showManage ? 'block' : 'none';

  state.requests.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'req-row';
    row.dataset.id = r._id;
    row.innerHTML = `
      <div>
        <div class="req-title">${esc(r.songTitle)} <span style="opacity:.6;font-size:12px">(${esc(r.status)})</span></div>
        <div class="req-sub">${esc(r.requesterName)} · ${esc(r.artist || '')}${r.targetSinger ? ` · 담당: ${esc(r.targetSinger)}` : ''}</div>
      </div>
      <div class="req-actions">
        ${showManage ? `<span class="chip">선택</span>` : `<button class="floating-btn compact-btn" data-action="del" type="button">삭제</button>`}
      </div>
    `;

    if (showManage) {
      row.onclick = () => {
        const id = r._id;
        if (state.selectedRequestIds.has(id)) {
          state.selectedRequestIds.delete(id);
          row.classList.remove('selected');
        } else {
          state.selectedRequestIds.add(id);
          row.classList.add('selected');
        }
        $('requestManageTitle').textContent =
          state.selectedRequestIds.size ? `${state.selectedRequestIds.size}개 선택됨` : '신청곡 선택 후 상태 변경';
      };
    } else {
      row.querySelector('[data-action="del"]').onclick = async (e) => {
        e.stopPropagation();
        await apiJson(`/api/requests/${encodeURIComponent(r._id)}`, 'DELETE');
        await loadRequests(true);
      };
    }

    wrap.appendChild(row);
  });
}

async function submitSongRequest() {
  const payload = {
    requesterName: $('requesterInput').value.trim() || '익명',
    songTitle: $('requestSongInput').value.trim(),
    artist: $('requestArtistInput').value.trim(),
    targetSinger: $('requestSingerInput').value.trim()
  };
  if (!payload.songTitle) return toast('곡명을 입력해 주세요.');
  const res = await apiJson('/api/requests', 'POST', payload);
  if (!res.ok) return toast('신청 실패');
  closeModal('requestModal');
  $('requestSongInput').value = '';
  $('requestArtistInput').value = '';
  $('requestSingerInput').value = '';
  await loadRequests(true);
  toast('신청 완료');
}

async function applySelectedRequestStatus(status) {
  if (!state.selectedRequestIds.size) return toast('선택된 신청곡이 없습니다.');
  for (const id of state.selectedRequestIds) {
    await apiJson(`/api/requests/${encodeURIComponent(id)}`, 'PATCH', { status });
  }
  await loadRequests(true);
}

async function deleteSelectedRequests() {
  if (!state.selectedRequestIds.size) return toast('선택된 신청곡이 없습니다.');
  for (const id of state.selectedRequestIds) {
    await apiJson(`/api/requests/${encodeURIComponent(id)}`, 'DELETE');
  }
  await loadRequests(true);
}

async function clearRequests() {
  const res = await apiJson('/api/requests/clear', 'POST', {});
  if (!res.ok) return toast('권한 없음');
  await loadRequests(true);
}

// ---- Auth / Role UI ---------------------------------------------------------------
function applyRoleUI() {
  $('roleBadge').textContent = state.role.toUpperCase();
  $('userDisplayName').textContent = state.displayName;
  $('userRoleText').textContent =
    state.role === 'viewer' ? '읽기 전용' : state.role === 'session' ? '세션 멤버' : '관리자';

  const isAdmin = state.role === 'admin';
  const isSession = state.role === 'session';
  const isPriv = isAdmin || isSession;

  $('adminToggleBtn').style.display = isPriv ? 'inline-flex' : 'none';
  $('profileButton').style.display = isPriv ? 'inline-flex' : 'none';
  $('requestManageToggleBtn').style.display = isPriv ? 'inline-flex' : 'none';

  $('clearRequestsBtn').style.display = isAdmin ? 'inline-flex' : 'none';

  $('authButton').textContent = state.role === 'viewer' ? '세션 / 관리자 로그인' : '로그아웃';

  // Availability filter visibility: only for session/admin
  const showAvail = isPriv;
  $('availUserFilter').style.display = showAvail ? 'inline-flex' : 'none';
  $('availOnlyWrap').style.display = showAvail ? 'inline-flex' : 'none';
}

async function refreshSession() {
  const me = await apiGet('/api/admin/me');
  if (me.ok) {
    state.role = me.user.role;
    state.displayName = me.user.displayName || me.user.userId;
  } else {
    state.role = 'viewer';
    state.displayName = '방문자';
  }
  applyRoleUI();
  // update presence role on socket (best-effort)
  state._socket?.emit?.('main:join', {
    nickname: localStorage.getItem('mb_presence_nick') || state.displayName,
    role: state.role,
    displayName: state.displayName,
    profilePhoto: $('profilePhoto')?.src || ''
  });
}

async function doLogin() {
  const userId = $('loginId').value.trim();
  const password = $('loginPw').value;
  if (!userId || !password) return toast('아이디/비번을 입력해 주세요.');
  const res = await apiJson('/api/admin/login', 'POST', { userId, password });
  if (!res.ok) return toast('로그인 실패');
  closeModal('loginModal');
  $('loginPw').value = '';
  await refreshSession();
  await loadAvailabilityUsersIfNeeded();
  toast('로그인 완료');
}

async function doLogout() {
  await apiJson('/api/admin/logout', 'POST', {});
  await refreshSession();
  toast('로그아웃');
}

// ---- Admin actions ----------------------------------------------------------------
let editTargetField = null;
function openEditModal(field, title, currentValue) {
  editTargetField = field;
  $('editModalTitle').textContent = title;
  $('editModalInput').value = currentValue || '';
  openModal('editModal');
}

async function saveEditModal() {
  if (!editTargetField) return;
  const value = $('editModalInput').value;
  const res = await apiJson('/api/main', 'PATCH', { field: editTargetField, value });
  if (!res.ok) return toast('저장 실패(권한 확인)');
  closeModal('editModal');
  await loadMainPage();
  toast('저장 완료');
}

async function syncDrive(isFast) {
  const res = await apiJson('/api/admin/sync/drive', 'POST', { latestDays: isFast ? 7 : 30 });
  if (!res.ok) return toast(`동기화 실패: ${res.error || ''}`);
  toast(`동기화 완료: ${res.processed}개`);
  await loadSongs(true);
  applySongFilters();
}

// ---- Wiring ----------------------------------------------------------------------
function wireEvents() {
  $('mainNavBtn').onclick = () => switchPage('main');
  $('songsNavBtn').onclick = () => switchPage('songs');

  $('authButton').onclick = async () => {
    if (state.role === 'viewer') openModal('loginModal');
    else await doLogout();
  };

  $('adminToggleBtn').onclick = () => $('adminControls').classList.toggle('active');

  $('profileButton').onclick = () => toast('프로필 기능은 다음 단계(B)에서 확장');

  $('loginCloseBtn').onclick = () => closeModal('loginModal');
  $('loginSubmitBtn').onclick = () => doLogin().catch(() => {});

  $('requestOpenBtn').onclick = () => openModal('requestModal');
  $('requestCancelBtn').onclick = () => closeModal('requestModal');
  $('requestSubmitBtn').onclick = () => submitSongRequest().catch(() => {});

  $('requestRefreshBtn').onclick = () => loadRequests(true).catch(() => {});
  $('requestHideBtn').onclick = () => {
    $('requestPanel').style.display = 'none';
    $('requestShowBtn').style.display = 'inline-flex';
  };
  $('requestShowBtn').onclick = () => {
    $('requestPanel').style.display = 'block';
    $('requestShowBtn').style.display = 'none';
  };

  // presence panel
  $('presenceRefreshBtn').onclick = () => state._socket?.emit?.('presence:refresh');
  $('presenceHideBtn').onclick = () => {
    $('presencePanel').style.display = 'none';
    $('presenceShowBtn').style.display = 'inline-flex';
  };
  $('presenceShowBtn').onclick = () => {
    $('presencePanel').style.display = 'block';
    $('presenceShowBtn').style.display = 'none';
    state._socket?.emit?.('presence:refresh');
  };

  $('requestManageToggleBtn').onclick = () => {
    state.requestManageMode = !state.requestManageMode;
    renderRequests();
  };
  $('requestDeleteBtn').onclick = () => deleteSelectedRequests().catch(() => {});
  $('clearRequestsBtn').onclick = () => clearRequests().catch(() => {});
  document.querySelectorAll('.request-mini-btn[data-status]').forEach((btn) => {
    btn.onclick = () => applySelectedRequestStatus(btn.dataset.status).catch(() => {});
  });

  $('editCancelBtn').onclick = () => closeModal('editModal');
  $('editSaveBtn').onclick = () => saveEditModal().catch(() => {});

  $('randomPickBtn').onclick = () => pickRandomSong();
  $('randomCloseBtn').onclick = () => closeModal('randomModal');
  $('randomRerollBtn').onclick = () => pickRandomSong();

  $('resetFiltersBtn').onclick = () => {
    $('searchInput').value = '';
    $('genreFilter').value = '';
    $('moodFilter').value = '';
    $('vocalFilter').value = '';
    $('latestOnlyToggle').checked = false;
    state.page = 1;
    applySongFilters();
  };

  const debouncedFilter = (() => {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.page = 1;
        applySongFilters();
      }, 150);
    };
  })();
  ['searchInput', 'genreFilter', 'moodFilter', 'vocalFilter'].forEach((id) => $(id).addEventListener('input', debouncedFilter));
  $('latestOnlyToggle').addEventListener('change', debouncedFilter);
  $('hideTagsToggle').addEventListener('change', () => applySongFilters());

  $('pageSizeSelect').onchange = () => {
    state.pageSize = Number($('pageSizeSelect').value || 100);
    state.page = 1;
    applySongFilters();
  };
  $('prevPageBtn').onclick = () => {
    state.page = Math.max(1, state.page - 1);
    applySongFilters();
  };
  $('nextPageBtn').onclick = () => {
    const totalPages = Math.max(1, Math.ceil(state.songsFiltered.length / state.pageSize));
    state.page = Math.min(totalPages, state.page + 1);
    applySongFilters();
  };

  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.onclick = () => {
      const field = btn.dataset.sortField;
      if (state.sortField === field) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        state.sortField = field;
        state.sortDir = field === 'createdAt' ? 'desc' : 'asc';
      }
      document.querySelectorAll('.sort-btn').forEach((b) => b.classList.toggle('active', b.dataset.sortField === state.sortField));
      state.page = 1;
      applySongFilters();
    };
  });
  // default active
  document.querySelector('.sort-btn[data-sort-field="createdAt"]')?.classList.add('active');

  $('editBannerBtn').onclick = () => openEditModal('bannerImage', '배너 이미지 URL', state.main?.bannerImage);
  $('editNoticeBtn').onclick = () => openEditModal('notice', '공지사항 내용', state.main?.notice);
  $('editTitleBtn').onclick = () => openEditModal('titleImage', '타이틀 이미지 URL', state.main?.titleImage);
  $('syncAllBtn').onclick = () => syncDrive(false).catch(() => {});
  $('syncFastBtn').onclick = () => syncDrive(true).catch(() => {});

  // session controls on main page
  $('sessionCreateBtn').onclick = () => {
    const socket = state._socket;
    if (!socket) return;
    socket.emit('session:create', {}, (ack) => {
      if (!ack?.ok) return toast('세션 생성 실패');
      joinLiveSession(String(ack.roomCode || ''));
      toast(`세션 생성: ${ack.roomCode}`);
    });
  };
  $('sessionJoinBtn').onclick = () => {
    const code = (prompt('Room Code를 입력하세요:', state.sessionRoomCode || '') || '').trim().toUpperCase();
    if (!code) return;
    joinLiveSession(code);
  };
  $('sessionLeaveBtn').onclick = () => leaveLiveSession();
  $('sessionMembersBtn').onclick = () => {
    $('sessionPanel').style.display = 'block';
    state._socket?.emit?.('session:participants:refresh', { roomCode: state.sessionRoomCode });
  };
  $('sessionPanelHideBtn').onclick = () => {
    $('sessionPanel').style.display = 'none';
  };
  $('sessionCopyBtn').onclick = async () => {
    if (!state.sessionRoomCode) return;
    const url = `${window.location.origin}/?room=${encodeURIComponent(state.sessionRoomCode)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('세션 링크 복사됨');
    } catch {
      prompt('복사해서 공유하세요:', url);
    }
  };

  // availability filter
  $('availUserFilter').onchange = () => loadAvailability().catch(() => {});
  $('availOnlyToggle').onchange = () => applySongFilters();
}

function attachSockets() {
  const nickname = getOrCreatePresenceNickname();
  const metaToken = state.metaToken || '';
  const socket = io({ auth: { nickname, metaToken } });
  socket.on('requests:updated', (p) => {
    if (Array.isArray(p?.items)) {
      state.requests = p.items;
      renderRequests();
    }
  });

  // Join main presence room (server trusts metaToken, not payload role)
  socket.emit('main:join', { nickname, profilePhoto: $('profilePhoto')?.src || '' });
  state._socket = socket;

  socket.on('presence:list', (p) => {
    renderPresence(p?.items || []);
  });

  // session state events (page turner)
  socket.on('session:pageTurner:state', (p) => {
    if (!state.sessionRoomCode) return;
    state.isPageTurner = p?.pageTurnerSocketId === socket.id;
    $('turnerBadge').style.display = state.isPageTurner ? 'inline-flex' : 'none';
  });

  socket.on('session:participants', (p) => {
    if (!state.sessionRoomCode) return;
    if (p?.roomCode && String(p.roomCode).toUpperCase() !== String(state.sessionRoomCode).toUpperCase()) return;
    renderSessionMembers(p?.members || []);
  });

  socket.on('session:state', (p) => {
    if (!state.sessionRoomCode) return;
    if (p?.roomCode && String(p.roomCode).toUpperCase() !== String(state.sessionRoomCode).toUpperCase()) return;
    state.sessionCurrentFileId = p?.currentFileId || '';
    state.sessionCurrentPageNo = Number(p?.currentPageNo || 1);
    renderSessionStatus();
  });

  // keep status updated even without session:state (backward)
  socket.on('session:follow:file', (p) => {
    if (!state.sessionRoomCode) return;
    if (!p?.fileId) return;
    state.sessionCurrentFileId = p.fileId;
    state.sessionCurrentPageNo = 1;
    renderSessionStatus();
  });
  socket.on('viewer:page_change', (p) => {
    if (!state.sessionRoomCode) return;
    if (!p?.fileId || !p?.pageNo) return;
    state.sessionCurrentFileId = p.fileId;
    state.sessionCurrentPageNo = Number(p.pageNo);
    renderSessionStatus();
  });

  // If turner was transferred to this socket while on main page, keep room stable by re-broadcasting current state.
  socket.on('session:pageTurner:sync_request', (p) => {
    if (!state.sessionRoomCode) return;
    // We don't track local page on main page; just keep room at current (server) state.
    if (p?.fileId && p?.pageNo) {
      socket.emit('viewer:page_change', {
        roomCode: state.sessionRoomCode,
        fileId: p.fileId,
        pageNo: p.pageNo,
        reason: 'turner_sync_main'
      });
    }
  });
}

function renderSessionStatus() {
  if (!state.sessionRoomCode) return;
  const badge = $('sessionBadge');
  if (!badge) return;
  const fileId = state.sessionCurrentFileId;
  const pageNo = state.sessionCurrentPageNo;
  let label = `세션: ${state.sessionRoomCode}`;
  if (fileId) {
    const song = state.songsAll.find((s) => s.googleFileId === fileId);
    const title = song?.displayTitle || song?.title || '';
    label += ` · ${title ? title : fileId.slice(0, 8) + '...'} · p.${pageNo}`;
  }
  badge.textContent = label;
}

function getOrCreatePresenceNickname() {
  const key = 'mb_presence_nick';
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const v = prompt('닉네임을 입력해 주세요(접속자 표시용):', '익명') || '익명';
  localStorage.setItem(key, v);
  return v;
}

function renderPresence(items) {
  const wrap = $('presenceList');
  if (!wrap) return;
  wrap.innerHTML = '';
  items.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'presence-item';
    el.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center;">
        ${p.profilePhoto ? `<img class="presence-photo" src="${esc(p.profilePhoto)}" alt="" />` : `<div class="presence-photo"></div>`}
        <div>
          <div>${esc(p.displayName || p.nickname || '익명')}</div>
          <div class="presence-sub">${esc(p.role || 'viewer')}</div>
        </div>
      </div>
    `;
    wrap.appendChild(el);
  });
}

function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get('room') || '';
}

function setRoomToUrl(roomCode) {
  const url = new URL(window.location.href);
  if (roomCode) url.searchParams.set('room', roomCode);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url.toString());
}

function joinLiveSession(roomCode) {
  const code = String(roomCode || '').trim().toUpperCase();
  if (!code) return;
  state.sessionRoomCode = code;
  $('sessionBadge').style.display = 'inline-flex';
  $('sessionBadge').textContent = `세션: ${code}`;
  $('sessionLeaveBtn').style.display = 'inline-flex';
  $('sessionMembersBtn').style.display = 'inline-flex';
  setRoomToUrl(code);
  state._socket?.emit?.(
    'session:join',
    {
      roomCode: code,
      nickname: localStorage.getItem('mb_presence_nick') || state.displayName,
      role: state.role,
      displayName: state.displayName,
      profilePhoto: $('profilePhoto')?.src || ''
    },
    (ack) => {
    if (!ack?.ok) {
      toast('세션 참여 실패');
      return;
    }
    state.isPageTurner = Boolean(ack.isPageTurner);
    $('turnerBadge').style.display = state.isPageTurner ? 'inline-flex' : 'none';
    }
  );
}

function leaveLiveSession() {
  const code = state.sessionRoomCode;
  if (!code) return;
  state._socket?.emit?.('session:leave', { roomCode: code });
  state.sessionRoomCode = '';
  state.isPageTurner = false;
  $('sessionBadge').style.display = 'none';
  $('turnerBadge').style.display = 'none';
  $('sessionLeaveBtn').style.display = 'none';
  $('sessionMembersBtn').style.display = 'none';
  $('sessionPanel').style.display = 'none';
  setRoomToUrl('');
  toast('세션 나감');
}

function renderSessionMembers(members) {
  const wrap = $('sessionMembersList');
  if (!wrap) return;
  wrap.innerHTML = '';
  members.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'presence-item';
    const name = m.displayName || m.nickname || '익명';
    el.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center;">
        ${m.profilePhoto ? `<img class="presence-photo" src="${esc(m.profilePhoto)}" alt="" />` : `<div class="presence-photo"></div>`}
        <div>
          <div>${esc(name)} ${m.isPageTurner ? '<span class="chip">터너</span>' : ''}</div>
          <div class="presence-sub">${esc(m.role || 'viewer')}</div>
        </div>
      </div>
      <div>
        ${state.isPageTurner && !m.isPageTurner ? `<button class="floating-btn compact-btn" data-transfer="1">양도</button>` : ''}
      </div>
    `;
    const btn = el.querySelector('[data-transfer="1"]');
    if (btn) {
      btn.onclick = () => {
        state._socket?.emit?.('session:pageTurner:transfer', { roomCode: state.sessionRoomCode, targetSocketId: m.socketId }, (ack) => {
          if (!ack?.ok) toast('양도 실패');
        });
      };
    }
    wrap.appendChild(el);
  });
}

async function loadAvailability() {
  const userId = $('availUserFilter').value;
  state.availabilityUserId = userId;
  state.availabilitySet = null;
  if (!userId) {
    applySongFilters();
    return;
  }
  const data = await apiGet(`/api/availability?userId=${encodeURIComponent(userId)}`);
  if (!data.ok) {
    toast('가능곡 로드 실패');
    return;
  }
  const set = new Set();
  (data.items || []).forEach((a) => {
    if (a.available) set.add(a.googleFileId);
  });
  state.availabilitySet = set;
  applySongFilters();
}

async function loadAvailabilityUsersIfNeeded() {
  // session/admin only: build dropdown from /api/admin/users
  if (state.role === 'viewer') return;
  const r = await apiGet('/api/admin/users');
  if (!r.ok) return;
  const sel = $('availUserFilter');
  const current = sel.value;
  sel.innerHTML = `<option value="">가능곡(유저 선택)</option>`;
  (r.items || [])
    .filter((u) => u.role === 'session' || u.role === 'admin')
    .forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.userId;
      opt.textContent = `${u.userId} (${u.role})`;
      sel.appendChild(opt);
    });
  if (current) sel.value = current;
}

async function bootstrap() {
  showLoading(true);
  try {
    wireEvents();
    // socket meta for role hardening
    try {
      const meta = await fetch('/api/socket/meta', { credentials: 'include' }).then((r) => r.json());
      if (meta?.ok) state.metaToken = meta.token;
    } catch {}
    attachSockets();
    await refreshSession();
    await loadAvailabilityUsersIfNeeded();
    await loadMainPage();
    await loadSongs(true);
    applySongFilters();
    await loadRequests(true);

    // Auto-join live session if ?room exists (main-page convenience)
    const roomFromUrl = getRoomFromUrl().trim().toUpperCase();
    if (roomFromUrl) joinLiveSession(roomFromUrl);
  } finally {
    showLoading(false);
    document.body.classList.remove('preload');
  }
}

bootstrap().catch((e) => {
  console.error(e);
  toast('초기화 실패');
  showLoading(false);
});
