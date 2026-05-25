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

function getMobileModePref() {
  const v = String(localStorage.getItem('mb_viewer_mobile_mode') || 'auto').toLowerCase();
  return v === 'on' || v === 'off' || v === 'auto' ? v : 'auto';
}

function setMobileModePref(v) {
  const vv = v === 'on' || v === 'off' || v === 'auto' ? v : 'auto';
  localStorage.setItem('mb_viewer_mobile_mode', vv);
}

function isMobileModeEnabled() {
  const pref = getMobileModePref();
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return isMobileLike();
}

function isMobileViewer() {
  try {
    // 기존 로직은 화면 크기 기준 자동이었는데, 보기옵션에서 auto/on/off로 강제할 수 있게 한다.
    return isMobileModeEnabled() && String(authState?.role || '') === 'viewer';
  } catch {
    return false;
  }
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

function setParticipantsOpen(open) {
  setHidden('participantsPanel', !open);
}

function toggleParticipantsPanel() {
  const panel = document.getElementById('participantsPanel');
  if (!panel) return;
  setParticipantsOpen(panel.classList.contains('hidden'));
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

function setCursorMarker(el, { xNorm, yNorm, visible, mode = 'line', pageNo = 0, yPageNorm = null } = {}) {
  if (!el) return;
  if (!visible) {
    el.style.display = 'none';
    return;
  }
  const m = mode === 'row' ? 'row' : 'line';
  el.classList.toggle('row', m === 'row');
  const container = document.getElementById('pdf-container');
  if (!container) return;
  const r = container.getBoundingClientRect();

  // "한줄전체" 모드는 컨테이너 전체가 아니라, 특정 페이지 안쪽에서만 가로줄이 그어져야 한다.
  if (m === 'row' && pageNo && Number.isFinite(Number(yPageNorm))) {
    const v = viewMap.get(Number(pageNo));
    if (v?.root) {
      const pr = v.root.getBoundingClientRect();
      const pad = 12;
      const width = Math.max(40, pr.width - pad * 2);
      // 페이지 내부에서만 꽉 채우기: 가운데 정렬
      el.style.width = `${Math.round(width)}px`;
      const leftPx = (pr.left - r.left) + pr.width / 2;
      const yLocal = (pr.top - r.top) + clamp(Number(yPageNorm), 0, 1) * pr.height;
      const h = clamp(r.height * 0.065, 34, 70);
      el.style.height = `${Math.round(h)}px`;
      el.style.left = `${Math.round(clamp(leftPx, 0, r.width))}px`;
      el.style.top = `${Math.round(clamp(yLocal, h / 2, Math.max(h / 2, r.height - h / 2)))}px`;
      el.style.display = 'block';
      return;
    }
  }

  // default(현재부분): 컨테이너 기준 정규화 좌표
  el.style.width = '';
  // allow both normalized coords and absolute px (relative to container)
  const xPx = Number.isFinite(Number(xNorm)) ? r.width * clamp(Number(xNorm || 0), 0, 1) : null;
  const yPx = Number.isFinite(Number(yNorm)) ? r.height * clamp(Number(yNorm || 0), 0, 1) : null;
  const x = r.left + (xPx ?? 0);
  const y = r.top + (yPx ?? 0);

  // 높이: 화면에 비례(너무 작/크지 않게)
  const h = m === 'row' ? clamp(r.height * 0.065, 34, 70) : clamp(r.height * 0.11, 40, 110);
  el.style.height = `${Math.round(h)}px`;
  // CSS에서 transform: translate(-50%, -50%)로 "중심 기준" 정렬을 하므로,
  // 여기서는 left/top에 중심 좌표를 그대로 넣는다.
  const left = clamp(x - r.left, 0, r.width);
  const top = clamp(y - r.top, h / 2, Math.max(h / 2, r.height - h / 2));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.display = 'block';
}

function findPageAtPoint(clientX, clientY) {
  const pages = getSpreadPages(state.pageNo);
  const candidates = pages.map((p) => ({ pageNo: p, view: viewMap.get(p) })).filter((x) => x.view?.root);
  if (!candidates.length) return null;

  // 1) direct hit
  for (const c of candidates) {
    const rect = c.view.root.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return { pageNo: c.pageNo, rect };
    }
  }
  // 2) choose nearest rect (distance to rect)
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const rect = c.view.root.getBoundingClientRect();
    const x = clamp(clientX, rect.left, rect.right);
    const y = clamp(clientY, rect.top, rect.bottom);
    const d = (clientX - x) ** 2 + (clientY - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { pageNo: c.pageNo, rect };
    }
  }
  return best;
}

function updateCursorShareUI() {
  const btn = document.getElementById('cursorShareBtn');
  if (!btn) return;
  const canUse = state.isInSession ? Boolean(state.isPageTurner) : false;
  btn.disabled = !canUse;
  btn.classList.toggle('disabled', !canUse);
  btn.classList.toggle('active', Boolean(state.cursorShareOn));
  document.getElementById('cursorModeGroup')?.style && (document.getElementById('cursorModeGroup').style.display = state.cursorShareOn ? 'inline-flex' : 'none');
  document.getElementById('cursorModeLineBtn')?.classList.toggle('active', state.cursorShareMode === 'line');
  document.getElementById('cursorModeRowBtn')?.classList.toggle('active', state.cursorShareMode === 'row');
  updateToolActiveUI();
}

function stopCursorShare(sendHide = false) {
  state.cursorShareOn = false;
  ensureCursorEls();
  if (localCursorEl) localCursorEl.style.display = 'none';
  if (cursorMoveHandler) {
    const c = document.getElementById('pdf-container');
    c?.removeEventListener('pointermove', cursorMoveHandler);
    c?.removeEventListener('mousemove', cursorMoveHandler);
    c?.removeEventListener('touchmove', cursorMoveHandler);
  }
  cursorMoveHandler = null;
  updateCursorShareUI();
  updateToolActiveUI();
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
  updateToolActiveUI();

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
    const t = e.touches && e.touches[0] ? e.touches[0] : null;
    clientX = t ? t.clientX : e.clientX;
    clientY = t ? t.clientY : e.clientY;

    const hit = findPageAtPoint(clientX, clientY);
    if (!hit?.rect) return;
    const rect = hit.rect;
    const pageNo = hit.pageNo;
    const xPageNorm = rect.width ? (clientX - rect.left) / rect.width : 0;
    const yPageNorm = rect.height ? (clientY - rect.top) / rect.height : 0;

    // local marker placement uses container-local px
    const xLocal = (rect.left - r.left) + clamp(xPageNorm, 0, 1) * rect.width;
    const yLocal = (rect.top - r.top) + clamp(yPageNorm, 0, 1) * rect.height;
    const xNorm = r.width ? xLocal / r.width : 0;
    const yNorm = r.height ? yLocal / r.height : 0;

    const mode = state.cursorShareMode || 'line';
    setCursorMarker(localCursorEl, { xNorm, yNorm, visible: true, mode, pageNo, yPageNorm });
    socket.emit('viewer:cursor', { roomCode: state.roomCode, fileId: state.fileId, pageNo, xPageNorm, yPageNorm, mode });
  };

  container.addEventListener('pointermove', cursorMoveHandler, { passive: true });
  // fallback
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
  // mode: 'pdf' | 'chord'
  mode: 'pdf',
  pdfFileId: null,
  chordDocId: '',
  chordSourceUrl: '',
  chordBlocks: null,
  chordPendingAuthUrl: '',
  pageNo: 1,
  totalPages: 1,
  roomCode: null,
  isInSession: false,
  isPageTurner: false,
  isToolAuthorized: false,
  cursorShareOn: false,
  cursorShareMode: String(localStorage.getItem('mb_viewer_cursorMode') || 'line') === 'row' ? 'row' : 'line',
  nickname: getOrCreateNickname(),
  overlapPx: 0,

  pdfDoc: null,
  pdfScale: 1,
  isPdfReady: false,
  // preview slice mode: iframe(임베드) + transform으로 "페이지처럼" 보여주기(보기 전용)
  previewMode: false,

  // pageNo -> { json, w, h }
  annoStore: {},
  // pageNo -> undo stack: [{json,w,h}]
  undoStack: {},
  // pageNo -> redo stack: [{json,w,h}]
  redoStack: {},
  tool: 'pen',
  shape: null, // 'line'|'rect'|'circle' (when tool==='shape')
  brushSize: 3,
  brushColor: '#ff2d55',
  textFontSize: 22,

  // view modes
  spreadCount: 2, // 1~4 (기본 2p)
  fitMode: true,
  zoom: 1,
  // pan in zoomed view (normalized 0..1, applied after renderSpread)
  panX: 0,
  panY: 0,
  _panMaxX: 0,
  _panMaxY: 0,
  _contentW: 0,
  _contentH: 0,
  locked: false,
  activeDrawPageNo: 1
};

state.pdfFileId = state.fileId;


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
  // 링크/보기/도구 UI 토글은 세션 권한과 무관하게 사용 가능(주석 공유만 권한 필요)
}

