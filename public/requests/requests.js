/* global io */
const $ = (id) => document.getElementById(id);

const statusLabel = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'accepted') return '수락';
  if (v === 'rejected') return '거절';
  if (v === 'completed') return '완료';
  return '대기';
};

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'include' });
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
    el.innerHTML = `
      <div class="rowTitle">
        ${esc(r.songTitle || '')}
        <span class="chip">${esc(statusLabel(r.status))}</span>
      </div>
      <div class="rowSub">
        ${esc(r.requesterName || '익명')}
        ${r.artist ? ` · ${esc(r.artist)}` : ''}
        ${r.targetSinger ? ` · 담당: ${esc(r.targetSinger)}` : ''}
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
  $('refreshBtn').onclick = () => loadOnce().catch(() => {});
  loadOnce().catch(() => {});

  try {
    const socket = io();
    socket.on('requests:updated', (p) => {
      if (Array.isArray(p?.items)) render(p.items);
    });
  } catch {}
}

boot();

