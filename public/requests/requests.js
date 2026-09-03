/* global io */
const $ = (id) => document.getElementById(id);

// TODO: Render 백엔드 배포 후 발급받은 새 주소를 여기에 입력할 예정
// (또는 public/config.js에서 window.API_URL을 설정)
const API_URL = String(window.API_URL || window.MB_API || window.location.origin || '').replace(/\/$/, '');
const apiUrl = (path) => {
  const p = String(path || '');
  if (!p) return API_URL;
  if (/^https?:\/\//i.test(p)) return p;
  return `${API_URL}${p.startsWith('/') ? '' : '/'}${p}`;
};

const statusLabel = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'accepted') return '수락';
  if (v === 'rejected') return '거절';
  if (v === 'completed') return '완료';
  return '대기';
};

async function apiGet(url) {
  const res = await fetch(apiUrl(url), { credentials: 'include' });
  try {
    return await res.json();
  } catch {
    return { ok: false, error: `HTTP_${res.status}` };
  }
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function render(items) {
  const list = $('list');
  list.innerHTML = '';
  const arr = Array.isArray(items) ? items : [];
  const empty = $('empty');
  empty.textContent = '신청곡이 없습니다.';
  empty.style.display = arr.length ? 'none' : 'block';

  arr.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'row';
    const requester = String(r.requesterName || '익명').trim() || '익명';
    const artist = String(r.artist || '').trim();
    const target = String(r.targetSinger || '').trim();
    el.innerHTML = `
      <div class="rowTitle">
        ${esc(r.songTitle || '')}
        <span class="chip">${esc(statusLabel(r.status))}</span>
      </div>
      <div class="rowSub">
        <div class="rowSubLeft">
          ${esc(artist || '-')} · 담당보컬 : ${esc(target || '-')}
        </div>
        <div class="rowSubRight">
          신청자 : ${esc(requester)}
        </div>
      </div>
    `;
    list.appendChild(el);
  });
}

function showMessage(text) {
  const el = $('empty');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
}

async function loadOnce() {
  try {
    const r = await apiGet('/api/requests');
    if (r?.ok) {
      render(r.items || []);
      return true;
    }
    showMessage(`불러오기 실패: ${r?.error || ''}`);
  } catch {
    showMessage('서버에 연결하지 못했습니다. 잠시 후 자동으로 다시 시도합니다.');
  }
  return false;
}

function boot() {
  loadOnce();

  // 실시간 갱신은 socket.io, 실패(CDN 차단/연결 끊김) 시에는 주기적 폴링으로 대체한다.
  let socketOk = false;
  try {
    if (typeof io === 'function') {
      const socket = io(API_URL, { withCredentials: true });
      socket.on('connect', () => {
        socketOk = true;
        loadOnce();
      });
      socket.on('disconnect', () => {
        socketOk = false;
      });
      socket.on('requests:updated', (p) => {
        if (Array.isArray(p?.items)) render(p.items);
      });
    }
  } catch {}
  setInterval(() => {
    if (!socketOk) loadOnce();
  }, 15000);
}

boot();
