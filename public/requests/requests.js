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
  const empty = $('empty');
  empty.textContent = '신청곡이 없습니다.'; // 상태 문구(로딩/에러)로 바뀌었을 수 있어 원복
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

// UX-12(2차 감사): 로딩/에러 상태가 전무해 실패 시 영구 백지였다(방송 송출 위험).
// 로딩 문구 → 실패 시 에러+재시도 버튼 → 30초 자동 재시도.
function setStatus(html) {
  const empty = $('empty');
  if (!empty) return;
  empty.style.display = 'block';
  empty.innerHTML = html;
}

let _retryTimer = null;
async function loadOnce() {
  setStatus('신청곡을 불러오는 중...');
  let ok = false;
  try {
    const r = await apiGet('/api/requests');
    if (r?.ok) {
      render(r.items || []);
      ok = true;
    }
  } catch {}
  if (!ok) {
    setStatus('신청곡을 불러오지 못했습니다. <button id="retryBtn" type="button">다시 시도</button>');
    document.getElementById('retryBtn')?.addEventListener('click', () => loadOnce());
    clearTimeout(_retryTimer);
    _retryTimer = setTimeout(() => loadOnce(), 30000);
  }
}

function boot() {
  loadOnce().catch(() => {});

  try {
    const socket = io(API_URL, { withCredentials: true });
    socket.on('requests:updated', (p) => {
      if (Array.isArray(p?.items)) render(p.items);
    });
    // 소켓이 재연결되면(서버 재기동 등) 최신 목록을 다시 당겨온다.
    socket.on('connect', () => loadOnce().catch(() => {}));
  } catch {}
}

boot();
