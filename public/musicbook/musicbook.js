/* global io */

// ---- State -----------------------------------------------------------------------
const state = {
  role: 'viewer', // viewer | session | admin
  displayName: '방문자',
  userId: '',
  main: null,
  songCardsAll: [],
  songCardsFiltered: [],
  songFilesAll: [], // fileId 단위(세션 팔로우/가능곡 편집 등에서 사용)
  songFilesFiltered: [],
  requests: [],
  requestManageMode: false,
  selectedRequestIds: new Set(),
  // 가능보컬 필터용 (타인 포함)
  filterAvailableVocalUserId: '',
  filterAvailableVocalSet: null, // Set<googleFileId>
  // 가능보컬 멀티 선택(AND)용
  filterAvailableVocalUserIds: [],
  filterAvailableVocalSetsByUserId: new Map(), // userId -> Set<googleFileId>
  availableVocalUsers: [], // [{userId,displayName}]

  // 본인 가능곡 편집용
  myAvailabilitySet: null, // Set<googleFileId>
  availabilityEditMode: false,
  availabilityOriginalSet: null, // Set<googleFileId>
  availabilityDraftSet: null, // Set<googleFileId>

  sessionRoomCode: '',
  isPageTurner: false,
  sessionCurrentFileId: '',
  sessionCurrentPageNo: 1,

  sortField: 'createdAt',
  sortDir: 'desc',
  page: 1,
  pageSize: 500,

  // card click selection
  _pendingCard: null,
  _pendingVariant: null,
  _rouletteCandidates: []
};

// ---- DOM helpers -----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function extractDriveFileIdFromAny(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  // drive.google.com/file/d/<id>/view
  const m1 = s.match(/\/file\/d\/([^/]+)/);
  if (m1) return m1[1];
  // open?id=<id>
  try {
    const u = new URL(s, window.location.origin);
    const id = u.searchParams.get('id');
    if (id) return id;
  } catch {}
  return '';
}

