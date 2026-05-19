/* global io */

const state = {
  page: 1,
  limit: 60,
  total: 0
};

function qs(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildQuery() {
  const q = qs('q').value.trim();
  const genre = qs('genre').value;
  const mood = qs('mood').value;
  const vocal = qs('vocal').value;
  const latestOnly = qs('latestOnly').checked ? '1' : '';

  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (genre) p.set('genre', genre);
  if (mood) p.set('mood', mood);
  if (vocal) p.set('vocal', vocal);
  if (latestOnly) p.set('latestOnly', '1');
  p.set('page', String(state.page));
  p.set('limit', String(state.limit));
  return p.toString();
}

async function loadSongs() {
  const res = await fetch(`/api/songs?${buildQuery()}`);
  const data = await res.json();
  if (!data.ok) throw new Error('loadSongs failed');
  state.total = data.total;
  renderSongs(data.items);
  renderPager();
  qs('resultInfo').textContent = `결과: ${data.total}개 · ${data.page}/${Math.max(1, Math.ceil(data.total / data.limit))}페이지`;
}

function renderSongs(items) {
  const grid = qs('songGrid');
  grid.innerHTML = '';
  items.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="cardTop">
        <div>
          <div class="songTitle">${esc(s.displayTitle || s.title)}</div>
          <div class="meta">${esc(s.artist || '')}</div>
        </div>
        ${s.isLatest ? `<div class="badgeNew">NEW!</div>` : ''}
      </div>
      <div class="chips">
        ${s.key ? `<span class="chip">Key ${esc(s.key)}</span>` : ''}
        ${s.genre ? `<span class="chip">${esc(s.genre)}</span>` : ''}
        ${s.mood ? `<span class="chip">${esc(s.mood)}</span>` : ''}
        ${s.vocal ? `<span class="chip">${esc(s.vocal)}</span>` : ''}
      </div>
      <div class="cardActions">
        <button class="pickBtn" data-fileid="${esc(s.googleFileId)}">곡 선택하기</button>
      </div>
    `;
    el.querySelector('.pickBtn').onclick = () => {
      window.location.href = `/viewer/${encodeURIComponent(s.googleFileId)}`;
    };
    grid.appendChild(el);
  });
}

function renderPager() {
  const pager = qs('pager');
  const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
  pager.innerHTML = '';
  const prev = document.createElement('button');
  prev.className = 'btn light';
  prev.textContent = '이전';
  prev.disabled = state.page <= 1;
  prev.onclick = async () => {
    state.page -= 1;
    await loadSongs();
  };
  const next = document.createElement('button');
  next.className = 'btn light';
  next.textContent = '다음';
  next.disabled = state.page >= totalPages;
  next.onclick = async () => {
    state.page += 1;
    await loadSongs();
  };
  const label = document.createElement('span');
  label.className = 'muted';
  label.textContent = `${state.page}/${totalPages}`;
  pager.append(prev, label, next);
}

async function loadRequests() {
  const res = await fetch('/api/requests');
  const data = await res.json();
  if (!data.ok) return;
  renderRequests(data.items);
}

function renderRequests(items) {
  const list = qs('requestList');
  list.innerHTML = '';
  items.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'reqItem';
    el.innerHTML = `
      <div class="reqLeft">
        <div class="reqTitle">${esc(r.songTitle)} <span class="muted">(${esc(r.status)})</span></div>
        <div class="reqSub">${esc(r.requesterName)} · ${esc(r.artist || '')} ${r.targetSinger ? `· 담당: ${esc(r.targetSinger)}` : ''}</div>
      </div>
      <div class="reqActions">
        <button class="btn light" data-id="${esc(r._id)}">삭제</button>
      </div>
    `;
    el.querySelector('button').onclick = async () => {
      await fetch(`/api/requests/${encodeURIComponent(r._id)}`, { method: 'DELETE' });
      await loadRequests();
    };
    list.appendChild(el);
  });
}

async function submitRequest() {
  const payload = {
    requesterName: qs('reqName').value.trim() || '익명',
    songTitle: qs('reqTitle').value.trim(),
    artist: qs('reqArtist').value.trim(),
    targetSinger: qs('reqTarget').value.trim()
  };
  if (!payload.songTitle) return alert('곡명을 입력해 주세요.');

  const res = await fetch('/api/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok) return alert('신청 실패');
  qs('reqTitle').value = '';
  qs('reqArtist').value = '';
  qs('reqTarget').value = '';
  await loadRequests();
}

function populateSelect(id, items) {
  const sel = qs(id);
  items.forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
}

function init() {
  populateSelect('genre', ['KPOP', 'JPOP', 'POP', 'OST', '기타']);
  populateSelect('mood', ['발라드', '락발라드', '밴드송', '댄스', '뮤지컬', '힙합', '동요']);
  populateSelect('vocal', ['남솔로', '여솔로', '듀엣', '그룹곡']);

  const debounced = (() => {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.page = 1;
        loadSongs().catch(() => {});
      }, 250);
    };
  })();

  ['q', 'genre', 'mood', 'vocal'].forEach((id) => qs(id).addEventListener('input', debounced));
  qs('latestOnly').addEventListener('change', debounced);
  qs('resetBtn').onclick = () => {
    qs('q').value = '';
    qs('genre').value = '';
    qs('mood').value = '';
    qs('vocal').value = '';
    qs('latestOnly').checked = false;
    state.page = 1;
    loadSongs().catch(() => {});
  };

  qs('reqSubmit').onclick = () => submitRequest().catch(() => {});
  qs('adminLoginBtn').onclick = () => (window.location.href = '/admin');

  // Socket: request updates (simple MVP)
  const socket = io();
  socket.on('requests:updated', (p) => {
    if (p?.items) renderRequests(p.items);
  });

  loadSongs().catch(() => {});
  loadRequests().catch(() => {});
}

init();