function updateSongBookPickVisibility() {
  const btn = document.getElementById('songBookPickBtn');
  if (!btn) return;
  const isMember = authState.role === 'admin' || authState.role === 'session';
  // 로그인 환경이면(세션 참여 여부와 무관하게) 노래책에서 고르기 노출
  btn.classList.toggle('hidden', !isMember);
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
    // 모바일에서는 기본으로 패널을 접어둠(필요 시 '세션목록' 버튼으로 열기)
    if (isMobileLike()) setHidden('participantsPanel', true);
    // 세션의 최신 상태(현재 악보/페이지)를 재요청해서 동기화 보장
    socket.emit('session:participants:refresh', { roomCode: state.roomCode });
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
  document.getElementById('sessionFloatBtn').textContent = '세션참여';
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

// 검색용 정규화: 소문자 + 공백 제거(띄어쓰기 유무 무시)
function normSearch(s) {
  return normLower(s).replace(/\s+/g, '');
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
    _searchNorm: normSearch(c.searchText || ''),
    _titleNorm: normSearch(c.title || ''),
    _artistNorm: normSearch(c.artist || '')
  }));
  document.getElementById('songPickHint').textContent = `총 ${songCardsCache.length}곡 · 검색해서 선택`;
}

function pickCardMatches(q) {
  const qq = normSearch(String(q || '').trim());
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

// ---- Mode (PDF / CodeWiki) -------------------------------------------------------
const VIEWER_BUILD = '20260520_07';

function hashString(s) {
  const str = String(s || '');
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function setCwError(msg) {
  const el = document.getElementById('cwError');
  if (el) el.textContent = String(msg || '');
}

function setCwMeta(msg) {
  const el = document.getElementById('cwMeta');
  if (el) el.textContent = String(msg || '');
}

function handleIncomingRawChord(rawText, sourceUrl, via = '') {
  const text = String(rawText || '');
  const su = String(sourceUrl || '');
  if (!text.trim()) return;

  setMode('chord');
  document.getElementById('cwRawInput')?.classList.remove('hidden');
  document.getElementById('cwParseRawBtn')?.classList.remove('hidden');
  const ta = document.getElementById('cwRawInput');
  if (ta) ta.value = text;
  state.chordSourceUrl = su;
  setCwMeta(`소스: ${via || 'external'}\n원문 URL: ${su}\n(원문이 입력창에 채워졌습니다)`);

  // 사용자가 원하면 자동 파싱
  if (confirm('코드위키 원문을 받았습니다. 지금 바로 파싱할까요?')) {
    openChordByRawText(text, su).catch(() => {});
  }
}

function decodeB64Unicode(b64) {
  const s = String(b64 || '');
  // eslint-disable-next-line no-undef
  const bin = atob(s);
  // eslint-disable-next-line no-undef
  return decodeURIComponent(
    Array.prototype.map
      .call(bin, (c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
      .join('')
  );
}

function consumeWindowNamePayload() {
  try {
    const n = String(window.name || '');
    const prefix = 'MB_RAW_CHORD_V1|';
    if (!n.startsWith(prefix)) return;
    const payload = JSON.parse(decodeB64Unicode(n.slice(prefix.length)));
    window.name = '';
    handleIncomingRawChord(payload?.rawText, payload?.sourceUrl, 'bookmarklet(window.name)');
  } catch {}
}

function buildCodewikiBookmarklet() {
  // NOTE: bookmarklet는 사용자의 브라우저(코드위키 탭)에서 실행되어,
  //       본문 텍스트를 추출한 뒤 우리 뷰어 창으로 postMessage로 전달한다.
  const target = `${window.location.origin}/viewer?mode=chord`;
  const targetOrigin = window.location.origin;
  const js = `(()=>{try{
const pick=(s)=>String(s||'').trimEnd();
let t='';
const pre=document.querySelector('pre'); if(pre) t=pick(pre.innerText||pre.textContent);
if(!t){ const ta=document.querySelector('textarea'); if(ta) t=pick(ta.value||ta.textContent); }
if(!t){ const mains=[...document.querySelectorAll('main,article,#content,#main')]; for(const m of mains){ const x=pick(m.innerText||m.textContent); if(x&&x.length>t.length) t=x; } }
if(!t){ t=pick(document.body&& (document.body.innerText||document.body.textContent)); }
if(!t){ alert('본문 텍스트를 찾지 못했습니다.'); return; }
const url='${target}';
const w=window.open(url,'_blank');
if(!w){ alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
const msg={type:'MB_RAW_CHORD_V1', rawText:t, sourceUrl:location.href};
// window.name fallback (postMessage 수신 타이밍/차단 이슈 대비)
const b64=(str)=>btoa(unescape(encodeURIComponent(str)));
try{ w.name='MB_RAW_CHORD_V1|'+b64(JSON.stringify(msg)); }catch(e){}
const send=()=>{ try{ w.postMessage(msg,'${targetOrigin}'); }catch(e){} };
const it=setInterval(()=>{ if(!w||w.closed){ clearInterval(it); return; } send(); }, 350);
setTimeout(()=>clearInterval(it), 20000);
alert('뷰어로 전송했습니다. 뷰어 창에서 파싱을 진행하세요.');
}catch(e){ alert('실패: '+(e&&e.message?e.message:e)); }})();`;
  // eslint-disable-next-line no-useless-escape
  return `javascript:${js.replace(/\n/g, '').replace(/\s+/g, ' ')}`;
}

// cross-origin postMessage로 원문 전달 받기(북마클릿/유저 참여형)
window.addEventListener('message', (ev) => {
  const d = ev?.data;
  if (!d || typeof d !== 'object') return;
  if (d.type !== 'MB_RAW_CHORD_V1') return;
  const rawText = String(d.rawText || '');
  const sourceUrl = String(d.sourceUrl || '');
  handleIncomingRawChord(rawText, sourceUrl, 'bookmarklet(postMessage)');
});

function showChordAuthActions(show) {
  const on = Boolean(show) && state.mode === 'chord';
  document.getElementById('cwAuthOpenBtn')?.classList.toggle('hidden', !on);
  document.getElementById('cwAuthDoneBtn')?.classList.toggle('hidden', !on);
}

function openAuthPopup(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  // 팝업 차단 최소화를 위해 feature를 단순화한다(사용자 클릭에서만 호출됨)
  const w = window.open(u, '_blank');
  if (!w) {
    setCwError('팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 “인증창 열기”를 눌러주세요.');
    return null;
  }
  try {
    w.focus();
  } catch {}
  return w;
}

function needsUserAuthForError(err) {
  const e = String(err || '');
  // 서버가 bot 페이지를 탐지했거나,
  // upstream이 403을 반환한 경우(대부분 bot/verification)도 유저 인증 흐름으로 보낸다.
  if (e.includes('BOT_PROTECTION')) return true;
  if (e === 'FETCH_FAILED_403' || e.endsWith('_403')) return true;
  // extractor가 실패한 경우도 "수동 인증/원문 붙여넣기" 유도
  if (e === 'EXTRACT_FAILED') return true;
  if (e === 'PUPPETEER_FAILED') return true;
  return false;
}

// 코드위키 모드(ChordWiki view)는 당분간 비활성화한다(서버 크롤링 안정화 전까지 숨김).
const ENABLE_CHORDWIKI_MODE = false;

function setMode(mode) {
  if (!ENABLE_CHORDWIKI_MODE) mode = 'pdf';
  state.mode = mode;
  document.getElementById('pdfModeBtn')?.classList.toggle('active', mode === 'pdf');
  document.getElementById('chordModeBtn')?.classList.toggle('active', mode === 'chord');

  setHidden('pdf-container', mode !== 'pdf');
  setHidden('chordwikiPane', mode !== 'chord');

  if (mode === 'pdf') {
    document.getElementById('linkInput')?.setAttribute('placeholder', '구글드라이브 PDF 링크 또는 fileId');
    // chord 전용 UI 숨김
    showChordAuthActions(false);
    state.chordPendingAuthUrl = '';
    setCwMeta('');
    // 인증 팝업이 남아있으면 정리
    try {
      if (state._authPopup && !state._authPopup.closed) state._authPopup.close();
    } catch {}
    state._authPopup = null;
    // restore pdf fileId for viewer internals
    if (state.pdfFileId) {
      state.fileId = state.pdfFileId;
      loadPdf(state.fileId).catch(() => {});
    }
  } else {
    document.getElementById('linkInput')?.setAttribute('placeholder', '코드위키 URL(또는 아래에 원문 붙여넣기)');
    // if previously opened chord doc, keep it
    if (state.chordDocId) state.fileId = state.chordDocId;
    // chord 모드 진입 시 스크롤 우선(선택 도구)
    if (state.tool !== 'select') setTool('select');
    // 디버그: 어떤 빌드의 viewer.js가 로드되었는지 항상 표시
    setCwMeta(`뷰어 빌드: ${VIEWER_BUILD}`);
  }

  const cwHost = document.getElementById('cwAnnoHost');
  if (cwHost) cwHost.style.pointerEvents = state.mode === 'chord' && state.tool === 'select' ? 'none' : 'auto';
}

document.getElementById('pdfModeBtn')?.addEventListener('click', () => setMode('pdf'));
document.getElementById('chordModeBtn')?.addEventListener('click', () => setMode('chord'));

document.getElementById('cwPasteToggleBtn')?.addEventListener('click', () => {
  const raw = document.getElementById('cwRawInput');
  const btn = document.getElementById('cwParseRawBtn');
  const nowHidden = raw?.classList.toggle('hidden');
  btn?.classList.toggle('hidden', Boolean(nowHidden));
});

document.getElementById('cwBookmarkletBtn')?.addEventListener('click', () => {
  setMode('chord');
  const code = buildCodewikiBookmarklet();
  prompt(
    '코드위키 자동 가져오기(북마클릿)입니다.\n' +
      '1) 아래 전체를 복사\n' +
      '2) 브라우저 북마크바에 새 북마크를 만들고 URL에 붙여넣기\n' +
      '3) 코드위키 페이지에서 그 북마크를 클릭하면, 원문이 이 뷰어로 전송됩니다.\n\n' +
      '(참고: 서버가 403(Cloudflare)로 막히는 경우를 위한 “유저 참여형” 방식입니다.)',
    code
  );
});

document.getElementById('cwAuthOpenBtn')?.addEventListener('click', () => {
  if (!state.chordPendingAuthUrl) return;
  // 기존에 열어둔 창이 있으면 그 창을 사용
  try {
    if (state._authPopup && !state._authPopup.closed) {
      state._authPopup.location.replace(state.chordPendingAuthUrl);
      state._authPopup.focus();
      return;
    }
  } catch {}
  state._authPopup = openAuthPopup(state.chordPendingAuthUrl);
});
document.getElementById('cwAuthDoneBtn')?.addEventListener('click', () => {
  if (!state.chordPendingAuthUrl) return;
  // 사용자가 새창에서 인증을 완료했다고 가정하고 동일 URL 재시도
  openChordByUrl(state.chordPendingAuthUrl, { preopenAuth: true, broadcast: true }).catch(() => {});
});

function renderChordBlocks(blocks) {
  const wrap = document.getElementById('cwContent');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!Array.isArray(blocks) || !blocks.length) {
    setCwError('파싱 결과가 비었습니다.');
    return;
  }
  setCwError('');

  let line = document.createElement('div');
  line.className = 'chord-line';
  wrap.appendChild(line);

  for (const b of blocks) {
    if (b?.lyric_raw === '\n') {
      line = document.createElement('div');
      line.className = 'chord-line';
      wrap.appendChild(line);
      continue;
    }
    const cell = document.createElement('div');
    cell.className = 'chord-lyric-cell';

    const chordEl = document.createElement('div');
    chordEl.className = 'cwChord';
    chordEl.textContent = String(b?.chord || '');

    const lyricEl = document.createElement('div');
    lyricEl.className = 'cwLyric';
    lyricEl.textContent = String(b?.lyric_kr ?? b?.lyric_raw ?? '');

    cell.appendChild(chordEl);
    cell.appendChild(lyricEl);
    line.appendChild(cell);
  }

  // Phase2-4: chord mode annotation layer (Fabric) - 1 page canvas matching scrollHeight
  setupChordAnnoAfterRender();
}

function setupChordAnnoAfterRender() {
  const host = document.getElementById('cwAnnoHost');
  const inner = document.getElementById('cwInner');
  if (!host || !inner) return;

  // chord mode에서는 "단일 페이지(1)"로 취급
  state.totalPages = 1;
  state.pageNo = 1;
  state.activeDrawPageNo = 1;

  // recreate a single view (pageNo=1) using existing Fabric/undo/broadcast wiring
  clearViews();
  const v = makeView(1);

  // move the view root into cw overlay host
  try {
    v.root.parentElement?.removeChild?.(v.root);
  } catch {}
  host.innerHTML = '';
  host.appendChild(v.root);

  // styling: cover whole chord sheet area
  v.root.style.position = 'absolute';
  v.root.style.inset = '0';
  v.root.style.margin = '0';
  v.root.style.padding = '0';
  v.root.style.background = 'transparent';
  v.pdfCanvas.style.display = 'none';

  // set canvas size to scrollable content size
  const w = Math.max(200, inner.scrollWidth);
  const h = Math.max(200, inner.scrollHeight);
  v.root.style.width = `${w}px`;
  v.root.style.height = `${h}px`;
  v.annoCanvas.width = w;
  v.annoCanvas.height = h;
  try {
    v.fabric.setWidth(w);
    v.fabric.setHeight(h);
    v.fabric.calcOffset();
  } catch {}

  // restore snapshot if exists (compat with existing store)
  const saved = state.annoStore?.[1] || state.annoStore?.['1'];
  if (saved) applySnapshotToPage(1, saved);
  else applySnapshotToPage(1, { json: { objects: [] }, w, h });
}

const resizeChordAnnoDebounced = debounce(() => {
  if (state.mode !== 'chord') return;
  // re-run sizing only (keep existing view)
  const v = viewMap.get(1);
  const inner = document.getElementById('cwInner');
  if (!v?.fabric || !inner) return;
  const w = Math.max(200, inner.scrollWidth);
  const h = Math.max(200, inner.scrollHeight);
  v.root.style.width = `${w}px`;
  v.root.style.height = `${h}px`;
  v.annoCanvas.width = w;
  v.annoCanvas.height = h;
  v.fabric.setWidth(w);
  v.fabric.setHeight(h);
  v.fabric.calcOffset();
  v.fabric.requestRenderAll();
}, 200);
window.addEventListener('resize', () => resizeChordAnnoDebounced());

async function openChordByUrl(url, { broadcast, preopenAuth } = { broadcast: true, preopenAuth: false }) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return alert('코드위키 모드는 URL이 필요합니다.');

  setMode('chord');
  setCwError('불러오는 중...');
  setCwMeta('');
  showChordAuthActions(false);
  state.chordPendingAuthUrl = '';

  // 팝업은 사용자 제스처(클릭) 호출 스택에서만 허용되는 경우가 많아서,
  // 필요할지도 모르는 상황(403) 대비로 "빈 새창"을 먼저 열어둔 뒤,
  // 실패 시 그 창을 URL로 이동시키는 방식으로 자동화한다.
  let preWin = null;
  if (preopenAuth) {
    try {
      // user gesture stack에서 about:blank를 먼저 열어두면, 이후 403에서도 URL 이동이 가능해진다.
      preWin = window.open('about:blank', '_blank');
      if (preWin) state._authPopup = preWin;
    } catch {
      preWin = null;
    }
  }

  let r;
  try {
    r = await fetch(`/api/proxy-chord?url=${encodeURIComponent(u)}`).then((x) => x.json());
  } catch (e) {
    r = { ok: false, error: `NETWORK_ERROR: ${String(e?.message || e)}` };
  }
  if (!r.ok) {
    setCwError(`불러오기 실패: ${r.error || ''}`);
    if (needsUserAuthForError(r.error)) {
      state.chordPendingAuthUrl = u;
      showChordAuthActions(true);
      if (String(r.error || '') === 'EXTRACT_FAILED') {
        setCwError('본문 추출에 실패했습니다. 새창에서 확인 후(필요 시 인증), 원문 붙여넣기로 진행하세요.');
        try {
          if (r.detail) setCwMeta(`추출 실패 상세: ${JSON.stringify(r.detail)}`);
        } catch {}
      } else if (String(r.error || '') === 'PUPPETEER_FAILED') {
        setCwError('서버의 브라우저 엔진(Puppeteer) 수집이 실패했습니다. 원문 붙여넣기로 진행하거나, 아래 상세 에러를 확인하세요.');
        try {
          if (r.detail) setCwMeta(`Puppeteer 실패 상세: ${JSON.stringify(r.detail)}`);
        } catch {}
      } else {
        // NOTE: 서버에서 뜬 403은 "사용자 브라우저 인증"과 별개로,
        //       서버 IP/데이터센터 차단 등으로 계속 403이 날 수 있다.
        setCwError('보안 검증(403)이 감지되었습니다. 새창에서 확인 후 “인증 완료(재시도)”를 눌러보세요. 계속 실패하면 서버 IP 차단일 수 있어 원문 붙여넣기를 사용하세요.');
        try {
          if (r.detail) setCwMeta(`실패 상세: ${JSON.stringify(r.detail)}`);
        } catch {}
      }
      document.getElementById('cwRawInput')?.classList.remove('hidden');
      document.getElementById('cwParseRawBtn')?.classList.remove('hidden');

      // 자동 새창 활성화(가능한 경우)
      if (preWin && !preWin.closed) {
        try {
          preWin.focus();
        } catch {}
        try {
          preWin.location.replace(u);
        } catch (e) {
          // 일부 브라우저는 비동기 콜백에서의 리다이렉트를 차단할 수 있음.
          // 이 경우, 팝업 내에 사용자가 직접 누를 수 있는 링크를 그려준다.
          try {
            preWin.document.open();
            preWin.document.write(
              `<meta charset="utf-8" />` +
                `<title>인증 필요</title>` +
                `<div style="font-family:system-ui; padding:18px; line-height:1.5">` +
                `<h3 style="margin:0 0 10px 0">인증이 필요합니다</h3>` +
                `<p style="margin:0 0 12px 0">아래 버튼을 눌러 인증 페이지를 열어주세요.</p>` +
                `<a href="${u.replace(/\"/g, '&quot;')}" style="display:inline-block; padding:10px 12px; border:1px solid #999; border-radius:10px; text-decoration:none;">인증 페이지 열기</a>` +
                `</div>`
            );
            preWin.document.close();
          } catch {}
        }
      }
    } else if (preWin && !preWin.closed) {
      try {
        preWin.close();
      } catch {}
    }
    return;
  }
  if (preWin && !preWin.closed) {
    try {
      preWin.close();
    } catch {}
  }

  const docId = `chord:${hashString(u)}`;
  state.chordDocId = docId;
  state.chordSourceUrl = u;
  state.chordBlocks = r.blocks || [];

  // Debug meta (fetch vs puppeteer)
  try {
    const src = String(r?.meta?.source || '');
    const fu = String(r?.meta?.finalUrl || '');
    const cached = r?.cached ? ' (cached)' : '';
    setCwMeta(src ? `소스: ${src}${cached}\n최종 URL: ${fu}` : '');
  } catch {}

  // session/snapshot layer uses state.fileId. chord 모드에서는 docId를 fileId로 사용.
  state.fileId = docId;
  // reset per-doc state
  state.annoStore = {};
  state.undoStack = {};
  state.redoStack = {};
  if (state.isInSession && state.roomCode) socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId: state.fileId });

  if (broadcast && state.isInSession && state.isPageTurner && state.roomCode) {
    socket.emit('session:follow:file', { roomCode: state.roomCode, fileId: docId, originalLink: u }, () => {});
  }

  renderChordBlocks(state.chordBlocks);
}

