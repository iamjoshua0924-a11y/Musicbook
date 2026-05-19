/* global io, pdfjsLib, fabric */

// ---- Helpers ----------------------------------------------------------------------
function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getFileIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[1] || ''; // /viewer/:fileId
}

function safeRoomCode(v) {
  return String(v || '').trim().toUpperCase();
}

function getOrCreateNickname() {
  const key = 'mb_nickname';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const nick = prompt('닉네임을 입력하세요(익명 가능):', '익명') || '익명';
  localStorage.setItem(key, nick);
  return nick;
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

// ---- State ------------------------------------------------------------------------
const state = {
  fileId: getFileIdFromPath(),
  pageNo: 1,
  totalPages: 1,
  roomCode: null,
  isInSession: false,
  isPageTurner: false,
  nickname: getOrCreateNickname(),

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
  spreadCount: 1, // 1~4
  fitMode: true,
  zoom: 1,
  perfMode: false,
  focusMode: false,
  locked: false,
  activeDrawPageNo: 1
};

// ---- Socket -----------------------------------------------------------------------
const socket = io({
  auth: { nickname: state.nickname }
});

function joinSession(roomCode) {
  state.roomCode = safeRoomCode(roomCode);
  state.isInSession = true;
  document.getElementById('sessionToggle').checked = true;
  setHidden('sessionBadge', false);
  setText('sessionBadge', `세션: ${state.roomCode} (연결중...)`);

  socket.emit(
    'session:join',
    {
      roomCode: state.roomCode,
      nickname: state.nickname,
      role: 'viewer',
      displayName: state.nickname,
      profilePhoto: ''
    },
    (ack) => {
    if (!ack?.ok) {
      alert('세션 참여 실패');
      leaveSession();
      return;
    }
    setText('sessionBadge', `세션: ${state.roomCode}`);
    setHidden('participantsPanel', false);
    // request initial annotations
    if (state.fileId) socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId: state.fileId });
  }
  );
}

function leaveSession() {
  const roomCode = state.roomCode;
  state.roomCode = null;
  state.isInSession = false;
  state.isPageTurner = false;
  document.getElementById('sessionToggle').checked = false;
  setHidden('sessionBadge', true);
  setHidden('turnerBadge', true);
  setHidden('participantsPanel', true);
  if (roomCode) socket.emit('session:leave', { roomCode });
}

// MUST-1: auto join when ?room exists.
const initialRoom = safeRoomCode(qs('room'));
if (initialRoom) {
  joinSession(initialRoom);
}

// ---- UI wiring --------------------------------------------------------------------
setText('fileIdBadge', state.fileId ? `fileId: ${state.fileId}` : 'fileId: (없음)');

document.getElementById('sessionToggle').addEventListener('change', (e) => {
  const on = e.target.checked;
  if (on) {
    // If URL already has room, auto join (no modal) - MUST-1.
    const urlRoom = safeRoomCode(qs('room'));
    if (urlRoom) return joinSession(urlRoom);

    const roomCode = safeRoomCode(prompt('Room Code를 입력하세요:', ''));
    if (!roomCode) {
      e.target.checked = false;
      return;
    }
    joinSession(roomCode);
  } else {
    leaveSession();
  }
});

