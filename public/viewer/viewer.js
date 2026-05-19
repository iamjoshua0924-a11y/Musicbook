/* global io */

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

// ---- State ------------------------------------------------------------------------
const state = {
  fileId: getFileIdFromPath(),
  pageNo: 1,
  roomCode: null,
  isInSession: false,
  isPageTurner: false,
  nickname: getOrCreateNickname()
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

  socket.emit('session:join', { roomCode: state.roomCode, nickname: state.nickname }, (ack) => {
    if (!ack?.ok) {
      alert('세션 참여 실패');
      leaveSession();
      return;
    }
    setText('sessionBadge', `세션: ${state.roomCode}`);
    setHidden('participantsPanel', false);
  });
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

const pdfUrl = state.fileId ? `${window.location.origin}/api/drive/pdf/${state.fileId}` : '';
setText('pdfUrlText', pdfUrl);

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

document.getElementById('openBtn').addEventListener('click', () => {
  const input = document.getElementById('driveInput').value;
  const fileId = extractDriveFileId(input);
  if (!fileId) return alert('fileId를 추출하지 못했습니다. Drive 링크 또는 fileId를 확인해 주세요.');

  // If we are page turner inside a session, broadcast follow-file first.
  const roomCode = state.roomCode;
  if (state.isInSession && state.isPageTurner && roomCode) {
    socket.emit('session:follow:file', { roomCode, fileId }, (ack) => {
      if (!ack?.ok) alert('세션 곡 전환 브로드캐스트 실패(권한 확인)');
      window.location.href = `${window.location.origin}/viewer/${fileId}?room=${roomCode}`;
    });
  } else {
    // Personal mode or follower: just navigate (no broadcast).
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

function changePage(next, source) {
  const pageNo = Math.max(1, next);
  state.pageNo = pageNo;
  setText('pageLabel', String(pageNo));

  // Only pageTurner broadcasts page change (requirement).
  if (state.isInSession && state.isPageTurner) {
    socket.emit('viewer:page_change', { roomCode: state.roomCode, fileId: state.fileId, pageNo }, () => {});
  }
}

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
});

socket.on('session:follow:file', (p) => {
  if (!state.isInSession) return;
  const fileId = p?.fileId;
  if (!fileId) return;
  // Navigate to keep URL canonical, preserving room param (requirement).
  const nextUrl = `${window.location.origin}/viewer/${fileId}?room=${state.roomCode}`;
  if (fileId !== state.fileId) window.location.href = nextUrl;
});