async function openChordByRawText(rawText, sourceUrl = '', { broadcast } = { broadcast: true }) {
  setMode('chord');
  const text = String(rawText || '');
  if (!text.trim()) return alert('원문이 비었습니다.');
  setCwError('파싱 중...');
  setCwMeta('');
  showChordAuthActions(false);
  state.chordPendingAuthUrl = '';

  const payload = { rawText: text };
  const su = String(sourceUrl || '').trim();
  if (/^https?:\/\//i.test(su)) payload.sourceUrl = su;

  const r = await fetch('/api/proxy-chord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then((x) => x.json());
  if (!r.ok) return setCwError(`파싱 실패: ${r.error || ''}`);

  try {
    const src = String(r?.meta?.source || 'clientRawText');
    setCwMeta(`소스: ${src}`);
  } catch {}

  const docId = `chord:${hashString(sourceUrl || text.slice(0, 5000))}`;
  state.chordDocId = docId;
  state.chordSourceUrl = sourceUrl;
  state.chordBlocks = r.blocks || [];
  state.fileId = docId;
  state.annoStore = {};
  state.undoStack = {};
  state.redoStack = {};
  if (state.isInSession && state.roomCode) socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId: state.fileId });

  if (broadcast && state.isInSession && state.isPageTurner && state.roomCode) {
    socket.emit('session:follow:file', { roomCode: state.roomCode, fileId: docId, originalLink: sourceUrl }, () => {});
  }
  setCwError('');
  renderChordBlocks(state.chordBlocks);
}