function normalizeProfilePhotoUrl(url, size = 240) {
  const s = String(url || '').trim();
  if (!s) return '';
  // If it's already a thumbnail URL or direct image URL, keep as-is.
  if (s.includes('drive.google.com/thumbnail')) return s;
  const id = extractDriveFileIdFromAny(s);
  if (!id) return s;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${Number(size) || 240}`;
}

function normLower(s) {
  const v = String(s ?? '');
  try {
    // 한글 조합(NFD/NFC) 차이로 includes가 실패하는 케이스 방지
    return v.normalize('NFC').toLowerCase();
  } catch {
    return v.toLowerCase();
  }
}

// 검색용 정규화: 소문자 + 공백 제거(띄어쓰기 유무 무시)
function normSearch(s) {
  return normLower(s).replace(/\s+/g, '');
}

function showLoading(on) {
  $('loadingScreen').classList.toggle('active', Boolean(on));
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

function openModal(id) {
  $(id).classList.add('active');
}
function closeModal(id) {
  $(id).classList.remove('active');
}

function switchPage(page) {
  $('mainPage').classList.toggle('active', page === 'main');
  $('songsPage').classList.toggle('active', page === 'songs');
  $('mainNavBtn').classList.toggle('active', page === 'main');
  $('songsNavBtn').classList.toggle('active', page === 'songs');
  if (page === 'songs') {
    $('songsTitleRow').style.display = 'flex';
  } else {
    $('songsTitleRow').style.display = 'none';
  }
}

// ---- API -------------------------------------------------------------------------
async function apiGet(url) {
  const res = await fetch(url, { credentials: 'include' });
  return res.json();
}
async function apiJson(url, method, body) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  return res.json();
}

function updateProfileImage(id, url) {
  const image = $(id);
  if (!image) return;
  const finalUrl = normalizeProfilePhotoUrl(url || '', id === 'profilePhoto' ? 80 : 240);
  image.classList.toggle('active', Boolean(finalUrl));
  image.src = finalUrl || '';
}

function openUrlOrToast(url, label) {
  // chzzk: legacy default (원본 GAS 링크)
  if (!url && label === '치지직') url = 'https://m.chzzk.naver.com/a69cde62e00086cfcf1c6733758cad9c';
  if (url) window.open(url, '_blank');
  else toast(`${label} 링크가 설정되어 있지 않습니다. /admin에서 설정해 주세요.`);
}

async function loadMainPage() {
  const data = await apiGet('/api/main');
  if (!data.ok) return;
  state.main = data.data;

  // banner/title
  const bannerUrl = normalizeProfilePhotoUrl(state.main.bannerImage || '', 1600);
  const titleUrl = normalizeProfilePhotoUrl(state.main.titleImage || '', 800);
  $('bannerImage').src = bannerUrl || 'https://placehold.co/1200x400?text=NO+IMAGE';
  $('songsTitleLogo').src = titleUrl || '';
  $('songsTitleLogo').style.display = state.main.titleImage ? 'block' : 'none';

  // notice
  $('noticeContent').innerText = state.main.notice || '';

  // external links
  $('discordBtn').onclick = () => openUrlOrToast(state.main.discordUrl, '디스코드');
  $('youtubeBtn').onclick = () => openUrlOrToast(state.main.youtubeUrl, '유튜브');
  $('chzzkBtn').onclick = () => openUrlOrToast(state.main.chzzkUrl, '치지직');
}

// ---- CHZZK admin controls (PoC) --------------------------------------------------
let _chzzkStatusTimer = null;
async function refreshChzzkStatus() {
  if (state.role !== 'admin') return;
  const el = $('chzzkStatusText');
  if (!el) return;
  try {
    const r = await apiGet('/api/admin/chzzk/status');
    if (!r?.ok) {
      el.textContent = '치지직 상태: 오류';
      return;
    }
    const st = String(r.state || 'OFF');
    const map = { OFF: 'OFF', WAIT_LIVE: '대기', CONNECTING: '연결중', CONNECTED: '연결됨', ERROR: '오류' };
    const label = map[st] || st;
    const lastAt = Number(r.lastMessageAt || 0);
    const lastMsg = String(r.lastMessagePreview || '').trim();
    const time = lastAt ? new Date(lastAt).toLocaleTimeString() : '';
    const extra = lastMsg ? ` · 최근(${time}): ${lastMsg}` : lastAt ? ` · 최근(${time})` : '';
    el.textContent = `치지직 상태: ${label}${extra}`;
  } catch {
    el.textContent = '치지직 상태: 오류';
  }
}

function startChzzkStatusPolling() {
  if (_chzzkStatusTimer) return;
  _chzzkStatusTimer = setInterval(() => refreshChzzkStatus().catch(() => {}), 1500);
  refreshChzzkStatus().catch(() => {});
}

async function chzzkStart() {
  const btn = $('chzzkStartBtn');
  const stopBtn = $('chzzkStopBtn');
  try {
    if (btn) btn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    const r = await apiJson('/api/admin/chzzk/start', 'POST', {});
    if (!r?.ok) toast('치지직 시작 실패');
  } catch {
    toast('치지직 시작 실패');
  } finally {
    if (btn) btn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;
    refreshChzzkStatus().catch(() => {});
  }
}

async function chzzkStop() {
  const btn = $('chzzkStartBtn');
  const stopBtn = $('chzzkStopBtn');
  try {
    if (btn) btn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    const r = await apiJson('/api/admin/chzzk/stop', 'POST', {});
    if (!r?.ok) toast('치지직 정지 실패');
  } catch {
    toast('치지직 정지 실패');
  } finally {
    if (btn) btn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;
    refreshChzzkStatus().catch(() => {});
  }
}

async function loadSongs(force = false) {
  if (!force && state.songCardsAll.length) return;
  const data = await apiGet('/api/songs/cards');
  if (!data.ok) throw new Error('songs load failed');
  state.songCardsAll = (data.items || []).map((c) => ({
    ...c,
    keyLabel: (c.keys || []).filter(Boolean).join('/') || '-',
    _searchNorm: normSearch(c.searchText || ''),
    _titleNorm: normSearch(c.title || ''),
    _artistNorm: normSearch(c.artist || '')
  }));
  if (!state.songCardsAll.length) {
    $('resultCount').textContent = '곡 데이터가 없습니다. /admin에서 Drive 동기화를 실행해 주세요.';
  }
}

async function loadSongFiles(force = false) {
  if (!force && state.songFilesAll.length) return;
  const data = await apiGet('/api/songs?limit=5000');
  if (!data.ok) throw new Error('songs load failed');
  state.songFilesAll = (data.items || []).map((s) => ({
    ...s,
    _searchNorm: normSearch(s.searchText || ''),
    _titleNorm: normSearch(s.title || ''),
    _displayTitleNorm: normSearch(s.displayTitle || ''),
    _artistNorm: normSearch(s.artist || '')
  }));
}

async function loadAvailableVocalSet(userId) {
  state.filterAvailableVocalUserId = userId || '';
  state.filterAvailableVocalSet = null;
  if (!userId) return;
  const data = await apiGet(`/api/availability?userId=${encodeURIComponent(userId)}`);
  if (!data.ok) return;
  const set = new Set();
  (data.items || []).forEach((a) => {
    if (a.available) set.add(a.googleFileId);
  });
  state.filterAvailableVocalSet = set;
}

async function loadAvailableVocalSets(userIds) {
  const ids = Array.isArray(userIds) ? userIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const selected = new Set(ids);
  // prune cache
  for (const k of state.filterAvailableVocalSetsByUserId.keys()) {
    if (!selected.has(k)) state.filterAvailableVocalSetsByUserId.delete(k);
  }
  const missing = ids.filter((uid) => !state.filterAvailableVocalSetsByUserId.has(uid));
  await Promise.all(
    missing.map(async (uid) => {
      const data = await apiGet(`/api/availability?userId=${encodeURIComponent(uid)}`);
      if (!data.ok) return;
      const set = new Set();
      (data.items || []).forEach((a) => {
        if (a.available) set.add(a.googleFileId);
      });
      state.filterAvailableVocalSetsByUserId.set(uid, set);
    })
  );
}

function getSelectedAvailableVocalUserIds() {
  return Array.isArray(state.filterAvailableVocalUserIds) ? state.filterAvailableVocalUserIds.slice() : [];
}

function renderAvailableVocalChips() {
  const wrap = $('availableVocalChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const ids = getSelectedAvailableVocalUserIds();
  const row = $('availableVocalSelectedRow');
  if (row) row.style.display = ids.length ? 'flex' : 'none';
  if (!ids.length) return;
  const userMap = new Map((state.availableVocalUsers || []).map((u) => [String(u.userId), u]));
  ids.forEach((uid) => {
    const u = userMap.get(uid);
    const name = String(u?.displayName || u?.userId || uid);
    const chip = document.createElement('span');
    chip.className = 'avail-chip';
    chip.innerHTML = `<span>${esc(name)}</span><button type="button" data-x="1" aria-label="remove">×</button>`;
    chip.querySelector('[data-x="1"]').onclick = async () => {
      state.filterAvailableVocalUserIds = ids.filter((x) => x !== uid);
      await loadAvailableVocalSets(state.filterAvailableVocalUserIds);
      state.page = 1;
      applySongFilters();
      renderAvailableVocalChips();
    };
    wrap.appendChild(chip);
  });
}

function openAvailableVocalModal() {
  const overlay = $('availableVocalModal');
  if (!overlay) return;
  overlay.classList.add('active');
  $('availableVocalSearch').value = '';
  renderAvailableVocalModalList('');
}

function closeAvailableVocalModal() {
  $('availableVocalModal')?.classList.remove('active');
}

function renderAvailableVocalModalList(query) {
  const q = normSearch(String(query || '').trim());
  const list = Array.isArray(state.availableVocalUsers) ? state.availableVocalUsers : [];
  const wrap = $('availableVocalModalList');
  if (!wrap) return;
  wrap.innerHTML = '';
  const selected = new Set(getSelectedAvailableVocalUserIds());
  list
    .filter((u) => {
      if (!q) return true;
      return normSearch(u.displayName || u.userId || '').includes(q);
    })
    .slice(0, 200)
    .forEach((u) => {
      const uid = String(u.userId || '').trim();
      if (!uid) return;
      const row = document.createElement('div');
      row.className = 'avail-modal-row';
      const name = String(u.displayName || uid);
      row.innerHTML = `<label><input type="checkbox" data-uid="${esc(uid)}" ${selected.has(uid) ? 'checked' : ''} /> ${esc(
        name
      )}</label>`;
      row.querySelector('input[type="checkbox"]').onchange = async (e) => {
        const on = Boolean(e.target.checked);
        const cur = new Set(getSelectedAvailableVocalUserIds());
        if (on) cur.add(uid);
        else cur.delete(uid);
        state.filterAvailableVocalUserIds = Array.from(cur);
        await loadAvailableVocalSets(state.filterAvailableVocalUserIds);
        state.page = 1;
        applySongFilters();
        renderAvailableVocalChips();
      };
      wrap.appendChild(row);
    });
}

async function loadMyAvailabilitySet() {
  const userId = state.userId || '';
  state.myAvailabilitySet = null;
  if (!userId) return null;
  const data = await apiGet(`/api/availability?userId=${encodeURIComponent(userId)}`);
  if (!data.ok) return null;
  const set = new Set();
  (data.items || []).forEach((a) => {
    if (a.available) set.add(a.googleFileId);
  });
  state.myAvailabilitySet = set;
  return set;
}

function applySongFilters() {
  const q = normSearch($('searchInput').value.trim());
  const genre = $('genreFilter').value;
  const mood = $('moodFilter').value;
  const vocal = $('vocalFilter').value;
  const availableVocalUserIds = getSelectedAvailableVocalUserIds();

  const hideTags = true; // 기본은 항상 태그 숨김(토글 제거)

  if (state.availabilityEditMode) {
    let list = state.songFilesAll.slice().filter((s) => !s.hidden);
    if (genre) list = list.filter((s) => s.genre === genre);
    if (mood) list = list.filter((s) => s.mood === mood);
    if (vocal) list = list.filter((s) => s.vocal === vocal);
  if (q)
    list = list.filter(
      (s) =>
          (s._searchNorm || normSearch(s.searchText || '')).includes(q) ||
          (s._titleNorm || normSearch(s.title || '')).includes(q) ||
          (s._displayTitleNorm || normSearch(s.displayTitle || '')).includes(q) ||
          (s._artistNorm || normSearch(s.artist || '')).includes(q)
    );

    // 가능보컬(AND) 필터도 편집모드(파일 단위)에 동일 적용
    if (availableVocalUserIds.length) {
      const ids = availableVocalUserIds;
      list = list.filter((s) => {
        const fid = String(s.googleFileId || '');
        return ids.every((uid) => {
          const set = state.filterAvailableVocalSetsByUserId.get(uid);
          if (!set) return false;
          return set.has(fid);
        });
      });
    }

    const f = state.sortField;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const av = a?.[f] ?? '';
      const bv = b?.[f] ?? '';
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });

    state.songFilesFiltered = list;
    $('resultCount').textContent = `검색 결과: ${list.length}개(파일 단위)`;
    renderAvailabilityEditCards(hideTags);
    renderPager();
    return;
  }

  let list = state.songCardsAll.slice();
  if (genre) list = list.filter((c) => c.genre === genre);
  if (mood) list = list.filter((c) => c.mood === mood);
  if (vocal) list = list.filter((c) => c.vocal === vocal);
  if (q)
    list = list.filter(
      (c) =>
        (c._searchNorm || normSearch(c.searchText || '')).includes(q) ||
        (c._titleNorm || normSearch(c.title || '')).includes(q) ||
        (c._artistNorm || normSearch(c.artist || '')).includes(q)
    );

  // 가능보컬 필터(AND): 선택된 유저 "모두"가 가능한 곡만 노출
  if (availableVocalUserIds.length) {
    const ids = availableVocalUserIds;
    list = list.filter((c) => {
      const vars = Array.isArray(c.variants) ? c.variants : [];
      return ids.every((uid) => {
        const set = state.filterAvailableVocalSetsByUserId.get(uid);
        if (!set) return false;
        return vars.some((v) => set.has(v.googleFileId));
      });
    });
  }

  const f = state.sortField;
  const dir = state.sortDir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    const av = f === 'key' ? a?.keyLabel ?? '' : a?.[f] ?? '';
    const bv = f === 'key' ? b?.keyLabel ?? '' : b?.[f] ?? '';
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });

  state.songCardsFiltered = list;
  $('resultCount').textContent = `검색 결과: ${list.length}곡`;
  renderSongCards(hideTags);
  renderPager();
}

function renderSongCards(hideTags) {
  const wrap = $('songCardList');
  wrap.innerHTML = '';

  const totalPages = Math.max(1, Math.ceil(state.songCardsFiltered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const items = state.songCardsFiltered.slice(start, start + state.pageSize);

  items.forEach((c) => {
    const el = document.createElement('div');
    const canOpen = state.role !== 'viewer';
    el.className = canOpen ? 'song-card clickable' : 'song-card';
    const title = c.title || '(제목없음)';
    const keyLabel = c.keyLabel || '-';

    const isAdmin = state.role === 'admin';
    const users = Array.isArray(c.availableUsers) ? c.availableUsers : [];
    const maxShown = 8;
    const shown = users.slice(0, maxShown);
    const more = users.length > maxShown ? users.length - maxShown : 0;
    const avatarHtml = `
      <div class="mini-avatars">
        ${shown
          .map((u) => {
            const name = String(u.displayName || u.userId || '').trim();
            const initial = name ? name.slice(0, 1) : '?';
            const photo = normalizeProfilePhotoUrl(u.profilePhoto || '', 80);
            return photo
              ? `<span class="mini-avatar" title="${esc(name)}"><img src="${esc(photo)}" alt="" /></span>`
              : `<span class="mini-avatar" title="${esc(name)}">${esc(initial)}</span>`;
          })
          .join('')}
        ${more ? `<span class="mini-avatar more" title="+${more}명">+${more}</span>` : ''}
      </div>
    `;
    // 카드 레이아웃(3행):
    // 1행 제목(+new) + 우측 편집
    // 2행 가수
    // 3행 가능보컬 프로필(최대 8명 +N)
    el.innerHTML = `
      <div class="song-card-header">
        <div class="song-card-top">
          <div class="song-card-title">
            <span>${esc(title)}</span>
            ${c.isLatest ? `<span class="new-badge">new!</span>` : ''}
          </div>
          <div class="song-card-actions">
            ${isAdmin ? `<span class="chip edit-chip" data-action="editSong">편집</span>` : ''}
          </div>
        </div>
        <div class="song-card-artist">${esc(c.artist || '')}</div>
        ${users.length ? `<div class="song-card-avatars">${avatarHtml}</div>` : ''}
      </div>
      ${hideTags ? '' : `
        <div class="song-chips">
          <span class="chip">${esc(keyLabel)}</span>
          <span class="chip">${esc(c.genre || '-')}</span>
          <span class="chip">${esc(c.mood || '-')}</span>
          <span class="chip">${esc(c.vocal || '-')}</span>
        </div>
      `}
    `;
    el.querySelector('[data-action="editSong"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSongTagModal(c);
    });
    if (canOpen) {
      el.onclick = () => {
        openCardFlow(c).catch(() => {});
      };
    }
    wrap.appendChild(el);
  });
}

async function toggleAvailabilityForFile(userId, googleFileId, next) {
  if (!userId) return toast('로그인 정보가 없습니다.');
  const res = await apiJson('/api/availability', 'PUT', { userId, googleFileId, available: Boolean(next) });
  if (!res.ok) return toast('저장 실패');
  if (!state.myAvailabilitySet) state.myAvailabilitySet = new Set();
  if (next) state.myAvailabilitySet.add(googleFileId);
  else state.myAvailabilitySet.delete(googleFileId);
}

function updateAvailabilityEditCount() {
  const el = $('availabilityEditCount');
  if (!el) return;
  if (!state.availabilityEditMode) {
    el.textContent = '';
    return;
  }
  const orig = state.availabilityOriginalSet || new Set();
  const draft = state.availabilityDraftSet || new Set();
  let added = 0;
  for (const fid of draft) {
    if (!orig.has(fid)) added += 1;
  }
  el.textContent = `새로 체크: ${added}곡`;
}

function renderAvailabilityEditCards(hideTags) {
  const wrap = $('songCardList');
  wrap.innerHTML = '';

  const totalPages = Math.max(1, Math.ceil(state.songFilesFiltered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const items = state.songFilesFiltered.slice(start, start + state.pageSize);

  const userId = state.userId || '';
  const set = state.availabilityDraftSet || state.myAvailabilitySet;

  items.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'song-card';
    const title = s.displayTitle || s.title || '(제목없음)';
    const checked = !!(set && set.has(s.googleFileId));
    el.innerHTML = `
      <div class="song-card-header">
        <div>
          <div class="song-card-title">${esc(title)}</div>
          <div class="song-card-artist">${esc(s.artist || '')}</div>
        </div>
        <div class="song-card-right">
          <label class="inline-check" style="gap:8px;">
            <input type="checkbox" ${checked ? 'checked' : ''} />
            가능
          </label>
        </div>
      </div>
      ${hideTags ? '' : `
        <div class="song-chips">
          <span class="chip">${esc(s.key || '-')}</span>
          <span class="chip">${esc(s.genre || '-')}</span>
          <span class="chip">${esc(s.mood || '-')}</span>
          <span class="chip">${esc(s.vocal || '-')}</span>
        </div>
      `}
    `;
    const chk = el.querySelector('input[type="checkbox"]');
    chk.onchange = async () => {
      const next = chk.checked;
      // 선택모드에서는 로컬 draft만 수정(저장 버튼에서 일괄 반영)
      if (state.availabilityEditMode) {
        if (!state.availabilityDraftSet) state.availabilityDraftSet = new Set();
        if (next) state.availabilityDraftSet.add(s.googleFileId);
        else state.availabilityDraftSet.delete(s.googleFileId);
        updateAvailabilityEditCount();
        return;
      }
      await toggleAvailabilityForFile(userId, s.googleFileId, next);
    };
    wrap.appendChild(el);
  });
}

// ---- Song tag edit (admin only) ---------------------------------------------------
let _editCard = null;
function openSongTagModal(card) {
  if (state.role !== 'admin') return toast('관리자 권한이 필요합니다.');
  _editCard = card;
  $('songTagModalSubtitle').textContent = `${card.title || '(제목없음)'} · ${card.artist || ''}`;
  // 조성(key)은 카드(키 통합) 개념과 충돌하므로 여기서는 비활성화
  $('songKeySelect').value = '';
  $('songKeySelect').disabled = true;
  $('songGenreSelect').value = card.genre || '';
  $('songMoodSelect').value = card.mood || '';
  $('songVocalSelect').value = card.vocal || '';
  openModal('songTagModal');
}

async function saveSongTagModal() {
  if (!_editCard) return;
  const payload = {
    genre: $('songGenreSelect').value || '',
    mood: $('songMoodSelect').value || '',
    vocal: $('songVocalSelect').value || ''
  };
  const res = await apiJson(`/api/admin/song-cards`, 'PATCH', { title: _editCard.title, artist: _editCard.artist, ...payload });
  if (!res.ok) return toast(`저장 실패: ${res.error || ''}`);
  // 갱신은 서버 재조회로 일관성 확보
  await loadSongs(true);
  closeModal('songTagModal');
  _editCard = null;
  $('songKeySelect').disabled = false;
  applySongFilters();
  toast('저장 완료');
}

// ---- Card flow (키 선택 -> 액션 선택) ---------------------------------------------
async function openCardFlow(card) {
  if (state.role === 'viewer') return;
  if (!card?.variants?.length) return;

  // 태그 입력 모달은 "뷰어 선택지(키/액션)"보다 먼저 등장해야 한다.
  if (needsTagGate(card)) {
    // 태그 저장 API는 googleFileId를 요구하므로 대표 variant를 pending으로 넣는다.
    state._pendingCard = card;
    state._pendingVariant = card.variants[0];
    const ok = await openTagRequiredModal(card);
    if (!ok) return;
    // 최신 태그 반영된 카드로 교체(재조회 완료 후)
    card = state.songCardsAll.find((c) => String(c.cardId) === String(card.cardId)) || card;
  }

  const keys = (card.keys || []).filter((x) => x !== undefined);
  if (keys.length > 1) return openKeySelectModal(card);
  return openSongActionModal(card, card.variants[0]);
}

function openKeySelectModal(card) {
  state._pendingCard = card;
  state._pendingVariant = null;
  $('keySelectSubtitle').textContent = `${card.title || ''} - ${card.artist || ''}`.trim();
  const wrap = $('keySelectButtons');
  wrap.innerHTML = '';
  (card.variants || []).forEach((v) => {
    const btn = document.createElement('button');
    btn.className = 'floating-btn compact-btn';
    btn.type = 'button';
    btn.textContent = v.key ? v.key : '-';
    btn.onclick = () => {
      closeModal('keySelectModal');
      openSongActionModal(card, v);
    };
    wrap.appendChild(btn);
  });
  openModal('keySelectModal');
}

function openSongActionModal(card, variant) {
  state._pendingCard = card;
  state._pendingVariant = variant;
  const k = variant?.key ? ` (${variant.key})` : '';
  $('songActionSubtitle').textContent = `${card.title || ''} - ${card.artist || ''}${k}`.trim();
  openModal('songActionModal');
}

function needsTagGate(card) {
  if (!card) return false;
  // 장르/분위기/보컬 중 하나라도 비어있으면 입력 유도
  return !(String(card.genre || '').trim() && String(card.mood || '').trim() && String(card.vocal || '').trim());
}

function openTagRequiredModal(card) {
  const overlay = $('tagRequiredModal');
  if (!overlay) return Promise.resolve(false);
  $('tagRequiredSubtitle').textContent = `${card.title || ''} · ${card.artist || ''}`.trim();

  const g = $('tagReqGenre');
  const m = $('tagReqMood');
  const v = $('tagReqVocal');
  if (g) g.value = String(card.genre || '').trim();
  if (m) m.value = String(card.mood || '').trim();
  if (v) v.value = String(card.vocal || '').trim();

  // 이미 값이 있는 필드는 수정 불가(최초 입력 보호)
  if (g) g.disabled = Boolean(String(card.genre || '').trim());
  if (m) m.disabled = Boolean(String(card.mood || '').trim());
  if (v) v.disabled = Boolean(String(card.vocal || '').trim());

  openModal('tagRequiredModal');

  return new Promise((resolve) => {
    const cleanup = (ok) => {
      try {
        $('tagReqCancelBtn').onclick = null;
        $('tagReqSaveBtn').onclick = null;
      } catch {}
      closeModal('tagRequiredModal');
      resolve(Boolean(ok));
    };
    $('tagReqCancelBtn').onclick = () => cleanup(false);
    $('tagReqSaveBtn').onclick = async () => {
      const genre = String(g?.value || '').trim();
      const mood = String(m?.value || '').trim();
      const vocal = String(v?.value || '').trim();
      if (!genre || !mood || !vocal) return toast('장르/분위기/보컬을 모두 선택해 주세요.');
      const vv = state._pendingVariant;
      if (!vv?.googleFileId) return cleanup(false);
      const saveBtn = $('tagReqSaveBtn');
      const cancelBtn = $('tagReqCancelBtn');
      const sp = $('tagReqSpinner');
      try {
        if (saveBtn) saveBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        if (sp) sp.style.display = 'inline-block';
        const r = await apiJson('/api/songs/tags', 'PATCH', { googleFileId: vv.googleFileId, genre, mood, vocal });
        if (!r.ok) {
          toast('저장 실패');
          return;
        }
        // 카드/검색에 바로 반영되도록 재조회
        await loadSongs(true);
        await loadSongFiles(true);
        cleanup(true);
      } finally {
        if (sp) sp.style.display = 'none';
        if (saveBtn) saveBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
      }
    };
  });
}

async function copyDriveLink() {
  const v = state._pendingVariant;
  const url = String(v?.driveUrl || '').trim();
  if (!url) return toast('링크가 없습니다.');
  try {
    await navigator.clipboard.writeText(url);
    toast('드라이브 링크 복사됨');
  } catch {
    toast('복사 실패(브라우저 권한 확인)');
  }
}

async function openInViewer() {
  const v = state._pendingVariant;
  if (!v?.googleFileId) return;
  const roomCode = state.sessionRoomCode;
  const targetUrl = roomCode ? `/viewer/${encodeURIComponent(v.googleFileId)}?room=${encodeURIComponent(roomCode)}` : `/viewer/${encodeURIComponent(v.googleFileId)}`;
  if (roomCode && state.isPageTurner) {
    state._socket?.emit?.('session:follow:file', { roomCode, fileId: v.googleFileId, originalLink: v.driveUrl || '' }, () => {
      window.location.href = targetUrl;
    });
  } else {
    window.location.href = targetUrl;
  }
}

function renderPager() {
  const total = state.availabilityEditMode ? state.songFilesFiltered.length : state.songCardsFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  $('pageInfo').textContent = `${state.page} / ${totalPages}`;
  $('prevPageBtn').disabled = state.page <= 1;
  $('nextPageBtn').disabled = state.page >= totalPages;
}

// (룰렛 애니메이션은 후속 단계에서 교체)
function _mbLocalDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getRandomCandidateCount() {
  const v = Number(localStorage.getItem('mb_random_candidate_count') || '3');
  if (!Number.isFinite(v)) return 3;
  return Math.min(5, Math.max(1, Math.round(v)));
}

function setRandomCandidateCount(n) {
  const v = Math.min(5, Math.max(1, Math.round(Number(n || 3))));
  localStorage.setItem('mb_random_candidate_count', String(v));
  return v;
}

function _mbHash32(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 (with overflow)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function getOrCreateAnonUserKey() {
  const k = 'mb_anon_user_v1';
  let v = String(localStorage.getItem(k) || '').trim();
  if (!v) {
    v = `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(k, v);
  }
  return v;
}

