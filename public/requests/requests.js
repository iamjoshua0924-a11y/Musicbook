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
  return res.json();
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
  $('empty').style.display = arr.length ? 'none' : 'block';

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

async function loadOnce() {
  const r = await apiGet('/api/requests');
  if (r?.ok) render(r.items || []);
}

function boot() {
  loadOnce().catch(() => {});

  try {
    const socket = io(API_URL, { withCredentials: true });
    socket.on('requests:updated', (p) => {
      if (Array.isArray(p?.items)) render(p.items);
    });
  } catch {}
}

boot();
