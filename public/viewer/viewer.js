/* global io, pdfjsLib, fabric */

// ---- Helpers ----------------------------------------------------------------------
function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function extractDriveFileIdFromAny(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m1 = s.match(/\/file\/d\/([^/]+)/);
  if (m1) return m1[1];
  try {
    const u = new URL(s, window.location.origin);
    const id = u.searchParams.get('id');
    if (id) return id;
  } catch {}
  return '';
}

function normalizeProfilePhotoUrl(url, size = 80) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (s.includes('drive.google.com/thumbnail')) return s;
  const id = extractDriveFileIdFromAny(s);
  if (!id) return s;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${Number(size) || 80}`;
}

function getFileIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // supports /viewer or /viewer/:fileId
  if (parts[0] !== 'viewer') return '';
  return parts[1] || '';
}

function safeRoomCode(v) {
  return String(v || '').trim().toUpperCase();
}

// NOTE: preview 환경에서 prompt()가 지원되지 않아 모달 기반으로 입력을 받는다.
function getOrCreateNickname() {
  // 메인(노래책)과 동일한 키를 우선 사용
  const shared = localStorage.getItem('mb_presence_nick');
  if (shared) return shared;
  const legacy = localStorage.getItem('mb_nickname');
  if (legacy) return legacy;
  return '';
}

function isMobileLike() {
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  return window.matchMedia('(max-width: 980px)').matches || isCoarse;
}

function openJoinModal({ nickname = '', roomCode = '' } = {}) {
  const overlay = document.getElementById('joinModal');
  const nickField = document.getElementById('joinNickField');
  const roomField = document.getElementById('joinRoomField');
  const okBtn = document.getElementById('joinOkBtn');
  const cancelBtn = document.getElementById('joinCancelBtn');
  if (!overlay || !nickField || !roomField || !okBtn || !cancelBtn) return Promise.resolve(null);

  nickField.value = String(nickname || '');
  roomField.value = String(roomCode || '');
  overlay.classList.remove('hidden');
  setTimeout(() => (nickField.value ? roomField.focus() : nickField.focus()), 0);

  return new Promise((resolve) => {
    const cleanup = (v) => {
      overlay.classList.add('hidden');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      nickField.onkeydown = null;
      roomField.onkeydown = null;
      resolve(v);
    };
    const tryOk = () => {
      const nick = String(nickField.value || '').trim();
      if (!nick) return flashHud('닉네임을 입력해 주세요', 1200);
      const room = safeRoomCode(roomField.value);
      cleanup({ nick, room });
    };
    okBtn.onclick = tryOk;
    cancelBtn.onclick = () => cleanup(null);
    nickField.onkeydown = (e) => {
      if (e.key === 'Enter') {
        if (nickField.value.trim()) roomField.focus();
        else tryOk();
      }
      if (e.key === 'Escape') cleanup(null);
    };
    roomField.onkeydown = (e) => {
      if (e.key === 'Enter') tryOk();
      if (e.key === 'Escape') cleanup(null);
    };
  });
}

async function ensureNickname() {
  // 사용자가 한번이라도 저장한 닉네임이면 그대로 사용
  const saved = localStorage.getItem('mb_presence_nick') || localStorage.getItem('mb_nickname');
  if (saved) return saved;
  const input = await openInputModal({ title: '닉네임 설정', placeholder: '닉네임을 입력하세요(익명 가능)', value: '익명' });
  const nick = String(input || '').trim() || '익명';
  localStorage.setItem('mb_presence_nick', nick);
  // legacy 키도 같이 저장(호환)
  localStorage.setItem('mb_nickname', nick);
  return nick;
}

async function ensureNicknameForVisitorAlways() {
  const saved = localStorage.getItem('mb_presence_nick') || localStorage.getItem('mb_nickname') || '';
  // 모바일에서는 닉네임 + 세션코드까지 한 번에 입력할 수 있게 한다.
  if (isMobileLike()) {
    const v = await openJoinModal({ nickname: saved || '', roomCode: safeRoomCode(qs('room')) || '' });
    const finalNick = String(v?.nick || saved || '').trim() || '익명';
    localStorage.setItem('mb_presence_nick', finalNick);
    localStorage.setItem('mb_nickname', finalNick);
    // room code가 있으면 즉시 join 시도(세션코드가 없으면 닉네임만 저장)
    if (v?.room) {
      // URL에도 반영
      setRoomToUrl(v.room);
      // socket auth 적용
      try {
        socket.auth = { ...(socket.auth || {}), nickname: finalNick };
        socket.disconnect();
        socket.connect();
      } catch {}
      // 실제 join은 init()에서 desiredRoom 로직이 처리하도록 qs(room)을 채워준다.
    }
    return finalNick;
  }

  const nick = await openInputModalRequired({ title: '닉네임 설정', placeholder: '닉네임을 입력하세요', value: saved || '익명', minLen: 1 });
  const finalNick = String(nick || '').trim() || '익명';
  localStorage.setItem('mb_presence_nick', finalNick);
  localStorage.setItem('mb_nickname', finalNick);
  return finalNick;
}

function getRoomMap() {
  try {
    return JSON.parse(localStorage.getItem('mb_viewer_room_map') || '{}') || {};
  } catch {
    return {};
  }
}
function setRoomMap(map) {
  try {
    localStorage.setItem('mb_viewer_room_map', JSON.stringify(map || {}));
  } catch {}
}
function getLastRoomForFile(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return '';
  const map = getRoomMap();
  return String(map[id] || '').trim().toUpperCase();
}
function setLastRoomForFile(fileId, roomCode) {
  const id = String(fileId || '').trim();
  const room = safeRoomCode(roomCode);
  if (!id || !room) return;
  const map = getRoomMap();
  map[id] = room;
  setRoomMap(map);
}
function clearLastRoomForFile(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return;
  const map = getRoomMap();
  delete map[id];
  setRoomMap(map);
}

function openInputModal({ title, placeholder = '', value = '' } = {}) {
  const overlay = document.getElementById('inputModal');
  const titleEl = document.getElementById('inputModalTitle');
  const field = document.getElementById('inputModalField');
  const okBtn = document.getElementById('inputModalOkBtn');
  const cancelBtn = document.getElementById('inputModalCancelBtn');
  if (!overlay || !titleEl || !field || !okBtn || !cancelBtn) return Promise.resolve(null);

  titleEl.textContent = String(title || '입력');
  field.placeholder = String(placeholder || '');
  field.value = String(value || '');
  overlay.classList.remove('hidden');
  setTimeout(() => field.focus(), 0);

  return new Promise((resolve) => {
    const cleanup = (result) => {
      overlay.classList.add('hidden');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      field.onkeydown = null;
      cancelBtn.style.display = '';
      resolve(result);
    };
    okBtn.onclick = () => cleanup(field.value);
    cancelBtn.onclick = () => cleanup(null);
    field.onkeydown = (e) => {
      if (e.key === 'Enter') cleanup(field.value);
      else if (e.key === 'Escape') cleanup(null);
    };
  });
}

function openInputModalRequired({ title, placeholder = '', value = '', minLen = 1 } = {}) {
  const overlay = document.getElementById('inputModal');
  const titleEl = document.getElementById('inputModalTitle');
  const field = document.getElementById('inputModalField');
  const okBtn = document.getElementById('inputModalOkBtn');
  const cancelBtn = document.getElementById('inputModalCancelBtn');
  if (!overlay || !titleEl || !field || !okBtn || !cancelBtn) return Promise.resolve(String(value || '').trim());

  titleEl.textContent = String(title || '입력');
  field.placeholder = String(placeholder || '');
  field.value = String(value || '');
  cancelBtn.style.display = 'none';
  overlay.classList.remove('hidden');
  setTimeout(() => field.focus(), 0);

  return new Promise((resolve) => {
    const tryOk = () => {
      const v = String(field.value || '').trim();
      if (v.length < minLen) {
        field.focus();
        flashHud('닉네임을 입력해 주세요', 1200);
        return;
      }
      overlay.classList.add('hidden');
      okBtn.onclick = null;
      field.onkeydown = null;
      cancelBtn.style.display = '';
      resolve(v);
    };
    okBtn.onclick = tryOk;
    field.onkeydown = (e) => {
      if (e.key === 'Enter') tryOk();
    };
  });
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHidden(id, hidden) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('hidden', hidden);
}

function setParticipantsCollapsed(collapsed) {
  const body = document.getElementById('participantsBody');
  const btn = document.getElementById('participantsToggleBtn');
  if (!body || !btn) return;
  body.classList.toggle('isHidden', Boolean(collapsed));
  btn.textContent = collapsed ? '보기' : '감추기';
  localStorage.setItem('mb_viewer_participantsCollapsed', collapsed ? '1' : '0');
}

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'include' });
  return res.json();
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function copyToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

function flashHud(msg, ms = 1200) {
  setHidden('pageHud', false);
  setText('pageHud', String(msg || ''));
  setTimeout(() => {
    try {
      updatePageLabels();
    } catch {}
  }, ms);
}

// ---- Cursor share (vertical highlighter line) -------------------------------------
let localCursorEl = null;
let remoteCursorEl = null;
let cursorMoveHandler = null;
let lastCursorEmitAt = 0;

function ensureCursorEls() {
  const container = document.getElementById('pdf-container');
  if (!container) return;
  if (!localCursorEl) {
    localCursorEl = document.createElement('div');
    localCursorEl.className = 'cursor-marker';
    localCursorEl.id = 'cursorMarkerLocal';
    container.appendChild(localCursorEl);
  }
  if (!remoteCursorEl) {
    remoteCursorEl = document.createElement('div');
    remoteCursorEl.className = 'cursor-marker';
    remoteCursorEl.id = 'cursorMarkerRemote';
    container.appendChild(remoteCursorEl);
  }
}

function setCursorMarker(el, { xNorm, yNorm, visible }) {
  if (!el) return;
  if (!visible) {
    el.style.display = 'none';
    return;
  }
  const container = document.getElementById('pdf-container');
  if (!container) return;
  const r = container.getBoundingClientRect();
  const x = r.left + r.width * clamp(Number(xNorm || 0), 0, 1);
  const y = r.top + r.height * clamp(Number(yNorm || 0), 0, 1);

  // 높이: 화면에 비례(너무 작/크지 않게) - 기존 대비 1/2
  const h = clamp(r.height * 0.11, 40, 110);
  el.style.height = `${Math.round(h)}px`;
  el.style.left = `${Math.round(x - r.left)}px`;
  el.style.top = `${Math.round(y - r.top)}px`;
  el.style.display = 'block';
}

function updateCursorShareUI() {
  const btn = document.getElementById('cursorShareBtn');
  if (!btn) return;
  const canUse = state.isInSession ? Boolean(state.isPageTurner) : false;
  btn.disabled = !canUse;
  btn.classList.toggle('disabled', !canUse);
  btn.classList.toggle('active', Boolean(state.cursorShareOn));
}

function stopCursorShare(sendHide = false) {
  state.cursorShareOn = false;
  ensureCursorEls();
  if (localCursorEl) localCursorEl.style.display = 'none';
  if (cursorMoveHandler) {
    document.getElementById('pdf-container')?.removeEventListener('mousemove', cursorMoveHandler);
    document.getElementById('pdf-container')?.removeEventListener('touchmove', cursorMoveHandler);
  }
  cursorMoveHandler = null;
  updateCursorShareUI();
  if (sendHide && state.isInSession && state.isPageTurner && state.roomCode && state.fileId) {
    socket.emit('viewer:cursor', { roomCode: state.roomCode, fileId: state.fileId, hide: true });
  }
}

function startCursorShare() {
  if (!state.isInSession || !state.isPageTurner) {
    flashHud('커서공유는 페이지터너만 사용 가능합니다', 1400);
    return;
  }
  ensureCursorEls();
  state.cursorShareOn = true;
  updateCursorShareUI();

  const container = document.getElementById('pdf-container');
  if (!container) return;

  cursorMoveHandler = (e) => {
    if (!state.cursorShareOn) return;
    if (!state.isInSession || !state.isPageTurner || !state.roomCode || !state.fileId) return;
    const now = Date.now();
    if (now - lastCursorEmitAt < 33) return; // ~30fps throttle
    lastCursorEmitAt = now;

    const r = container.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    const xNorm = r.width ? (clientX - r.left) / r.width : 0;
    const yNorm = r.height ? (clientY - r.top) / r.height : 0;

    setCursorMarker(localCursorEl, { xNorm, yNorm, visible: true });
    socket.emit('viewer:cursor', { roomCode: state.roomCode, fileId: state.fileId, xNorm, yNorm });
  };

  container.addEventListener('mousemove', cursorMoveHandler, { passive: true });
  container.addEventListener('touchmove', cursorMoveHandler, { passive: true });
}

function makeLaserGroup(points) {
  const pts = points || [];
  const outline = new fabric.Polyline(pts, {
    fill: '',
    stroke: '#ff2d55',
    strokeWidth: 8,
    opacity: 0.75,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    selectable: false,
    evented: false,
    objectCaching: false
  });
  const inner = new fabric.Polyline(pts, {
    fill: '',
    stroke: '#ffffff',
    strokeWidth: 3,
    opacity: 0.95,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    selectable: false,
    evented: false,
    objectCaching: false
  });
  const group = new fabric.Group([outline, inner], {
    selectable: false,
    evented: false,
    objectCaching: false
  });
  group._transient = true;
  return group;
}

function updateLaserGroup(group, points) {
  if (!group?._objects?.length) return;
  const pts = points || [];
  group._objects.forEach((o) => o.set({ points: pts }));
  group.dirty = true;
}

function fadeOutAndRemove(canvas, obj, ms = 2000) {
  if (!canvas || !obj) return;
  const startOpacity = typeof obj.opacity === 'number' ? obj.opacity : 1;
  fabric.util.animate({
    startValue: startOpacity,
    endValue: 0,
    duration: ms,
    onChange: (v) => {
      try {
        obj.set('opacity', v);
        canvas.requestRenderAll();
      } catch {}
    },
    onComplete: () => {
      try {
        canvas.remove(obj);
        canvas.requestRenderAll();
      } catch {}
    }
  });
}

function scheduleFadeOutAndRemove(canvas, obj, holdMs = 2000, fadeMs = 2000) {
  if (!canvas || !obj) return;
  setTimeout(() => fadeOutAndRemove(canvas, obj, fadeMs), Math.max(0, Number(holdMs) || 0));
}

function distPointToRect(px, py, r) {
  const x = clamp(px, r.left, r.left + r.width);
  const y = clamp(py, r.top, r.top + r.height);
  const dx = px - x;
  const dy = py - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function eraseAtPoint(fabricCanvas, p, radius) {
  if (!fabricCanvas || !p) return 0;
  const rad = Math.max(4, Number(radius) || 8);
  const objs = fabricCanvas.getObjects();
  let removed = 0;
  // 뒤에서부터(최근 그린 것 우선)
  for (let i = objs.length - 1; i >= 0; i -= 1) {
    const obj = objs[i];
    if (!obj || obj._transient) continue; // 레이저 등 제외
    const rect = obj.getBoundingRect(true, true);
    if (distPointToRect(p.x, p.y, rect) <= rad) {
      fabricCanvas.remove(obj);
      removed += 1;
    }
  }
  if (removed) {
    fabricCanvas.discardActiveObject?.();
    fabricCanvas.requestRenderAll();
  }
  return removed;
}

// ---- State ------------------------------------------------------------------------
const state = {
  fileId: getFileIdFromPath(),
  pageNo: 1,
  totalPages: 1,
  roomCode: null,
  isInSession: false,
  isPageTurner: false,
  isToolAuthorized: false,
  cursorShareOn: false,
  nickname: getOrCreateNickname(),
  overlapPx: 0,

  pdfDoc: null,
  pdfScale: 1,
  isPdfReady: false,

  // pageNo -> { json, w, h }
  annoStore: {},
  // pageNo -> undo stack: [{json,w,h}]
  undoStack: {},
  // pageNo -> redo stack: [{json,w,h}]
  redoStack: {},
  tool: 'pen',
  shape: null, // 'line'|'rect'|'circle' (when tool==='shape')

  // view modes
  spreadCount: 2, // 1~4 (기본 2p)
  fitMode: true,
  zoom: 1,
  locked: false,
  textFontSize: 22,
  activeDrawPageNo: 1
};

// Initial UI state classes
document.body.dataset.tool = state.tool;

// ---- Auth context (optional) ------------------------------------------------------
const authState = { role: 'viewer', displayName: state.nickname, profilePhoto: '' };

async function loadMe() {
  try {
    const me = await fetch('/api/admin/me', { credentials: 'include' }).then((r) => r.json());
    if (me?.ok) {
      authState.role = me.user.role;
      authState.displayName = me.user.displayName || me.user.userId;
    }
  } catch {}
}

// Fetch signed meta token (role hardening)
async function getSocketMetaToken() {
  try {
    const r = await fetch('/api/socket/meta', { credentials: 'include' }).then((x) => x.json());
    return r?.token || '';
  } catch {
    return '';
  }
}

// ---- Socket -----------------------------------------------------------------------
const socket = io({
  auth: { nickname: state.nickname || '익명', metaToken: '' }
});

function setRoomToUrl(roomCode) {
  const u = new URL(window.location.href);
  const r = safeRoomCode(roomCode);
  if (r) u.searchParams.set('room', r);
  else u.searchParams.delete('room');
  window.history.replaceState(null, '', `${u.pathname}?${u.searchParams.toString()}`);
}

function emitSessionJoin(roomCode) {
  if (!roomCode) return;
  socket.emit('session:join', {
    roomCode,
    nickname: state.nickname || '익명',
    role: authState.role,
    displayName: authState.displayName || state.nickname || '익명',
    profilePhoto: authState.profilePhoto || ''
  });
}

// ---- Session UI policy -------------------------------------------------------------
// 요구사항:
// - 세션 참여 시 기본값: 링크칸 숨김 + 보기옵션 숨김 + 도구창 숨김
// - 토글 버튼은 페이지터너만 사용 가능
state._preSessionUi = null;

function setSessionUiDefaultsIfNeeded() {
  if (!state.isInSession) return;
  if (state._preSessionUi == null) {
    state._preSessionUi = {
      linkCollapsed: document.body.classList.contains('link-collapsed'),
      viewHidden: document.getElementById('viewBar')?.classList.contains('isHidden'),
      toolHidden: document.getElementById('toolBar')?.classList.contains('isHidden')
    };
  }
  document.body.classList.add('link-collapsed');
  document.getElementById('viewBar')?.classList.add('isHidden');
  document.getElementById('toolBar')?.classList.add('isHidden');
}

function restoreUiAfterLeavingSession() {
  const prev = state._preSessionUi;
  state._preSessionUi = null;
  if (!prev) return;
  document.body.classList.toggle('link-collapsed', Boolean(prev.linkCollapsed));
  document.getElementById('viewBar')?.classList.toggle('isHidden', Boolean(prev.viewHidden));
  document.getElementById('toolBar')?.classList.toggle('isHidden', Boolean(prev.toolHidden));
}

function canUseToolsNow() {
  if (!state.isInSession) return true;
  return Boolean(state.isPageTurner || state.isToolAuthorized);
}

function updateTurnerToggleAccess() {
  const canToggle = state.isInSession ? canUseToolsNow() : true;
  ['toggleLinkBtn', 'toggleViewBtn', 'toggleToolBtn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !canToggle;
    btn.classList.toggle('disabled', !canToggle);
  });
  if (state.isInSession && !canUseToolsNow()) setSessionUiDefaultsIfNeeded();

  const reqBtn = document.getElementById('requestToolBtn');
  if (reqBtn) reqBtn.classList.toggle('hidden', !(state.isInSession && !canUseToolsNow()));
}

function updateSongBookPickVisibility() {
  const btn = document.getElementById('songBookPickBtn');
  if (!btn) return;
  const isMember = authState.role === 'admin' || authState.role === 'session';
  btn.classList.toggle('hidden', !(isMember && state.isInSession && state.roomCode));
}

function joinSession(roomCode) {
  state.roomCode = safeRoomCode(roomCode);
  state.isInSession = true;
  document.getElementById('sessionFloatBtn').textContent = '세션 나가기';
  setHidden('sessionBadge', false);
  setText('sessionBadge', `세션: ${state.roomCode} (연결중...)`);
  setHidden('touchRoomBadge', false);
  setText('touchRoomBadge', `ROOM ${state.roomCode}`);
  setRoomToUrl(state.roomCode);
  if (state.fileId) setLastRoomForFile(state.fileId, state.roomCode);

  socket.emit(
    'session:join',
    {
      roomCode: state.roomCode,
      nickname: state.nickname,
      role: authState.role,
      displayName: authState.displayName,
      profilePhoto: authState.profilePhoto
    },
    (ack) => {
    if (!ack?.ok) {
      alert('세션 참여 실패');
      leaveSession();
      return;
    }
    setText('sessionBadge', `세션: ${state.roomCode}`);
    setText('touchRoomBadge', `ROOM ${state.roomCode}`);
    setHidden('participantsPanel', false);
    // request initial annotations
    if (state.fileId) socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId: state.fileId });
    setSessionUiDefaultsIfNeeded();
    updateTurnerToggleAccess();
    updateSongBookPickVisibility();
  }
  );
}

function leaveSession() {
  const roomCode = state.roomCode;
  state.roomCode = null;
  state.isInSession = false;
  state.isPageTurner = false;
  document.getElementById('sessionFloatBtn').textContent = '세션 참여';
  setHidden('sessionBadge', true);
  setHidden('turnerBadge', true);
  setHidden('touchRoomBadge', true);
  setHidden('touchTurnerBadge', true);
  setHidden('participantsPanel', true);
  if (roomCode) socket.emit('session:leave', { roomCode });
  setRoomToUrl('');
  if (state.fileId) clearLastRoomForFile(state.fileId);
  restoreUiAfterLeavingSession();
  updateTurnerToggleAccess();
  updateSongBookPickVisibility();
}

// reconnect safety: 소켓 재연결 시 방 재가입
socket.on('connect', () => {
  if (state.isInSession && state.roomCode) emitSessionJoin(state.roomCode);
});

// ---- Song picker (노래책에서 고르기) ------------------------------------------------
let songCardsCache = null;

function normLower(s) {
  const v = String(s ?? '');
  try {
    return v.normalize('NFC').toLowerCase();
  } catch {
    return v.toLowerCase();
  }
}

function openSongPickModal() {
  setHidden('songPickModal', false);
  const input = document.getElementById('songPickSearch');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 0);
  }
  renderSongPickList([]);
  document.getElementById('songPickHint').textContent = '불러오는 중...';
  loadSongCardsIfNeeded().catch(() => {
    document.getElementById('songPickHint').textContent = '곡 목록을 불러오지 못했습니다.';
  });
}

function closeSongPickModal() {
  setHidden('songPickModal', true);
}

async function loadSongCardsIfNeeded() {
  if (songCardsCache) {
    document.getElementById('songPickHint').textContent = '검색해서 곡을 선택하세요.';
    return;
  }
  const r = await apiGet('/api/songs/cards');
  if (!r?.ok) throw new Error('LOAD_FAILED');
  songCardsCache = (r.items || []).map((c) => ({
    ...c,
    _searchNorm: normLower(c.searchText || ''),
    _titleNorm: normLower(c.title || ''),
    _artistNorm: normLower(c.artist || '')
  }));
  document.getElementById('songPickHint').textContent = `총 ${songCardsCache.length}곡 · 검색해서 선택`;
}

function pickCardMatches(q) {
  const qq = normLower(String(q || '').trim());
  if (!songCardsCache) return [];
  if (!qq) return songCardsCache.slice(0, 30);
  return songCardsCache
    .filter((c) => (c._searchNorm || '').includes(qq) || (c._titleNorm || '').includes(qq) || (c._artistNorm || '').includes(qq))
    .slice(0, 40);
}

function openFileInRoom(fileId, originalLink = '') {
  const roomCode = state.roomCode;
  if (state.isInSession && state.isPageTurner && roomCode) {
    // 페이지터너는 브로드캐스트만 하고, 실제 이동은 follow:file 이벤트로 통일(중복 네비게이션/루프 방지)
    socket.emit('session:follow:file', { roomCode, fileId, originalLink: String(originalLink || '').trim() }, (ack) => {
      if (!ack?.ok) alert('세션 곡 전환 브로드캐스트 실패(권한 확인)');
    });
  } else {
    window.location.href = `${window.location.origin}/viewer/${fileId}?room=${encodeURIComponent(roomCode)}`;
  }
}

function renderSongPickList(cards) {
  const wrap = document.getElementById('songPickList');
  if (!wrap) return;
  wrap.innerHTML = '';
  (cards || []).forEach((c) => {
    const el = document.createElement('div');
    el.className = 'songPickItem';
    const keys = (c.keys || []).filter((x) => x !== undefined);
    const keysHtml = `
      <div class="songPickKeys">
        ${keys
          .map((k) => `<button class="songPickKeyBtn" type="button" data-k="${encodeURIComponent(k || '')}">${k || '-'}</button>`)
          .join('')}
      </div>
    `;
    el.innerHTML = `
      <div style="min-width:0;">
        <div class="songPickTitle">${String(c.title || '')}</div>
        <div class="songPickSub">${String(c.artist || '')}</div>
      </div>
      ${keysHtml}
    `;
    // key button click -> open
    el.querySelectorAll('.songPickKeyBtn').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const key = decodeURIComponent(btn.dataset.k || '');
        const v = (c.variants || []).find((x) => String(x.key || '') === String(key || '')) || (c.variants || [])[0];
        if (!v?.googleFileId) return;
        closeSongPickModal();
        openFileInRoom(v.googleFileId, v.driveUrl || '');
      };
    });
    // clicking item without choosing key -> if only 1 key
    el.onclick = () => {
      if (keys.length !== 1) return;
      const v = (c.variants || [])[0];
      if (!v?.googleFileId) return;
      closeSongPickModal();
      openFileInRoom(v.googleFileId, v.driveUrl || '');
    };
    wrap.appendChild(el);
  });
}

// ---- URL state restore (바이블: p/s/fit/z/po/ps/py) --------------------------------
function setPreviewYOffsetPx(px) {
  const v = Math.max(-300, Math.min(300, Number(px) || 0));
  document.documentElement.style.setProperty('--previewYOffsetPx', `${v}px`);
}

function applyStateFromUrl() {
  const p = Number(qs('p') || '');
  const s = Number(qs('s') || '');
  const z = Number(qs('z') || '');
  const fit = String(qs('fit') || '').trim().toLowerCase();
  const po = Number(qs('po') || '');
  const py = Number(qs('py') || '');

  if (Number.isFinite(p) && p > 0) state.pageNo = Math.floor(p);
  if (Number.isFinite(s) && s >= 1) state.spreadCount = clamp(Math.floor(s), 1, 4);
  if (fit) state.fitMode = true; // (현 구현은 page/width 구분 없이 fitScale 사용)
  if (Number.isFinite(z) && z > 0) {
    state.fitMode = false;
    state.zoom = clamp(z, 0.5, 3);
  }
  if (Number.isFinite(po)) state.overlapPx = clamp(po, 0, 40);
  if (Number.isFinite(py)) setPreviewYOffsetPx(py);
}
applyStateFromUrl();

const updateUrlState = debounce(() => {
  const u = new URL(window.location.href);
  // keep room
  const room = safeRoomCode(state.roomCode);
  if (room) u.searchParams.set('room', room);
  else u.searchParams.delete('room');

  u.searchParams.set('p', String(state.pageNo || 1));
  u.searchParams.set('s', String(state.spreadCount || 1));
  if (state.fitMode) {
    u.searchParams.set('fit', 'page');
    u.searchParams.delete('z');
  } else {
    u.searchParams.delete('fit');
    u.searchParams.set('z', String(state.zoom || 1));
  }
  u.searchParams.set('po', String(state.overlapPx || 0));
  window.history.replaceState(null, '', `${u.pathname}?${u.searchParams.toString()}`);
}, 120);

// ---- UI wiring --------------------------------------------------------------------
// fileIdBadge는 UI에서 숨김(불필요)

// link row collapse (desktop)
const linkCollapsed = localStorage.getItem('mb_viewer_linkCollapsed') === '1';
document.body.classList.toggle('link-collapsed', linkCollapsed);

// theme (persist)
function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
}
// 기본 테마는 GAS 레퍼런스처럼 dark
const savedTheme = localStorage.getItem('mb_viewer_theme') || 'dark';
applyTheme(savedTheme);
document.getElementById('themeBtn')?.addEventListener('click', () => {
  const next = document.body.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('mb_viewer_theme', next);
  applyTheme(next);
});

// touch-mode (manual + auto)
let manualTouch = localStorage.getItem('mb_viewer_touch') === '1';
function applyTouchMode(on) {
  document.body.classList.toggle('touch-mode', Boolean(on));
  localStorage.setItem('mb_viewer_touch', on ? '1' : '0');
}

function applyTouchModeAuto(on) {
  // auto mode: don't persist (사용자가 명시적으로 끈 경우를 존중)
  document.body.classList.toggle('touch-mode', Boolean(on));
}
document.getElementById('touchBtn')?.addEventListener('click', () => {
  manualTouch = !document.body.classList.contains('touch-mode');
  applyTouchMode(manualTouch);
});

document.getElementById('participantsToggleBtn')?.addEventListener('click', () => {
  const body = document.getElementById('participantsBody');
  if (!body) return;
  setParticipantsCollapsed(!body.classList.contains('isHidden'));
});

document.getElementById('requestToolBtn')?.addEventListener('click', () => {
  if (!state.isInSession || !state.roomCode) return;
  if (state.isPageTurner || state.isToolAuthorized) return;
  socket.emit('session:tool:request', { roomCode: state.roomCode }, (ack) => {
    if (!ack?.ok) return flashHud('요청 실패', 1200);
    flashHud('도구 권한 요청을 보냈습니다', 1400);
  });
});

document.getElementById('songBookPickBtn')?.addEventListener('click', () => {
  // 멤버+세션 상태에서만 노출되므로 별도 권한 체크는 생략
  openSongPickModal();
});
document.getElementById('songPickCloseBtn')?.addEventListener('click', () => closeSongPickModal());
document.getElementById('songPickModal')?.addEventListener('click', (e) => {
  if (e.target?.id === 'songPickModal') closeSongPickModal();
});
document.getElementById('songPickSearch')?.addEventListener(
  'input',
  debounce((e) => {
    const q = e.target.value || '';
    const items = pickCardMatches(q);
    renderSongPickList(items);
  }, 120)
);

// overlap slider (GAS style)
function setSpreadOverlapPx(px) {
  const v = Math.max(0, Math.min(40, Number(px) || 0));
  state.overlapPx = v;
  document.documentElement.style.setProperty('--spreadOverlapPx', `${v}px`);
  const label = document.getElementById('overlapLabel');
  if (label) label.textContent = `${v}px`;
  localStorage.setItem('mb_viewer_overlap', String(v));
}
const savedOverlap = Number(localStorage.getItem('mb_viewer_overlap') || '0');
setSpreadOverlapPx(Number.isFinite(state.overlapPx) ? state.overlapPx : savedOverlap);
const overlapRange = document.getElementById('overlapRange');
if (overlapRange) {
  overlapRange.value = String(Number.isFinite(state.overlapPx) ? state.overlapPx : savedOverlap);
  overlapRange.addEventListener('input', (e) => {
    setSpreadOverlapPx(e.target.value);
    emitViewerSettings('overlap');
    updateUrlState();
  });
}

// initial spread button active
[1, 2, 3, 4].forEach((x) => document.getElementById(`spread${x}Btn`)?.classList.toggle('active', x === state.spreadCount));

document.getElementById('sessionFloatBtn')?.addEventListener('click', async () => {
  if (state.isInSession) {
    leaveSession();
    return;
  }

  // If URL already has room, auto join (no modal) - MUST-1.
  const urlRoom = safeRoomCode(qs('room'));
  // 모바일에서는 닉+룸 동시 입력 지원
  if (isMobileLike()) {
    const savedNick = localStorage.getItem('mb_presence_nick') || localStorage.getItem('mb_nickname') || state.nickname || '';
    const v = await openJoinModal({ nickname: savedNick, roomCode: urlRoom || '' });
    if (!v) return;
    const nick = String(v.nick || '').trim();
    state.nickname = nick;
    localStorage.setItem('mb_presence_nick', nick);
    localStorage.setItem('mb_nickname', nick);
    authState.displayName = authState.displayName || nick;
    socket.auth = { ...(socket.auth || {}), nickname: nick };
    const room = safeRoomCode(v.room || urlRoom);
    if (room) return joinSession(room);
  } else {
    const nick = await ensureNickname();
    state.nickname = nick;
    authState.displayName = authState.displayName || nick;
    socket.auth = { ...(socket.auth || {}), nickname: nick };
    if (urlRoom) return joinSession(urlRoom);
  }

  const input = await openInputModal({ title: '세션 참여', placeholder: 'Room Code를 입력하세요', value: '' });
  const roomCode = safeRoomCode(input);
  if (!roomCode) return;
  joinSession(roomCode);
});

document.getElementById('createSessionFloatBtn')?.addEventListener('click', () => {
  Promise.resolve()
    .then(() => ensureNickname())
    .then((nick) => {
      state.nickname = nick;
      authState.displayName = authState.displayName || nick;
      socket.auth = { ...(socket.auth || {}), nickname: nick };
      socket.emit('session:create', { nickname: nick }, (ack) => {
    if (!ack?.ok) return alert('세션 생성 실패');
    const roomCode = ack.roomCode;
    // Auto join created room
    const nextUrl = `${window.location.origin}/viewer/${state.fileId || ''}?room=${roomCode}`;
    // NOTE: keep current fileId; if empty, user can still open via link input in future version
    window.history.replaceState(null, '', nextUrl);
    joinSession(roomCode);
    copyToClipboard(roomCode).then((ok) => {
      if (ok) flashHud(`ROOM ${roomCode} 복사됨`, 1200);
    });
      });
    })
    .catch(() => {});
});

document.getElementById('prevBtn').addEventListener('click', () => changePage(state.pageNo - state.spreadCount, 'local'));
document.getElementById('nextBtn').addEventListener('click', () => changePage(state.pageNo + state.spreadCount, 'local'));

function extractDriveFileId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  // Accept raw id
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s) && !s.includes('/')) return s;
  // drive.google.com/file/d/<id>/view
  const m1 = s.match(/\/file\/d\/([^/]+)/);
  if (m1) return m1[1];
  // open?id=<id>
  const u = new URL(s, window.location.origin);
  const id = u.searchParams.get('id');
  if (id) return id;
  return '';
}

function openByInput(input) {
  const fileId = extractDriveFileId(input);
  if (!fileId) return alert('fileId를 추출하지 못했습니다. Drive 링크 또는 fileId를 확인해 주세요.');
  // 이미 같은 파일을 보고 있으면 다시 네비게이션하지 않음(무한 루프/리프레시 방지)
  if (state.fileId && String(fileId) === String(state.fileId)) return;

  const roomCode = state.roomCode;
  if (state.isInSession && state.isPageTurner && roomCode) {
    socket.emit('session:follow:file', { roomCode, fileId, originalLink: String(input || '').trim() }, (ack) => {
      if (!ack?.ok) alert('세션 곡 전환 브로드캐스트 실패(권한 확인)');
    });
  } else {
    const roomParam = state.isInSession && roomCode ? `?room=${roomCode}` : '';
    window.location.href = `${window.location.origin}/viewer/${fileId}${roomParam}`;
  }
}

// New: inline open input (GAS style)
document.getElementById('openBtn')?.addEventListener('click', () => {
  const input = document.getElementById('linkInput')?.value || '';
  openByInput(input);
});
document.getElementById('linkInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('openBtn')?.click();
});

// ---- Key bindings (바이블: 기본 매핑 + 사용자 지정) ---------------------------------
const DEFAULT_NEXT_KEYS = ['ArrowRight', 'PageDown', ' ']; // Space는 e.key === ' '
const DEFAULT_PREV_KEYS = ['ArrowLeft', 'PageUp'];
const KEY_STORAGE = { next: 'mb_viewer_key_next', prev: 'mb_viewer_key_prev' };
let captureKeyMode = null; // 'next' | 'prev'

function loadBoundKeys() {
  const prev = (localStorage.getItem(KEY_STORAGE.prev) || '').split(',').map((x) => x.trim()).filter(Boolean);
  const next = (localStorage.getItem(KEY_STORAGE.next) || '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    prev: prev.length ? prev : DEFAULT_PREV_KEYS,
    next: next.length ? next : DEFAULT_NEXT_KEYS
  };
}

function saveBoundKey(which, key) {
  localStorage.setItem(KEY_STORAGE[which], key);
}

function setBindLabels() {
  const keys = loadBoundKeys();
  setText('bindPrevLabel', keys.prev.map((k) => (k === ' ' ? 'Space' : k)).join('/'));
  setText('bindNextLabel', keys.next.map((k) => (k === ' ' ? 'Space' : k)).join('/'));
}
setBindLabels();

document.getElementById('bindPrevBtn')?.addEventListener('click', () => {
  captureKeyMode = 'prev';
  setHidden('pageHud', false);
  setText('pageHud', '이전 키를 누르세요(ESC 취소)');
});
document.getElementById('bindNextBtn')?.addEventListener('click', () => {
  captureKeyMode = 'next';
  setHidden('pageHud', false);
  setText('pageHud', '다음 키를 누르세요(ESC 취소)');
});
document.getElementById('bindResetBtn')?.addEventListener('click', () => {
  localStorage.removeItem(KEY_STORAGE.prev);
  localStorage.removeItem(KEY_STORAGE.next);
  setBindLabels();
  setHidden('pageHud', false);
  setText('pageHud', '키 바인딩 초기화 완료');
});

// Pedal/keyboard mapping (requirement). Only page turner broadcasts.
window.addEventListener('keydown', (e) => {
  if (captureKeyMode) {
    if (e.key === 'Escape') {
      captureKeyMode = null;
      setText('pageHud', '취소됨');
      return;
    }
    // store single key (원본도 단일 지정 UI)
    saveBoundKey(captureKeyMode, e.key);
    captureKeyMode = null;
    setBindLabels();
    setHidden('pageHud', false);
    setText('pageHud', '저장됨');
    e.preventDefault();
    return;
  }

  const { prev, next } = loadBoundKeys();
  if (next.includes(e.key)) {
    if (e.key === ' ') e.preventDefault();
    changePage(state.pageNo + state.spreadCount, 'kbd');
    updateUrlState();
  }
  if (prev.includes(e.key)) {
    changePage(state.pageNo - state.spreadCount, 'kbd');
    updateUrlState();
  }
});

// Mobile-only floating menu button: touch-mode에서만 하단 패널(간단 시트) 토글
document.getElementById('fab')?.addEventListener('click', () => {
  document.body.classList.toggle('sheet-open');
});

// touch bottom buttons (원본)
document.getElementById('touchPrevBtn')?.addEventListener('click', () => {
  changePage(state.pageNo - state.spreadCount, 'touch');
  updateUrlState();
});
document.getElementById('touchNextBtn')?.addEventListener('click', () => {
  changePage(state.pageNo + state.spreadCount, 'touch');
  updateUrlState();
});
function toggleBottomSheet(e) {
  // 문서 레벨 auto-close 핸들러에 의해 즉시 닫히는 것 방지
  try {
    e?.preventDefault?.();
    e?.stopPropagation?.();
  } catch {}
  document.body.classList.toggle('sheet-open');
  flashHud(document.body.classList.contains('sheet-open') ? '메뉴 열림' : '메뉴 닫힘', 700);
}

document.getElementById('touchMenuBtn')?.addEventListener('click', toggleBottomSheet);
// iOS에서 click이 불안정한 경우 대비
document.getElementById('touchMenuBtn')?.addEventListener('touchend', toggleBottomSheet, { passive: false });

// iOS/Safari에서 하단바 클릭이 불안정한 케이스 대비: 컨테이너 클릭도 허용
document.getElementById('touchNavBottom')?.addEventListener('click', (e) => {
  if (e.target?.id !== 'touchMenuBtn') return;
  toggleBottomSheet(e);
});

// Tap zones (GAS style): left=prev, right=next, center=toggle palette
document.getElementById('tapZoneLeft')?.addEventListener('click', () => changePage(state.pageNo - state.spreadCount, 'tap'));
document.getElementById('tapZoneRight')?.addEventListener('click', () => changePage(state.pageNo + state.spreadCount, 'tap'));
document.getElementById('tapZoneCenter')?.addEventListener('click', () => {
  // 중앙 탭: 옵션/팔레트 토글
  document.body.classList.toggle('sheet-open');
});

document.getElementById('fullscreenBtn').addEventListener('click', async () => {
  // MUST-2: fullscreen target must be top-level wrapper
  const wrapper = document.getElementById('viewer-wrapper');
  if (!document.fullscreenElement) {
    await wrapper.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
});

// fullscreenBtn2 제거(상단 버튼으로 통일)

function changePage(next, source) {
  // pageNo means "leftmost page" in spread mode
  const pageNo = Math.max(1, Math.min(state.totalPages, next));
  state.pageNo = pageNo;
  state.activeDrawPageNo = pageNo;
  updatePageLabels();
  renderSpread(pageNo).catch(() => {});
  updateUrlState();

  // Only pageTurner broadcasts page change (requirement).
  if (state.isInSession && state.isPageTurner) {
    socket.emit('viewer:page_change', { roomCode: state.roomCode, fileId: state.fileId, pageNo }, () => {});
  }
}

// ---- PDF.js rendering + Fabric overlay (multi-page spread) -------------------------
// eslint-disable-next-line no-undef
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const els = {
  pdfPreview: document.getElementById('pdf-preview'),
  canvasStack: document.getElementById('canvas-stack'),
  pdfContainer: document.getElementById('pdf-container'),
  pageHud: document.getElementById('pageHud')
};

/** @type {Map<number, any>} */
const viewMap = new Map(); // pageNo -> view
/** @type {Map<number, Function>} */
const broadcastDebouncedByPage = new Map();

function getSpreadPages(leftPageNo) {
  const pages = [];
  for (let i = 0; i < state.spreadCount; i += 1) {
    const p = leftPageNo + i;
    if (p > state.totalPages) break;
    pages.push(p);
  }
  return pages;
}

function updatePageLabels() {
  const pages = getSpreadPages(state.pageNo);
  const range = pages.length > 1 ? `${pages[0]}-${pages[pages.length - 1]}` : `${pages[0] || 1}`;
  setText('pageLabel', range);
  setText('pageTotal', `/ ${state.totalPages}`);
  setHidden('pageHud', false);
  const hud = `${range} / ${state.totalPages}${state.isPageTurner ? ' · 터너' : ''}`;
  els.pageHud.textContent = hud;
  setText('touchPageInfo', `${range}/${state.totalPages}`);
}

function clearViews() {
  for (const v of viewMap.values()) {
    try {
      v.fabric?.dispose?.();
    } catch {}
  }
  viewMap.clear();
  broadcastDebouncedByPage.clear();
  els.canvasStack.innerHTML = '';
}

function computeViewport(page) {
  const base = page.getViewport({ scale: 1 });
  const gap = 12;
  const pad = 24;
  const maxW = Math.max(200, (els.pdfContainer.clientWidth - pad - gap * (state.spreadCount - 1)) / state.spreadCount);
  const maxH = Math.max(200, els.pdfContainer.clientHeight - pad);
  const scaleW = maxW / base.width;
  const scaleH = maxH / base.height;
  const fitScale = Math.max(0.15, Math.min(scaleW, scaleH));
  const scale = state.fitMode ? fitScale : fitScale * state.zoom;
  return page.getViewport({ scale });
}

function makeView(pageNo) {
  const root = document.createElement('div');
  root.className = 'page-view';
  root.dataset.pageNo = String(pageNo);

  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.className = 'pdf-layer';

  const annoCanvas = document.createElement('canvas');
  annoCanvas.className = 'anno-layer';

  root.appendChild(pdfCanvas);
  root.appendChild(annoCanvas);
  els.canvasStack.appendChild(root);

  const fabricCanvas = new fabric.Canvas(annoCanvas, {
    isDrawingMode: true,
    selection: false
  });

  // mark active page for undo/redo based on last click
  fabricCanvas.on('mouse:down', () => {
    state.activeDrawPageNo = pageNo;
  });

  // --- Shape/Text placement -------------------------------------------------------
  let isPlacing = false;
  let placingObj = null;
  let origin = null;
  // --- Laser pointer (transient) --------------------------------------------------
  let laserPlacing = false;
  let laserObj = null;
  let laserPoints = [];
  // --- Eraser (delete nearby objects) ---------------------------------------------
  let erasing = false;
  let erasedCount = 0;
  // late-bound (pushUndo/broadcast are declared later)
  let vPushUndo = () => {};
  let vBroadcast = () => {};

  const getPointer = (opt) => fabricCanvas.getPointer(opt.e);
  const commonStyle = () => {
    const size = Number(document.getElementById('brushSize').value || 3);
    const color = document.getElementById('colorPicker').value || '#ff2d55';
    return { stroke: color, fill: 'rgba(0,0,0,0)', strokeWidth: Math.max(1, size) };
  };

  fabricCanvas.on('mouse:down', (opt) => {
    state.activeDrawPageNo = pageNo;
    if (state.locked) return;

    if (state.tool === 'eraser') {
      const p = getPointer(opt);
      const size = Number(document.getElementById('brushSize').value || 3);
      erasing = true;
      erasedCount += eraseAtPoint(fabricCanvas, p, Math.max(10, size * 2.4));
      return;
    }

    if (state.tool === 'laser') {
      const p = getPointer(opt);
      laserPlacing = true;
      laserPoints = [{ x: p.x, y: p.y }, { x: p.x + 0.01, y: p.y + 0.01 }];
      laserObj = makeLaserGroup(laserPoints);
      fabricCanvas.add(laserObj);
      fabricCanvas.requestRenderAll();
      return;
    }

    if (state.tool === 'text') {
      const p = getPointer(opt);
      const color = document.getElementById('colorPicker').value || '#ff2d55';
      const it = new fabric.IText('텍스트', {
        left: p.x,
        top: p.y,
        fontSize: state.textFontSize || 22,
        fill: color,
        fontWeight: 700
      });
      fabricCanvas.add(it);
      it.enterEditing();
      fabricCanvas.setActiveObject(it);
      vPushUndo();
      vBroadcast();
      // 텍스트 1회 생성 후 자연스럽게 선택 도구로 복귀
      setTimeout(() => setTool('select'), 0);
      return;
    }

    if (state.tool !== 'shape') return;
    const p = getPointer(opt);
    origin = { x: p.x, y: p.y };
    const st = commonStyle();

    if (state.shape === 'line') {
      placingObj = new fabric.Line([p.x, p.y, p.x, p.y], {
        stroke: st.stroke,
        strokeWidth: st.strokeWidth,
        selectable: false,
        evented: false
      });
    } else if (state.shape === 'rect') {
      placingObj = new fabric.Rect({
        left: p.x,
        top: p.y,
        width: 1,
        height: 1,
        ...st,
        selectable: false,
        evented: false
      });
    } else if (state.shape === 'circle') {
      placingObj = new fabric.Ellipse({
        left: p.x,
        top: p.y,
        rx: 1,
        ry: 1,
        ...st,
        selectable: false,
        evented: false
      });
    } else {
      placingObj = null;
    }

    if (placingObj) {
      isPlacing = true;
      fabricCanvas.add(placingObj);
    }
  });

  fabricCanvas.on('mouse:move', (opt) => {
    if (state.locked) return;
    if (erasing) {
      const p = getPointer(opt);
      const size = Number(document.getElementById('brushSize').value || 3);
      erasedCount += eraseAtPoint(fabricCanvas, p, Math.max(10, size * 2.4));
      return;
    }
    if (laserPlacing && laserObj) {
      const p = getPointer(opt);
      laserPoints.push({ x: p.x, y: p.y });
      // keep it light
      if (laserPoints.length > 200) laserPoints.shift();
      updateLaserGroup(laserObj, laserPoints);
      fabricCanvas.requestRenderAll();
      return;
    }
    if (!isPlacing || !placingObj || !origin) return;
    const p = getPointer(opt);

    if (placingObj.type === 'line') {
      placingObj.set({ x2: p.x, y2: p.y });
    } else if (placingObj.type === 'rect') {
      const left = Math.min(origin.x, p.x);
      const top = Math.min(origin.y, p.y);
      const w = Math.abs(origin.x - p.x);
      const h = Math.abs(origin.y - p.y);
      placingObj.set({ left, top, width: w, height: h });
    } else if (placingObj.type === 'ellipse') {
      const left = Math.min(origin.x, p.x);
      const top = Math.min(origin.y, p.y);
      const rx = Math.abs(origin.x - p.x) / 2;
      const ry = Math.abs(origin.y - p.y) / 2;
      placingObj.set({ left, top, rx, ry });
    }
    placingObj.setCoords();
    fabricCanvas.requestRenderAll();
  });

  fabricCanvas.on('mouse:up', () => {
    if (state.locked) return;
    if (erasing) {
      erasing = false;
      if (erasedCount > 0) {
        erasedCount = 0;
        vPushUndo();
        vBroadcast();
      }
      return;
    }
    if (laserPlacing) {
      laserPlacing = false;
      const lo = laserObj;
      const pts = laserPoints;
      laserObj = null;
      laserPoints = [];

      // Broadcast to room for authorized tool users (5초 후 자동 삭제)
      if (lo && state.isInSession && state.roomCode && state.fileId && canUseToolsNow()) {
        socket.emit('viewer:laser', {
          roomCode: state.roomCode,
          fileId: state.fileId,
          pageNo,
          w: fabricCanvas.getWidth(),
          h: fabricCanvas.getHeight(),
          points: pts
        });
      }

      // 1초 유지 후 짧게 페이드아웃(요구사항)
      if (lo) scheduleFadeOutAndRemove(fabricCanvas, lo, 1000, 400);
      return;
    }
    if (!isPlacing) return;
    isPlacing = false;
    placingObj = null;
    origin = null;
    vPushUndo();
    vBroadcast();
  });

  // ensure undo/redo init
  state.undoStack[pageNo] ||= [];
  state.redoStack[pageNo] ||= [];

  const pushUndo = debounce(() => {
    const snap = snapshotPage(pageNo);
    if (!snap) return;
    state.undoStack[pageNo].push(snap);
    state.undoStack[pageNo] = state.undoStack[pageNo].slice(-30);
    // new draw invalidates redo
    state.redoStack[pageNo] = [];
  }, 250);

  const broadcast = broadcastDebouncedByPage.get(pageNo) ||
    debounce(() => {
      if (!state.isInSession || !state.roomCode || !state.fileId) return;
      if (!canUseToolsNow()) return;
      const snap = snapshotPage(pageNo);
      if (!snap) return;
      state.annoStore[pageNo] = snap;
      socket.emit('wb:page:update', {
        roomCode: state.roomCode,
        fileId: state.fileId,
        pageNo: String(pageNo),
        pageSnapshot: snap
      });
    }, 200);
  broadcastDebouncedByPage.set(pageNo, broadcast);

  vPushUndo = () => pushUndo();
  vBroadcast = () => broadcast();

  fabricCanvas.on('path:created', () => {
    if (state.locked) return;
    pushUndo();
    broadcast();
  });
  fabricCanvas.on('object:modified', () => {
    if (state.locked) return;
    pushUndo();
    broadcast();
  });

  const v = { pageNo, root, pdfCanvas, annoCanvas, fabric: fabricCanvas, pushUndo, broadcast };
  viewMap.set(pageNo, v);
  applyToolToAll();

  // selection change -> sync edit UI (best effort)
  const syncSelectionUI = () => {
    const active = fabricCanvas.getActiveObject?.();
    if (!active) return;
    if (active.type === 'i-text') {
      document.getElementById('fontSize').value = String(active.fontSize || 22);
    }
  };
  fabricCanvas.on('selection:created', syncSelectionUI);
  fabricCanvas.on('selection:updated', syncSelectionUI);
  return v;
}

function applyToolToCanvas(fab) {
  if (!fab) return;
  const size = Number(document.getElementById('brushSize').value || 3);
  const color = document.getElementById('colorPicker').value || '#ff2d55';

  // selection defaults
  const makeSelectable = (on) => {
    fab.selection = on;
    fab.forEachObject((obj) => {
      obj.selectable = on;
      obj.evented = on;
    });
  };

  if (state.locked) {
    fab.isDrawingMode = false;
    makeSelectable(false);
    return;
  }

  if (state.tool === 'pen') {
    fab.isDrawingMode = true;
    fab.freeDrawingBrush = new fabric.PencilBrush(fab);
    fab.freeDrawingBrush.width = size;
    fab.freeDrawingBrush.color = color;
    makeSelectable(false);
  } else if (state.tool === 'highlighter') {
    fab.isDrawingMode = true;
    fab.freeDrawingBrush = new fabric.PencilBrush(fab);
    fab.freeDrawingBrush.width = Math.max(8, size * 3);
    // keep input color hue but with alpha
    const rgba = color.startsWith('#')
      ? `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},0.28)`
      : 'rgba(255, 235, 59, 0.28)';
    fab.freeDrawingBrush.color = rgba;
    makeSelectable(false);
  } else if (state.tool === 'eraser') {
    // 커스텀 지우개: "근처 오브젝트 삭제" 방식(검정펜 fallback 금지)
    fab.isDrawingMode = false;
    makeSelectable(false);
  } else if (state.tool === 'select') {
    fab.isDrawingMode = false;
    makeSelectable(true);
  } else if (state.tool === 'laser') {
    // transient pointer (custom mouse events)
    fab.isDrawingMode = false;
    makeSelectable(false);
  } else if (state.tool === 'shape' || state.tool === 'text') {
    // placement happens on mouse events
    fab.isDrawingMode = false;
    makeSelectable(false);
  }
}

function syncDrawingActiveClass() {
  const drawingTools = ['pen', 'highlighter', 'eraser', 'shape', 'text', 'laser'];
  const active = !state.locked && drawingTools.includes(state.tool);
  document.body.classList.toggle('drawing-active', active);
}

function applyToolToAll() {
  for (const v of viewMap.values()) applyToolToCanvas(v.fabric);
  syncDrawingActiveClass();
}

function snapshotPage(pageNo) {
  const v = viewMap.get(pageNo);
  if (!v?.fabric) return null;
  const json = v.fabric.toDatalessJSON();
  return { json, w: v.fabric.getWidth(), h: v.fabric.getHeight() };
}

function applySnapshotToPage(pageNo, pageSnapshot) {
  const v = viewMap.get(pageNo);
  if (!v?.fabric) return;
  const newW = v.fabric.getWidth();
  const newH = v.fabric.getHeight();
  v.fabric.loadFromJSON(pageSnapshot?.json || { objects: [] }, () => {
    const oldW = Number(pageSnapshot?.w || newW);
    const oldH = Number(pageSnapshot?.h || newH);
    const sx = oldW ? newW / oldW : 1;
    const sy = oldH ? newH / oldH : 1;
    v.fabric.getObjects().forEach((obj) => {
      obj.scaleX *= sx;
      obj.scaleY *= sy;
      obj.left *= sx;
      obj.top *= sy;
      obj.setCoords();
    });
    v.fabric.renderAll();
    applyToolToCanvas(v.fabric);
  });
}

async function renderSpread(leftPageNo) {
  if (!state.isPdfReady || !state.pdfDoc) return;

  // Remove preview fallback if any
  els.pdfPreview.classList.add('hidden');
  els.canvasStack.style.display = 'flex';

  // Rebuild views each time (<=4 pages, OK)
  clearViews();

  const pages = getSpreadPages(leftPageNo);
  updatePageLabels();

  for (const p of pages) {
    const page = await state.pdfDoc.getPage(p);
    const viewport = computeViewport(page);
    const v = makeView(p);

    v.pdfCanvas.width = Math.floor(viewport.width);
    v.pdfCanvas.height = Math.floor(viewport.height);
    v.annoCanvas.width = v.pdfCanvas.width;
    v.annoCanvas.height = v.pdfCanvas.height;

    // size root to fit canvas
    v.root.style.width = `${v.pdfCanvas.width}px`;
    v.root.style.height = `${v.pdfCanvas.height}px`;

    v.fabric.setWidth(v.pdfCanvas.width);
    v.fabric.setHeight(v.pdfCanvas.height);

    const ctx = v.pdfCanvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const saved = state.annoStore[p];
    if (saved) applySnapshotToPage(p, saved);
    else applySnapshotToPage(p, { json: { objects: [] }, w: v.pdfCanvas.width, h: v.pdfCanvas.height });
  }
}

async function loadPdf(fileId) {
  state.isPdfReady = false;
  state.pdfDoc = null;
  state.totalPages = 1;
  state.pageNo = 1;
  state.activeDrawPageNo = 1;
  updatePageLabels();

  const url = `${window.location.origin}/api/drive/pdf/${fileId}`;
  setHidden('pageHud', false);
  setText('pageHud', 'PDF 로딩 중...');

  try {
    const loadingTask = pdfjsLib.getDocument({
      url,
      withCredentials: true,
      disableStream: false,
      disableAutoFetch: false
    });
    const pdf = await loadingTask.promise;
    state.pdfDoc = pdf;
    state.totalPages = pdf.numPages;
    state.isPdfReady = true;
    updatePageLabels();
    await renderSpread(state.pageNo);

    if (state.isInSession && state.roomCode) socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId });
  } catch (e) {
    try {
      const meta = await fetch(`/api/drive/preview/${encodeURIComponent(fileId)}`).then((r) => r.json());
      els.pdfPreview.src = meta.previewUrl;
      els.pdfPreview.classList.remove('hidden');
      els.canvasStack.style.display = 'none';
      setHidden('pageHud', false);
      setText('pageHud', '스트리밍이 제한되어 미리보기 모드로 열었습니다(권한/공유 확인)');
    } catch {
      setHidden('pageHud', false);
      setText('pageHud', 'PDF 로딩 실패: Drive 공유/권한 또는 fileId 확인');
    }
  }
}

// Resize -> re-render current spread
const ro = new ResizeObserver(
  debounce(() => {
    if (state.isPdfReady) renderSpread(state.pageNo).catch(() => {});
  }, 200)
);
ro.observe(els.pdfContainer);

// Palette tools
document.getElementById('brushSize').addEventListener('input', () => applyToolToAll());
document.getElementById('colorPicker').addEventListener('input', () => applyToolToAll());

function setTool(tool, shape = null) {
  if (state.isInSession && !canUseToolsNow()) {
    flashHud('도구 권한이 없습니다(도구요청 버튼으로 요청)', 1400);
    return;
  }
  // 커서공유는 "표시 모드"이므로, 다른 도구로 전환하면 자동 중단
  if (state.cursorShareOn) stopCursorShare(true);
  state.tool = tool;
  state.shape = shape;
  document.body.dataset.tool = tool;
  document.body.classList.toggle('tool-text', tool === 'text');
  applyToolToAll();
}

document.getElementById('penBtn').addEventListener('click', () => setTool('pen'));
document.getElementById('highlighterBtn').addEventListener('click', () => setTool('highlighter'));
document.getElementById('cursorShareBtn')?.addEventListener('click', () => {
  if (state.cursorShareOn) stopCursorShare(true);
  else startCursorShare();
});
document.getElementById('laserBtn')?.addEventListener('click', () => setTool('laser'));
document.getElementById('eraserBtn').addEventListener('click', () => setTool('eraser'));
document.getElementById('selectBtn').addEventListener('click', () => setTool('select'));
document.getElementById('lineBtn').addEventListener('click', () => setTool('shape', 'line'));
document.getElementById('rectBtn').addEventListener('click', () => setTool('shape', 'rect'));
document.getElementById('circleBtn').addEventListener('click', () => setTool('shape', 'circle'));
document.getElementById('textBtn').addEventListener('click', () => setTool('text'));

function undoForActivePage() {
  const pageNo = state.activeDrawPageNo || state.pageNo;
  const stack = state.undoStack[pageNo] || [];
  if (!stack.length) return;
  const current = snapshotPage(pageNo);
  if (current) {
    state.redoStack[pageNo] ||= [];
    state.redoStack[pageNo].push(current);
    state.redoStack[pageNo] = state.redoStack[pageNo].slice(-30);
  }
  stack.pop();
  const prev = stack[stack.length - 1];
  if (prev) {
    state.annoStore[pageNo] = prev;
    applySnapshotToPage(pageNo, prev);
  } else {
    state.annoStore[pageNo] = { json: { objects: [] }, w: 1, h: 1 };
    applySnapshotToPage(pageNo, { json: { objects: [] }, w: 1, h: 1 });
  }
  broadcastDebouncedByPage.get(pageNo)?.();
}

function redoForActivePage() {
  const pageNo = state.activeDrawPageNo || state.pageNo;
  const rstack = state.redoStack[pageNo] || [];
  if (!rstack.length) return;
  const snap = rstack.pop();
  state.undoStack[pageNo] ||= [];
  state.undoStack[pageNo].push(snap);
  state.annoStore[pageNo] = snap;
  applySnapshotToPage(pageNo, snap);
  broadcastDebouncedByPage.get(pageNo)?.();
}

document.getElementById('undoBtn').addEventListener('click', undoForActivePage);
document.getElementById('redoBtn').addEventListener('click', redoForActivePage);
document.getElementById('clearBtn').addEventListener('click', () => {
  const pageNo = state.activeDrawPageNo || state.pageNo;
  state.undoStack[pageNo] ||= [];
  const current = snapshotPage(pageNo);
  if (current) state.undoStack[pageNo].push(current);
  state.redoStack[pageNo] = [];
  state.annoStore[pageNo] = { json: { objects: [] }, w: 1, h: 1 };
  applySnapshotToPage(pageNo, { json: { objects: [] }, w: 1, h: 1 });
  broadcastDebouncedByPage.get(pageNo)?.();
});

// View controls
function emitViewerSettings(reason = '') {
  if (!state.isInSession || !state.roomCode || !state.fileId) return;
  if (!state.isPageTurner) return;
  socket.emit('viewer:settings', {
    roomCode: state.roomCode,
    fileId: state.fileId,
    reason,
    settings: {
      spreadCount: state.spreadCount,
      fitMode: state.fitMode,
      zoom: state.zoom,
      overlapPx: state.overlapPx
    }
  });
}

function setSpread(n) {
  state.spreadCount = n;
  // GAS처럼 버튼 active 처리
  [1, 2, 3, 4].forEach((x) => document.getElementById(`spread${x}Btn`)?.classList.toggle('active', x === n));
  changePage(state.pageNo, 'spread');
  emitViewerSettings('spread');
  updateUrlState();
}
document.getElementById('spread1Btn').addEventListener('click', () => setSpread(1));
document.getElementById('spread2Btn').addEventListener('click', () => setSpread(2));
document.getElementById('spread3Btn').addEventListener('click', () => setSpread(3));
document.getElementById('spread4Btn').addEventListener('click', () => setSpread(4));

document.getElementById('zoomInBtn').addEventListener('click', () => {
  state.fitMode = false;
  state.zoom = Math.min(3, state.zoom * 1.15);
  renderSpread(state.pageNo).catch(() => {});
  emitViewerSettings('zoom');
  updateUrlState();
});
document.getElementById('zoomOutBtn').addEventListener('click', () => {
  state.fitMode = false;
  state.zoom = Math.max(0.5, state.zoom / 1.15);
  renderSpread(state.pageNo).catch(() => {});
  emitViewerSettings('zoom');
  updateUrlState();
});
document.getElementById('fitBtn').addEventListener('click', () => {
  state.fitMode = true;
  state.zoom = 1;
  renderSpread(state.pageNo).catch(() => {});
  emitViewerSettings('fit');
  updateUrlState();
});

function toggleLock() {
  state.locked = !state.locked;
  document.getElementById('lockFloatBtn').textContent = state.locked ? '잠금해제' : '잠금';
  document.getElementById('lockFloatBtn').classList.toggle('active', state.locked);
  applyToolToAll();
}

document.getElementById('lockFloatBtn')?.addEventListener('click', toggleLock);

function getActiveView() {
  const pageNo = state.activeDrawPageNo || state.pageNo;
  return viewMap.get(pageNo);
}

// Text size option: when text tool is enabled, change default + selected text (if any)
document.getElementById('fontSize')?.addEventListener('input', (e) => {
  const fs = Number(e.target.value || 22);
  state.textFontSize = clamp(fs, 12, 60);
  const v = getActiveView();
  const obj = v?.fabric?.getActiveObject?.();
  if (v?.fabric && obj?.type === 'i-text') {
    obj.set('fontSize', state.textFontSize);
    v.fabric.requestRenderAll();
  }
});
document.getElementById('fontSize')?.addEventListener('change', () => {
  const v = getActiveView();
  v?.pushUndo?.();
  v?.broadcast?.();
});

// Delete key (selection mode)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  if (state.tool !== 'select') return;
  const pageNo = state.activeDrawPageNo || state.pageNo;
  const v = viewMap.get(pageNo);
  if (!v?.fabric) return;
  const obj = v.fabric.getActiveObject();
  if (!obj) return;
  v.fabric.remove(obj);
  v.fabric.discardActiveObject();
  v.fabric.requestRenderAll();
  v.pushUndo?.();
  v.broadcast?.();
});

// Live mode (mobile/tablet)
function updateLiveMode() {
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  const isLive = window.matchMedia('(max-width: 980px)').matches || isCoarse;
  document.body.classList.toggle('live-mode', isLive);
  document.body.classList.toggle('landscape', window.matchMedia('(orientation: landscape)').matches);
  // 모바일 UX는 live-mode 기준으로 항상 시트 UI가 필요해서 자동 활성(사용자 설정과 무관)
  if (isLive) applyTouchModeAuto(true);
}
updateLiveMode();
window.addEventListener('resize', updateLiveMode);

// Desktop toggles (GAS 원본)
document.getElementById('toggleViewBtn')?.addEventListener('click', () => {
  if (state.isInSession && !canUseToolsNow()) return;
  document.getElementById('viewBar')?.classList.toggle('isHidden');
});
document.getElementById('toggleToolBtn')?.addEventListener('click', () => {
  if (state.isInSession && !canUseToolsNow()) return;
  document.getElementById('toolBar')?.classList.toggle('isHidden');
});
document.getElementById('toggleLinkBtn')?.addEventListener('click', () => {
  if (state.isInSession && !canUseToolsNow()) return;
  const next = !document.body.classList.contains('link-collapsed');
  document.body.classList.toggle('link-collapsed', next);
  localStorage.setItem('mb_viewer_linkCollapsed', next ? '1' : '0');
});

// touch-mode quick toggles (inside bottom sheet)
document.getElementById('mobileToggleLinkBtn')?.addEventListener('click', () => {
  const next = !document.body.classList.contains('link-collapsed');
  document.body.classList.toggle('link-collapsed', next);
  localStorage.setItem('mb_viewer_linkCollapsed', next ? '1' : '0');
});
document.getElementById('mobileToggleViewBtn')?.addEventListener('click', () => {
  document.getElementById('viewBar')?.classList.toggle('isHidden');
});
document.getElementById('mobileToggleToolBtn')?.addEventListener('click', () => {
  document.getElementById('toolBar')?.classList.toggle('isHidden');
});

// Wheel zoom (Ctrl + wheel)
els.pdfContainer.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    state.fitMode = false;
    const dir = e.deltaY < 0 ? 1.08 : 0.92;
    state.zoom = clamp(state.zoom * dir, 0.5, 3);
    renderSpread(state.pageNo).catch(() => {});
  },
  { passive: false }
);

// Touch: pinch zoom + swipe page (only when not drawing tools)
const touch = { mode: null, startX: 0, startY: 0, dx: 0, startDist: 0, startZoom: 1 };
function dist(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
els.pdfContainer.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 2) {
      touch.mode = 'pinch';
      touch.startDist = dist(e.touches[0], e.touches[1]);
      touch.startZoom = state.fitMode ? 1 : state.zoom;
      state.fitMode = false;
    } else if (e.touches.length === 1 && state.tool === 'select') {
      touch.mode = 'swipe';
      touch.startX = e.touches[0].clientX;
      touch.startY = e.touches[0].clientY;
      touch.dx = 0;
    } else {
      touch.mode = null;
    }
  },
  { passive: true }
);
els.pdfContainer.addEventListener(
  'touchmove',
  (e) => {
    if (touch.mode === 'pinch' && e.touches.length === 2) {
      const d = dist(e.touches[0], e.touches[1]);
      const ratio = d / (touch.startDist || d);
      state.zoom = clamp(touch.startZoom * ratio, 0.5, 3);
      renderSpread(state.pageNo).catch(() => {});
    } else if (touch.mode === 'swipe' && e.touches.length === 1) {
      touch.dx = e.touches[0].clientX - touch.startX;
    }
  },
  { passive: true }
);
els.pdfContainer.addEventListener(
  'touchend',
  () => {
    if (touch.mode === 'swipe') {
      if (Math.abs(touch.dx) > 80) {
        if (touch.dx < 0) changePage(state.pageNo + state.spreadCount, 'swipe');
        else changePage(state.pageNo - state.spreadCount, 'swipe');
      }
    }
    touch.mode = null;
  },
  { passive: true }
);

// touch-mode bottom sheet auto-close when clicking outside
document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('sheet-open')) return;
  const fab = document.getElementById('fab');
  const shell = document.getElementById('toolbarShell');
  const bottom = document.getElementById('touchNavBottom');
  if (fab?.contains(e.target)) return;
  if (bottom?.contains(e.target)) return;
  if (shell?.contains(e.target)) return;
  document.body.classList.remove('sheet-open');
});

// ---- Socket event handlers ---------------------------------------------------------
socket.on('session:pageTurner:state', (p) => {
  if (!state.isInSession) return;
  state.isPageTurner = p?.pageTurnerSocketId === socket.id;
  if (state.isPageTurner) state.isToolAuthorized = true;
  if (state.isPageTurner) {
    setHidden('turnerBadge', false);
    setText('turnerBadge', '현재 당신이 페이지터너입니다');
    setHidden('touchTurnerBadge', false);
    setText('touchTurnerBadge', 'TURNER');
    // 턴너가 된 순간 현재 보기설정도 동기화(요구사항)
    emitViewerSettings('turner_state');
  } else {
    setHidden('turnerBadge', true);
    setHidden('touchTurnerBadge', true);
  }
  updateTurnerToggleAccess();
  updateCursorShareUI();
  updatePageLabels();
});

socket.on('session:participants', (p) => {
  if (!state.isInSession) return;
  try {
    const me = (p?.members || []).find((m) => m.socketId === socket.id);
    if (me) state.isToolAuthorized = Boolean(me.isToolAuthorized) || state.isPageTurner;
  } catch {}
  updateTurnerToggleAccess();
  updateCursorShareUI();
  const list = document.getElementById('participantsList');
  list.innerHTML = '';
  (p?.members || []).forEach((m) => {
    const row = document.createElement('div');
    row.className = 'participant-row';
    const name = m.displayName || m.nickname || '익명';
    const initial = String(name || '').trim().slice(0, 1) || '?';
    const photo = normalizeProfilePhotoUrl(m.profilePhoto || '', 80);
    row.innerHTML = `
      <span class="participant-left">
        ${
          photo
            ? `<span class="participant-avatar"><img src="${String(photo)}" alt="" /></span>`
            : `<span class="participant-avatar">${initial}</span>`
        }
        <span class="participant-name">${name}</span>
      </span>
      ${m.isPageTurner ? `<span class="participant-badge">TURNER</span>` : ''}
    `;

    if (state.isPageTurner && !m.isPageTurner) {
      const btn = document.createElement('button');
      btn.textContent = '권한 양도';
      btn.onclick = () => {
        socket.emit('session:pageTurner:transfer', { roomCode: state.roomCode, targetSocketId: m.socketId }, (ack) => {
          if (!ack?.ok) alert('양도 실패');
        });
      };
      row.appendChild(btn);
    }

    // tool permission UI
    if (!m.isPageTurner) {
      if (m.isToolAuthorized) {
        const badge = document.createElement('span');
        badge.className = 'participant-badge';
        badge.textContent = 'TOOL';
        row.appendChild(badge);
      } else if (m.toolRequested) {
        const badge = document.createElement('span');
        badge.className = 'participant-badge';
        badge.textContent = '요청';
        row.appendChild(badge);
      }
    }
    if (state.isPageTurner && !m.isPageTurner) {
      const toolBtn = document.createElement('button');
      toolBtn.textContent = m.isToolAuthorized ? '도구 해제' : '도구 승인';
      toolBtn.onclick = () => {
        socket.emit(
          'session:tool:grant',
          { roomCode: state.roomCode, targetSocketId: m.socketId, allow: !m.isToolAuthorized },
          (ack) => {
            if (!ack?.ok) alert('처리 실패');
          }
        );
      };
      row.appendChild(toolBtn);
    }
    list.appendChild(row);
  });
});

socket.on('viewer:cursor', (p) => {
  if (!state.isInSession) return;
  if (p?.fileId && state.fileId && String(p.fileId) !== String(state.fileId)) return;
  ensureCursorEls();
  if (p?.hide) return setCursorMarker(remoteCursorEl, { visible: false });
  setCursorMarker(remoteCursorEl, { xNorm: p?.xNorm, yNorm: p?.yNorm, visible: true });
});

socket.on('session:tool:request', (p) => {
  if (!state.isInSession) return;
  if (!state.isPageTurner) return;
  const name = p?.displayName || p?.nickname || '참여자';
  const ok = confirm(`${name}님이 도구 권한을 요청했습니다. 승인할까요?`);
  socket.emit('session:tool:grant', { roomCode: state.roomCode, targetSocketId: p?.socketId, allow: ok });
});

socket.on('session:tool:state', (p) => {
  if (!state.isInSession) return;
  if (p?.roomCode && String(p.roomCode).toUpperCase() !== String(state.roomCode || '').toUpperCase()) return;
  state.isToolAuthorized = Boolean(p?.allowed) || state.isPageTurner;
  updateTurnerToggleAccess();
  flashHud(state.isToolAuthorized ? '도구 권한 승인됨' : '도구 권한 해제됨', 1400);
});

socket.on('session:pageTurner:sync_request', (p) => {
  // MUST-3: new turner must immediately push its current page to re-sync everyone.
  if (!state.isInSession) return;
  if (state.isPageTurner) {
    socket.emit('viewer:page_change', {
      roomCode: state.roomCode,
      fileId: state.fileId,
      pageNo: state.pageNo,
      reason: 'turner_sync'
    });
    emitViewerSettings('turner_sync');
  }
});

socket.on('viewer:page_change', (p) => {
  // Only followers react.
  if (!state.isInSession) return;
  if (state.isPageTurner) return;
  if (!p?.pageNo) return;
  if (p?.fileId && p.fileId !== state.fileId) return; // file changes handled by follow:file
  state.pageNo = Number(p.pageNo);
  state.activeDrawPageNo = state.pageNo;
  updatePageLabels();
  renderSpread(state.pageNo).catch(() => {});
});

socket.on('viewer:settings', (p) => {
  if (!state.isInSession) return;
  // followers only
  if (state.isPageTurner) return;
  if (!p?.settings) return;
  if (p?.fileId && p.fileId !== state.fileId) return;
  const s = p.settings;
  if (typeof s.spreadCount === 'number') state.spreadCount = clamp(s.spreadCount, 1, 4);
  if (typeof s.fitMode === 'boolean') state.fitMode = s.fitMode;
  if (typeof s.zoom === 'number') state.zoom = clamp(s.zoom, 0.5, 3);
  if (typeof s.overlapPx === 'number') setSpreadOverlapPx(s.overlapPx);
  [1, 2, 3, 4].forEach((x) => document.getElementById(`spread${x}Btn`)?.classList.toggle('active', x === state.spreadCount));
  renderSpread(state.pageNo).catch(() => {});
});

socket.on('viewer:laser', (p) => {
  if (!state.isInSession) return;
  if (!p?.pageNo || !p?.points || !Array.isArray(p.points)) return;
  if (p?.fileId && p.fileId !== state.fileId) return;

  const pageNo = Number(p.pageNo);
  const v = viewMap.get(pageNo);
  if (!v?.fabric) return;
  const srcW = Number(p.w || v.fabric.getWidth());
  const srcH = Number(p.h || v.fabric.getHeight());
  const dstW = v.fabric.getWidth();
  const dstH = v.fabric.getHeight();
  const sx = srcW ? dstW / srcW : 1;
  const sy = srcH ? dstH / srcH : 1;
  const pts = p.points.slice(0, 240).map((pt) => ({ x: Number(pt.x) * sx, y: Number(pt.y) * sy }));
  const obj = makeLaserGroup(pts);
  v.fabric.add(obj);
  v.fabric.requestRenderAll();
  // 1초 유지 후 짧게 페이드아웃(요구사항)
  scheduleFadeOutAndRemove(v.fabric, obj, 1000, 400);
});

socket.on('session:follow:file', (p) => {
  if (!state.isInSession) return;
  const fileId = p?.fileId;
  if (!fileId) return;
  // 무한 리부팅 방지: 이미 같은 파일이면 아무것도 하지 않음
  if (String(fileId) === String(state.fileId || '')) return;

  // originalLink가 있어도 재-broadcast 되지 않도록 "추출→로컬에서 로드"만 수행
  const originalLink = String(p?.originalLink || '').trim();
  const targetId = originalLink ? extractDriveFileId(originalLink) || fileId : fileId;

  // 세션 내에서는 페이지 리로드를 하지 않고 PDF만 교체한다(중복 접속/터너 깜빡임 방지)
  state.fileId = String(targetId);
  try {
    setLastRoomForFile(state.fileId, state.roomCode);
    const nextUrl = `${window.location.origin}/viewer/${encodeURIComponent(state.fileId)}?room=${encodeURIComponent(state.roomCode)}`;
    window.history.replaceState(null, '', nextUrl);
  } catch {}

  // reset per-file state
  state.annoStore = {};
  state.undoStack = {};
  state.redoStack = {};
  try {
    els.pdfPreview.classList.add('hidden');
    els.pdfPreview.src = '';
    els.canvasStack.style.display = '';
  } catch {}

  loadPdf(state.fileId).catch(() => {});
});

// Whiteboard sync
socket.on('wb:sync', (p) => {
  if (!p?.snapshot) return;
  state.annoStore = p.snapshot || {};
  // re-render current spread overlays
  if (state.isPdfReady) renderSpread(state.pageNo).catch(() => {});
});

socket.on('wb:page:update', (p) => {
  if (!p?.pageNo || !p?.pageSnapshot) return;
  const pageNo = Number(p.pageNo);
  state.annoStore[pageNo] = p.pageSnapshot;
  if (viewMap.has(pageNo)) applySnapshotToPage(pageNo, p.pageSnapshot);
});

// ---- Init -------------------------------------------------------------------------
async function init() {
  const metaToken = await getSocketMetaToken();
  if (metaToken) {
    try {
      socket.auth = { ...(socket.auth || {}), metaToken };
      // reconnect to apply auth
      socket.disconnect();
      socket.connect();
    } catch {}
  }

  await loadMe();
  // 방문자(익명)로 /viewer 접속 시: 무조건 닉네임을 설정하도록 강제
  if (authState.role === 'viewer') {
    const nick = await ensureNicknameForVisitorAlways();
    state.nickname = nick;
    authState.displayName = nick;
    try {
      socket.auth = { ...(socket.auth || {}), nickname: nick };
      socket.disconnect();
      socket.connect();
    } catch {}
  }
  // 로그인 사용자면 displayName 우선, 아니면 닉네임(공유키) 사용
  if (!authState.displayName) authState.displayName = state.nickname || '익명';
  updateSongBookPickVisibility();

  // auto reconnect to last room:
  // 1) ?room 우선
  // 2) 없으면 동일 fileId에서 마지막으로 사용한 room
  const desiredRoom = safeRoomCode(qs('room')) || getLastRoomForFile(state.fileId);
  if (desiredRoom && !state.isInSession) {
    const nick = await ensureNickname();
    state.nickname = nick;
    socket.auth = { ...(socket.auth || {}), nickname: nick };
    joinSession(desiredRoom);
  }

  // participants panel collapse state restore
  try {
    const v = localStorage.getItem('mb_viewer_participantsCollapsed');
    setParticipantsCollapsed(v === '1');
  } catch {}


  // Personal entry without fileId: show prompt to open from link
  if (!state.fileId) {
    setHidden('pageHud', false);
    setText('pageHud', 'Drive 링크로 악보를 열어주세요');
    // focus input
    setTimeout(() => {
      document.getElementById('linkInput')?.focus();
    }, 120);
    return;
  }

  await loadPdf(state.fileId);
}

init().catch(() => {});