document.getElementById('cwParseRawBtn')?.addEventListener('click', () => {
  const t = document.getElementById('cwRawInput')?.value || '';
  openChordByRawText(t, state.chordSourceUrl).catch(() => {});
});

// ---- CodeWiki scroll sync (Phase2-3) ---------------------------------------------
const cwScrollEl = document.getElementById('cwScroll');
function getScrollRatio(el) {
  const max = Math.max(1, el.scrollHeight - el.clientHeight);
  return Math.max(0, Math.min(1, el.scrollTop / max));
}
function setScrollRatio(el, ratio, smooth = true) {
  const max = Math.max(1, el.scrollHeight - el.clientHeight);
  const top = Math.max(0, Math.min(max, ratio * max));
  el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

const emitScrollSync = debounce(() => {
  if (!cwScrollEl) return;
  if (!state.isInSession || !state.isPageTurner) return;
  if (state.mode !== 'chord') return;
  if (!state.roomCode || !state.fileId) return;
  socket.emit('session:scroll:sync', { roomCode: state.roomCode, fileId: state.fileId, ratio: getScrollRatio(cwScrollEl) }, () => {});
}, 80);

cwScrollEl?.addEventListener('scroll', () => {
  if (state.mode !== 'chord') return;
  // 페이지터너만 브로드캐스트
  if (state.isInSession && state.isPageTurner) emitScrollSync();
});

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

// touch-mode (auto only; desktop toggle removed)
function applyTouchModeAuto(on) {
  document.body.classList.toggle('touch-mode', Boolean(on));
}

function applyMobileModeButtons() {
  const pref = getMobileModePref();
  document.getElementById('mobileAutoBtn')?.classList.toggle('active', pref === 'auto');
  document.getElementById('mobileOnBtn')?.classList.toggle('active', pref === 'on');
  document.getElementById('mobileOffBtn')?.classList.toggle('active', pref === 'off');
}

document.getElementById('mobileAutoBtn')?.addEventListener('click', () => {
  setMobileModePref('auto');
  applyMobileModeButtons();
  updateLiveMode();
});
document.getElementById('mobileOnBtn')?.addEventListener('click', () => {
  setMobileModePref('on');
  applyMobileModeButtons();
  updateLiveMode();
});
document.getElementById('mobileOffBtn')?.addEventListener('click', () => {
  setMobileModePref('off');
  applyMobileModeButtons();
  updateLiveMode();
});

document.getElementById('participantsToggleBtn')?.addEventListener('click', () => setParticipantsOpen(false));
document.getElementById('participantsBtn')?.addEventListener('click', () => toggleParticipantsPanel());
document.getElementById('touchMenuBtn')?.addEventListener('click', () => toggleParticipantsPanel());

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

// (prev/next 버튼 제거: 키/터치/스와이프로 넘김)

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
  const trimmed = String(input || '').trim();
  // chordwiki mode: URL은 proxy로 처리
  if (!extractDriveFileId(trimmed) && /^https?:\/\//i.test(trimmed)) {
    return openChordByUrl(trimmed).catch(() => {});
  }

  const fileId = extractDriveFileId(trimmed);
  if (!fileId) return alert('fileId를 추출하지 못했습니다. Drive 링크 또는 fileId를 확인해 주세요.');
  // 이미 같은 파일을 보고 있으면 다시 네비게이션하지 않음(무한 루프/리프레시 방지)
  if (state.fileId && String(fileId) === String(state.fileId)) return;

  const roomCode = state.roomCode;
  if (state.isInSession && state.isPageTurner && roomCode) {
    const originalLink = String(input || '').trim();
    const isUrl = /^https?:\/\//i.test(trimmed);

    const applyLocal = (nextFileId) => {
      // local apply (no full reload)
      setMode('pdf');
      state.fileId = String(nextFileId);
      state.pdfFileId = String(nextFileId);
      try {
        setLastRoomForFile(state.fileId, roomCode);
        window.history.replaceState(
          null,
          '',
          `${window.location.origin}/viewer/${encodeURIComponent(state.fileId)}?room=${encodeURIComponent(roomCode)}`
        );
      } catch {}
      state.annoStore = {};
      state.undoStack = {};
      state.redoStack = {};
      loadPdf(state.fileId).catch(() => {});
    };

    const broadcast = (nextFileId) => {
      socket.emit('session:follow:file', { roomCode, fileId: nextFileId, originalLink }, (ack) => {
        if (!ack?.ok) alert('세션 곡 전환 브로드캐스트 실패(권한 확인)');
      });
    };

    // 외부 Drive URL이면 먼저 서버로 가져오기(import) 시도 -> 가져온 fileId를 공유
    if (isUrl) {
      setHidden('pageHud', false);
      setText('pageHud', '외부 악보 가져오는 중...');
      fetch('/api/drive/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: originalLink })
      })
        .then((r) => r.json())
        .then((r) => {
          if (!r?.ok || !r?.imported?.googleFileId) throw new Error(r?.error || 'IMPORT_FAILED');
          const nextId = String(r.imported.googleFileId);
          broadcast(nextId);
          applyLocal(nextId);
        })
        .catch(() => {
          // import 실패 시 기존 fileId로 fallback
          broadcast(fileId);
          applyLocal(fileId);
        });
      return;
    }

    broadcast(fileId);
    applyLocal(fileId);
  } else {
    const roomParam = state.isInSession && roomCode ? `?room=${roomCode}` : '';
    window.location.href = `${window.location.origin}/viewer/${fileId}${roomParam}`;
  }
}

// New: inline open input (GAS style)
document.getElementById('openBtn')?.addEventListener('click', () => {
  const input = document.getElementById('linkInput')?.value || '';
  if (state.mode === 'chord') return openChordByUrl(input, { preopenAuth: true }).catch(() => {});
  openByInput(input);
});
document.getElementById('linkInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('openBtn')?.click();
});

// ---- Key bindings (키보드 + MIDI) ---------------------------------------------------
const DEFAULT_NEXT_KEYS = ['ArrowRight', 'PageDown', ' ']; // Space는 e.key === ' '
const DEFAULT_PREV_KEYS = ['ArrowLeft', 'PageUp'];
const KEY_STORAGE = { next: 'mb_viewer_key_next', prev: 'mb_viewer_key_prev' };
let captureKeyMode = null; // 'next' | 'prev'

function formatBindToken(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  if (t === ' ') return 'Space';
  if (t.startsWith('MIDI:note:')) return `MIDI Note ${t.split(':')[2]}`;
  if (t.startsWith('MIDI:cc:')) return `MIDI CC ${t.split(':')[2]}`;
  return t;
}

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
  setText('bindPrevLabel', keys.prev.map((k) => formatBindToken(k)).join('/'));
  setText('bindNextLabel', keys.next.map((k) => formatBindToken(k)).join('/'));
}
setBindLabels();

