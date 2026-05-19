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
  tool: 'pen'
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

document.getElementById('prevBtn').addEventListener('click', () => changePage(state.pageNo - 1, 'local'));
document.getElementById('nextBtn').addEventListener('click', () => changePage(state.pageNo + 1, 'local'));

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
  if (nextKeys.includes(e.key)) changePage(state.pageNo + 1, 'kbd');
  if (prevKeys.includes(e.key)) changePage(state.pageNo - 1, 'kbd');
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
  const pageNo = Math.max(1, Math.min(state.totalPages, next));
  state.pageNo = pageNo;
  setText('pageLabel', String(pageNo));
  setText('pageTotal', `/ ${state.totalPages}`);
  setHidden('pageHud', false);
  setText('pageHud', `${state.pageNo} / ${state.totalPages}${state.isPageTurner ? ' · 터너' : ''}`);
  renderPage(pageNo).catch(() => {});

  // Only pageTurner broadcasts page change (requirement).
  if (state.isInSession && state.isPageTurner) {
    socket.emit('viewer:page_change', { roomCode: state.roomCode, fileId: state.fileId, pageNo }, () => {});
  }
}

// ---- PDF.js rendering + Fabric overlay --------------------------------------------
// eslint-disable-next-line no-undef
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.js';

const els = {
  pdfCanvas: document.getElementById('pdf-canvas'),
  annoCanvasEl: document.getElementById('anno-canvas'),
  pdfPreview: document.getElementById('pdf-preview'),
  canvasStack: document.getElementById('canvas-stack')
};

let fabricCanvas = null;

function computeViewport(page) {
  const base = page.getViewport({ scale: 1 });
  const container = document.getElementById('pdf-container');
  const maxW = container.clientWidth - 20;
  const maxH = container.clientHeight - 20;
  const scaleW = maxW / base.width;
  const scaleH = maxH / base.height;
  const scale = Math.max(0.2, Math.min(scaleW, scaleH));
  return page.getViewport({ scale });
}

