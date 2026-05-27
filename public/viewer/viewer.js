/* global io, pdfjsLib, fabric */

// ---- Helpers ----------------------------------------------------------------------
function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}
// window.open 재사용(탭 2개 생성 방지)을 위해, 가능한 한 빨리 window.name을 확정한다.
// - 기존에는 init() 끝부분에서 설정되어, 다른 탭에서 window.open(targetName)이 먼저 호출되면 새 탭이 생길 수 있었다.
try {
  const u0 = new URL(window.location.href);
  const rn0 = String(u0.searchParams.get('room') || '').trim().toUpperCase();
  if (rn0) window.name = `mb_viewer_room_${rn0}`;
  else window.name = 'mb_viewer_main';
} catch {}

// ---- API URL (frontend 분리 대응) --------------------------------------------------
// TODO: Render 백엔드 배포 후 발급받은 새 주소를 여기에 입력할 예정
// (또는 public/config.js에서 window.API_URL을 설정)
const API_URL = String(window.API_URL || window.MB_API || window.location.origin || '').replace(/\/$/, '');
const apiUrl = (path) => {
  const p = String(path || '');
  if (!p) return API_URL;
  if (/^https?:\/\//i.test(p)) return p;
  return `${API_URL}${p.startsWith('/') ? '' : '/'}${p}`;
};

// ---- Chord view preferences -------------------------------------------------------
const CW_PREF_KEY = 'mb_cw_view_prefs_v1';
const CW_PREF_DEFAULTS = {
  layout: 'auto', // auto | m1 | m2 | m4
  measureStd: 'line', // line | global | off
  maxLineCols: 120,
  maxMeasureCap: 36,
  gapLines: 1,
  lineHeight: 1.55,
  letterSpacing: 0 // px
};

function loadCwPrefs() {
  try {
    const raw = localStorage.getItem(CW_PREF_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    const p = { ...CW_PREF_DEFAULTS, ...(obj || {}) };
    p.maxLineCols = Math.min(240, Math.max(40, Number(p.maxLineCols || 120)));
    p.maxMeasureCap = Math.min(80, Math.max(10, Number(p.maxMeasureCap || 36)));
    p.gapLines = Math.min(5, Math.max(0, Math.round(Number(p.gapLines ?? 1))));
    p.lineHeight = Math.min(2.8, Math.max(1.1, Number(p.lineHeight || 1.55)));
    p.letterSpacing = Math.min(6, Math.max(-2, Number(p.letterSpacing || 0)));
    p.layout = ['auto', 'm1', 'm2', 'm4'].includes(String(p.layout)) ? String(p.layout) : 'auto';
    p.measureStd = ['line', 'global', 'off'].includes(String(p.measureStd)) ? String(p.measureStd) : 'line';
    return p;
  } catch {
    return { ...CW_PREF_DEFAULTS };
  }
}

function saveCwPrefs(patch) {
  const cur = loadCwPrefs();
  const next = loadCwPrefs(); // normalized
  Object.assign(next, cur, patch || {});
  try {
    localStorage.setItem(CW_PREF_KEY, JSON.stringify(next));
  } catch {}
  return loadCwPrefs();
}

function applyCwPrefToPre(pre) {
  if (!pre) return;
  const p = loadCwPrefs();
  pre.style.lineHeight = String(p.lineHeight || 1.55);
  pre.style.letterSpacing = `${Number(p.letterSpacing || 0)}px`;
}

function rerenderChordNow() {
  if (state?.mode !== 'chord') return;
  try {
    if (state.chordBlocksRaw && typeof state.chordBlocksRaw === 'object' && !Array.isArray(state.chordBlocksRaw)) {
      renderChordCompact(state.chordBlocksRaw);
      return;
    }
    if (Array.isArray(state.chordBlocks) && state.chordBlocks.length) {
      renderChordBlocks(state.chordBlocks);
    }
  } catch {}
}

function initCwControls() {
  const layoutSel = document.getElementById('cwLayoutSelect');
  const stdSel = document.getElementById('cwMeasureStdSelect');
  const maxCols = document.getElementById('cwMaxCols');
  const maxColsLabel = document.getElementById('cwMaxColsLabel');
  const lineHeight = document.getElementById('cwLineHeight');
  const lineHeightLabel = document.getElementById('cwLineHeightLabel');
  const letter = document.getElementById('cwLetterSpacing');
  const letterLabel = document.getElementById('cwLetterSpacingLabel');
  const gap = document.getElementById('cwGapLines');
  const gapLabel = document.getElementById('cwGapLinesLabel');
  if (!layoutSel || !stdSel || !maxCols || !lineHeight || !letter || !gap) return;

  const p = loadCwPrefs();
  try {
    layoutSel.value = String(p.layout || 'auto');
    stdSel.value = String(p.measureStd || 'line');
    maxCols.value = String(Math.round(Number(p.maxLineCols || 120)));
    lineHeight.value = String(Math.round(Number(p.lineHeight || 1.55) * 100));
    letter.value = String(Number(p.letterSpacing || 0));
    gap.value = String(Number(p.gapLines ?? 1));
  } catch {}

  const updateLabels = (pp) => {
    try {
      if (maxColsLabel) maxColsLabel.textContent = String(Math.round(Number(pp.maxLineCols || 120)));
      if (lineHeightLabel) lineHeightLabel.textContent = String((Number(pp.lineHeight || 1.55)).toFixed(2));
      if (letterLabel) letterLabel.textContent = String(Number(pp.letterSpacing || 0));
      if (gapLabel) gapLabel.textContent = String(Number(pp.gapLines ?? 1));
    } catch {}
  };
  updateLabels(p);

  const apply = () => {
    const next = saveCwPrefs({
      layout: String(layoutSel.value || 'auto'),
      measureStd: String(stdSel.value || 'line'),
      maxLineCols: Number(maxCols.value || 120),
      lineHeight: Number(lineHeight.value || 155) / 100,
      letterSpacing: Number(letter.value || 0),
      gapLines: Number(gap.value || 1)
    });
    // 입력값을 정규화된 값으로 되돌림
    try {
      maxCols.value = String(Math.round(Number(next.maxLineCols || 120)));
      lineHeight.value = String(Math.round(Number(next.lineHeight || 1.55) * 100));
      letter.value = String(Number(next.letterSpacing || 0));
      gap.value = String(Number(next.gapLines ?? 1));
    } catch {}
    updateLabels(next);
    rerenderChordNow();
  };

  layoutSel.onchange = apply;
  stdSel.onchange = apply;
  maxCols.oninput = apply;
  lineHeight.oninput = apply;
  letter.oninput = apply;
  gap.oninput = apply;
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
  // GitHub Pages(/Musicbook/public/viewer/...) + 백엔드(/viewer/...) 모두 지원
  const qp = qs('fileId');
  if (qp) return String(qp || '').trim();
  const parts = window.location.pathname.split('/').filter(Boolean);
  // supports .../viewer or .../viewer/:fileId (viewer segment can be nested)
  const idx = parts.indexOf('viewer');
  if (idx < 0) return '';
  return parts[idx + 1] || '';
}

function getViewerBaseUrl() {
  // 현재 viewer 페이지의 "폴더" URL (.../viewer/)을 만들고, fileId를 path에 두지 않는다(정적 호스팅 호환).
  const u = new URL(window.location.href);
  const parts = u.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('viewer');
  if (idx < 0) return new URL('/viewer/', u.origin).toString();
  const keep = parts.slice(0, idx + 1); // .../viewer
  u.pathname = `/${keep.join('/')}/`;
  u.search = '';
  u.hash = '';
  return u.toString();
}

function buildViewerUrl({ fileId = '', roomCode = '' } = {}) {
  const u = new URL(getViewerBaseUrl());
  if (fileId) u.searchParams.set('fileId', String(fileId));
  if (roomCode) u.searchParams.set('room', safeRoomCode(roomCode));
  return u.toString();
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
  const res = await fetch(apiUrl(url), { credentials: 'include' });
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
let cursorDownHandler = null;
let cursorUpHandler = null;
let cursorDragLock = null; // { pageNo, yPageNorm }
let lastCursorEmitAt = 0;

function ensureCursorEls() {
  const container = state.mode === 'chord' ? document.getElementById('cwInner') : document.getElementById('pdf-container');
  if (!container) return;
  // 모드가 바뀌면 기존 마커를 새 컨테이너로 옮긴다.
  if (localCursorEl && localCursorEl.parentElement !== container) {
    try {
      localCursorEl.remove();
    } catch {}
    localCursorEl = null;
  }
  if (remoteCursorEl && remoteCursorEl.parentElement !== container) {
    try {
      remoteCursorEl.remove();
    } catch {}
    remoteCursorEl = null;
  }
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
  // chord 모드: cwInner(content)에 마커를 올려서 scroll과 함께 자연스럽게 움직이게 한다.
  if (state.mode === 'chord') {
    const inner = document.getElementById('cwInner');
    if (!inner) return;
    const ir = inner.getBoundingClientRect();
    const xPx = Number.isFinite(Number(xNorm)) ? ir.width * clamp(Number(xNorm || 0.5), 0, 1) : ir.width * 0.5;
    const yPx = Number.isFinite(Number(yNorm)) ? ir.height * clamp(Number(yNorm || 0.5), 0, 1) : ir.height * 0.5;
    if (m === 'row') {
      // 가로 전체: 화면(스크롤뷰) 기준 폭으로 잡되, inner에 위치시키기 위해 cwScroll 폭을 사용
      const scroll = document.getElementById('cwScroll');
      const sr = scroll ? scroll.getBoundingClientRect() : ir;
      const pad = 14;
      const width = Math.max(40, sr.width - pad * 2);
      el.style.width = `${Math.round(width)}px`;
      el.style.height = `46px`;
      el.style.left = `${Math.round(pad + width / 2)}px`;
      el.style.top = `${Math.round(yPx)}px`;
    } else {
      el.style.width = '';
      el.style.height = `80px`;
      el.style.left = `${Math.round(xPx)}px`;
      el.style.top = `${Math.round(yPx)}px`;
    }
    el.style.display = 'block';
    return;
  }

  const container = document.getElementById('pdf-container');
  if (!container) return;
  const r = container.getBoundingClientRect();
  const sx = Number(container.scrollLeft || 0);
  const sy = Number(container.scrollTop || 0);

  // 가능한 경우(현재 스프레드에 페이지가 존재): 항상 "페이지 기준 좌표"로 마커를 배치한다.
  // (스크롤/줌 시에도 안정적으로 따라오게 하기 위함)
  if (pageNo && (Number.isFinite(Number(xNorm)) || Number.isFinite(Number(yPageNorm)))) {
    const v = viewMap.get(Number(pageNo));
    if (v?.root) {
      const pr = v.root.getBoundingClientRect();
      const pad = 10;
      // row 모드에서는 "가로 전체"가 핵심이므로 x 좌표는 무시(페이지 중앙 고정)
      const xPage = m === 'row' ? 0.5 : Number.isFinite(Number(xNorm)) ? clamp(Number(xNorm), 0, 1) : 0.5;
      const yPage = Number.isFinite(Number(yPageNorm)) ? clamp(Number(yPageNorm), 0, 1) : 0.5;

      const leftPx = sx + (pr.left - r.left) + xPage * pr.width;
      const topPx = sy + (pr.top - r.top) + yPage * pr.height;

      if (m === 'row') {
        const width = Math.max(40, pr.width - pad * 2);
        el.style.width = `${Math.round(width)}px`;
        const h = clamp(pr.height * 0.065, 34, 70);
        el.style.height = `${Math.round(h)}px`;
      } else {
        // line
        el.style.width = '';
        const h = clamp(pr.height * 0.11, 40, 110);
        el.style.height = `${Math.round(h)}px`;
      }

      // row 모드: 페이지 내부 가로 전체이므로 항상 페이지 중앙에 배치
      el.style.left = `${Math.round(m === 'row' ? sx + (pr.left - r.left) + pr.width / 2 : leftPx)}px`;
      el.style.top = `${Math.round(topPx)}px`;
      el.style.display = 'block';
      return;
    }
  }

  // default(현재부분): 컨테이너 기준 정규화 좌표
  el.style.width = '';
  // allow both normalized coords and absolute px (relative to container)
  const xPx = Number.isFinite(Number(xNorm)) ? r.width * clamp(Number(xNorm || 0), 0, 1) : null;
  const yPx = Number.isFinite(Number(yNorm)) ? r.height * clamp(Number(yNorm || 0), 0, 1) : null;

  // 높이: 화면에 비례(너무 작/크지 않게)
  const h = m === 'row' ? clamp(r.height * 0.065, 34, 70) : clamp(r.height * 0.11, 40, 110);
  el.style.height = `${Math.round(h)}px`;
  if (m === 'row') {
    const pad = 10;
    el.style.width = `${Math.round(Math.max(40, r.width - pad * 2))}px`;
  }
  // CSS에서 transform: translate(-50%, -50%)로 "중심 기준" 정렬을 하므로,
  // 여기서는 left/top에 중심 좌표를 그대로 넣는다.
  const left = sx + (m === 'row' ? r.width / 2 : xPx ?? 0);
  const top = sy + (yPx ?? 0);
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
  const canUse = Boolean(state.isInSession);
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
    const c = state.mode === 'chord' ? document.getElementById('cwInner') : document.getElementById('pdf-container');
    c?.removeEventListener('pointermove', cursorMoveHandler);
    c?.removeEventListener('mousemove', cursorMoveHandler);
    c?.removeEventListener('touchmove', cursorMoveHandler);
  }
  if (cursorDownHandler) {
    const c = state.mode === 'chord' ? document.getElementById('cwInner') : document.getElementById('pdf-container');
    c?.removeEventListener('pointerdown', cursorDownHandler);
    c?.removeEventListener('mousedown', cursorDownHandler);
    c?.removeEventListener('touchstart', cursorDownHandler);
  }
  if (cursorUpHandler) {
    const c = state.mode === 'chord' ? document.getElementById('cwInner') : document.getElementById('pdf-container');
    c?.removeEventListener('pointerup', cursorUpHandler);
    c?.removeEventListener('pointercancel', cursorUpHandler);
    c?.removeEventListener('mouseup', cursorUpHandler);
    c?.removeEventListener('mouseleave', cursorUpHandler);
    c?.removeEventListener('touchend', cursorUpHandler);
    c?.removeEventListener('touchcancel', cursorUpHandler);
  }
  cursorMoveHandler = null;
  cursorDownHandler = null;
  cursorUpHandler = null;
  cursorDragLock = null;
  updateCursorShareUI();
  updateToolActiveUI();
  if (sendHide && state.isInSession && state.roomCode && state.fileId) {
    socket.emit('viewer:cursor', { roomCode: state.roomCode, fileId: state.fileId, hide: true });
  }
}

function startCursorShare() {
  if (!state.isInSession || !state.roomCode || !state.fileId) {
    flashHud('커서공유는 세션 참여 중에만 사용 가능합니다', 1400);
    return;
  }
  ensureCursorEls();
  state.cursorShareOn = true;
  // 커서공유는 "표시"가 핵심이므로 chord 모드에서는 select로 강제(스크롤/포인터 안정)
  if (state.mode === 'chord') setTool('select');
  updateCursorShareUI();
  updateToolActiveUI();

  // chord 모드는 캔버스가 위를 덮기 때문에, cwScroll이 아니라 상위 컨테이너(cwInner)에 걸어야 이벤트가 잡힌다.
  const container = state.mode === 'chord' ? document.getElementById('cwInner') : document.getElementById('pdf-container');
  if (!container) return;

  cursorDownHandler = (e) => {
    if (!state.cursorShareOn) return;
    if (!state.isInSession || !state.roomCode || !state.fileId) return;
    if ((state.cursorShareMode || 'line') !== 'row') return;
    const t = e.touches && e.touches[0] ? e.touches[0] : null;
    const clientX = t ? t.clientX : e.clientX;
    const clientY = t ? t.clientY : e.clientY;
    if (state.mode === 'chord') {
      const inner = document.getElementById('cwInner');
      if (!inner) return;
      const ir = inner.getBoundingClientRect();
      const yNorm = ir.height ? (clientY - ir.top) / ir.height : 0.5;
      cursorDragLock = { pageNo: 1, yPageNorm: clamp(yNorm, 0, 1) };
      return;
    }
    const hit = findPageAtPoint(clientX, clientY);
    if (!hit?.rect) return;
    const rect = hit.rect;
    const pageNo = hit.pageNo;
    const yPageNorm = rect.height ? (clientY - rect.top) / rect.height : 0.5;
    cursorDragLock = { pageNo, yPageNorm: clamp(yPageNorm, 0, 1) };
  };

  cursorUpHandler = () => {
    cursorDragLock = null;
  };

  cursorMoveHandler = (e) => {
    if (!state.cursorShareOn) return;
    if (!state.isInSession || !state.roomCode || !state.fileId) return;
    const now = Date.now();
    if (now - lastCursorEmitAt < 33) return; // ~30fps throttle
    lastCursorEmitAt = now;

    const r = container.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;
    const t = e.touches && e.touches[0] ? e.touches[0] : null;
    clientX = t ? t.clientX : e.clientX;
    clientY = t ? t.clientY : e.clientY;

    let pageNo = 0;
    let xPageNorm = 0;
    let yPageNorm = 0;
    if (state.mode === 'chord') {
      const inner = document.getElementById('cwInner');
      if (!inner) return;
      const ir = inner.getBoundingClientRect();
      pageNo = 1;
      xPageNorm = ir.width ? (clientX - ir.left) / ir.width : 0.5;
      yPageNorm = ir.height ? (clientY - ir.top) / ir.height : 0.5;
    } else {
      const hit = findPageAtPoint(clientX, clientY);
      if (!hit?.rect) return;
      const rect = hit.rect;
      pageNo = hit.pageNo;
      xPageNorm = rect.width ? (clientX - rect.left) / rect.width : 0;
      yPageNorm = rect.height ? (clientY - rect.top) / rect.height : 0;
    }

    const mode = state.cursorShareMode || 'line';
    // row 모드에서 "드래그 중"이면 세로 위치(y)를 고정한다.
    if (mode === 'row' && cursorDragLock?.pageNo) {
      xPageNorm = 0.5;
      yPageNorm = Number.isFinite(Number(cursorDragLock.yPageNorm)) ? cursorDragLock.yPageNorm : yPageNorm;
    }
    setCursorMarker(localCursorEl, { xNorm: xPageNorm, yNorm: yPageNorm, visible: true, mode, pageNo, yPageNorm });
    socket.emit('viewer:cursor', { roomCode: state.roomCode, fileId: state.fileId, pageNo, xPageNorm, yPageNorm, mode });
  };

  container.addEventListener('pointerdown', cursorDownHandler, { passive: true });
  container.addEventListener('pointerup', cursorUpHandler, { passive: true });
  container.addEventListener('pointercancel', cursorUpHandler, { passive: true });
  // fallback
  container.addEventListener('mousedown', cursorDownHandler, { passive: true });
  container.addEventListener('mouseup', cursorUpHandler, { passive: true });
  container.addEventListener('mouseleave', cursorUpHandler, { passive: true });
  container.addEventListener('touchstart', cursorDownHandler, { passive: true });
  container.addEventListener('touchend', cursorUpHandler, { passive: true });
  container.addEventListener('touchcancel', cursorUpHandler, { passive: true });

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
  // compact blocks object(대용량) 보관용
  chordBlocksRaw: null,
  // 마지막으로 "실제로 렌더 완료"된 fileId (동기화/리커버리 판단용)
  renderedFileId: '',
  // follow 이벤트(곡 전환) 시퀀스
  lastFileRev: 0,
  _lastFollowAt: 0,
  chordPendingAuthUrl: '',
  pageNo: 1,
  totalPages: 1,
  roomCode: null,
  isInSession: false,
  isPageTurner: false,
  isToolAuthorized: false,
  cursorShareOn: false,
  // 커서공유 디폴트: 한줄전체(row)
  cursorShareMode: String(localStorage.getItem('mb_viewer_cursorMode') || 'row') === 'line' ? 'line' : 'row',
  nickname: getOrCreateNickname(),
  overlapPx: 0,

  pdfDoc: null,
  pdfScale: 1,
  isPdfReady: false,
  // preview slice mode: iframe(임베드) + transform으로 "페이지처럼" 보여주기(보기 전용)
  previewMode: false,
  // preview iframe src (same-origin stream or drive preview url)
  previewEmbedSrc: '',

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
    const me = await fetch(apiUrl('/api/admin/me'), { credentials: 'include' }).then((r) => r.json());
    if (me?.ok) {
      authState.role = me.user.role;
      authState.displayName = me.user.displayName || me.user.userId;
    }
  } catch {}
}

// Fetch signed meta token (role hardening)
async function getSocketMetaToken() {
  try {
    const r = await fetch(apiUrl('/api/socket/meta'), { credentials: 'include' }).then((x) => x.json());
    return r?.token || '';
  } catch {
    return '';
  }
}

// ---- Socket -----------------------------------------------------------------------
const socket = io(API_URL, {
  withCredentials: true,
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
    window.location.href = buildViewerUrl({ fileId, roomCode });
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
  const existingRoom = safeRoomCode(u.searchParams.get('room'));
  // 세션 중에는 room 파라미터가 빠지면 공유 링크가 다른 방으로 인식될 수 있어, 기존 값을 유지한다.
  if (room) u.searchParams.set('room', room);
  else if (state.isInSession && existingRoom) u.searchParams.set('room', existingRoom);
  else if (existingRoom) u.searchParams.set('room', existingRoom);
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
  if (!el) return;
  const m = String(msg || '').trim();
  el.classList.toggle('hidden', !m);
  el.textContent = m;
}

function setCwMeta(msg) {
  const el = document.getElementById('cwMeta');
  if (!el) return;
  const m = String(msg || '').trim();
  el.classList.toggle('hidden', !m);
  el.textContent = m;
}

function clearChordPaneState({ keepMode = false, keepData = true } = {}) {
  try {
    if (!keepData) {
      state.chordDocId = '';
      state.chordSourceUrl = '';
      state.chordBlocks = null;
      state.chordBlocksRaw = null;
    }
  } catch {}
  try {
    const wrap = document.getElementById('cwContent');
    if (wrap) wrap.innerHTML = '';
    const host = document.getElementById('cwAnnoHost');
    if (host) host.innerHTML = '';
    setCwError('');
    setCwMeta('');
  } catch {}
  // chord 전용 fabric view가 남아있으면 PDF로 전환 시 겹칠 수 있어 정리
  try {
    clearViews();
  } catch {}
  if (!keepMode) {
    // noop (caller decides)
  }
}

function setMode(mode) {
  state.mode = mode;
  document.getElementById('pdfModeBtn')?.classList.toggle('active', mode === 'pdf');
  document.getElementById('chordModeBtn')?.classList.toggle('active', mode === 'chord');

  setHidden('pdf-container', mode !== 'pdf');
  setHidden('chordwikiPane', mode !== 'chord');

  if (mode === 'pdf') {
    document.getElementById('linkInput')?.setAttribute('placeholder', '구글드라이브 PDF 링크 또는 fileId');
    // chord 모드에서 PDF로 넘어갈 때는 chord UI/캔버스를 확실히 정리한다.
    // 단, 다시 "코드" 탭으로 돌아올 수 있어야 하므로 데이터(state.chordDocId 등)는 유지한다.
    clearChordPaneState({ keepMode: true, keepData: true });
    // restore pdf fileId for viewer internals
    if (state.pdfFileId) {
      state.fileId = state.pdfFileId;
      loadPdf(state.fileId).catch(() => {});
    }
  } else {
    document.getElementById('linkInput')?.setAttribute('placeholder', '코드위키 링크를 넣으면 새 탭으로 엽니다');
    // if previously opened chord doc, keep it
    if (state.chordDocId) state.fileId = state.chordDocId;
    // chord 모드 진입 시 스크롤 우선(선택 도구)
    if (state.tool !== 'select') setTool('select');
  }

  const cwHost = document.getElementById('cwAnnoHost');
  if (cwHost) cwHost.style.pointerEvents = state.mode === 'chord' && state.tool === 'select' ? 'none' : 'auto';
}

document.getElementById('pdfModeBtn')?.addEventListener('click', () => setMode('pdf'));
document.getElementById('chordModeBtn')?.addEventListener('click', async () => {
  // chord 데이터가 없으면 아무 것도 하지 않는다.
  if (!state.chordDocId && !state.chordBlocks && !state.chordBlocksRaw) return;
  setMode('chord');
  try {
    // 이미 렌더된 경우는 패스
    const wrap = document.getElementById('cwContent');
    const hasDom = Boolean(wrap && wrap.children && wrap.children.length);
    if (hasDom) return;
  } catch {}
  try {
    if (state.chordBlocksRaw && typeof state.chordBlocksRaw === 'object' && !Array.isArray(state.chordBlocksRaw)) {
      renderChordCompact(state.chordBlocksRaw);
      return;
    }
    if (Array.isArray(state.chordBlocks) && state.chordBlocks.length) {
      renderChordBlocks(state.chordBlocks);
      return;
    }
    if (state.chordDocId) {
      await openChordByDocId(state.chordDocId, { broadcast: false });
    }
  } catch {}
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

  const isWideChar = (ch) => /[\u3040-\u30ff\u3400-\u9fff\uAC00-\uD7AF\u3000-\u303F\uFF00-\uFFEF]/.test(String(ch || ''));
  const textToCols = (text) => {
    const cols = [];
    const s = String(text ?? '');
    for (const ch of Array.from(s)) {
      cols.push(ch);
      if (isWideChar(ch)) cols.push(' '); // 전각 2칸 보정
    }
    return cols;
  };
  const blocksToLines = (arr) => {
    /** @type {Array<Array<any>>} */
    const lines = [];
    let cur = [];
    for (const b of arr) {
      if (b?.lyric_raw === '\n') {
        lines.push(cur);
        cur = [];
        continue;
      }
      cur.push(b);
    }
    if (cur.length) lines.push(cur);
    return lines;
  };

  // ---- 5) BPM/저작권 제거 ----------------------------------------------------------
  const rawLines = blocksToLines(blocks);
  const rawTextLines = rawLines.map((ln) => ln.map((b) => String(b?.lyric_raw ?? '')).join(''));
  let bpmIdx = -1;
  for (let i = 0; i < rawTextLines.length; i += 1) {
    if (/\bbpm\b/i.test(rawTextLines[i] || '')) {
      bpmIdx = i;
      break;
    }
  }
  // BPM 라인이 있으면 "BPM 포함 라인 + 그 위" 전부 제거
  let linesFiltered = bpmIdx >= 0 ? rawLines.slice(bpmIdx + 1) : rawLines.slice();
  linesFiltered = linesFiltered.filter((ln) => {
    const t = ln.map((b) => String(b?.lyric_raw ?? '')).join('');
    if (!t.trim()) return false;
    if (/copyright/i.test(t) || /©/.test(t)) return false;
    return true;
  });

  // ---- 1) 바(|) 단위 래핑 + 2) 코드 겹침 방지 + 3) 세트 간 간격 + 4) 마디폭 표준화 ----
  const pref = loadCwPrefs();
  const MAX_LINE_COLS = Number(pref.maxLineCols || 120); // 마디 단위 줄바꿈 폭
  const MAX_MEASURE_COLS_CAP = Number(pref.maxMeasureCap || 36); // 표준 마디폭 cap
  const SET_GAP_LINES = Number(pref.gapLines ?? 1); // 세트 간 간격(빈 줄 개수)
  const FIXED_MEASURES = String(pref.layout || 'auto').startsWith('m') ? Number(String(pref.layout).slice(1)) : 0;

  const renderLineToCols = (ln) => {
    /** @type {Array<{baseCol:number, token:string}>} */
    const chordEvents = [];
    /** @type {string[]} */
    const lyricCols = [];
    let col = 0;
    for (const b of ln) {
      let chordTok = String(b?.chord || '').trim();
      let lyricText = String(b?.lyric_kr ?? b?.lyric_raw ?? '');
      // ♥♠ 등 보컬 분배 기호는 "코드"가 아니라 가사로 보여야 한다(기존 데이터 호환)
      if (/^[♥♠♦♣♡○●◎★☆▲▼■□▶◀]+$/.test(chordTok) && !String(lyricText || '').trim()) {
        lyricText = chordTok;
        chordTok = '';
      }
      if (chordTok) chordEvents.push({ baseCol: col, token: chordTok });
      const cols = textToCols(lyricText || ' ');
      lyricCols.push(...cols);
      col += cols.length;
    }
    /** @type {string[]} */
    const chordCols = Array.from({ length: lyricCols.length }, () => ' ');

    // 2) 코드가 겹치면, 해당 위치에 공백을 "삽입"해 마디 내부를 늘린다.
    chordEvents.sort((a, b) => a.baseCol - b.baseCol);
    let shift = 0;
    let lastEnd = -1;
    for (const ev of chordEvents) {
      const base = Math.max(0, Number(ev.baseCol) + shift);
      let start = Math.max(base, lastEnd + 1);
      if (start > base) {
        const insert = start - base;
        lyricCols.splice(base, 0, ...Array.from({ length: insert }, () => ' '));
        chordCols.splice(base, 0, ...Array.from({ length: insert }, () => ' '));
        shift += insert;
      }
      while (chordCols.length < start + ev.token.length) {
        chordCols.push(' ');
        lyricCols.push(' ');
      }
      for (let k = 0; k < ev.token.length; k += 1) chordCols[start + k] = ev.token[k];
      lastEnd = start + ev.token.length - 1;
    }
    while (chordCols.length < lyricCols.length) chordCols.push(' ');
    while (lyricCols.length < chordCols.length) lyricCols.push(' ');

    // 공백만 있는 좌/우 여백은 줄 전체 폭을 불필요하게 키워 "의미없는 여백 구간"을 만든다.
    // (특히 코드위키 추출 시 라인 시작/끝에 인덴트가 과도하게 들어오는 케이스)
    let left = 0;
    while (left < lyricCols.length && lyricCols[left] === ' ' && chordCols[left] === ' ') left += 1;
    let right = lyricCols.length - 1;
    while (right >= left && lyricCols[right] === ' ' && chordCols[right] === ' ') right -= 1;
    if (right < left) return { lyricCols: [' '], chordCols: [' '] };
    if (left > 0 || right < lyricCols.length - 1) {
      return { lyricCols: lyricCols.slice(left, right + 1), chordCols: chordCols.slice(left, right + 1) };
    }
    return { lyricCols, chordCols };
  };

  const splitMeasures = (lyricCols, chordCols) => {
    /** @type {Array<{ly:string[], ch:string[]}>} */
    const measures = [];
    let bufLy = [];
    let bufCh = [];
    let hasBar = false;
    const flush = () => {
      measures.push({ ly: bufLy, ch: bufCh });
      bufLy = [];
      bufCh = [];
    };
    for (let i = 0; i < lyricCols.length; i += 1) {
      const ly = lyricCols[i];
      const ch = chordCols[i] || ' ';
      if (ly === '|') {
        // bar는 "마디 닫힘"이므로 직전 마디에 포함시켜야 한다(바가 닫히기 전 개행 금지)
        bufLy.push('|');
        bufCh.push(ch);
        hasBar = true;
        flush();
        continue;
      }
      bufLy.push(ly);
      bufCh.push(ch);
    }
    flush();
    return { measures, hasBar };
  };

  /** @type {Array<{lyricCols:string[], chordCols:string[]}>} */
  const rendered = [];

  // global 마디폭(선택): 전체 라인에서 가장 긴 마디를 기준으로(단 cap 적용)
  let globalStd = 0;
  if (pref.measureStd === 'global') {
    for (const ln of linesFiltered) {
      const { lyricCols, chordCols } = renderLineToCols(ln);
      const { measures, hasBar } = splitMeasures(lyricCols, chordCols);
      if (!hasBar) continue;
      for (const m of measures) {
        const endsWithBar = m.ly.length && m.ly[m.ly.length - 1] === '|';
        const bodyLen = m.ly.length - (endsWithBar ? 1 : 0);
        globalStd = Math.max(globalStd, bodyLen);
      }
    }
    globalStd = Math.min(globalStd, MAX_MEASURE_COLS_CAP);
  }

  for (const ln of linesFiltered) {
    const { lyricCols, chordCols } = renderLineToCols(ln);
    const { measures, hasBar } = splitMeasures(lyricCols, chordCols);

    // 4) 마디폭 표준화:
    // - off: 패딩 없음
    // - line: 해당 줄에서 가장 긴 마디 길이 기준
    // - global: 전체에서 가장 긴 마디 길이 기준
    let std = 0;
    if (pref.measureStd === 'off') std = 0;
    else if (pref.measureStd === 'global') std = globalStd;
    else if (hasBar) {
      for (const m of measures) {
        const endsWithBar = m.ly.length && m.ly[m.ly.length - 1] === '|';
        const bodyLen = m.ly.length - (endsWithBar ? 1 : 0);
        std = Math.max(std, bodyLen);
      }
      std = Math.min(std, MAX_MEASURE_COLS_CAP);
    }

    /** @type {Array<string>} */
    let curLy = [];
    /** @type {Array<string>} */
    let curCh = [];
    let curLen = 0;
    let curMeasureCount = 0;
    const pushLine = () => {
      if (!curLy.length && !curCh.length) return;
      // 1) 바가 열렸는데 닫히기 전에 줄바꿈이 생기는 것 방지:
      // 여기서는 measure 단위로만 라인을 푸시하므로 "바 토큰"이 끊기지 않는다.
      rendered.push({ lyricCols: curLy, chordCols: curCh });
      curLy = [];
      curCh = [];
      curLen = 0;
      curMeasureCount = 0;
    };

    for (const m of measures) {
      const endsWithBar = m.ly.length && m.ly[m.ly.length - 1] === '|';
      const bodyLy = endsWithBar ? m.ly.slice(0, -1) : m.ly.slice();
      const bodyCh = endsWithBar ? m.ch.slice(0, -1) : m.ch.slice();
      const pad = std > 0 ? Math.max(0, std - bodyLy.length) : 0;
      const lyPart = [...bodyLy, ...Array.from({ length: pad }, () => ' '), ...(endsWithBar ? ['|'] : [])];
      const chPart = [...bodyCh, ...Array.from({ length: pad }, () => ' '), ...(endsWithBar ? [m.ch[m.ch.length - 1] || ' '] : [])];

      const isBarOnly = lyPart.length === 1 && lyPart[0] === '|';
      const nextMeasureCount = isBarOnly ? curMeasureCount : curMeasureCount + 1;

      // 래핑(선택):
      // - fixed: 마디 N개 단위
      // - auto: 폭 기반
      if (FIXED_MEASURES > 0 && curLen > 0 && curMeasureCount >= FIXED_MEASURES && !isBarOnly) pushLine();
      if (curLen > 0 && curLen + lyPart.length > MAX_LINE_COLS && !isBarOnly) pushLine();

      curLy.push(...lyPart);
      curCh.push(...chPart);
      curLen += lyPart.length;
      curMeasureCount = nextMeasureCount;
    }
    pushLine();
  }

  // ---- 3) 세트 간 간격 + 출력 -------------------------------------------------------
  const pre = document.createElement('pre');
  pre.className = 'cwPre';
  pre.style.whiteSpace = 'pre';
  pre.style.margin = '0';
  pre.style.padding = '12px';
  pre.style.fontFamily =
    "'D2Coding','D2 Coding', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  pre.style.fontSize = '14px';
  applyCwPrefToPre(pre);

  let out = '';
  for (const ln of rendered) {
    out += ln.chordCols.join('') + '\n' + ln.lyricCols.join('') + '\n' + '\n'.repeat(SET_GAP_LINES);
  }
  pre.textContent = out.trimEnd();
  wrap.appendChild(pre);
  try {
    // 텍스트 렌더 후 캔버스(주석) 레이어를 덮는다.
    setupChordAnnoAfterRender();
  } catch {}
}

function expandCompactChordBlocks(blocks) {
  const b = blocks;
  if (!b || typeof b !== 'object') return blocks;
  if (Array.isArray(b)) return b;
  const fmt = String(b.format || '');
  if (fmt !== 'mb_chord_compact_v1' && fmt !== 'mb_chord_compact_v2') return blocks;
  const lines = Array.isArray(b.lines) ? b.lines : [];
  /** @type {Array<any>} */
  const out = [];
  const rleDecode = (arr) => {
    if (!Array.isArray(arr)) return '';
    let s = '';
    for (const it of arr) {
      if (!Array.isArray(it) || it.length < 2) continue;
      if (it[0] === 0) s += ' '.repeat(Number(it[1] || 0));
      else s += String(it[1] || '');
    }
    return s;
  };
  for (const ln of lines) {
    const raw = fmt === 'mb_chord_compact_v2' ? rleDecode(ln?.rawRle) : String(ln?.raw || '');
    const kr = fmt === 'mb_chord_compact_v2' ? rleDecode(ln?.krRle) : String(ln?.kr || '');
    const chordArr = Array.isArray(ln?.chords) ? ln.chords : [];
    const chordMap = new Map();
    for (const c of chordArr) {
      const col = Number(c?.col);
      const tok = String(c?.token || '');
      if (Number.isFinite(col) && tok) chordMap.set(col, tok);
    }
    const maxLen = Math.max(raw.length, kr.length);
    for (let i = 0; i < maxLen; i += 1) {
      out.push({
        chord: chordMap.get(i) || '',
        lyric_raw: raw[i] ?? ' ',
        lyric_kr: kr[i] ?? raw[i] ?? ' '
      });
    }
    out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
  }
  return out;
}

function renderChordCompact(compact) {
  const wrap = document.getElementById('cwContent');
  if (!wrap) return;
  wrap.innerHTML = '';

  const fmt = String(compact?.format || '');
  const lines = Array.isArray(compact?.lines) ? compact.lines : [];
  if (!lines.length) {
    setCwError('파싱 결과가 비었습니다.');
    return;
  }
  setCwError('');

  // compact는 per-cell DOM을 만들지 않고 <pre> 한 번으로 렌더(대용량에서도 안전)
  const pre = document.createElement('pre');
  pre.className = 'cwPre';
  pre.style.whiteSpace = 'pre';
  pre.style.margin = '0';
  pre.style.padding = '12px';
  pre.style.fontFamily =
    "'D2Coding','D2 Coding', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  pre.style.fontSize = '14px';
  applyCwPrefToPre(pre);

  const isWideChar = (ch) => /[\u3040-\u30ff\u3400-\u9fff\uAC00-\uD7AF\u3000-\u303F\uFF00-\uFFEF]/.test(String(ch || ''));
  const buildCharToCol = (text) => {
    const chars = Array.from(String(text ?? ''));
    /** @type {number[]} */
    const map = new Array(chars.length);
    let col = 0;
    for (let i = 0; i < chars.length; i += 1) {
      map[i] = col;
      col += isWideChar(chars[i]) ? 2 : 1;
    }
    return { chars, map, totalCols: col };
  };
  const textToCols = (text) => {
    const cols = [];
    const s = String(text ?? '');
    for (const ch of Array.from(s)) {
      cols.push(ch);
      if (isWideChar(ch)) cols.push(' ');
    }
    return cols;
  };

  const rleDecode = (arr) => {
    if (!Array.isArray(arr)) return '';
    let s = '';
    for (const it of arr) {
      if (!Array.isArray(it) || it.length < 2) continue;
      if (it[0] === 0) s += ' '.repeat(Number(it[1] || 0));
      else s += String(it[1] || '');
    }
    return s;
  };

  const decodeLineText = (ln) => {
    if (fmt === 'mb_chord_compact_v2') return rleDecode(ln?.krRle) || rleDecode(ln?.rawRle) || '';
    return String(ln?.kr || ln?.raw || '');
  };

  // renderChordBlocks와 동일한 정책:
  // - 마디(|) 단위 줄바꿈(바가 닫히기 전에 개행 금지)
  // - 코드 겹침 방지(필요 시 공백 삽입)
  // - 마디폭 표준화(선택: 줄/전체/끄기)
  const pref = loadCwPrefs();
  const MAX_LINE_COLS = Number(pref.maxLineCols || 120);
  const MAX_MEASURE_COLS_CAP = Number(pref.maxMeasureCap || 36);
  const SET_GAP_LINES = Number(pref.gapLines ?? 1);
  const FIXED_MEASURES = String(pref.layout || 'auto').startsWith('m') ? Number(String(pref.layout).slice(1)) : 0;

  const buildMeasuresFromLine = (lyricText, chordArr) => {
    const { chars, map, totalCols } = buildCharToCol(lyricText);
    const lyricCols = textToCols(lyricText);
    const chordCols = Array.from({ length: lyricCols.length }, () => ' ');
    const chords = Array.isArray(chordArr) ? chordArr : [];
    const maxCol = chords.reduce((m, c) => Math.max(m, Number(c?.col) || 0), 0);
    const needCharIndexToDisplayCol = !compact?.widePad && totalCols > chars.length && maxCol <= chars.length;
    /** @type {Array<{baseCol:number, token:string}>} */
    const events = [];
    chords.forEach((c) => {
      const rawCol = Number(c?.col);
      const tok = String(c?.token || '');
      if (!Number.isFinite(rawCol) || rawCol < 0 || !tok) return;
      const baseCol = needCharIndexToDisplayCol ? Number(map[rawCol] ?? rawCol) : rawCol;
      events.push({ baseCol, token: tok });
    });
    events.sort((a, b) => a.baseCol - b.baseCol);
    let shift = 0;
    let lastEnd = -1;
    for (const ev of events) {
      const base = Math.max(0, Number(ev.baseCol) + shift);
      let start = Math.max(base, lastEnd + 1);
      if (start > base) {
        const ins = start - base;
        lyricCols.splice(base, 0, ...Array.from({ length: ins }, () => ' '));
        chordCols.splice(base, 0, ...Array.from({ length: ins }, () => ' '));
        shift += ins;
      }
      while (chordCols.length < start + ev.token.length) {
        chordCols.push(' ');
        lyricCols.push(' ');
      }
      for (let k = 0; k < ev.token.length; k += 1) chordCols[start + k] = ev.token[k];
      lastEnd = start + ev.token.length - 1;
    }
    while (chordCols.length < lyricCols.length) chordCols.push(' ');
    while (lyricCols.length < chordCols.length) lyricCols.push(' ');

    // 의미없는 좌/우 공백 트림(폭 폭발 방지)
    let left = 0;
    while (left < lyricCols.length && lyricCols[left] === ' ' && chordCols[left] === ' ') left += 1;
    let right = lyricCols.length - 1;
    while (right >= left && lyricCols[right] === ' ' && chordCols[right] === ' ') right -= 1;
    if (right < left) {
      lyricCols.splice(0, lyricCols.length, ' ');
      chordCols.splice(0, chordCols.length, ' ');
    } else if (left > 0 || right < lyricCols.length - 1) {
      const ly2 = lyricCols.slice(left, right + 1);
      const ch2 = chordCols.slice(left, right + 1);
      lyricCols.splice(0, lyricCols.length, ...ly2);
      chordCols.splice(0, chordCols.length, ...ch2);
    }

    // measure split
    /** @type {Array<{ly:string[], ch:string[]}>} */
    const measures = [];
    let bufLy = [];
    let bufCh = [];
    let hasBar = false;
    const flush = () => {
      measures.push({ ly: bufLy, ch: bufCh });
      bufLy = [];
      bufCh = [];
    };
    for (let i = 0; i < lyricCols.length; i += 1) {
      const ly = lyricCols[i];
      const ch = chordCols[i] || ' ';
      if (ly === '|') {
        bufLy.push('|');
        bufCh.push(ch);
        hasBar = true;
        flush();
      } else {
        bufLy.push(ly);
        bufCh.push(ch);
      }
    }
    flush();
    return { measures, hasBar };
  };

  /** @type {Array<{lyricCols:string[], chordCols:string[]}>} */
  const renderedLines = [];
  let globalStd = 0;
  if (pref.measureStd === 'global') {
    for (const ln of lines) {
      const lyric = decodeLineText(ln);
      const { measures, hasBar } = buildMeasuresFromLine(lyric, ln?.chords);
      if (!hasBar) continue;
      for (const m of measures) {
        const endsWithBar = m.ly.length && m.ly[m.ly.length - 1] === '|';
        const bodyLen = m.ly.length - (endsWithBar ? 1 : 0);
        globalStd = Math.max(globalStd, bodyLen);
      }
    }
    globalStd = Math.min(globalStd, MAX_MEASURE_COLS_CAP);
  }

  for (const ln of lines) {
    const lyric = decodeLineText(ln);
    const { measures, hasBar } = buildMeasuresFromLine(lyric, ln?.chords);

    let std = 0;
    if (pref.measureStd === 'off') std = 0;
    else if (pref.measureStd === 'global') std = globalStd;
    else if (hasBar) {
      for (const m of measures) {
        const endsWithBar = m.ly.length && m.ly[m.ly.length - 1] === '|';
        const bodyLen = m.ly.length - (endsWithBar ? 1 : 0);
        std = Math.max(std, bodyLen);
      }
      std = Math.min(std, MAX_MEASURE_COLS_CAP);
    }

    /** @type {Array<{ly:string[], ch:string[]}>} */
    const packed = measures.map((m) => {
      const endsWithBar = m.ly.length && m.ly[m.ly.length - 1] === '|';
      const bodyLy = endsWithBar ? m.ly.slice(0, -1) : m.ly.slice();
      const bodyCh = endsWithBar ? m.ch.slice(0, -1) : m.ch.slice();
      const pad = std > 0 ? Math.max(0, std - bodyLy.length) : 0;
      return {
        ly: [...bodyLy, ...Array.from({ length: pad }, () => ' '), ...(endsWithBar ? ['|'] : [])],
        ch: [...bodyCh, ...Array.from({ length: pad }, () => ' '), ...(endsWithBar ? [m.ch[m.ch.length - 1] || ' '] : [])]
      };
    });

    // wrap by measure boundary (auto: 폭 / fixed: 마디 수)
    let curLy = [];
    let curCh = [];
    let curLen = 0;
    let curMeasureCount = 0;
    const push = () => {
      if (!curLy.length) return;
      renderedLines.push({ lyricCols: curLy, chordCols: curCh });
      curLy = [];
      curCh = [];
      curLen = 0;
      curMeasureCount = 0;
    };
    for (const m of packed) {
      const isBarOnly = m.ly.length === 1 && m.ly[0] === '|';
      const nextMeasureCount = isBarOnly ? curMeasureCount : curMeasureCount + 1;
      if (FIXED_MEASURES > 0 && curLen > 0 && curMeasureCount >= FIXED_MEASURES && !isBarOnly) push();
      if (curLen > 0 && curLen + m.ly.length > MAX_LINE_COLS && !isBarOnly) push();
      curLy.push(...m.ly);
      curCh.push(...m.ch);
      curLen += m.ly.length;
      curMeasureCount = nextMeasureCount;
    }
    push();
  }

  let out = '';
  for (const ln of renderedLines) {
    out += ln.chordCols.join('') + '\n' + ln.lyricCols.join('') + '\n' + '\n'.repeat(SET_GAP_LINES);
  }
  pre.textContent = out.trimEnd();
  wrap.appendChild(pre);
  try {
    // 텍스트 렌더 후 캔버스(주석) 레이어를 덮는다.
    setupChordAnnoAfterRender();
  } catch {}
}

function isAllowedChordWikiOrigin(origin) {
  const o = String(origin || '');
  return (
    o.endsWith('://ja.chordwiki.org') ||
    o.endsWith('://www.chordwiki.org') ||
    o.endsWith('://chordwiki.org') ||
    o.endsWith('://chordwiki.jp') ||
    o.endsWith('://www.chordwiki.jp')
  );
}

function setupChordPostMessageReceiver() {
  // NOTE:
  // postMessage로 받은 "임시 chord payload"는 일반 PDF/기타 뷰어 동작을 방해하면 안 된다.
  // 따라서 sessionStorage 복원은 `?from=postmessage`로 열린 탭에서만 수행한다.
  let allowRestore = false;
  try {
    const u = new URL(window.location.href);
    allowRestore = String(u.searchParams.get('from') || '') === 'postmessage';
  } catch {}

  // chunk 수신 버퍼 (tab life 동안만)
  const chunkStore = new Map(); // transferId -> { total, got:Set, chunks:Array<string>, sourceUrl }

  const tryAssemble = (transferId, ev) => {
    const st = chunkStore.get(transferId);
    if (!st) return;
    if (st.got.size !== st.total) return;
    try {
      const json = st.chunks.join('');
      const payload = JSON.parse(json);
      const blocks = payload?.blocks;
      if (!blocks) return;
      setMode('chord');
      setCwError('');
      setCwMeta('');
      state.chordDocId = '';
      state.chordSourceUrl = String(payload?.sourceUrl || st.sourceUrl || '');
      state.chordBlocks = expandCompactChordBlocks(blocks);
      state.fileId = state.chordSourceUrl ? `chordmsg:${hashString(state.chordSourceUrl)}` : `chordmsg:${Date.now()}`;
      renderChordBlocks(state.chordBlocks);
      // opener에 수신 완료 ack
      try {
        ev.source?.postMessage?.(
          { type: 'mb_chord_ack_v1', ok: true, lines: Array.isArray(blocks?.lines) ? blocks.lines.length : 0 },
          ev.origin
        );
      } catch {}
      try {
        sessionStorage.setItem('mb_lastChordMsg', JSON.stringify({ sourceUrl: state.chordSourceUrl, blocks }));
      } catch {}
    } catch {}
    chunkStore.delete(transferId);
  };

  window.addEventListener('message', (ev) => {
    try {
      if (!isAllowedChordWikiOrigin(ev.origin)) return;
      const d = ev.data || {};
      // 1) small payload (legacy)
      if (d?.type === 'mb_chord_payload_v1') {
        const blocks = d.blocks;
        if (!blocks) return;
        setMode('chord');
        setCwError('');
        setCwMeta('');
        state.chordDocId = '';
        state.chordSourceUrl = String(d.sourceUrl || '');
        state.chordBlocks = expandCompactChordBlocks(blocks);
        state.fileId = state.chordSourceUrl ? `chordmsg:${hashString(state.chordSourceUrl)}` : `chordmsg:${Date.now()}`;
        renderChordBlocks(state.chordBlocks);
        // opener에 수신 완료 ack
        try {
          ev.source?.postMessage?.(
            { type: 'mb_chord_ack_v1', ok: true, lines: Array.isArray(blocks?.lines) ? blocks.lines.length : 0 },
            ev.origin
          );
        } catch {}
        try {
          sessionStorage.setItem('mb_lastChordMsg', JSON.stringify({ sourceUrl: state.chordSourceUrl, blocks }));
        } catch {}
        return;
      }

      // 2) chunked payload (new)
      if (d?.type === 'mb_chord_init_v1') {
        const transferId = String(d.transferId || '');
        const total = Number(d.totalChunks || 0);
        if (!transferId || !Number.isFinite(total) || total <= 0 || total > 5000) return;
        chunkStore.set(transferId, { total, got: new Set(), chunks: Array.from({ length: total }, () => ''), sourceUrl: String(d.sourceUrl || '') });
        return;
      }
      if (d?.type === 'mb_chord_chunk_v1') {
        const transferId = String(d.transferId || '');
        const idx = Number(d.idx);
        const chunk = String(d.chunk || '');
        const st = chunkStore.get(transferId);
        if (!st || !Number.isFinite(idx) || idx < 0 || idx >= st.total) return;
        if (!st.got.has(idx)) {
          st.got.add(idx);
          st.chunks[idx] = chunk;
        }
        tryAssemble(transferId, ev);
        return;
      }
    } catch {}
  });

  // opener(ChordWiki 탭)에게 "ready" 신호를 보내 payload 유실을 방지한다.
  try {
    if (allowRestore && window.opener && typeof window.opener.postMessage === 'function') {
      const ping = () => {
        try {
          window.opener.postMessage({ type: 'mb_viewer_ready_v1' }, '*');
        } catch {}
      };
      ping();
      setTimeout(ping, 250);
      setTimeout(ping, 900);
    }
  } catch {}

  // 새로고침 시 마지막 메시지를 복원
  if (allowRestore) {
    try {
      const s = sessionStorage.getItem('mb_lastChordMsg');
      if (s) {
        const d = JSON.parse(s);
        if (d?.blocks) {
          setMode('chord');
          state.chordSourceUrl = String(d.sourceUrl || '');
          state.chordBlocks = expandCompactChordBlocks(d.blocks);
          state.fileId = state.chordSourceUrl ? `chordmsg:${hashString(state.chordSourceUrl)}` : `chordmsg:${Date.now()}`;
          renderChordBlocks(state.chordBlocks);
        }
      }
    } catch {}
  }
}

function setupChordAnnoAfterRender() {
  if (state.mode !== 'chord') return;
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

async function openChordByDocId(docId, { broadcast } = { broadcast: true }) {
  const id = String(docId || '').trim();
  if (!id) return;
  setMode('chord');
  setCwError('불러오는 중...');
  setCwMeta('');

  // 강제 종결 토큰(무한 로딩 방지)
  openChordByDocId._seq = (openChordByDocId._seq || 0) + 1;
  const seq = openChordByDocId._seq;

  let r;
  let forceTimeout = null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    // AbortController가 브라우저/환경에 따라 100% 동작하지 않는 케이스를 대비해,
    // 9초가 지나면 UI를 실패로 강제 전환한다.
    forceTimeout = setTimeout(() => {
      if (seq !== openChordByDocId._seq) return;
      // "불러오는 중..." 상태에서만 강제 TIMEOUT을 표시(성공/실패로 종결된 경우 덮어쓰지 않기)
      const el = document.getElementById('cwError');
      const cur = String(el?.textContent || '').trim();
      if (cur === '불러오는 중...') setCwError('불러오기 실패: TIMEOUT');
    }, 9000);
    r = await fetch(apiUrl(`/api/chord-doc?docId=${encodeURIComponent(id)}`), { signal: controller.signal }).then((x) => x.json());
    clearTimeout(t);
  } catch (e) {
    r = { ok: false, error: `NETWORK_ERROR: ${String(e?.message || e)}` };
  }
  try {
    if (forceTimeout) clearTimeout(forceTimeout);
    if (seq !== openChordByDocId._seq) return;
    if (!r?.ok) {
      setCwError(`불러오기 실패: ${r?.error || ''}`);
      return;
    }

    state.chordDocId = id;
    state.chordSourceUrl = String(r?.meta?.sourceUrl || '');
    const blocksObj = r.blocks || [];
    const isCompact =
      blocksObj && typeof blocksObj === 'object' && !Array.isArray(blocksObj) && String(blocksObj.format || '').startsWith('mb_chord_compact_');
    // 대용량 array도 per-cell DOM 렌더는 터질 수 있으니 compact 저장이 오면 그대로 렌더한다.
    state.chordBlocks = isCompact ? null : expandCompactChordBlocks(blocksObj);
    state.chordBlocksRaw = isCompact ? blocksObj : null;
    state.fileId = id;
    state.annoStore = {};
    state.undoStack = {};
    state.redoStack = {};
    if (state.isInSession && state.roomCode) socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId: state.fileId });

    if (broadcast && state.isInSession && state.isPageTurner && state.roomCode) {
      socket.emit('session:follow:file', { roomCode: state.roomCode, fileId: id, originalLink: state.chordSourceUrl || '' }, () => {});
    }

    setCwError('');
    if (isCompact) renderChordCompact(blocksObj);
    else renderChordBlocks(state.chordBlocks);
    state.renderedFileId = id;

    // chord 탭 활성화(코드<->PDF 전환 지원)
    const chordBtn = document.getElementById('chordModeBtn');
    if (chordBtn) chordBtn.classList.remove('hidden');
    document.getElementById('pdfModeBtn')?.classList.remove('active');
    chordBtn?.classList.add('active');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[viewer] render_error', e);
    setCwError(`불러오기 실패: RENDER_ERROR`);
    try {
      setCwMeta(String(e?.message || e).slice(0, 180));
    } catch {}
  } finally {
    if (forceTimeout) clearTimeout(forceTimeout);
  }
}

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
// 노래책 검색 입력 중 Space 등을 누를 때 뒤쪽 악보 페이지터닝 단축키로 전파되지 않게 한다.
document.getElementById('songPickSearch')?.addEventListener('keydown', (e) => {
  e.stopPropagation();
});

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
    const nextUrl = buildViewerUrl({ fileId: state.fileId || '', roomCode });
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
  // 코드위키는 뷰어에서 직접 크롤/파싱하지 않는다.
  // 링크를 입력하면 해당 페이지를 새 탭으로 열어주고, 거기서 Tampermonkey 버튼으로 docId를 생성해 들어오게 한다.
  if (!extractDriveFileId(trimmed) && /^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (state.isInSession && state.roomCode) u.searchParams.set('mb_room', String(state.roomCode));
      window.open(u.toString(), '_blank');
    } catch {
      try {
        window.open(trimmed, '_blank');
      } catch {}
    }
    flashHud('ChordWiki 탭에서 “🎵 ScoreViewer로 열기” 버튼을 누르세요', 1600);
    return;
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
          buildViewerUrl({ fileId: state.fileId, roomCode })
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
      fetch(apiUrl('/api/drive/import'), {
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
    window.location.href = buildViewerUrl({ fileId, roomCode: roomParam ? roomCode : '' });
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

  // Undo/Redo (annotation)
  if (e.ctrlKey || e.metaKey) {
    const k = String(e.key || '').toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoForActivePage();
      else undoForActivePage();
      return;
    }
    if (k === 'y') {
      e.preventDefault();
      redoForActivePage();
      return;
    }
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

let suppressScrollSync = false;

function setContentBoxSize(w, h) {
  const ww = Math.max(1, Math.floor(Number(w) || 0));
  const hh = Math.max(1, Math.floor(Number(h) || 0));
  state._contentW = ww;
  state._contentH = hh;
  if (state.fitMode) {
    // keep centered fit layout
    els.canvasStack.style.width = '100%';
    els.canvasStack.style.height = '100%';
  } else {
    // IMPORTANT: 줌 모드에서는 "양수 방향"으로 스크롤 영역이 생기도록, 컨텐츠 박스를 실치수로 고정한다.
    // (flex-center 상태에서 overflow가 좌/상 방향으로 튀면 스크롤/동기화가 깨지는 문제 방지)
    els.canvasStack.style.width = `${ww}px`;
    els.canvasStack.style.height = `${hh}px`;
  }
}

function applyPanScroll() {
  const contW = Math.max(1, els.pdfContainer.clientWidth || 1);
  const contH = Math.max(1, els.pdfContainer.clientHeight || 1);
  const maxX = Math.max(0, Number(state._contentW || 0) - contW);
  const maxY = Math.max(0, Number(state._contentH || 0) - contH);
  state._panMaxX = maxX;
  state._panMaxY = maxY;

  state.panX = clamp01(state.panX);
  state.panY = clamp01(state.panY);

  // followers: 줌 상태에서는 스크롤이 우선(캔버스가 터치를 먹지 않게)
  const isFollower = state.isInSession && !state.isPageTurner;
  els.canvasStack.classList.toggle('scroll-pan', Boolean(isFollower) && !state.fitMode);

  // fit 모드(또는 오버플로우 없음)에서는 스크롤/팬 비활성
  if (state.fitMode || (!maxX && !maxY)) {
    suppressScrollSync = true;
    els.pdfContainer.style.overflow = 'hidden';
    els.pdfContainer.scrollLeft = 0;
    els.pdfContainer.scrollTop = 0;
    setTimeout(() => (suppressScrollSync = false), 0);
    els.canvasStack.style.justifyContent = 'center';
    els.canvasStack.style.alignItems = 'center';
    // restore sizing for fit
    els.canvasStack.style.width = '100%';
    els.canvasStack.style.height = '100%';
    state.panX = 0;
    state.panY = 0;
    return;
  }

  // zoom 모드: native scroll로 패닝(더 안정적, "날아감" 방지)
  els.pdfContainer.style.overflow = 'auto';
  els.canvasStack.style.justifyContent = 'flex-start';
  els.canvasStack.style.alignItems = 'flex-start';
  const left = Math.round(maxX * state.panX);
  const top = Math.round(maxY * state.panY);
  suppressScrollSync = true;
  if (Number.isFinite(left)) els.pdfContainer.scrollLeft = left;
  if (Number.isFinite(top)) els.pdfContainer.scrollTop = top;
  setTimeout(() => (suppressScrollSync = false), 0);
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
  const src = String(state.previewEmbedSrc || '').trim() || apiUrl(`/api/drive/embed/${encodeURIComponent(state.fileId)}${roomParam}`);

  clearPreviewViews();
  const gap = 12;
  setContentBoxSize(
    Math.max(1, state.spreadCount) * previewPageW + gap * Math.max(0, state.spreadCount - 1),
    previewPageH
  );
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
  applyPanScroll();
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
      const tgt = opt?.target;
      // 이미 있는 텍스트를 눌렀으면 그대로 편집 진입(새 텍스트 생성 X)
      if (tgt && tgt.type === 'i-text') {
        try {
          fabricCanvas.setActiveObject(tgt);
          tgt.enterEditing?.();
          tgt.selectAll?.();
          fabricCanvas.requestRenderAll();
        } catch {}
        return;
      }
      // 다른 오브젝트를 누른 경우: 선택/이동만 하고 새 텍스트는 만들지 않는다.
      if (tgt) return;

      const color = String(state.brushColor || '#ff2d55');
      const it = new fabric.IText('텍스트', {
        left: p.x,
        top: p.y,
        fontSize: state.textFontSize || 22,
        fill: color,
        fontWeight: 700
      });
      fabricCanvas.add(it);
      fabricCanvas.setActiveObject(it);
      // NOTE: 편집 진입을 다음 tick으로 넘기면 가끔 focus가 튀는 케이스가 있어 즉시 실행
      try {
        it.enterEditing();
        it.selectAll?.();
      } catch {}
      fabricCanvas.requestRenderAll();
      vPushUndo();
      vBroadcast();
      // 텍스트 툴은 유지(입력 중 풀리는 문제 방지)
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

  // 텍스트 편집 중에도 안정적으로 반영/공유되도록(Backspace 등 입력 도중 툴이 풀리는 문제 완화)
  const pushUndoTextDebounced = debounce(() => {
    if (state.locked) return;
    pushUndo();
    broadcast();
  }, 250);
  fabricCanvas.on('text:changed', () => pushUndoTextDebounced());
  fabricCanvas.on('text:editing:exited', () => pushUndoTextDebounced());

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
  } else if (state.tool === 'shape') {
    // placement happens on mouse events
    fab.isDrawingMode = false;
    makeSelectable(false);
  } else if (state.tool === 'text') {
    // 텍스트는 "생성 + 기존 텍스트 편집"을 위해 selectable on
    fab.isDrawingMode = false;
    makeSelectable(true);
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
  // HTML 입력(검색/링크 입력/모달) 중에는 Space 등이 페이지 넘김으로 해석되면 안 된다.
  try {
    const ae = document.activeElement;
    const tag = String(ae?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable) return true;
    // 모달이 열려 있으면 기본적으로 입력/선택 중이므로 단축키를 막는다.
    const openModalIds = ['songPickModal', 'inputModal', 'joinModal'];
    for (const id of openModalIds) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) return true;
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
    // 기존 slice mode는 브라우저/Drive 조건에 따라 빈 화면이 되는 케이스가 있어,
    // preview 모드에서는 "단일 iframe"을 우선 보여준다(보기 전용).
    try {
      els.canvasStack.style.display = 'none';
      els.pdfPreview.classList.remove('hidden');
      const src = String(state.previewEmbedSrc || '').trim();
      if (src) els.pdfPreview.src = src;
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
  const gap = 12;
  let contentW = 0;
  let contentH = 0;

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

    contentW += v.pdfCanvas.width;
    contentH = Math.max(contentH, v.pdfCanvas.height);

  }
  contentW += gap * Math.max(0, pages.length - 1);
  setContentBoxSize(contentW, contentH);
  applyPanScroll();
}

async function loadPdf(fileId) {
  state.isPdfReady = false;
  state.pdfDoc = null;
  state.totalPages = 1;
  state.pageNo = 1;
  state.activeDrawPageNo = 1;
  updatePageLabels();

  const roomParam = state.isInSession && state.roomCode ? `?room=${encodeURIComponent(state.roomCode)}` : '';
  const url = apiUrl(`/api/drive/pdf/${fileId}${roomParam}`);
  setHidden('pageHud', false);
  setText('pageHud', 'PDF 로딩 중...');

  try {
    const loadingTask = pdfjsLib.getDocument({
      url,
      withCredentials: true,
      // 트래픽 절감:
      // - Range ON: 필요한 부분만 내려받도록(페이지 단위)
      // - autoFetch OFF: 안 보는 페이지까지 미리 받지 않도록
      // ※ 일부 Drive 케이스에서 Range가 막히면 catch -> previewMode fallback.
      disableRange: false,
      disableStream: false,
      disableAutoFetch: true
    });
    const pdf = await loadingTask.promise;
    state.previewMode = false;
    state.pdfDoc = pdf;
    state.totalPages = pdf.numPages;
    state.isPdfReady = true;
    state.renderedFileId = String(fileId);
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

      // 미리보기는 1) same-origin embed 스트림을 우선, 2) 실패 시 drive preview URL을 사용한다.
      state.previewEmbedSrc = apiUrl(`/api/drive/embed/${encodeURIComponent(fileId)}${roomParam}`);
      try {
        const pr = await fetch(apiUrl(`/api/drive/preview/${encodeURIComponent(fileId)}`)).then((r) => r.json());
        if (pr?.ok && pr.previewUrl) state.previewEmbedSrc = String(pr.previewUrl);
      } catch {}

      state.renderedFileId = String(fileId);
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
  else {
    // 기본은 "한줄전체" (요구사항)
    state.cursorShareMode = 'row';
    localStorage.setItem('mb_viewer_cursorMode', 'row');
    startCursorShare();
  }
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
  // 텍스트 편집 중에는 삭제키를 "오브젝트 삭제"로 해석하면 안 된다.
  if (isAnyTextEditing()) return;
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
  },
  { passive: false }
);

// Native scroll sync (zoomed pan) - pageTurner only
els.pdfContainer.addEventListener(
  'scroll',
  () => {
    if (suppressScrollSync) return;
    if (state.fitMode) return;
    if (!(state._panMaxX > 0 || state._panMaxY > 0)) return;
    if (!state.isInSession || !state.roomCode || !state.fileId) return;
    if (!state.isPageTurner) return;
    if (isAnyTextEditing()) return;
    const maxX = Math.max(0, state._panMaxX || 0);
    const maxY = Math.max(0, state._panMaxY || 0);
    state.panX = maxX ? clamp01(els.pdfContainer.scrollLeft / maxX) : 0;
    state.panY = maxY ? clamp01(els.pdfContainer.scrollTop / maxY) : 0;
    emitViewerSettingsDebounced('pan');
  },
  { passive: true }
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
    } else if (e.touches.length === 1 && state.tool === 'select' && state.fitMode) {
      // 줌(스크롤) 상태에서는 swipe page-turn을 막고, 네이티브 스크롤이 우선되게 한다.
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
  // 같은 사람이 reconnect / 중복 탭 등으로 두 번 뜨는 현상 완화:
  // - displayName(또는 nickname) 기준으로 1명으로 합친다.
  // - TURNER/TOOL/요청 플래그는 OR로 병합한다.
  // - 내 socketId는 항상 우선 유지한다.
  const mergedMap = new Map();
  (p?.members || []).forEach((m) => {
    const nameKey = String(m?.displayName || m?.nickname || '익명').trim() || '익명';
    const prev = mergedMap.get(nameKey);
    if (!prev) {
      mergedMap.set(nameKey, { ...m });
      return;
    }
    const keep =
      prev.socketId === socket.id
        ? prev
        : m.socketId === socket.id
          ? m
          : prev.isPageTurner
            ? prev
            : m.isPageTurner
              ? m
              : prev;
    const other = keep === prev ? m : prev;
    mergedMap.set(nameKey, {
      ...keep,
      // flags merge
      isPageTurner: Boolean(keep.isPageTurner || other.isPageTurner),
      isToolAuthorized: Boolean(keep.isToolAuthorized || other.isToolAuthorized),
      toolRequested: Boolean(keep.toolRequested || other.toolRequested),
      profilePhoto: keep.profilePhoto || other.profilePhoto || ''
    });
  });

  Array.from(mergedMap.values()).forEach((m) => {
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
  // rev 동기화(있으면)
  const rev = Number(p?.currentFileRev || 0);
  if (Number.isFinite(rev) && rev > Number(state.lastFileRev || 0)) state.lastFileRev = rev;

  const needFileAlign =
    fileId &&
    (String(fileId) !== String(state.fileId || '') ||
      (state.renderedFileId && String(fileId) !== String(state.renderedFileId || '')));

  if (needFileAlign) {
    const originalLink = String(p?.currentOriginalLink || '').trim();
    if (fileId.startsWith('chord:')) {
      openChordByDocId(fileId, { broadcast: false }).catch(() => {});
    } else if (originalLink && /^https?:\/\//i.test(originalLink) && !extractDriveFileId(originalLink)) {
      // legacy: docId 없이 URL만 공유된 경우(현재 정책에서는 지원하지 않음)
      setMode('chord');
      state.fileId = fileId;
      setCwError('이 세션은 코드위키 URL만 공유되어 docId가 없습니다. 페이지터너가 Tampermonkey로 다시 열어주세요.');
      setCwMeta(`원문 URL: ${originalLink}`);
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
    // chord 모드에서는 pageNo=1을 cwInner 기준으로 렌더한다(페이지 follow 불필요)
    if (state.mode === 'chord' && pageNo === 1) {
      return setCursorMarker(remoteCursorEl, { xNorm: xPageNorm, yNorm: yPageNorm, visible: true, mode, pageNo: 1, yPageNorm: yPageNorm });
    }
    // 모바일 viewer는 커서가 있는 페이지로 따라간다.
    if (isMobileViewer() && pageNo !== state.pageNo) {
      followToPage(pageNo, 'cursor').catch(() => {});
    }
    return setCursorMarker(remoteCursorEl, { xNorm: xPageNorm, yNorm: yPageNorm, visible: true, mode, pageNo, yPageNorm: yPageNorm });
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
  const reason = String(p?.reason || '');
  // 모바일 viewer는 1p 고정(터너 설정 무시)
  const prev = {
    spreadCount: state.spreadCount,
    fitMode: state.fitMode,
    zoom: state.zoom,
    overlapPx: state.overlapPx
  };

  if (typeof s.spreadCount === 'number' && !isMobileViewer()) state.spreadCount = clamp(s.spreadCount, 1, 4);
  if (isMobileViewer()) state.spreadCount = 1;
  if (typeof s.fitMode === 'boolean') state.fitMode = s.fitMode;
  if (typeof s.zoom === 'number') state.zoom = clamp(s.zoom, 0.5, 3);
  if (typeof s.overlapPx === 'number') setSpreadOverlapPx(s.overlapPx);
  if (typeof s.panX === 'number') state.panX = clamp01(s.panX);
  if (typeof s.panY === 'number') state.panY = clamp01(s.panY);

  const layoutChanged =
    prev.spreadCount !== state.spreadCount ||
    prev.fitMode !== state.fitMode ||
    prev.zoom !== state.zoom ||
    prev.overlapPx !== state.overlapPx;

  [1, 2, 3, 4].forEach((x) => document.getElementById(`spread${x}Btn`)?.classList.toggle('active', x === state.spreadCount));

  // pan-only는 DOM을 재구성하면 튐이 심해지므로, 스크롤만 맞춘다.
  if (!layoutChanged && reason === 'pan') {
    applyPanScroll();
    return;
  }

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
  // rev가 있으면, 더 최신 rev만 적용 (일부 클라이언트가 이벤트를 놓치는 케이스 복구)
  const rev = Number(p?.rev || 0);
  if (Number.isFinite(rev) && rev > 0) {
    if (rev <= Number(state.lastFileRev || 0)) return;
    state.lastFileRev = rev;
  }
  // 같은 파일이라도 "실제 렌더"가 안 된 상태일 수 있어(네트워크/권한/preview 등),
  // follow 이벤트가 오면 일정 간격으로는 강제로 재로딩해 준다.
  const now = Date.now();
  if (String(fileId) === String(state.fileId || '') && now - Number(state._lastFollowAt || 0) < 800) return;
  state._lastFollowAt = now;

  // originalLink가 있어도 재-broadcast 되지 않도록 "추출→로컬에서 로드"만 수행
  const originalLink = String(p?.originalLink || '').trim();
  // chord doc follow (docId)
  if (String(fileId).startsWith('chord:')) {
    openChordByDocId(String(fileId), { broadcast: false }).catch(() => {});
    return;
  }
  // codewiki URL follow (legacy) - docId 없이 URL만 공유된 케이스는 지원하지 않음
  if (originalLink && /^https?:\/\//i.test(originalLink) && !extractDriveFileId(originalLink)) {
    setMode('chord');
    state.fileId = String(fileId);
    setCwError('이 세션은 코드위키 URL만 공유되어 docId가 없습니다. 페이지터너가 Tampermonkey로 다시 열어주세요.');
    setCwMeta(`원문 URL: ${originalLink}`);
    socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId: state.fileId });
    return;
  }

  const targetId = originalLink ? extractDriveFileId(originalLink) || fileId : fileId;

  // 세션 내에서는 페이지 리로드를 하지 않고 PDF만 교체한다(중복 접속/터너 깜빡임 방지)
  state.fileId = String(targetId);
  try {
    setLastRoomForFile(state.fileId, state.roomCode);
    const nextUrl = buildViewerUrl({ fileId: state.fileId, roomCode: state.roomCode });
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
  // 코드뷰 렌더 옵션 UI 초기화(값 복원 + 변경 시 즉시 재렌더)
  initCwControls();

  // 방문자(익명)로 /viewer 접속 시:
  // - 기존에는 "무조건 닉네임 모달"을 띄워서 chord/doc 로딩까지 막았는데,
  //   이 때문에 코드위키 버튼으로 열린 탭이 '빈 화면'처럼 보이는 문제가 생김.
  // - 예방: 기본 닉네임('익명')으로 즉시 진행하고,
  //   사용자가 세션 참여를 눌렀을 때만 닉네임/룸 모달을 띄운다.
  if (authState.role === 'viewer') {
    const saved = localStorage.getItem('mb_presence_nick') || localStorage.getItem('mb_nickname') || '';
    const nick = String(saved || '익명').trim() || '익명';
    state.nickname = nick;
    authState.displayName = nick;
    if (!saved) {
      try {
        localStorage.setItem('mb_presence_nick', nick);
        localStorage.setItem('mb_nickname', nick);
      } catch {}
    }
    try {
      socket.auth = { ...(socket.auth || {}), nickname: nick };
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

  // 같은 room에서는 window.open이 같은 탭을 재사용할 수 있게 name을 고정한다.
  // (ChordWiki → ScoreViewer 버튼을 여러 번 눌러도 새 탭이 계속 생기지 않게)
  try {
    const rn = safeRoomCode(qs('room')) || safeRoomCode(state.roomCode);
    if (rn) window.name = `mb_viewer_room_${rn}`;
    else window.name = 'mb_viewer_main';
  } catch {}

  // chordwiki userscript -> postMessage 수신은 "postmessage로 연 탭" 또는 "chord 모드 진입"에서만 활성화
  // (일반 PDF 뷰어 기능에 영향 주지 않도록)
  const qsMode = String(qs('mode') || '').toLowerCase();
  const from = String(qs('from') || '').toLowerCase();
  const shouldEnableChordMsg =
    from === 'postmessage' || qsMode === 'chord' || String(state.fileId || '').startsWith('chord:');
  if (shouldEnableChordMsg) setupChordPostMessageReceiver();

  // participants panel collapse state restore
  try {
    const v = localStorage.getItem('mb_viewer_participantsCollapsed');
    setParticipantsCollapsed(v === '1');
  } catch {}


  // Chord mode entry: /viewer?mode=chord&docId=...
  const qsDocId = String(qs('docId') || '').trim();
  if (qsMode === 'chord' && qsDocId) {
    state.fileId = qsDocId;
    // NOTE: 여기서 return 하지 않는다.
    // room 파라미터가 있으면 아래의 auto-join 로직이 동작해야 하고,
    // 마지막에 PDF 로드로 떨어지지 않도록 아래 "direct chord doc" 분기에서 처리한다.
    await openChordByDocId(qsDocId, { broadcast: false });
  }

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

  // direct chord doc in path (e.g., /viewer/chord:xxxx)
  if (String(state.fileId).startsWith('chord:')) {
    await openChordByDocId(state.fileId, { broadcast: false });
    return;
  }

  await loadPdf(state.fileId);
}

init().catch((e) => {
  // 기존에는 init 에러를 조용히 삼켜서(빈 화면) 원인 파악이 어려웠다.
  // chord/doc 링크로 직접 들어온 경우엔 init 실패해도 chord는 열어준다.
  // eslint-disable-next-line no-console
  console.error('[viewer] init failed:', e);
  try {
    const qsMode = String(qs('mode') || '').toLowerCase();
    const qsDocId = String(qs('docId') || '').trim();
    if (qsMode === 'chord' && qsDocId) {
      openChordByDocId(qsDocId, { broadcast: false }).catch(() => {});
      return;
    }
    setHidden('pageHud', false);
    setText('pageHud', `초기화 실패: ${String(e?.message || e).slice(0, 80)}`);
  } catch {}
});