document.getElementById('bindPrevBtn')?.addEventListener('click', () => {
  captureKeyMode = 'prev';
  setHidden('pageHud', false);
  setText('pageHud', '이전 입력(키 또는 MIDI)을 누르세요(ESC 취소)');
});
document.getElementById('bindNextBtn')?.addEventListener('click', () => {
  captureKeyMode = 'next';
  setHidden('pageHud', false);
  setText('pageHud', '다음 입력(키 또는 MIDI)을 누르세요(ESC 취소)');
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
  // 텍스트 편집 중에는 page-turn 단축키를 먹지 않는다(특히 Space).
  if (isAnyTextEditing()) return;
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
    changePage(state.pageNo + pageTurnStep(), 'kbd');
    updateUrlState();
  }
  if (prev.includes(e.key)) {
    changePage(state.pageNo - pageTurnStep(), 'kbd');
    updateUrlState();
  }
});

// MIDI mapping (optional): map note/CC to prev/next.
let midiAccess = null;
function midiTokenFromMsg(data) {
  if (!data || data.length < 2) return '';
  const status = data[0] & 0xf0;
  const d1 = data[1];
  const d2 = data[2] ?? 0;
  // Note on (velocity > 0)
  if (status === 0x90 && d2 > 0) return `MIDI:note:${d1}`;
  // Control change (value > 0)
  if (status === 0xb0 && d2 > 0) return `MIDI:cc:${d1}`;
  return '';
}
function attachMidiInputs(access) {
  if (!access?.inputs) return;
  for (const input of access.inputs.values()) {
    input.onmidimessage = (ev) => {
      const token = midiTokenFromMsg(ev?.data);
      if (!token) return;
      if (captureKeyMode) {
        saveBoundKey(captureKeyMode, token);
        captureKeyMode = null;
        setBindLabels();
        setHidden('pageHud', false);
        setText('pageHud', '저장됨');
        return;
      }
      const { prev, next } = loadBoundKeys();
      if (next.includes(token)) {
        changePage(state.pageNo + pageTurnStep(), 'midi');
        updateUrlState();
      }
      if (prev.includes(token)) {
        changePage(state.pageNo - pageTurnStep(), 'midi');
        updateUrlState();
      }
    };
  }
}
async function initMidi() {
  try {
    if (!navigator?.requestMIDIAccess) return;
    midiAccess = await navigator.requestMIDIAccess();
    attachMidiInputs(midiAccess);
    midiAccess.onstatechange = () => attachMidiInputs(midiAccess);
  } catch {}
}
initMidi();

// touch bottom buttons (원본)
let touchNavTimer = null;
function bumpTouchNav() {
  const nav = document.getElementById('touchNavBottom');
  if (!nav) return;
  nav.classList.add('navActive');
  clearTimeout(touchNavTimer);
  touchNavTimer = setTimeout(() => nav.classList.remove('navActive'), 2000);
}

document.getElementById('touchPrevBtn')?.addEventListener('click', () => {
  bumpTouchNav();
  changePage(state.pageNo - pageTurnStep(), 'touch');
  updateUrlState();
});
document.getElementById('touchNextBtn')?.addEventListener('click', () => {
  bumpTouchNav();
  changePage(state.pageNo + pageTurnStep(), 'touch');
  updateUrlState();
});
document.getElementById('touchMenuBtn')?.addEventListener('click', () => bumpTouchNav());

document.getElementById('touchNavBottom')?.addEventListener('click', (e) => {
  if (e.target?.id !== 'touchMenuBtn') return;
  toggleSessionPanel(e);
});

// Tap zones: 모바일 UX 혼선/도구 충돌 방지를 위해 비활성(하단 화살표 사용)

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
  // 새 페이지로 갈 때 팬은 초기화
  state.panX = 0;
  state.panY = 0;
  updatePageLabels();
  renderSpread(pageNo).catch(() => {});
  updateUrlState();

  // Only pageTurner broadcasts page change (requirement).
  if (state.isInSession && state.isPageTurner) {
    socket.emit('viewer:page_change', { roomCode: state.roomCode, fileId: state.fileId, pageNo }, () => {});
  }
}

let lastAutoFollowAt = 0;
async function followToPage(pageNo, reason = '') {
  if (!state.isPdfReady) return;
  const now = Date.now();
  if (now - lastAutoFollowAt < 450) return;
  lastAutoFollowAt = now;

  const next = Math.max(1, Math.min(state.totalPages, Number(pageNo) || 1));
  state.pageNo = next;
  state.activeDrawPageNo = next;
  updatePageLabels();
  await renderSpread(next);
  updateUrlState();
  if (reason) flashHud(`활성페이지 이동`, 700);
}