function getRandomUserKey() {
  const uid = String(state.userId || '').trim();
  if (uid) return `u:${uid}`;
  return `v:${getOrCreateAnonUserKey()}`;
}

function getRandomFilterKey() {
  // "같은 조건" 정의: 랜덤 풀을 만드는 검색/필터 조건만 포함
  const q = $('searchInput')?.value || '';
  const genre = $('genreFilter')?.value || '';
  const mood = $('moodFilter')?.value || '';
  const vocal = $('vocalFilter')?.value || '';

  const availUserIds = Array.isArray(state.filterAvailableVocalUserIds) ? [...state.filterAvailableVocalUserIds] : [];
  availUserIds.sort();

  const legacyAvailUserId = String(state.filterAvailableVocalUserId || '').trim();
  const obj = {
    q: String(q).trim(),
    genre: String(genre).trim(),
    mood: String(mood).trim(),
    vocal: String(vocal).trim(),
    availUserIds,
    legacyAvailUserId,
    availabilityEditMode: Boolean(state.availabilityEditMode)
  };
  return _mbHash32(JSON.stringify(obj));
}

function getTodayRandomHistory() {
  const today = _mbLocalDateKey();
  const userKey = getRandomUserKey();
  const filterKey = getRandomFilterKey();
  const key = `mb_random_history_v2:${today}:${userKey}:${filterKey}`;
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    if (raw && raw.date === today && Array.isArray(raw.ids)) return { key, date: today, ids: raw.ids };
  } catch {}
  return { key, date: today, ids: [] };
}