async function loadPdf(fileId) {
  state.isPdfReady = false;
  state.pdfDoc = null;
  state.totalPages = 1;
  state.pageNo = 1;
  setText('pageLabel', '1');
  setText('pageTotal', '/ ?');

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
    setText('pageTotal', `/ ${state.totalPages}`);
    await renderPage(state.pageNo);

    // Try to load annotations snapshot for current session
    if (state.isInSession && state.roomCode) socket.emit('wb:sync:request', { roomCode: state.roomCode, fileId });
  } catch (e) {
    // Fallback to iframe preview
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

function ensureFabric(newW, newH) {
  if (!fabricCanvas) {
    fabricCanvas = new fabric.Canvas('anno-canvas', {
      isDrawingMode: true,
      selection: false
    });

    // drawing defaults
    fabricCanvas.freeDrawingBrush.width = Number(document.getElementById('brushSize').value || 3);
    fabricCanvas.freeDrawingBrush.color = document.getElementById('colorPicker').value || '#ff2d55';

    const pushUndo = debounce(() => {
      const snap = snapshotCurrentPage();
      if (!snap) return;
      state.undoStack[state.pageNo] ||= [];
      state.undoStack[state.pageNo].push(snap);
      // keep last 30
      state.undoStack[state.pageNo] = state.undoStack[state.pageNo].slice(-30);
    }, 300);

    fabricCanvas.on('path:created', () => {
      pushUndo();
      broadcastSnapshotDebounced();
    });
    fabricCanvas.on('object:modified', () => {
      pushUndo();
      broadcastSnapshotDebounced();
    });
  }

  if (fabricCanvas.getWidth() !== newW || fabricCanvas.getHeight() !== newH) {
    fabricCanvas.setWidth(newW);
    fabricCanvas.setHeight(newH);
  }
}

function snapshotCurrentPage() {
  if (!fabricCanvas) return null;
  const json = fabricCanvas.toDatalessJSON();
  return { json, w: fabricCanvas.getWidth(), h: fabricCanvas.getHeight() };
}

const broadcastSnapshotDebounced = debounce(() => {
  if (!state.isInSession || !state.roomCode || !state.fileId || !fabricCanvas) return;
  const snap = snapshotCurrentPage();
  if (!snap) return;
  state.annoStore[state.pageNo] = snap;
  socket.emit('wb:page:update', {
    roomCode: state.roomCode,
    fileId: state.fileId,
    pageNo: String(state.pageNo),
    pageSnapshot: snap
  });
}, 250);

function applySnapshotToCanvas(pageSnapshot, newW, newH) {
  ensureFabric(newW, newH);
  fabricCanvas.off('path:created'); // avoid loops? (we still keep handlers, but loadFromJSON triggers render)
  fabricCanvas.loadFromJSON(pageSnapshot?.json || { objects: [], version: '6.0.0' }, () => {
    // rescale from snapshot dims to new dims
    const oldW = Number(pageSnapshot?.w || newW);
    const oldH = Number(pageSnapshot?.h || newH);
    const sx = oldW ? newW / oldW : 1;
    const sy = oldH ? newH / oldH : 1;
    fabricCanvas.getObjects().forEach((obj) => {
      obj.scaleX *= sx;
      obj.scaleY *= sy;
      obj.left *= sx;
      obj.top *= sy;
      obj.setCoords();
    });
    fabricCanvas.renderAll();
  });
}

async function renderPage(pageNo) {
  if (!state.isPdfReady || !state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(pageNo);
  const viewport = computeViewport(page);

  // Setup PDF canvas
  const pdfCanvas = els.pdfCanvas;
  const ctx = pdfCanvas.getContext('2d');
  pdfCanvas.width = Math.floor(viewport.width);
  pdfCanvas.height = Math.floor(viewport.height);

  // Ensure overlay matches
  els.annoCanvasEl.width = pdfCanvas.width;
  els.annoCanvasEl.height = pdfCanvas.height;
  ensureFabric(pdfCanvas.width, pdfCanvas.height);

  // Render PDF
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Load stored page snapshot if any
  const saved = state.annoStore[pageNo];
  if (saved) applySnapshotToCanvas(saved, pdfCanvas.width, pdfCanvas.height);
  else applySnapshotToCanvas({ json: { objects: [] }, w: pdfCanvas.width, h: pdfCanvas.height }, pdfCanvas.width, pdfCanvas.height);
}

// Handle resize -> re-render current page + re-apply snapshot
const ro = new ResizeObserver(
  debounce(() => {
    if (state.isPdfReady) renderPage(state.pageNo).catch(() => {});
  }, 200)
);
ro.observe(document.getElementById('pdf-container'));

// Tools
document.getElementById('brushSize').addEventListener('input', (e) => {
  if (!fabricCanvas) return;
  fabricCanvas.freeDrawingBrush.width = Number(e.target.value || 3);
});
document.getElementById('colorPicker').addEventListener('input', (e) => {
  if (!fabricCanvas) return;
  fabricCanvas.freeDrawingBrush.color = e.target.value || '#ff2d55';
});
document.getElementById('penBtn').addEventListener('click', () => {
  state.tool = 'pen';
  if (!fabricCanvas) return;
  fabricCanvas.isDrawingMode = true;
  fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
  fabricCanvas.freeDrawingBrush.width = Number(document.getElementById('brushSize').value || 3);
  fabricCanvas.freeDrawingBrush.color = document.getElementById('colorPicker').value || '#ff2d55';
});
document.getElementById('eraserBtn').addEventListener('click', () => {
  state.tool = 'eraser';
  if (!fabricCanvas) return;
  // If EraserBrush exists use it, else fallback to selection delete.
  if (fabric.EraserBrush) {
    fabricCanvas.isDrawingMode = true;
    fabricCanvas.freeDrawingBrush = new fabric.EraserBrush(fabricCanvas);
    fabricCanvas.freeDrawingBrush.width = Number(document.getElementById('brushSize').value || 8);
  } else {
    alert('EraserBrush를 지원하지 않는 Fabric 버전입니다. (추후 보완)');
  }
});
document.getElementById('clearBtn').addEventListener('click', () => {
  if (!fabricCanvas) return;
  fabricCanvas.clear();
  broadcastSnapshotDebounced();
});
document.getElementById('undoBtn').addEventListener('click', () => {
  const stack = state.undoStack[state.pageNo] || [];
  if (!stack.length) return;
  // pop current
  stack.pop();
  const prev = stack[stack.length - 1];
  if (prev) {
    state.annoStore[state.pageNo] = prev;
    applySnapshotToCanvas(prev, fabricCanvas.getWidth(), fabricCanvas.getHeight());
    broadcastSnapshotDebounced();
  } else {
    fabricCanvas.clear();
    broadcastSnapshotDebounced();
  }
});

// Live mode (mobile/tablet)
function updateLiveMode() {
  const isLive = window.matchMedia('(max-width: 980px)').matches || window.matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('live-mode', isLive);
}
updateLiveMode();
window.addEventListener('resize', updateLiveMode);

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
  setHidden('pageHud', false);
  setText('pageHud', `${state.pageNo} / ${state.totalPages}${state.isPageTurner ? ' · 터너' : ''}`);
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
  setText('pageLabel', String(state.pageNo));
  renderPage(state.pageNo).catch(() => {});
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
  // re-render current page overlays
  if (state.isPdfReady) renderPage(state.pageNo).catch(() => {});
});

socket.on('wb:page:update', (p) => {
  if (!p?.pageNo || !p?.pageSnapshot) return;
  const pageNo = Number(p.pageNo);
  state.annoStore[pageNo] = p.pageSnapshot;
  if (pageNo === state.pageNo && state.isPdfReady) {
    applySnapshotToCanvas(p.pageSnapshot, fabricCanvas.getWidth(), fabricCanvas.getHeight());
  }
});

// ---- Init -------------------------------------------------------------------------
if (state.fileId) {
  loadPdf(state.fileId).catch(() => {});
} else {
  alert('fileId가 없습니다. /viewer/:fileId 로 접속해 주세요.');
}