function pageTurnStep() {
  // 사용자 설정: 한번에(스프레드 단위) / 한페이지씩
  return state.turnUnit === 'spread' ? Math.max(1, Number(state.spreadCount) || 1) : 1;
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

function clamp01(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function applyPanTransform() {
  const contW = Math.max(1, els.pdfContainer.clientWidth || 1);
  const contH = Math.max(1, els.pdfContainer.clientHeight || 1);
  const maxX = Math.max(0, Number(state._contentW || 0) - contW);
  const maxY = Math.max(0, Number(state._contentH || 0) - contH);
  state._panMaxX = maxX;
  state._panMaxY = maxY;

  state.panX = clamp01(state.panX);
  state.panY = clamp01(state.panY);

  // fit 모드에서는 항상 가운데로(팬 없음)
  if (state.fitMode || (!maxX && !maxY)) {
    els.canvasStack.style.transform = '';
    els.canvasStack.style.justifyContent = 'center';
    els.canvasStack.style.alignItems = 'center';
    state.panX = 0;
    state.panY = 0;
    return;
  }

  const tx = -Math.round(maxX * state.panX);
  const ty = -Math.round(maxY * state.panY);
  // Guard against NaN/Infinity which can "blank out" the whole stage.
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
    els.canvasStack.style.transform = '';
    els.canvasStack.style.justifyContent = 'center';
    els.canvasStack.style.alignItems = 'center';
    state.panX = 0;
    state.panY = 0;
    return;
  }
  els.canvasStack.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
  els.canvasStack.style.justifyContent = 'flex-start';
  els.canvasStack.style.alignItems = 'flex-start';
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

// ---- Preview slice mode (iframe) --------------------------------------------------
// GAS식 "iframe을 크게 띄우고 clip+transform으로 페이지처럼 보이게" 하는 보기 전용 모드.
// NOTE: 실제 PDF 페이지를 파싱/렌더하지 않으므로, 페이지 수는 알 수 없어 9999로 가정한다.
const PREVIEW_A4 = 1.41421356237;
const PREVIEW_OVERLAP_Y_PX = 30; // 위/아래 겹침(연속 스크롤 느낌)
const PREVIEW_STEP_ADJUST_PX = 0;
const PREVIEW_SCALE = 1.02;
const PREVIEW_X_OFFSET_PX = 0;
const PREVIEW_Y_OFFSET_PX = 0;
const PREVIEW_IFRAME_H_PX = 220000; // 크게 잡아야 "아래 페이지"가 보임(스크롤 대신 viewport 확장)

let previewPageW = 360;
let previewPageH = 520;

function computePreviewPageBox() {
  const gap = 12;
  const pad = 24;
  const availW = Math.max(200, els.pdfContainer.clientWidth - pad - gap * (state.spreadCount - 1));
  const availH = Math.max(240, els.pdfContainer.clientHeight - pad);

  let wFromWidth = availW / Math.max(1, state.spreadCount);
  wFromWidth = Math.max(220, wFromWidth);
  let wFromHeight = Math.max(220, availH / PREVIEW_A4);

  let pageW = Math.min(wFromWidth, wFromHeight);
  // fitMode가 꺼져있으면 줌을 조금 반영
  if (!state.fitMode) pageW *= Math.max(0.5, Math.min(2.0, Number(state.zoom) || 1));
  pageW *= 0.985;

  previewPageW = Math.floor(Math.max(220, pageW));
  previewPageH = Math.floor(Math.max(260, previewPageW * PREVIEW_A4));
}

function getPreviewStep() {
  return Math.max(80, previewPageH - PREVIEW_OVERLAP_Y_PX + PREVIEW_STEP_ADJUST_PX);
}

function clearPreviewViews() {
  els.canvasStack.innerHTML = '';
}

function renderPreviewSpread(leftPageNo) {
  computePreviewPageBox();
  const step = getPreviewStep();
  const s = PREVIEW_SCALE;
  const roomParam = state.isInSession && state.roomCode ? `?room=${encodeURIComponent(state.roomCode)}` : '';
  const src = `/api/drive/embed/${encodeURIComponent(state.fileId)}${roomParam}`;

  clearPreviewViews();
  for (let i = 0; i < state.spreadCount; i += 1) {
    const pageNo = leftPageNo + i;

    const wrap = document.createElement('div');
    wrap.className = 'preview-view';
    wrap.dataset.pageNo = String(pageNo);
    wrap.style.width = `${previewPageW}px`;
    wrap.style.height = `${previewPageH}px`;

    const clip = document.createElement('div');
    clip.className = 'preview-clip';

    const iframe = document.createElement('iframe');
    iframe.className = 'preview-iframe';
    iframe.referrerPolicy = 'no-referrer';
    iframe.allow = 'fullscreen';
    iframe.loading = 'eager';
    iframe.src = src;
    iframe.style.width = `${previewPageW}px`;
    iframe.style.height = `${PREVIEW_IFRAME_H_PX}px`;

    const y = -((pageNo - 1) * step * s) + PREVIEW_Y_OFFSET_PX;
    const x = PREVIEW_X_OFFSET_PX;
    iframe.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;

    clip.appendChild(iframe);
    wrap.appendChild(clip);
    els.canvasStack.appendChild(wrap);
  }
  // content box for pan calc (use actual layout metrics; safer than manual sum)
  state._contentW = els.canvasStack.scrollWidth || 0;
  state._contentH = els.canvasStack.scrollHeight || 0;
  applyPanTransform();
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
    const size = Number(state.brushSize || 3);
    const color = String(state.brushColor || '#ff2d55');
    return { stroke: color, fill: 'rgba(0,0,0,0)', strokeWidth: Math.max(1, size) };
  };

  fabricCanvas.on('mouse:down', (opt) => {
    state.activeDrawPageNo = pageNo;
    if (state.locked) return;

    if (state.tool === 'eraser') {
      const p = getPointer(opt);
      erasing = true;
      const size = Number(state.brushSize || 3);
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
      const color = String(state.brushColor || '#ff2d55');
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
      const size = Number(state.brushSize || 3);
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
      // font size UI removed; keep state only
    }
  };
  fabricCanvas.on('selection:created', syncSelectionUI);
  fabricCanvas.on('selection:updated', syncSelectionUI);
  return v;
}

function applyToolToCanvas(fab) {
  if (!fab) return;
  const size = Number(state.brushSize || 3);
  const color = String(state.brushColor || '#ff2d55');

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
    // 커스텀 지우개: "근처 오브젝트 삭제" 방식
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

function isAnyTextEditing() {
  try {
    for (const v of viewMap.values()) {
      const a = v?.fabric?.getActiveObject?.();
      if (a && a.type === 'i-text' && a.isEditing) return true;
    }
  } catch {}
  return false;
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
  // preview slice mode: PDF 파싱이 안 되더라도 "보기"는 가능해야 한다.
  if (state.previewMode) {
    renderSpread._seq = (renderSpread._seq || 0) + 1;
    els.pdfPreview.classList.add('hidden');
    els.canvasStack.style.display = 'flex';
    try {
      renderPreviewSpread(leftPageNo);
      updatePageLabels();
    } catch {}
    return;
  }

  if (!state.isPdfReady || !state.pdfDoc) return;

  // IMPORTANT:
  // renderSpread는 async(페이지 렌더 await)라서, 페이지 넘김/설정 동기화로 연속 호출되면
  // 이전 렌더가 늦게 끝나면서 DOM에 중복 append(2p가 여러 번 보이는 현상)가 발생할 수 있다.
  // 최신 호출만 유효하도록 토큰으로 중단(cancellation)한다.
  renderSpread._seq = (renderSpread._seq || 0) + 1;
  const seq = renderSpread._seq;

  // Remove preview fallback if any
  els.pdfPreview.classList.add('hidden');
  els.canvasStack.style.display = 'flex';

  // Rebuild views each time (<=4 pages, OK)
  clearViews();

  const pages = getSpreadPages(leftPageNo);
  updatePageLabels();

  for (const p of pages) {
    if (seq !== renderSpread._seq) return; // cancelled by newer render
    const page = await state.pdfDoc.getPage(p);
    if (seq !== renderSpread._seq) return;
    const viewport = computeViewport(page);
    if (seq !== renderSpread._seq) return;
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
    if (seq !== renderSpread._seq) return;

    const saved = state.annoStore[p];
    if (saved) applySnapshotToPage(p, saved);
    else applySnapshotToPage(p, { json: { objects: [] }, w: v.pdfCanvas.width, h: v.pdfCanvas.height });

  }

  // store content size and apply pan transform (use actual layout metrics; safer)
  state._contentW = els.canvasStack.scrollWidth || 0;
  state._contentH = els.canvasStack.scrollHeight || 0;
  applyPanTransform();
}

async function loadPdf(fileId) {
  state.isPdfReady = false;
  state.pdfDoc = null;
  state.totalPages = 1;
  state.pageNo = 1;
  state.activeDrawPageNo = 1;
  updatePageLabels();

  const roomParam = state.isInSession && state.roomCode ? `?room=${encodeURIComponent(state.roomCode)}` : '';
  const url = `${window.location.origin}/api/drive/pdf/${fileId}${roomParam}`;
  setHidden('pageHud', false);
  setText('pageHud', 'PDF 로딩 중...');

  try {
    const loadingTask = pdfjsLib.getDocument({
      url,
      withCredentials: true,
      // 외부/공개 Drive의 Range 요청이 종종 막혀 로딩이 깨지는 케이스가 있어,
      // 서버 스트리밍(전체 파일) 기반으로 안정성을 우선한다.
      disableRange: true,
      disableStream: false,
      disableAutoFetch: false
    });
    const pdf = await loadingTask.promise;
    state.previewMode = false;
    state.pdfDoc = pdf;
    state.totalPages = pdf.numPages;
    state.isPdfReady = true;
    updatePageLabels();
    await renderSpread(state.pageNo);

    if (state.isInSession && state.roomCode) socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId });
  } catch (e) {
    try {
      // Preview slice mode:
      // - PDF 파싱 실패 시, iframe(임베드) + transform으로 페이지처럼 보이게(보기 전용)
      // - 세션 참여자에게 "무조건 보이게" 하는 것이 목표
      state.previewMode = true;
      state.pdfDoc = null;
      state.isPdfReady = true;
      state.totalPages = 9999;
      state.pageNo = Math.max(1, Number(state.pageNo) || 1);

      els.pdfPreview.classList.add('hidden');
      els.canvasStack.style.display = 'flex';
      await renderSpread(state.pageNo);
      setHidden('pageHud', false);
      setText('pageHud', '스트리밍이 제한되어 미리보기(슬라이스) 모드로 열었습니다(보기 전용)');
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

// ---- Tool/UI state ---------------------------------------------------------------
function updateToolActiveUI() {
  const on = (id, active) => document.getElementById(id)?.classList.toggle('active', Boolean(active));
  on('selectBtn', state.tool === 'select');
  on('penBtn', state.tool === 'pen');
  on('highlighterBtn', state.tool === 'highlighter');
  on('eraserBtn', state.tool === 'eraser');
  on('textBtn', state.tool === 'text');
  on('laserBtn', state.tool === 'laser');
  on('cursorShareBtn', Boolean(state.cursorShareOn));
  on('lineBtn', state.tool === 'shape' && state.shape === 'line');
  on('rectBtn', state.tool === 'shape' && state.shape === 'rect');
  on('circleBtn', state.tool === 'shape' && state.shape === 'circle');
}

function syncBrushOptionUI() {
  const sizeEl = document.getElementById('brushSize');
  const colorEl = document.getElementById('colorPicker');
  const fontEl = document.getElementById('fontSize');
  if (sizeEl) sizeEl.value = String(state.brushSize || 3);
  if (colorEl) colorEl.value = String(state.brushColor || '#ff2d55');
  if (fontEl) fontEl.value = String(state.textFontSize || 22);
}

function setTool(tool, shape = null) {
  // 세션 참여 중이더라도 도구 사용 자체는 허용(단, 공유/동기화는 권한 필요)
  if (state.isInSession && !canUseToolsNow() && tool !== 'select') {
    flashHud('로컬 주석 모드(공유 안됨)', 900);
  }
  // 커서공유는 "표시 모드"이므로, 다른 도구로 전환하면 자동 중단
  if (state.cursorShareOn) stopCursorShare(true);
  state.tool = tool;
  state.shape = shape;
  document.body.dataset.tool = tool;
  document.body.classList.toggle('tool-text', tool === 'text');
  // chord mode: select일 때는 스크롤/드래그가 우선이므로 캔버스 입력을 막는다.
  const cwHost = document.getElementById('cwAnnoHost');
  if (cwHost) cwHost.style.pointerEvents = state.mode === 'chord' && tool === 'select' ? 'none' : 'auto';
  applyToolToAll();
  updateToolActiveUI();
}

document.getElementById('penBtn').addEventListener('click', () => setTool('pen'));
document.getElementById('highlighterBtn').addEventListener('click', () => setTool('highlighter'));
document.getElementById('cursorShareBtn')?.addEventListener('click', () => {
  if (state.cursorShareOn) stopCursorShare(true);
  else startCursorShare();
});
document.getElementById('cursorModeLineBtn')?.addEventListener('click', () => {
  state.cursorShareMode = 'line';
  localStorage.setItem('mb_viewer_cursorMode', 'line');
  updateCursorShareUI();
});
document.getElementById('cursorModeRowBtn')?.addEventListener('click', () => {
  state.cursorShareMode = 'row';
  localStorage.setItem('mb_viewer_cursorMode', 'row');
  updateCursorShareUI();
});
document.getElementById('laserBtn')?.addEventListener('click', () => setTool('laser'));
document.getElementById('eraserBtn')?.addEventListener('click', () => setTool('eraser'));
document.getElementById('selectBtn').addEventListener('click', () => setTool('select'));
document.getElementById('lineBtn').addEventListener('click', () => setTool('shape', 'line'));
document.getElementById('rectBtn').addEventListener('click', () => setTool('shape', 'rect'));
document.getElementById('circleBtn').addEventListener('click', () => setTool('shape', 'circle'));
document.getElementById('textBtn').addEventListener('click', () => setTool('text'));

// Brush / color / text size controls
document.getElementById('brushSize')?.addEventListener('input', (e) => {
  state.brushSize = clamp(Number(e.target?.value || 3), 1, 30);
  applyToolToAll();
});
document.getElementById('colorPicker')?.addEventListener('input', (e) => {
  state.brushColor = String(e.target?.value || '#ff2d55');
  applyToolToAll();
});
document.getElementById('fontSize')?.addEventListener('input', (e) => {
  state.textFontSize = clamp(Number(e.target?.value || 22), 12, 60);
  const v = getActiveView();
  const obj = v?.fabric?.getActiveObject?.();
  if (v?.fabric && obj?.type === 'i-text') {
    obj.set('fontSize', state.textFontSize);
    v.fabric.requestRenderAll();
    // 권한 있으면 공유, 아니면 로컬만
    v.pushUndo?.();
    if (canUseToolsNow()) v.broadcast?.();
  }
});
syncBrushOptionUI();
updateToolActiveUI();

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
  // "전체" = 현재 파일의 모든 주석(그려진 페이지들)을 삭제
  const empty = { json: { objects: [] }, w: 1, h: 1 };
  const touchedPages = new Set();
  Object.keys(state.annoStore || {}).forEach((k) => touchedPages.add(Number(k)));
  // 아무것도 없으면 현재 스프레드만이라도 clear
  if (!touchedPages.size) getSpreadPages(state.pageNo).forEach((p) => touchedPages.add(p));

  touchedPages.forEach((pageNo) => {
    if (!pageNo) return;
    state.undoStack[pageNo] ||= [];
    const current = snapshotPage(pageNo);
    if (current) state.undoStack[pageNo].push(current);
    state.redoStack[pageNo] = [];
    state.annoStore[pageNo] = empty;
    if (viewMap.has(pageNo)) applySnapshotToPage(pageNo, empty);
    broadcastDebouncedByPage.get(pageNo)?.();
  });
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
      overlapPx: state.overlapPx,
      panX: state.panX,
      panY: state.panY
    }
  });
}