document.getElementById('createSessionBtn').addEventListener('click', () => {
  socket.emit('session:create', { nickname: state.nickname }, (ack) => {
    if (!ack?.ok) return alert('세션 생성 실패');
    const roomCode = ack.roomCode;
    // Auto join created room
    const nextUrl = `${window.location.origin}/viewer/${state.fileId || ''}?room=${roomCode}`;
    // NOTE: keep current fileId; if empty, user can still open via link input in future version
    window.history.replaceState(null, '', nextUrl);
    joinSession(roomCode);
  });
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

document.getElementById('openFromLinkBtn').addEventListener('click', () => {
  const input = prompt('Drive 링크 또는 fileId를 입력하세요:', '') || '';
  const fileId = extractDriveFileId(input);
  if (!fileId) return alert('fileId를 추출하지 못했습니다. Drive 링크 또는 fileId를 확인해 주세요.');

  const roomCode = state.roomCode;
  if (state.isInSession && state.isPageTurner && roomCode) {
    socket.emit('session:follow:file', { roomCode, fileId }, (ack) => {
      if (!ack?.ok) alert('세션 곡 전환 브로드캐스트 실패(권한 확인)');
      window.location.href = `${window.location.origin}/viewer/${fileId}?room=${roomCode}`;
    });
  } else {
    const roomParam = state.isInSession && roomCode ? `?room=${roomCode}` : '';
    window.location.href = `${window.location.origin}/viewer/${fileId}${roomParam}`;
  }
});

// Pedal/keyboard mapping (requirement). Only page turner broadcasts.
window.addEventListener('keydown', (e) => {
  const nextKeys = ['ArrowRight', 'PageDown', ' '];
  const prevKeys = ['ArrowLeft', 'PageUp'];
  if (nextKeys.includes(e.key)) changePage(state.pageNo + state.spreadCount, 'kbd');
  if (prevKeys.includes(e.key)) changePage(state.pageNo - state.spreadCount, 'kbd');
});

document.getElementById('fab').addEventListener('click', () => {
  const panel = document.getElementById('fabPanel');
  panel.classList.toggle('hidden');
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

document.getElementById('fullscreenBtn2').addEventListener('click', async () => {
  document.getElementById('fullscreenBtn').click();
});

function changePage(next, source) {
  // pageNo means "leftmost page" in spread mode
  const pageNo = Math.max(1, Math.min(state.totalPages, next));
  state.pageNo = pageNo;
  state.activeDrawPageNo = pageNo;
  updatePageLabels();
  renderSpread(pageNo).catch(() => {});

  // Only pageTurner broadcasts page change (requirement).
  if (state.isInSession && state.isPageTurner) {
    socket.emit('viewer:page_change', { roomCode: state.roomCode, fileId: state.fileId, pageNo }, () => {});
  }
}

// ---- PDF.js rendering + Fabric overlay (multi-page spread) -------------------------
// eslint-disable-next-line no-undef
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.js';

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
  const perfFactor = state.perfMode ? 0.9 : 1;
  const scale = (state.fitMode ? fitScale : fitScale * state.zoom) * perfFactor;
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

    if (state.tool === 'text') {
      const p = getPointer(opt);
      const color = document.getElementById('colorPicker').value || '#ff2d55';
      const it = new fabric.IText('텍스트', {
        left: p.x,
        top: p.y,
        fontSize: 22,
        fill: color,
        fontWeight: 700
      });
      fabricCanvas.add(it);
      it.enterEditing();
      fabricCanvas.setActiveObject(it);
      vPushUndo();
      vBroadcast();
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
    if (active.stroke) document.getElementById('strokeColor').value = active.stroke;
    if (active.strokeWidth) document.getElementById('strokeWidth').value = String(active.strokeWidth);
    if (active.type === 'i-text') {
      document.getElementById('fontSize').value = String(active.fontSize || 22);
      document.getElementById('strokeColor').value = active.fill || document.getElementById('strokeColor').value;
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
    if (fabric.EraserBrush) {
      fab.isDrawingMode = true;
      fab.freeDrawingBrush = new fabric.EraserBrush(fab);
      fab.freeDrawingBrush.width = Math.max(6, size * 2);
      makeSelectable(false);
    } else {
      // fallback: not supported
      fab.isDrawingMode = true;
      fab.freeDrawingBrush = new fabric.PencilBrush(fab);
      fab.freeDrawingBrush.width = Math.max(6, size * 2);
      fab.freeDrawingBrush.color = 'rgba(0,0,0,1)';
      makeSelectable(false);
    }
  } else if (state.tool === 'select') {
    fab.isDrawingMode = false;
    makeSelectable(true);
  } else if (state.tool === 'shape' || state.tool === 'text') {
    // placement happens on mouse events
    fab.isDrawingMode = false;
    makeSelectable(false);
  }
}

function applyToolToAll() {
  for (const v of viewMap.values()) applyToolToCanvas(v.fabric);
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
      alert('이 파일은 다운로드/스트리밍이 제한되어 preview 모드로 열립니다.');
    } catch {
      alert('PDF 로딩 실패');
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
  state.tool = tool;
  state.shape = shape;
  applyToolToAll();
}

document.getElementById('penBtn').addEventListener('click', () => setTool('pen'));
document.getElementById('highlighterBtn').addEventListener('click', () => setTool('highlighter'));
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
function setSpread(n) {
  state.spreadCount = n;
  changePage(state.pageNo, 'spread');
}
document.getElementById('spread1Btn').addEventListener('click', () => setSpread(1));
document.getElementById('spread2Btn').addEventListener('click', () => setSpread(2));
document.getElementById('spread3Btn').addEventListener('click', () => setSpread(3));
document.getElementById('spread4Btn').addEventListener('click', () => setSpread(4));

document.getElementById('zoomInBtn').addEventListener('click', () => {
  state.fitMode = false;
  state.zoom = Math.min(3, state.zoom * 1.15);
  renderSpread(state.pageNo).catch(() => {});
});
document.getElementById('zoomOutBtn').addEventListener('click', () => {
  state.fitMode = false;
  state.zoom = Math.max(0.5, state.zoom / 1.15);
  renderSpread(state.pageNo).catch(() => {});
});
document.getElementById('fitBtn').addEventListener('click', () => {
  state.fitMode = true;
  state.zoom = 1;
  renderSpread(state.pageNo).catch(() => {});
});

document.getElementById('focusModeBtn').addEventListener('click', () => {
  state.focusMode = !state.focusMode;
  document.body.classList.toggle('focus-mode', state.focusMode);
});
document.getElementById('perfModeBtn').addEventListener('click', () => {
  state.perfMode = !state.perfMode;
  renderSpread(state.pageNo).catch(() => {});
});

document.getElementById('lockModeBtn').addEventListener('click', () => {
  state.locked = !state.locked;
  document.getElementById('lockModeBtn').textContent = state.locked ? '잠금해제' : '잠금';
  applyToolToAll();
});

function getActiveView() {
  const pageNo = state.activeDrawPageNo || state.pageNo;
  return viewMap.get(pageNo);
}

function applyToActiveObject(mutator) {
  const v = getActiveView();
  const obj = v?.fabric?.getActiveObject?.();
  if (!v?.fabric || !obj) return;
  mutator(obj, v.fabric);
  v.fabric.requestRenderAll();
  v.pushUndo?.();
  v.broadcast?.();
}

// Selection edit controls
document.getElementById('bringFrontBtn').addEventListener('click', () => {
  applyToActiveObject((obj, c) => c.bringToFront(obj));
});
document.getElementById('sendBackBtn').addEventListener('click', () => {
  applyToActiveObject((obj, c) => c.sendToBack(obj));
});
document.getElementById('deleteBtn').addEventListener('click', () => {
  const v = getActiveView();
  const obj = v?.fabric?.getActiveObject?.();
  if (!v?.fabric || !obj) return;
  v.fabric.remove(obj);
  v.fabric.discardActiveObject();
  v.fabric.requestRenderAll();
  v.pushUndo?.();
  v.broadcast?.();
});
document.getElementById('duplicateBtn').addEventListener('click', () => {
  applyToActiveObject((obj, c) => {
    obj.clone((cloned) => {
      cloned.left = (cloned.left || 0) + 16;
      cloned.top = (cloned.top || 0) + 16;
      c.add(cloned);
      c.setActiveObject(cloned);
    });
  });
});

document.getElementById('strokeColor').addEventListener('input', (e) => {
  const v = getActiveView();
  const obj = v?.fabric?.getActiveObject?.();
  if (!obj) return;
  const col = e.target.value;
  if (obj.stroke !== undefined) obj.set('stroke', col);
  if (obj.fill !== undefined && obj.type === 'i-text') obj.set('fill', col);
  v.fabric.requestRenderAll();
  v.pushUndo?.();
  v.broadcast?.();
});
document.getElementById('strokeWidth').addEventListener('input', (e) => {
  const v = getActiveView();
  const obj = v?.fabric?.getActiveObject?.();
  if (!obj) return;
  const w = Number(e.target.value || 3);
  if (obj.strokeWidth !== undefined) obj.set('strokeWidth', w);
  v.fabric.requestRenderAll();
});
document.getElementById('strokeWidth').addEventListener('change', () => {
  const v = getActiveView();
  v?.pushUndo?.();
  v?.broadcast?.();
});
document.getElementById('fontSize').addEventListener('input', (e) => {
  const v = getActiveView();
  const obj = v?.fabric?.getActiveObject?.();
  if (!obj || obj.type !== 'i-text') return;
  obj.set('fontSize', Number(e.target.value || 22));
  v.fabric.requestRenderAll();
});
document.getElementById('fontSize').addEventListener('change', () => {
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
  const isLive = window.matchMedia('(max-width: 980px)').matches || window.matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('live-mode', isLive);
}
updateLiveMode();
window.addEventListener('resize', updateLiveMode);

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
    } else if (e.touches.length === 1 && (state.tool === 'select' || state.focusMode)) {
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

// FAB auto-close when clicking outside
document.addEventListener('click', (e) => {
  const fab = document.getElementById('fab');
  const panel = document.getElementById('fabPanel');
  if (panel.classList.contains('hidden')) return;
  if (panel.contains(e.target) || fab.contains(e.target)) return;
  panel.classList.add('hidden');
});

// ---- Socket event handlers ---------------------------------------------------------
socket.on('session:pageTurner:state', (p) => {
  if (!state.isInSession) return;
  state.isPageTurner = p?.pageTurnerSocketId === socket.id;
  if (state.isPageTurner) {
    setHidden('turnerBadge', false);
    setText('turnerBadge', '현재 당신이 페이지터너입니다');
  } else {
    setHidden('turnerBadge', true);
  }
  updatePageLabels();
});

socket.on('session:participants', (p) => {
  if (!state.isInSession) return;
  const list = document.getElementById('participantsList');
  list.innerHTML = '';
  (p?.members || []).forEach((m) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.gap = '8px';
    row.style.marginBottom = '6px';
    row.innerHTML = `<span>${m.nickname}${m.isPageTurner ? ' (터너)' : ''}</span>`;

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
    list.appendChild(row);
  });
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

socket.on('session:follow:file', (p) => {
  if (!state.isInSession) return;
  const fileId = p?.fileId;
  if (!fileId) return;
  // Navigate to keep URL canonical, preserving room param (requirement).
  const nextUrl = `${window.location.origin}/viewer/${fileId}?room=${state.roomCode}`;
  if (fileId !== state.fileId) window.location.href = nextUrl;
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
if (state.fileId) {
  loadPdf(state.fileId).catch(() => {});
} else {
  alert('fileId가 없습니다. /viewer/:fileId 로 접속해 주세요.');
}