function saveTodayRandomHistory(storageKey, ids) {
  const today = _mbLocalDateKey();
  const uniq = Array.from(new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean)));
  localStorage.setItem(storageKey, JSON.stringify({ date: today, ids: uniq }));
}

function resetTodayRandomHistoryForUser() {
  const today = _mbLocalDateKey();
  const userKey = getRandomUserKey();
  const prefix = `mb_random_history_v2:${today}:${userKey}:`;
  try {
    // localStorage iteration is safe here (small)
    const toDel = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toDel.push(k);
    }
    toDel.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

function pickRandomCardsNoDup(pool, count) {
  const hist = getTodayRandomHistory();
  const excluded = new Set((hist.ids || []).map((x) => String(x)));
  const avail = (pool || []).filter((c) => c && !excluded.has(String(c.cardId)));
  if (!avail.length) return [];
  const want = Math.min(Math.max(1, count), avail.length);

  // partial Fisher–Yates shuffle
  for (let i = 0; i < want; i += 1) {
    const j = i + Math.floor(Math.random() * (avail.length - i));
    const tmp = avail[i];
    avail[i] = avail[j];
    avail[j] = tmp;
  }
  return avail.slice(0, want);
}

function renderRandomCandidates(candidates) {
  const wrap = $('randomCandidates');
  if (!wrap) return;
  wrap.innerHTML = '';
  (candidates || []).forEach((c) => {
    const row = document.createElement('div');
    row.className = 'random-candidate';
    row.innerHTML = `
      <div class="meta">
        <div class="title">${esc(c.title || '')}</div>
        <div class="sub">${esc(c.artist || '')}</div>
      </div>
      <div class="actions">
        <button class="floating-btn compact-btn black-btn" type="button">이걸로 할래</button>
      </div>
    `;
    const btn = row.querySelector('button');
    if (btn) {
      btn.onclick = () => {
        if (state.role === 'viewer') return toast('세션/관리자 로그인이 필요합니다.');
        closeModal('randomModal');
        openCardFlow(c).catch(() => {});
      };
    }
    wrap.appendChild(row);
  });
}

function renderRouletteMulti(count) {
  const wrap = $('rouletteMulti');
  if (!wrap) return [];
  wrap.innerHTML = '';
  const listEls = [];
  for (let i = 0; i < count; i += 1) {
    const box = document.createElement('div');
    box.className = 'roulette-list-wrap';
    box.innerHTML = `
      <div class="roulette-fade top"></div>
      <div class="roulette-fade bottom"></div>
      <div class="roulette-center-line"></div>
      <div class="roulette-list"></div>
    `;
    const listEl = box.querySelector('.roulette-list');
    if (listEl) listEls.push(listEl);
    wrap.appendChild(box);
  }
  return listEls;
}

function spinRouletteList(listEl, pool, highlight, delayMs = 0) {
  if (!listEl) return 0;
  const box = listEl.parentElement;
  const ITEM_H = 28;
  // WRAP_H는 실제 컨테이너 높이를 기준으로 해야 "중앙 라인"과 멈춤 위치가 일치한다.
  // (미니 룰렛 높이를 줄였을 때 Math.max로 키우면 오차가 생김)
  const WRAP_H = Math.max(40, Number(box?.clientHeight || 80));
  const centerOffset = WRAP_H / 2 - ITEM_H / 2;

  const total = Math.min(48, Math.max(24, 32));
  const seq = [];
  for (let i = 0; i < total; i += 1) {
    seq.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  const stopIndex = Math.max(8, total - 8);
  seq[stopIndex] = highlight;

  listEl.style.transition = 'none';
  listEl.style.transform = 'translateY(0px)';
  listEl.innerHTML = seq
    .map(
      (c) =>
        `<div class="roulette-item"><span>${esc(c.title || '')}</span><span class="sub">${esc(c.artist || '')}</span></div>`
    )
    .join('');

  const duration = 2600;
  setTimeout(() => {
    requestAnimationFrame(() => {
      const y = centerOffset - stopIndex * ITEM_H;
      listEl.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.86, 0.10, 1)`;
      listEl.style.transform = `translateY(${y}px)`;
    });
  }, Math.max(0, delayMs));

  return duration + Math.max(0, delayMs);
}

function rollRouletteCandidates() {
  const rerollBtn = $('randomRerollBtn');
  if (rerollBtn) rerollBtn.style.display = 'none';
  $('randomResult').textContent = '룰렛을 돌려 후보를 뽑습니다...';
  renderRandomCandidates([]);

  const pool = state.songCardsFiltered || [];
  if (!pool.length) return toast('랜덤 대상 곡이 없습니다.');

  const want = getRandomCandidateCount();
  const candidates = pickRandomCardsNoDup(pool, want);
  state._rouletteCandidates = candidates;

  if (!candidates.length) {
    $('randomResult').textContent = '오늘은 더 뽑을 곡이 없습니다. (현재 조건/사용자 기준 중복 금지)';
    toast('오늘(현재 조건) 뽑을 곡이 없습니다. (랜덤 설정에서 “오늘 기록 초기화” 가능)');
    return;
  }
  if (candidates.length < want) {
    toast(`오늘 남은 곡이 ${candidates.length}개뿐입니다.`);
  }

  // 중복 금지 기준: "후보로 한 번이라도 나온 곡"을 오늘 기록에 추가
  const hist = getTodayRandomHistory();
  const nextIds = [...(hist.ids || []), ...candidates.map((c) => String(c.cardId))];
  saveTodayRandomHistory(hist.key, nextIds);

  // 후보 수만큼 "미니 룰렛"을 각각 돌린다(각각 1곡에서 멈춤)
  const listEls = renderRouletteMulti(candidates.length);
  const stagger = 140;
  let maxMs = 0;
  for (let i = 0; i < listEls.length; i += 1) {
    const ms = spinRouletteList(listEls[i], pool, candidates[i], i * stagger);
    if (ms > maxMs) maxMs = ms;
  }

  setTimeout(() => {
    $('randomResult').innerHTML = `<div><b>후보 ${candidates.length}개 중에서 골라주세요</b></div><div style="opacity:.75;margin-top:4px">마음에 안 들면 “후보 다시 뽑기”</div>`;
    renderRandomCandidates(candidates);
    if (rerollBtn) rerollBtn.style.display = 'inline-flex';
  }, Math.max(600, maxMs + 50));
}

// ---- Requests --------------------------------------------------------------------
async function loadRequests(force = false) {
  if (!force && state.requests.length) return;
  const data = await apiGet('/api/requests');
  if (!data.ok) return;
  state.requests = data.items || [];
  renderRequests();
}

function renderRequests() {
  const wrap = $('requestTableBody');
  wrap.innerHTML = '';
  state.selectedRequestIds.clear();

  const statusLabel = (s) => {
    const v = String(s || '').toLowerCase();
    if (v === 'accepted') return '수락';
    if (v === 'rejected') return '거절';
    if (v === 'completed') return '완료';
    return '대기';
  };

  const showManage = state.requestManageMode;
  $('requestManageBar').style.display = showManage ? 'block' : 'none';
  const isAdmin = state.role === 'admin';

  state.requests.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'req-row';
    row.dataset.id = r._id;
    const st = statusLabel(r.status);
    const title = `${String(r.songTitle || '').trim()}-${String(r.artist || '').trim()}`.replace(/-$/, '');
    const requester = String(r.requesterName || '').trim();
    const target = String(r.targetSinger || '').trim();
    row.innerHTML = `
      <div>
        <div class="req-title">${esc(title)} <span style="opacity:.6;font-size:12px">(${esc(st)})</span></div>
        <div class="req-sub"><b>신청자:</b> ${esc(requester)}${target ? ` <span style="opacity:.7">담당보컬:</span> ${esc(target)}` : ''}</div>
      </div>
      <div class="req-actions">
        ${showManage ? `<span class="chip">선택</span>` : isAdmin ? `<button class="floating-btn compact-btn" data-action="del" type="button">삭제</button>` : ''}
      </div>
    `;

    if (showManage) {
      row.onclick = () => {
        const id = r._id;
        if (state.selectedRequestIds.has(id)) {
          state.selectedRequestIds.delete(id);
          row.classList.remove('selected');
        } else {
          state.selectedRequestIds.add(id);
          row.classList.add('selected');
        }
        $('requestManageTitle').textContent =
          state.selectedRequestIds.size ? `${state.selectedRequestIds.size}개 선택됨` : '신청곡 선택 후 상태 변경';
      };
    } else {
      const delBtn = row.querySelector('[data-action="del"]');
      if (delBtn) {
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          await apiJson(`/api/requests/${encodeURIComponent(r._id)}`, 'DELETE');
          await loadRequests(true);
        };
      }
    }

    wrap.appendChild(row);
  });
}

async function submitSongRequest() {
  const payload = {
    requesterName: $('requesterInput').value.trim() || '익명',
    songTitle: $('requestSongInput').value.trim(),
    artist: $('requestArtistInput').value.trim(),
    targetSinger: $('requestSingerInput').value.trim()
  };
  if (!payload.songTitle) return toast('곡명을 입력해 주세요.');
  const res = await apiJson('/api/requests', 'POST', payload);
  if (!res.ok) return toast('신청 실패');
  closeModal('requestModal');
  $('requestSongInput').value = '';
  $('requestArtistInput').value = '';
  $('requestSingerInput').value = '';
  await loadRequests(true);
  toast('신청 완료');
}

async function applySelectedRequestStatus(status) {
  if (!state.selectedRequestIds.size) return toast('선택된 신청곡이 없습니다.');
  for (const id of state.selectedRequestIds) {
    await apiJson(`/api/requests/${encodeURIComponent(id)}`, 'PATCH', { status });
  }
  await loadRequests(true);
}

async function deleteSelectedRequests() {
  if (!state.selectedRequestIds.size) return toast('선택된 신청곡이 없습니다.');
  for (const id of state.selectedRequestIds) {
    await apiJson(`/api/requests/${encodeURIComponent(id)}`, 'DELETE');
  }
  await loadRequests(true);
}

async function clearRequests() {
  const res = await apiJson('/api/requests/clear', 'POST', {});
  if (!res.ok) return toast('권한 없음');
  await loadRequests(true);
}

// ---- Auth / Role UI ---------------------------------------------------------------
function applyRoleUI() {
  $('roleBadge').textContent = state.role.toUpperCase();
  $('userDisplayName').textContent = state.displayName;
  $('userRoleText').textContent =
    state.role === 'viewer' ? '읽기 전용' : state.role === 'session' ? '세션 멤버' : '관리자';

  const isAdmin = state.role === 'admin';
  const isSession = state.role === 'session';
  const isPriv = isAdmin || isSession;

  $('adminToggleBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  $('profileButton').style.display = isPriv ? 'inline-flex' : 'none';
  $('requestManageToggleBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  $('availabilityEditToggleBtn').style.display = isPriv ? 'inline-flex' : 'none';
  // (legacy) 단일 가능보컬 드롭다운은 사용하지 않음(멀티 선택 모달로 대체)

  $('clearRequestsBtn').style.display = isAdmin ? 'inline-flex' : 'none';

  $('authButton').textContent = state.role === 'viewer' ? '세션 / 관리자 로그인' : '로그아웃';
  if (!isAdmin) state.requestManageMode = false;

  if (isAdmin) startChzzkStatusPolling();
}

function openCreateUserModal() {
  if (state.role !== 'admin') return toast('관리자 권한이 필요합니다.');
  $('createUserId').value = '';
  $('createUserRole').value = 'session';
  $('createUserName').value = '';
  openModal('createUserModal');
}

async function submitCreateUser() {
  if (state.role !== 'admin') return toast('관리자 권한이 필요합니다.');
  const userId = $('createUserId').value.trim();
  const role = $('createUserRole').value;
  const displayName = $('createUserName').value.trim();
  if (!userId) return toast('유저 ID를 입력하세요.');
  const res = await apiJson('/api/admin/users', 'POST', { userId, role, displayName });
  if (!res.ok) return toast(`유저 추가 실패: ${res.error || ''}`);
  closeModal('createUserModal');
  toast(`유저 생성 완료: ${userId} / PW: ${res.password || '(응답 없음)'}`);
}

async function refreshSession() {
  const me = await apiGet('/api/admin/me');
  if (me.ok) {
    state.role = me.user.role;
    state.displayName = me.user.displayName || me.user.userId;
    state.userId = me.user.userId || '';
    state.profilePhoto = me.user.profilePhoto || '';
    updateProfileImage('profilePhoto', state.profilePhoto);
  } else {
    state.role = 'viewer';
    state.displayName = '방문자';
    state.userId = '';
    state.profilePhoto = '';
    updateProfileImage('profilePhoto', '');
  }
  applyRoleUI();
  // update presence role on socket (best-effort)
  state._socket?.emit?.('main:join', {
    nickname: localStorage.getItem('mb_presence_nick') || state.displayName,
    profilePhoto: $('profilePhoto')?.src || ''
  });
}

async function refreshSocketMetaAndReconnect() {
  // 로그인/로그아웃으로 metaToken(=role/displayName)이 바뀌면 socket.data가 갱신되도록 reconnect가 필요함
  try {
    const meta = await fetch('/api/socket/meta', { credentials: 'include' }).then((r) => r.json());
    if (meta?.ok) state.metaToken = meta.token;
  } catch {}
  const socket = state._socket;
  if (!socket) return;
  const nickname = getOrCreatePresenceNickname();
  socket.auth = { ...(socket.auth || {}), nickname, metaToken: state.metaToken || '' };
  try {
    socket.disconnect();
    socket.connect();
  } catch {}
}

async function doLogin() {
  const userId = $('loginId').value.trim();
  const password = $('loginPw').value;
  if (!userId || !password) return toast('아이디/비번을 입력해 주세요.');
  const res = await apiJson('/api/admin/login', 'POST', { userId, password });
  if (!res.ok) return toast('로그인 실패');
  closeModal('loginModal');
  $('loginPw').value = '';
  await refreshSession();
  // 로그인 직후에도 곡 카드 클릭/선택이 바로 활성화되도록 UI를 재렌더링한다.
  applySongFilters();
  await refreshSocketMetaAndReconnect();
  await loadAvailabilityUsersIfNeeded();
  toast('로그인 완료');
}

async function doLogout() {
  await apiJson('/api/admin/logout', 'POST', {});
  await refreshSession();
  applySongFilters();
  await refreshSocketMetaAndReconnect();
  toast('로그아웃');
}

// ---- Admin actions ----------------------------------------------------------------
let editTargetField = null;
function openEditModal(field, title, currentValue) {
  editTargetField = field;
  $('editModalTitle').textContent = title;
  $('editModalInput').value = currentValue || '';
  openModal('editModal');
}

async function saveEditModal() {
  if (!editTargetField) return;
  const value = $('editModalInput').value;
  const res = await apiJson('/api/main', 'PATCH', { field: editTargetField, value });
  if (!res.ok) return toast('저장 실패(권한 확인)');
  closeModal('editModal');
  await loadMainPage();
  toast('저장 완료');
}

async function syncDrive(isFast) {
  const res = await apiJson('/api/admin/sync/drive', 'POST', { latestDays: isFast ? 7 : 30 });
  if (!res.ok) return toast(`동기화 실패: ${res.error || ''}`);
  toast(`동기화 완료: ${res.processed}개`);
  await loadSongs(true);
  applySongFilters();
}

function openProfileModal() {
  if (state.role === 'viewer') return openModal('loginModal');
  $('profilePhotoInput').value = state.profilePhoto || '';
  updateProfileImage('profilePreview', state.profilePhoto || '');
  $('profilePasswordBox').style.display = 'none';
  $('profileCurrentPw').value = '';
  $('profileNewPw').value = '';
  $('profileNewPw2').value = '';
  openModal('profileModal');
}

function toggleProfilePasswordBox() {
  const box = $('profilePasswordBox');
  const next = box.style.display === 'none' || !box.style.display;
  box.style.display = next ? 'flex' : 'none';
  if (next) $('profileCurrentPw').focus();
}

async function submitPasswordChangeFromProfile() {
  const currentPassword = $('profileCurrentPw').value;
  const newPassword = $('profileNewPw').value;
  const newPassword2 = $('profileNewPw2').value;
  if (!newPassword || newPassword.length < 4) return toast('새 비밀번호를 4자 이상 입력하세요.');
  if (newPassword !== newPassword2) return toast('새 비밀번호 확인이 일치하지 않습니다.');

  const res = await apiJson('/api/admin/password/change', 'POST', { currentPassword, newPassword });
  if (!res.ok) return toast('비밀번호 변경 실패(현재 비번 확인)');
  toast('비밀번호 변경 완료');
  closeModal('profileModal');
}

async function submitProfilePhoto() {
  const profilePhoto = $('profilePhotoInput').value.trim();
  const res = await apiJson('/api/admin/profile', 'PATCH', { profilePhoto });
  if (!res.ok) return toast('프로필 저장 실패');
  state.profilePhoto = res.profilePhoto || '';
  updateProfileImage('profilePhoto', state.profilePhoto);
  updateProfileImage('profilePreview', state.profilePhoto);
  toast('프로필 사진을 저장했습니다.');
  closeModal('profileModal');
}

// ---- Wiring ----------------------------------------------------------------------
function wireEvents() {
  $('mainNavBtn').onclick = () => switchPage('main');
  $('songsNavBtn').onclick = () => switchPage('songs');

  $('authButton').onclick = async () => {
    if (state.role === 'viewer') openModal('loginModal');
    else await doLogout();
  };

  $('adminToggleBtn').onclick = () => $('adminControls').classList.toggle('active');

  $('profileButton').onclick = () => openProfileModal();
  $('profileCancelBtn').onclick = () => closeModal('profileModal');
  $('profileSaveBtn').onclick = () => submitProfilePhoto().catch(() => {});
  $('toggleProfilePwBtn').onclick = () => toggleProfilePasswordBox();
  $('profilePwSaveBtn').onclick = () => submitPasswordChangeFromProfile().catch(() => {});
  $('profilePhotoInput').addEventListener('input', (e) => updateProfileImage('profilePreview', e.target.value.trim()));

  $('createUserOpenBtn').onclick = () => openCreateUserModal();
  $('createUserCancelBtn').onclick = () => closeModal('createUserModal');
  $('createUserSubmitBtn').onclick = () => submitCreateUser().catch(() => {});

  $('loginCloseBtn').onclick = () => closeModal('loginModal');
  $('loginSubmitBtn').onclick = () => doLogin().catch(() => {});

  $('requestOpenBtn').onclick = () => openModal('requestModal');
  $('requestCancelBtn').onclick = () => closeModal('requestModal');
  $('requestSubmitBtn').onclick = () => submitSongRequest().catch(() => {});

  $('requestPopoutBtn').onclick = () => {
    try {
      window.open('/requests', 'requestBoard', 'width=420,height=820');
    } catch {}
  };
  $('requestHideBtn').onclick = () => {
    $('requestPanel').style.display = 'none';
    $('requestShowBtn').style.display = 'inline-flex';
  };
  $('requestShowBtn').onclick = () => {
    $('requestPanel').style.display = 'block';
    $('requestShowBtn').style.display = 'none';
  };

  // presence panel
  $('presenceHideBtn').onclick = () => {
    $('presencePanel').style.display = 'none';
    $('presenceShowBtn').style.display = 'inline-flex';
  };
  $('presenceShowBtn').onclick = () => {
    $('presencePanel').style.display = 'block';
    $('presenceShowBtn').style.display = 'none';
    state._socket?.emit?.('presence:refresh');
  };

  $('requestManageToggleBtn').onclick = () => {
    state.requestManageMode = !state.requestManageMode;
    renderRequests();
  };
  $('requestDeleteBtn').onclick = () => deleteSelectedRequests().catch(() => {});
  $('clearRequestsBtn').onclick = () => clearRequests().catch(() => {});
  document.querySelectorAll('.request-mini-btn[data-status]').forEach((btn) => {
    btn.onclick = () => applySelectedRequestStatus(btn.dataset.status).catch(() => {});
  });

  $('editCancelBtn').onclick = () => closeModal('editModal');
  $('editSaveBtn').onclick = () => saveEditModal().catch(() => {});

  $('songTagCancelBtn').onclick = () => closeModal('songTagModal');
  $('songTagSaveBtn').onclick = () => saveSongTagModal().catch(() => {});

  // CHZZK controls (admin)
  if ($('chzzkStartBtn')) $('chzzkStartBtn').onclick = () => chzzkStart().catch(() => {});
  if ($('chzzkStopBtn')) $('chzzkStopBtn').onclick = () => chzzkStop().catch(() => {});

  $('randomPickBtn').onclick = () => {
    openModal('randomModal');
    rollRouletteCandidates();
  };
  $('randomCloseBtn').onclick = () => closeModal('randomModal');
  $('randomRerollBtn').onclick = () => rollRouletteCandidates();

  // 랜덤 설정
  $('randomSettingsOpenBtn').onclick = () => {
    const input = $('randomCandidateCountInput');
    if (input) input.value = String(getRandomCandidateCount());
    openModal('randomSettingsModal');
  };
  $('randomSettingsCloseBtn').onclick = () => closeModal('randomSettingsModal');
  $('randomHistoryResetBtn').onclick = () => {
    resetTodayRandomHistoryForUser();
    toast('오늘 랜덤 기록(이 사용자/브라우저)을 초기화했습니다.');
  };
  $('randomCandidateCountInput').addEventListener('change', (e) => {
    const v = setRandomCandidateCount(e.target.value);
    e.target.value = String(v);
    toast(`후보 개수: ${v}개`);
  });

  $('resetFiltersBtn').onclick = () => {
    $('searchInput').value = '';
    $('genreFilter').value = '';
    $('moodFilter').value = '';
    $('vocalFilter').value = '';
    state.filterAvailableVocalUserId = '';
    state.filterAvailableVocalSet = null;
    state.filterAvailableVocalUserIds = [];
    state.filterAvailableVocalSetsByUserId = new Map();
    state.page = 1;
    applySongFilters();
    renderAvailableVocalChips();
  };

  // 가능곡 편집(세션/관리자만): 버튼 클릭 즉시 "가능곡 선택모드" 진입 → 하단 취소/저장으로 종료
  $('availabilityEditToggleBtn').onclick = async () => {
    if (!(state.role === 'admin' || state.role === 'session')) return;
    const userId = state.userId || '';
    if (!userId) return toast('로그인이 필요합니다.');
    const btn = $('availabilityEditToggleBtn');
    const sp = $('availabilityEditSpinner');
    try {
      if (btn) btn.disabled = true;
      if (sp) sp.style.display = 'inline-block';
      await loadSongFiles(true);
      await loadMyAvailabilitySet();
      state.availabilityOriginalSet = new Set(Array.from(state.myAvailabilitySet || []));
      state.availabilityDraftSet = new Set(Array.from(state.myAvailabilitySet || []));
      state.availabilityEditMode = true;
      if (btn) btn.style.display = 'none';
      $('availabilityEditBar').style.display = 'flex';
      $('availabilityEditTitle').textContent = `가능곡 선택모드 · ${state.displayName || userId}`;
      updateAvailabilityEditCount();
      state.page = 1;
      applySongFilters();
    } finally {
      if (sp) sp.style.display = 'none';
      if (btn) btn.disabled = false;
    }
  };

  $('availabilityEditCancelBtn').onclick = () => {
    state.availabilityEditMode = false;
    state.availabilityDraftSet = null;
    state.myAvailabilitySet = state.availabilityOriginalSet ? new Set(Array.from(state.availabilityOriginalSet)) : state.myAvailabilitySet;
    state.availabilityOriginalSet = null;
    $('availabilityEditBar').style.display = 'none';
    $('availabilityEditToggleBtn').style.display = state.role === 'admin' || state.role === 'session' ? 'inline-flex' : 'none';
    updateAvailabilityEditCount();
    applySongFilters();
    toast('취소됨');
  };

  $('availabilityEditSaveBtn').onclick = async () => {
    const userId = state.userId || '';
    if (!userId) return;
    const before = state.availabilityOriginalSet || new Set();
    const after = state.availabilityDraftSet || new Set();
    const all = new Set([...before, ...after]);
    const items = [];
    all.forEach((fid) => {
      const b = before.has(fid);
      const a = after.has(fid);
      if (a !== b) items.push({ googleFileId: fid, available: a });
    });
    if (items.length) {
      const res = await apiJson('/api/availability/bulk', 'POST', { userId, items });
      if (!res.ok) return toast('저장 실패');
    }
    state.myAvailabilitySet = new Set(Array.from(after));
    state.availabilityEditMode = false;
    state.availabilityOriginalSet = null;
    state.availabilityDraftSet = null;
    $('availabilityEditBar').style.display = 'none';
    $('availabilityEditToggleBtn').style.display = state.role === 'admin' || state.role === 'session' ? 'inline-flex' : 'none';
    updateAvailabilityEditCount();
    applySongFilters();
    toast('저장 완료');
  };

  const debouncedFilter = (() => {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.page = 1;
        applySongFilters();
      }, 150);
    };
  })();
  ['searchInput', 'genreFilter', 'moodFilter', 'vocalFilter'].forEach((id) => $(id).addEventListener('input', debouncedFilter));
  // 태그 토글 제거됨

  $('pageSizeSelect').onchange = () => {
    state.pageSize = Number($('pageSizeSelect').value || 100);
    state.page = 1;
    applySongFilters();
  };
  // 초기 기본값(HTML 기본 selected + state.pageSize) 반영
  try {
    $('pageSizeSelect').value = String(state.pageSize || 500);
  } catch {}
  $('prevPageBtn').onclick = () => {
    state.page = Math.max(1, state.page - 1);
    applySongFilters();
  };
  $('nextPageBtn').onclick = () => {
    const total = state.availabilityEditMode ? state.songFilesFiltered.length : state.songCardsFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(totalPages, state.page + 1);
    applySongFilters();
  };

  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.onclick = () => {
      const field = btn.dataset.sortField;
      if (state.sortField === field) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        state.sortField = field;
        state.sortDir = field === 'createdAt' ? 'desc' : 'asc';
      }
      document.querySelectorAll('.sort-btn').forEach((b) => b.classList.toggle('active', b.dataset.sortField === state.sortField));
      state.page = 1;
      applySongFilters();
    };
  });
  // default active
  document.querySelector('.sort-btn[data-sort-field="createdAt"]')?.classList.add('active');

  $('editBannerBtn').onclick = () => openEditModal('bannerImage', '배너 이미지 URL', state.main?.bannerImage);
  $('editNoticeBtn').onclick = () => openEditModal('notice', '공지사항 내용', state.main?.notice);
  $('editTitleBtn').onclick = () => openEditModal('titleImage', '타이틀 이미지 URL', state.main?.titleImage);
  $('syncAllBtn').onclick = () => syncDrive(false).catch(() => {});
  $('syncFastBtn').onclick = () => syncDrive(true).catch(() => {});

  // session controls on main page
  $('sessionCreateBtn').onclick = () => {
    if (state.role === 'viewer') return toast('로그인된 멤버만 세션을 만들 수 있습니다.');
    const socket = state._socket;
    if (!socket) return;
    socket.emit('session:create', {}, (ack) => {
      if (!ack?.ok) return toast('세션 생성 실패');
      // 세션 생성/참여는 바로 viewer로 이동
      window.location.href = `/viewer?room=${encodeURIComponent(String(ack.roomCode || '').trim().toUpperCase())}`;
    });
  };
  $('sessionJoinBtn').onclick = () => {
    if (state.role === 'viewer') return toast('로그인된 멤버만 세션에 참여할 수 있습니다.');
    const code = (prompt('Room Code를 입력하세요:', state.sessionRoomCode || '') || '').trim().toUpperCase();
    if (!code) return;
    window.location.href = `/viewer?room=${encodeURIComponent(code)}`;
  };
  $('sessionLeaveBtn').onclick = () => leaveLiveSession();
  $('sessionMembersBtn').onclick = () => {
    $('sessionPanel').style.display = 'block';
    state._socket?.emit?.('session:participants:refresh', { roomCode: state.sessionRoomCode });
  };
  $('sessionPanelHideBtn').onclick = () => {
    $('sessionPanel').style.display = 'none';
  };
  $('sessionCopyBtn').onclick = async () => {
    if (!state.sessionRoomCode) return;
    const url = `${window.location.origin}/?room=${encodeURIComponent(state.sessionRoomCode)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('세션 링크 복사됨');
    } catch {
      prompt('복사해서 공유하세요:', url);
    }
  };

  // 가능보컬 필터(AND 멀티 선택)
  $('availableVocalOpenBtn').onclick = () => openAvailableVocalModal();
  $('availableVocalCloseBtn').onclick = () => closeAvailableVocalModal();
  $('availableVocalModal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'availableVocalModal') closeAvailableVocalModal();
  });
  $('availableVocalSearch')?.addEventListener('input', (e) => {
    renderAvailableVocalModalList(e.target.value || '');
  });

  // action modals
  $('keySelectCancelBtn').onclick = () => closeModal('keySelectModal');
  $('songActionCancelBtn').onclick = () => closeModal('songActionModal');
  $('copyDriveLinkBtn').onclick = () => copyDriveLink().catch(() => {});
  $('openViewerBtn').onclick = () => openInViewer().catch(() => toast('열기 실패'));
}

function attachSockets() {
  const nickname = getOrCreatePresenceNickname();
  const metaToken = state.metaToken || '';
  const socket = io({ auth: { nickname, metaToken } });
  socket.on('requests:updated', (p) => {
    if (Array.isArray(p?.items)) {
      state.requests = p.items;
      renderRequests();
    }
  });

  const joinRooms = () => {
    const nn = getOrCreatePresenceNickname();
    socket.emit('main:join', { nickname: nn, profilePhoto: $('profilePhoto')?.src || '' });
    if (state.sessionRoomCode) {
      socket.emit('session:join', {
        roomCode: state.sessionRoomCode,
        nickname: nn || state.displayName,
        profilePhoto: $('profilePhoto')?.src || ''
      });
    }
  };
  socket.on('connect', () => joinRooms());
  // Join main presence room (server trusts metaToken, not payload role)
  joinRooms();
  state._socket = socket;

  socket.on('presence:list', (p) => {
    renderPresence(p?.items || []);
  });

  // session state events (page turner)
  socket.on('session:pageTurner:state', (p) => {
    if (!state.sessionRoomCode) return;
    state.isPageTurner = p?.pageTurnerSocketId === socket.id;
    $('turnerBadge').style.display = state.isPageTurner ? 'inline-flex' : 'none';
  });

  socket.on('session:participants', (p) => {
    if (!state.sessionRoomCode) return;
    if (p?.roomCode && String(p.roomCode).toUpperCase() !== String(state.sessionRoomCode).toUpperCase()) return;
    renderSessionMembers(p?.members || []);
  });

  socket.on('session:state', (p) => {
    if (!state.sessionRoomCode) return;
    if (p?.roomCode && String(p.roomCode).toUpperCase() !== String(state.sessionRoomCode).toUpperCase()) return;
    state.sessionCurrentFileId = p?.currentFileId || '';
    state.sessionCurrentPageNo = Number(p?.currentPageNo || 1);
    renderSessionStatus();
  });

  // keep status updated even without session:state (backward)
  socket.on('session:follow:file', (p) => {
    if (!state.sessionRoomCode) return;
    if (!p?.fileId) return;
    state.sessionCurrentFileId = p.fileId;
    state.sessionCurrentPageNo = 1;
    renderSessionStatus();
  });
  socket.on('viewer:page_change', (p) => {
    if (!state.sessionRoomCode) return;
    if (!p?.fileId || !p?.pageNo) return;
    state.sessionCurrentFileId = p.fileId;
    state.sessionCurrentPageNo = Number(p.pageNo);
    renderSessionStatus();
  });

  // If turner was transferred to this socket while on main page, keep room stable by re-broadcasting current state.
  socket.on('session:pageTurner:sync_request', (p) => {
    if (!state.sessionRoomCode) return;
    // We don't track local page on main page; just keep room at current (server) state.
    if (p?.fileId && p?.pageNo) {
      socket.emit('viewer:page_change', {
        roomCode: state.sessionRoomCode,
        fileId: p.fileId,
        pageNo: p.pageNo,
        reason: 'turner_sync_main'
      });
    }
  });
}

function renderSessionStatus() {
  if (!state.sessionRoomCode) return;
  const badge = $('sessionBadge');
  if (!badge) return;
  const fileId = state.sessionCurrentFileId;
  const pageNo = state.sessionCurrentPageNo;
  let label = `세션: ${state.sessionRoomCode}`;
  if (fileId) {
    const song = state.songFilesAll.find((s) => s.googleFileId === fileId);
    const title = song?.displayTitle || song?.title || '';
    label += ` · ${title ? title : fileId.slice(0, 8) + '...'} · p.${pageNo}`;
  }
  badge.textContent = label;
}

function getOrCreatePresenceNickname() {
  const key = 'mb_presence_nick';
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const v = prompt('닉네임을 입력해 주세요(접속자 표시용):', '익명') || '익명';
  localStorage.setItem(key, v);
  return v;
}

function renderPresence(items) {
  const wrap = $('presenceList');
  if (!wrap) return;
  wrap.innerHTML = '';

  const list = Array.isArray(items) ? items : [];
  const viewers = list.filter((p) => String(p?.role || '') === 'viewer');
  const members = list.filter((p) => String(p?.role || '') !== 'viewer');

  // 방문자는 개별 리스트업 하지 않고 카운트만 노출
  if (viewers.length) {
    const el = document.createElement('div');
    el.className = 'presence-item';
    el.style.padding = '8px 10px';
    el.style.opacity = '0.75';
    el.innerHTML = `<div class="presence-sub" style="font-size:12px; font-weight:900;">방문자: ${viewers.length}명</div>`;
    wrap.appendChild(el);
  }

  const avatarCircle = (name, photo) => {
    const n = String(name || '').trim();
    const initial = n ? n.slice(0, 1) : '?';
    const finalPhoto = normalizeProfilePhotoUrl(photo || '', 80);
    if (finalPhoto) return `<span class="presence-avatar"><img src="${esc(finalPhoto)}" alt="" /></span>`;
    return `<span class="presence-avatar">${esc(initial)}</span>`;
  };

  members.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'presence-item';
    el.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center;">
        ${avatarCircle(p.displayName || p.nickname || '익명', p.profilePhoto)}
        <div>
          <div>${esc(p.displayName || p.nickname || '익명')}</div>
        </div>
      </div>
    `;
    wrap.appendChild(el);
  });
}

function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get('room') || '';
}

function setRoomToUrl(roomCode) {
  const url = new URL(window.location.href);
  if (roomCode) url.searchParams.set('room', roomCode);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url.toString());
}

function joinLiveSession(roomCode) {
  const code = String(roomCode || '').trim().toUpperCase();
  if (!code) return;
  state.sessionRoomCode = code;
  $('sessionBadge').style.display = 'inline-flex';
  $('sessionBadge').textContent = `세션: ${code}`;
  $('sessionLeaveBtn').style.display = 'inline-flex';
  $('sessionMembersBtn').style.display = 'inline-flex';
  setRoomToUrl(code);
  state._socket?.emit?.(
    'session:join',
    {
      roomCode: code,
      nickname: localStorage.getItem('mb_presence_nick') || state.displayName,
      role: state.role,
      displayName: state.displayName,
      profilePhoto: $('profilePhoto')?.src || ''
    },
    (ack) => {
    if (!ack?.ok) {
      toast('세션 참여 실패');
      return;
    }
    state.isPageTurner = Boolean(ack.isPageTurner);
    $('turnerBadge').style.display = state.isPageTurner ? 'inline-flex' : 'none';
    }
  );
}

function leaveLiveSession() {
  const code = state.sessionRoomCode;
  if (!code) return;
  state._socket?.emit?.('session:leave', { roomCode: code });
  state.sessionRoomCode = '';
  state.isPageTurner = false;
  $('sessionBadge').style.display = 'none';
  $('turnerBadge').style.display = 'none';
  $('sessionLeaveBtn').style.display = 'none';
  $('sessionMembersBtn').style.display = 'none';
  $('sessionPanel').style.display = 'none';
  setRoomToUrl('');
  toast('세션 나감');
}

function renderSessionMembers(members) {
  const wrap = $('sessionMembersList');
  if (!wrap) return;
  wrap.innerHTML = '';
  members.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'presence-item';
    const name = m.displayName || m.nickname || '익명';
    const initial = String(name || '').trim().slice(0, 1) || '?';
    const photo = normalizeProfilePhotoUrl(m.profilePhoto || '', 80);
    el.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center;">
        ${photo ? `<span class="presence-avatar"><img src="${esc(photo)}" alt="" /></span>` : `<span class="presence-avatar">${esc(initial)}</span>`}
        <div>
          <div>${esc(name)} ${m.isPageTurner ? '<span class="chip">터너</span>' : ''}</div>
        </div>
      </div>
      <div>
        ${state.isPageTurner && !m.isPageTurner ? `<button class="floating-btn compact-btn" data-transfer="1">양도</button>` : ''}
      </div>
    `;
    const btn = el.querySelector('[data-transfer="1"]');
    if (btn) {
      btn.onclick = () => {
        state._socket?.emit?.('session:pageTurner:transfer', { roomCode: state.sessionRoomCode, targetSocketId: m.socketId }, (ack) => {
          if (!ack?.ok) toast('양도 실패');
        });
      };
    }
    wrap.appendChild(el);
  });
}

async function loadAvailableVocalUsers() {
  const r = await apiGet('/api/availability/users');
  if (!r.ok) return;
  // legacy select (숨김) - 값 유지용
  const sel = $('availableVocalFilter');
  if (sel) sel.innerHTML = `<option value="">가능보컬 전체</option>`;
  state.availableVocalUsers = Array.isArray(r.items) ? r.items.map((x) => ({ userId: x.userId, displayName: x.displayName })) : [];
  (state.availableVocalUsers || []).forEach((u) => {
    const uid = String(u.userId || '').trim();
    if (!uid) return;
    if (sel) {
      const opt = document.createElement('option');
      opt.value = uid;
      opt.textContent = u.displayName || uid;
      sel.appendChild(opt);
    }
  });
  renderAvailableVocalChips();
}

async function bootstrap() {
  showLoading(true);
  try {
    wireEvents();
    // socket meta for role hardening
    try {
      const meta = await fetch('/api/socket/meta', { credentials: 'include' }).then((r) => r.json());
      if (meta?.ok) state.metaToken = meta.token;
    } catch {}
    attachSockets();
    await refreshSession();
    await loadMainPage();
    await loadSongs(true);
    await loadSongFiles(true);
    await loadAvailableVocalUsers();
    applySongFilters();
    await loadRequests(true);

    // Auto-join live session if ?room exists (main-page convenience)
    const roomFromUrl = getRoomFromUrl().trim().toUpperCase();
    if (roomFromUrl) joinLiveSession(roomFromUrl);
  } finally {
    showLoading(false);
    document.body.classList.remove('preload');
  }
}

bootstrap().catch((e) => {
  console.error(e);
  toast('초기화 실패');
  showLoading(false);
});