let _emitSettingsTimer = null;
function emitViewerSettingsDebounced(reason = '') {
  if (!_emitSettingsTimer) {
    _emitSettingsTimer = setTimeout(() => {
      _emitSettingsTimer = null;
      emitViewerSettings(reason);
    }, 120);
  }
}

function setSpread(n) {
  const v = isMobileViewer() ? 1 : n;
  state.spreadCount = v;
  // GAS처럼 버튼 active 처리
  [1, 2, 3, 4].forEach((x) => document.getElementById(`spread${x}Btn`)?.classList.toggle('active', x === v));
  changePage(state.pageNo, 'spread');
  emitViewerSettings('spread');
  updateUrlState();
}
document.getElementById('spread1Btn').addEventListener('click', () => setSpread(1));
document.getElementById('spread2Btn').addEventListener('click', () => setSpread(2));
document.getElementById('spread3Btn').addEventListener('click', () => setSpread(3));
document.getElementById('spread4Btn').addEventListener('click', () => setSpread(4));

// Page turn unit (한번에/한페이지씩)
state.turnUnit = localStorage.getItem('mb_viewer_turn_unit') || 'single'; // 'single' | 'spread'
function setTurnUnit(v) {
  // 모바일 viewer는 항상 한페이지씩 강제
  const next = isMobileViewer() ? 'single' : v === 'spread' ? 'spread' : 'single';
  state.turnUnit = next;
  localStorage.setItem('mb_viewer_turn_unit', state.turnUnit);
  document.getElementById('turnUnitSpreadBtn')?.classList.toggle('active', state.turnUnit === 'spread');
  document.getElementById('turnUnitSingleBtn')?.classList.toggle('active', state.turnUnit === 'single');
}
document.getElementById('turnUnitSpreadBtn')?.addEventListener('click', () => setTurnUnit('spread'));
document.getElementById('turnUnitSingleBtn')?.addEventListener('click', () => setTurnUnit('single'));
setTurnUnit(state.turnUnit);

document.getElementById('zoomInBtn').addEventListener('click', () => {
  state.fitMode = false;
  state.zoom = Math.min(3, state.zoom * 1.15);
  // 줌 변경 시 기존 팬 값이 남아있으면 화면이 튈 수 있어 초기화
  state.panX = 0;
  state.panY = 0;
  renderSpread(state.pageNo).catch(() => {});
  emitViewerSettings('zoom');
  updateUrlState();
});
document.getElementById('zoomOutBtn').addEventListener('click', () => {
  state.fitMode = false;
  state.zoom = Math.max(0.5, state.zoom / 1.15);
  state.panX = 0;
  state.panY = 0;
  renderSpread(state.pageNo).catch(() => {});
  emitViewerSettings('zoom');
  updateUrlState();
});
document.getElementById('fitBtn').addEventListener('click', () => {
  state.fitMode = true;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  renderSpread(state.pageNo).catch(() => {});
  emitViewerSettings('fit');
  updateUrlState();
});

function getActiveView() {
  const pageNo = state.activeDrawPageNo || state.pageNo;
  return viewMap.get(pageNo);
}

// (텍스트 크기 UI 제거: 기본값 사용)

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
  const isLive = isMobileModeEnabled();
  document.body.classList.toggle('live-mode', isLive);
  document.body.classList.toggle('landscape', window.matchMedia('(orientation: landscape)').matches);
  applyTouchModeAuto(isLive);
  applyMobileModeButtons();
}
updateLiveMode();
window.addEventListener('resize', debounce(updateLiveMode, 200));

// Desktop toggles (GAS 원본)
document.getElementById('toggleViewBtn')?.addEventListener('click', () => {
  document.getElementById('viewBar')?.classList.toggle('isHidden');
});
document.getElementById('toggleToolBtn')?.addEventListener('click', () => {
  document.getElementById('toolBar')?.classList.toggle('isHidden');
});
document.getElementById('toggleLinkBtn')?.addEventListener('click', () => {
  const next = !document.body.classList.contains('link-collapsed');
  document.body.classList.toggle('link-collapsed', next);
  localStorage.setItem('mb_viewer_linkCollapsed', next ? '1' : '0');
});

// (mobileCtlBar 제거됨)

// Wheel zoom (Ctrl + wheel)
els.pdfContainer.addEventListener(
  'wheel',
  (e) => {
    // 1) Ctrl+Wheel: zoom
    if (e.ctrlKey) {
      e.preventDefault();
      state.fitMode = false;
      const dir = e.deltaY < 0 ? 1.08 : 0.92;
      state.zoom = clamp(state.zoom * dir, 0.5, 3);
      // zoom을 건드리면 팬은 초기화(예측 가능)
      state.panX = 0;
      state.panY = 0;
      renderSpread(state.pageNo).catch(() => {});
      emitViewerSettings('zoom');
      updateUrlState();
      return;
    }

    // 2) Normal wheel: pan (when zoomed / overflow exists)
    if (state.fitMode) return;
    if (!(state._panMaxX > 0 || state._panMaxY > 0)) return;
    // 텍스트 편집 중에는 스크롤/페이지턴 금지
    if (isAnyTextEditing()) return;
    e.preventDefault();
    const dx = Number(e.deltaX || 0);
    const dy = Number(e.deltaY || 0);
    if (e.shiftKey && state._panMaxX > 0) {
      state.panX = clamp01(state.panX + dx / (state._panMaxX || 1));
    } else if (state._panMaxY > 0) {
      state.panY = clamp01(state.panY + dy / (state._panMaxY || 1));
    }
    applyPanTransform();
    emitViewerSettingsDebounced('pan');
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
      // 핀치 줌 시작 시 팬 초기화(모바일에서 화면 튐 방지)
      state.panX = 0;
      state.panY = 0;
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
        if (touch.dx < 0) changePage(state.pageNo + pageTurnStep(), 'swipe');
        else changePage(state.pageNo - pageTurnStep(), 'swipe');
      }
    }
    touch.mode = null;
  },
  { passive: true }
);

// (sheet-open 제거됨)

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
    // 또한 room.currentFileId/currentPageNo를 확정(곡리스트→뷰어→세션생성 케이스 안정화)
    if (state.roomCode && state.fileId) {
      socket.emit('viewer:page_change', {
        roomCode: state.roomCode,
        fileId: state.fileId,
        pageNo: state.pageNo,
        reason: 'turner_state'
      });
    }
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
        <span class="participant-name" title="${String(name)}">${name}</span>
      </span>
      <span class="participant-actions"></span>
    `;
    const actions = row.querySelector('.participant-actions');
    if (m.isPageTurner) {
      const badge = document.createElement('span');
      badge.className = 'participant-badge';
      badge.textContent = 'TURNER';
      actions?.appendChild(badge);
    }

    if (state.isPageTurner && !m.isPageTurner) {
      const btn = document.createElement('button');
      btn.textContent = '양도';
      btn.title = '권한 양도';
      btn.onclick = () => {
        socket.emit('session:pageTurner:transfer', { roomCode: state.roomCode, targetSocketId: m.socketId }, (ack) => {
          if (!ack?.ok) alert('양도 실패');
        });
      };
      actions?.appendChild(btn);
    }

    // tool permission UI
    if (!m.isPageTurner) {
      if (m.isToolAuthorized) {
        const badge = document.createElement('span');
        badge.className = 'participant-badge';
        badge.textContent = 'TOOL';
        actions?.appendChild(badge);
      } else if (m.toolRequested) {
        const badge = document.createElement('span');
        badge.className = 'participant-badge';
        badge.textContent = '요청';
        actions?.appendChild(badge);
      }
    }
    if (state.isPageTurner && !m.isPageTurner) {
      const toolBtn = document.createElement('button');
      toolBtn.textContent = m.isToolAuthorized ? '해제' : '승인';
      toolBtn.title = m.isToolAuthorized ? '도구 해제' : '도구 승인';
      toolBtn.onclick = () => {
        socket.emit(
          'session:tool:grant',
          { roomCode: state.roomCode, targetSocketId: m.socketId, allow: !m.isToolAuthorized },
          (ack) => {
            if (!ack?.ok) alert('처리 실패');
          }
        );
      };
      actions?.appendChild(toolBtn);
    }
    list.appendChild(row);
  });
});

// Ensure late joiners always align to room's current file/page
socket.on('session:state', (p) => {
  if (!state.isInSession) return;
  if (p?.roomCode && String(p.roomCode).toUpperCase() !== String(state.roomCode || '').toUpperCase()) return;
  const fileId = String(p?.currentFileId || '').trim();
  const pageNo = Number(p?.currentPageNo || 0);
  if (fileId && String(fileId) !== String(state.fileId || '')) {
    const originalLink = String(p?.currentOriginalLink || '').trim();
    if (originalLink && /^https?:\/\//i.test(originalLink) && !extractDriveFileId(originalLink)) {
      openChordByUrl(originalLink, { broadcast: false }).catch(() => {});
    } else if (fileId.startsWith('chord:')) {
      // late join chord doc without originalLink: show pane + request raw text
      setMode('chord');
      state.fileId = fileId;
      setCwError('세션에서 코드위키 문서를 따라오려면 원문 텍스트가 필요합니다(원문 붙여넣기).');
      socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId: state.fileId });
    } else {
      setMode('pdf');
      state.fileId = fileId;
      loadPdf(state.fileId).catch(() => {});
    }
  }
  if (pageNo && !state.isPageTurner) {
    state.pageNo = pageNo;
    state.activeDrawPageNo = pageNo;
    updatePageLabels();
    renderSpread(state.pageNo).catch(() => {});
  }

  // codewiki scroll ratio align (late joiners)
  const ratio = Number(p?.currentScrollRatio);
  if (state.mode === 'chord' && cwScrollEl && !state.isPageTurner && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
    setScrollRatio(cwScrollEl, ratio, true);
  }
});

socket.on('session:scroll:sync', (p) => {
  if (!state.isInSession) return;
  if (!cwScrollEl) return;
  if (state.mode !== 'chord') return;
  if (state.isPageTurner) return;
  if (p?.fileId && String(p.fileId) !== String(state.fileId || '')) return;
  const ratio = Number(p?.ratio);
  if (!Number.isFinite(ratio)) return;
  setScrollRatio(cwScrollEl, Math.max(0, Math.min(1, ratio)), true);
});

socket.on('viewer:cursor', (p) => {
  if (!state.isInSession) return;
  // 페이지터너가 커서공유 중일 때는 서버 echo로 remote 커서가 겹쳐 보일 수 있으니 무시
  if (state.isPageTurner && state.cursorShareOn) return;
  if (p?.fileId && state.fileId && String(p.fileId) !== String(state.fileId)) return;
  ensureCursorEls();
  if (p?.hide) return setCursorMarker(remoteCursorEl, { visible: false });
  const mode = String(p?.mode || 'line') === 'row' ? 'row' : 'line';

  // New format: page-based cursor (preferred)
  const pageNo = Number(p?.pageNo || 0);
  const xPageNorm = Number(p?.xPageNorm);
  const yPageNorm = Number(p?.yPageNorm);
  if (pageNo && Number.isFinite(xPageNorm) && Number.isFinite(yPageNorm)) {
    // 모바일 viewer는 커서가 있는 페이지로 따라간다.
    if (isMobileViewer() && pageNo !== state.pageNo) {
      followToPage(pageNo, 'cursor').catch(() => {});
      // followToPage가 async라 이후 렌더 타이밍은 다음 메시지에서 자연히 맞춰짐
      // (즉시 표시 필요하면 await로 바꿀 수 있지만, 이벤트 빈도가 높아 비권장)
    }
    const v = viewMap.get(pageNo);
    if (!v?.root) return;
    const container = document.getElementById('pdf-container');
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const pr = v.root.getBoundingClientRect();
    const xLocal = (pr.left - cr.left) + clamp(xPageNorm, 0, 1) * pr.width;
    const yLocal = (pr.top - cr.top) + clamp(yPageNorm, 0, 1) * pr.height;
    const xNorm = cr.width ? xLocal / cr.width : 0;
    const yNorm = cr.height ? yLocal / cr.height : 0;
    return setCursorMarker(remoteCursorEl, { xNorm, yNorm, visible: true, mode, pageNo, yPageNorm: yPageNorm });
  }

  // Legacy fallback: container-based normalized cursor
  setCursorMarker(remoteCursorEl, { xNorm: p?.xNorm, yNorm: p?.yNorm, visible: true, mode });
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
  // 모바일 viewer는 1p 고정(터너 설정 무시)
  if (typeof s.spreadCount === 'number' && !isMobileViewer()) state.spreadCount = clamp(s.spreadCount, 1, 4);
  if (isMobileViewer()) state.spreadCount = 1;
  const prevZoom = state.zoom;
  const prevFit = state.fitMode;
  if (typeof s.fitMode === 'boolean') state.fitMode = s.fitMode;
  if (typeof s.zoom === 'number') state.zoom = clamp(s.zoom, 0.5, 3);
  if (typeof s.overlapPx === 'number') setSpreadOverlapPx(s.overlapPx);
  // 줌/fit 변경인데 pan이 없거나 이상하면 튐 방지용으로 0으로 리셋
  const zoomChanged = prevZoom !== state.zoom || prevFit !== state.fitMode;
  if (typeof s.panX === 'number') state.panX = clamp01(s.panX);
  else if (zoomChanged) state.panX = 0;
  if (typeof s.panY === 'number') state.panY = clamp01(s.panY);
  else if (zoomChanged) state.panY = 0;
  [1, 2, 3, 4].forEach((x) => document.getElementById(`spread${x}Btn`)?.classList.toggle('active', x === state.spreadCount));
  renderSpread(state.pageNo).catch(() => {});
});

socket.on('viewer:laser', async (p) => {
  if (!state.isInSession) return;
  if (!p?.pageNo || !p?.points || !Array.isArray(p.points)) return;
  if (p?.fileId && p.fileId !== state.fileId) return;

  const pageNo = Number(p.pageNo);
  if (isMobileViewer() && pageNo && pageNo !== state.pageNo) {
    await followToPage(pageNo, 'laser');
  }

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
  // codewiki URL follow
  if (originalLink && /^https?:\/\//i.test(originalLink) && !extractDriveFileId(originalLink)) {
    openChordByUrl(originalLink, { broadcast: false }).catch(() => {});
    return;
  }

  const targetId = originalLink ? extractDriveFileId(originalLink) || fileId : fileId;
  if (String(targetId).startsWith('chord:')) {
    setMode('chord');
    state.fileId = String(targetId);
    setCwError('코드위키 문서 follow: 원문 텍스트가 필요하면 “원문 붙여넣기”로 입력하세요.');
    socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId: state.fileId });
    return;
  }

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
  // re-apply overlays
  if (state.mode === 'chord') {
    // chord 모드는 page=1 단일 캔버스
    if (state.chordBlocks) renderChordBlocks(state.chordBlocks);
    else setupChordAnnoAfterRender();
  } else if (state.isPdfReady) {
    renderSpread(state.pageNo).catch(() => {});
  }
});

socket.on('wb:page:update', async (p) => {
  if (!p?.pageNo || !p?.pageSnapshot) return;
  const pageNo = Number(p.pageNo);
  state.annoStore[pageNo] = p.pageSnapshot;
  // 모바일 viewer는 "주석이 업데이트된 페이지"를 따라가서 항상 읽을 수 있게 한다.
  if (state.isInSession && isMobileViewer() && pageNo && pageNo !== state.pageNo) {
    await followToPage(pageNo, 'anno');
  }
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

  // bookmarklet window.name fallback 수신 (postMessage보다 더 안정적)
  consumeWindowNamePayload();

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

  // 모바일 viewer는 항상 1페이지 보기 + 한페이지씩 넘김을 강제
  document.body.classList.toggle('mobile-viewer', isMobileViewer());
  if (isMobileViewer()) {
    setSpread(1);
    setTurnUnit('single');
  }

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
