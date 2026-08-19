/* global io */

// ---- State -----------------------------------------------------------------------
// TODO: Render 백엔드 배포 후 발급받은 새 주소를 여기에 입력할 예정
// (또는 public/config.js에서 window.API_URL을 설정)
const API_URL = String(window.API_URL || window.MB_API || window.location.origin || '').replace(/\/$/, '');
const apiUrl = (path) => {
  const p = String(path || '');
  if (!p) return API_URL;
  if (/^https?:\/\//i.test(p)) return p;
  return `${API_URL}${p.startsWith('/') ? '' : '/'}${p}`;
};

// 프론트(정적 페이지) 내 이동용: GitHub Pages 경로(/Musicbook/public/...)를 유지해야 한다.
// 송북(/public/musicbook/)에서 보면 ../viewer/ 가 뷰어 엔트리다.
const VIEWER_BASE_URL = new URL('../viewer/', window.location.href).toString();
const viewerUrl = ({ fileId = '', roomCode = '', bookUserId = '' } = {}) => {
  const u = new URL(VIEWER_BASE_URL);
  if (fileId) u.searchParams.set('fileId', String(fileId));
  if (roomCode) u.searchParams.set('room', String(roomCode).trim().toUpperCase());
  if (bookUserId) u.searchParams.set('bookUserId', String(bookUserId).trim());
  return u.toString();
};

const state = {
  role: 'viewer', // viewer | session | admin
  displayName: '방문자',
  userId: '',
  isPrivate: false,
  hasPublicBook: false,
  privateArchivePath: '',
  // 개인 아카이브 모드(/public/musicbook/:userId, /musicbook/:userId 등)
  isArchiveMode: false,
  archiveTargetUserId: '',
  archiveViewOnly: false, // 관리자/타유저 접근 시 read-only
  archiveAuthorized: false,
  // archive public profile (stealth songbook header/loading)
  archiveDisplayName: '',
  archiveProfilePhoto: '',
  archiveTitleImage: '',
  archiveTheme: 'pink',
  archiveStatusTitle: '',
  archiveStatusDesc: '',
  songsViewMode: 'card',
  // set list (archive)
  setlistItems: [],
  setlistLoaded: false,
  setlistEditMode: false,
  setlistOriginalItems: null,
  setlistSelectedCardIds: new Set(),
  setlistPanelSize: { w: 420, h: 520 },
  // reviews (archive)
  reviewEnabled: false,
  reviewThreads: [],
  reviewThreadMap: new Map(), // cardId -> { ...thread }
  _reviewComposer: null, // { cardId, title, artist, tagText }
  // private requests (archive)
  privateRequests: [],
  privateRequestsLoaded: false,
  _requestDraft: null, // { googleFileId, driveUrl, title, artist, key }
  archiveGuestbookLoaded: false,
  guestbookItems: [],
  profilePhoto: '',
  main: null,
  songCardsAll: [],
  songCardsFiltered: [],
  songCardsTotal: 0, // 서버 기준 전체 카드 수(5000 제한과 무관)
  songFilesTotal: 0, // 서버 기준 전체 파일 수(5000 제한과 무관)
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
  myAvailabilityProficiencyMap: null, // Map<googleFileId, 0|1|2|3>
  availabilityEditMode: false,
  availabilityOriginalSet: null, // Set<googleFileId>
  availabilityDraftSet: null, // Set<googleFileId>
  availabilityHideExisting: false,
  proficiencyEditMode: false,
  proficiencyOriginalMap: null, // Map<googleFileId, proficiency>
  proficiencyDraftMap: null, // Map<googleFileId, proficiency>
  _forceAllSongsForEdit: false,

  // 가능곡 편집모드(관리자) - 곡 메타데이터(title/displayTitle/artist/key/genre/mood/vocal) 인라인 편집
  // songId(Mongo _id) -> 변경된 필드만 담은 draft. 원본과 동일해지면 항목을 지운다(= 변경사항 없음).
  catalogEditDraftMap: new Map(),

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
  // custom theme (3 colors)
  archiveThemeCustomA: '#f2f3ff',
  archiveThemeCustomB: '#ffffff',
  archiveThemeCustomC: '#6b5bff',
  _themePickerPrev: null,
  _rouletteCandidates: [],
  _lastSearchRaw: '',
  _lastSearchIsCho: false,
  _guestbookDrag: null,
  _listAnimTimer: null,
  _pageAnimTimer: null
};

function getProficiencyLabel(level) {
  const v = Math.max(0, Math.min(3, Number(level || 0) || 0));
  if (v === 1) return '더듬';
  if (v === 2) return '보통';
  if (v === 3) return '잘함';
  return '미설정';
}

function getThemeCacheKey(userId) {
  const uid = String(userId || '').trim();
  return uid ? `mb_theme_cache_${uid}` : '';
}

function readThemeCache(userId) {
  try {
    const key = getThemeCacheKey(userId);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const theme = String(v.theme || '').trim();
    return {
      theme,
      customA: String(v.customA || '').trim(),
      customB: String(v.customB || '').trim(),
      customC: String(v.customC || '').trim()
    };
  } catch {
    return null;
  }
}

function writeThemeCache(userId, theme, customA, customB, customC) {
  try {
    const key = getThemeCacheKey(userId);
    if (!key) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        theme: String(theme || 'pink').trim() || 'pink',
        customA: String(customA || '#f2f3ff'),
        customB: String(customB || '#ffffff'),
        customC: String(customC || '#6b5bff'),
        savedAt: Date.now()
      })
    );
  } catch {}
}

function clamp01(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function hexToRgb(hex) {
  const s = String(hex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  const r = parseInt(s.slice(1, 3), 16);
  const g = parseInt(s.slice(3, 5), 16);
  const b = parseInt(s.slice(5, 7), 16);
  return { r, g, b };
}

function rgbToHex(rgb) {
  const to = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16).padStart(2, '0');
  return `#${to(rgb.r)}${to(rgb.g)}${to(rgb.b)}`;
}

function mixHex(a, b, t) {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  if (!ar || !br) return String(a || '#000000');
  const k = clamp01(t);
  return rgbToHex({
    r: ar.r * (1 - k) + br.r * k,
    g: ar.g * (1 - k) + br.g * k,
    b: ar.b * (1 - k) + br.b * k
  });
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function pickBestTextColor(bg) {
  const black = '#101010';
  const white = '#f4f7fb';
  return contrastRatio(bg, black) >= contrastRatio(bg, white) ? black : white;
}

function adjustTowardToContrast(src, toward, against, minRatio, maxT = 0.5) {
  let best = String(src || '').trim();
  if (!best) best = '#000000';
  const current = contrastRatio(best, against);
  if (current >= minRatio) return best;
  // strong: step quickly
  for (let t = 0.08; t <= maxT + 1e-9; t += 0.06) {
    const cand = mixHex(best, toward, t);
    if (contrastRatio(cand, against) >= minRatio) return cand;
  }
  return mixHex(best, toward, maxT);
}

function rgba(hex, a) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0,0,0,${clamp01(a)})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clamp01(a)})`;
}

function computeCustomThemeStrong(rawA, rawB, rawC) {
  const A0 = /^#[0-9a-fA-F]{6}$/.test(String(rawA || '').trim()) ? String(rawA).toLowerCase() : '#f2f3ff';
  const B0 = /^#[0-9a-fA-F]{6}$/.test(String(rawB || '').trim()) ? String(rawB).toLowerCase() : '#ffffff';
  const C0 = /^#[0-9a-fA-F]{6}$/.test(String(rawC || '').trim()) ? String(rawC).toLowerCase() : '#6b5bff';

  const aLum = luminance(A0);
  const isDark = aLum < 0.38;

  // 1) Ensure card stands out from background (stronger)
  const targetForB = aLum > 0.78 ? '#000000' : '#ffffff';
  const B1 = adjustTowardToContrast(B0, targetForB, A0, 1.45, 0.32);

  // 2) Ensure accent is visible on card (borders/buttons)
  const bLum = luminance(B1);
  const targetForC = bLum > 0.55 ? '#000000' : '#ffffff';
  const C1 = adjustTowardToContrast(C0, targetForC, B1, 3.2, 0.58);

  // 3) Text colors
  const text = pickBestTextColor(B1);
  const btnText = pickBestTextColor(C1);

  // 4) Derived surfaces
  const top = mixHex(A0, isDark ? '#000000' : '#ffffff', isDark ? 0.12 : 0.16);
  const mid = mixHex(B1, isDark ? '#000000' : '#ffffff', isDark ? 0.08 : 0.10);
  const bottom = mixHex(A0, isDark ? '#000000' : '#ffffff', isDark ? 0.18 : 0.06);

  return {
    A: A0,
    B: B1,
    C: C1,
    isDark,
    pageBg: `linear-gradient(180deg, ${top} 0%, ${mid} 45%, ${bottom} 100%)`,
    text,
    btnText,
    glass: isDark ? rgba(mixHex(A0, '#000000', 0.25), 0.76) : 'rgba(255,255,255,0.70)',
    surfaceSoft: isDark ? rgba(mixHex(B1, A0, 0.35), 0.72) : rgba(mixHex(B1, A0, 0.35), 0.78),
    surfaceStrong: isDark ? rgba(mixHex(B1, A0, 0.18), 0.82) : rgba('#ffffff', 0.86),
    inputBg: isDark ? rgba(mixHex(B1, A0, 0.2), 0.90) : rgba('#ffffff', 0.88),
    selectBg: isDark ? rgba(mixHex(B1, A0, 0.2), 0.94) : rgba('#ffffff', 0.92),
    softSurface: isDark ? rgba(mixHex(B1, A0, 0.2), 0.90) : rgba('#ffffff', 0.92),
    cardBg: isDark ? rgba(mixHex(B1, A0, 0.16), 0.94) : rgba('#ffffff', 0.88),
    cardBorder: mixHex(C1, isDark ? '#000000' : '#ffffff', isDark ? 0.25 : 0.50),
    cardHoverBorder: C1,
    modalSurface: isDark ? rgba(mixHex(B1, A0, 0.2), 0.97) : rgba('#ffffff', 0.96),
    mutedSurface: isDark ? 'rgba(255,255,255,0.06)' : rgba(text, 0.04),
    overlayBg: isDark ? 'rgba(0,0,0,0.58)' : 'rgba(0,0,0,0.24)',
    shadow: isDark ? '0 14px 40px rgba(0,0,0,0.36)' : '0 12px 34px rgba(0,0,0,0.12)'
  };
}

function applyArchiveTheme() {
  try {
    const theme = String(state.archiveTheme || 'pink').trim() || 'pink';
    document.body.dataset.privateTheme = theme;
    if (theme === 'custom') {
      const t = computeCustomThemeStrong(state.archiveThemeCustomA, state.archiveThemeCustomB, state.archiveThemeCustomC);
      // raw colors (for tooling / preview)
      document.body.style.setProperty('--custom-a', String(state.archiveThemeCustomA || '#f2f3ff'));
      document.body.style.setProperty('--custom-b', String(state.archiveThemeCustomB || '#ffffff'));
      document.body.style.setProperty('--custom-c', String(state.archiveThemeCustomC || '#6b5bff'));
      // corrected colors (for rendering)
      document.body.style.setProperty('--page-bg', t.pageBg);
      document.body.style.setProperty('--black', t.text);
      document.body.style.setProperty('--btn-fill-text', t.btnText);
      document.body.style.setProperty('--glass', t.glass);
      document.body.style.setProperty('--surface-soft', t.surfaceSoft);
      document.body.style.setProperty('--surface-strong', t.surfaceStrong);
      document.body.style.setProperty('--shadow', t.shadow);
      document.body.style.setProperty('--input-bg', t.inputBg);
      document.body.style.setProperty('--select-bg', t.selectBg);
      document.body.style.setProperty('--soft-surface', t.softSurface);
      document.body.style.setProperty('--card-bg', t.cardBg);
      document.body.style.setProperty('--card-border', t.cardBorder);
      document.body.style.setProperty('--card-hover-border', t.cardHoverBorder);
      document.body.style.setProperty('--modal-surface', t.modalSurface);
      document.body.style.setProperty('--muted-surface', t.mutedSurface);
      document.body.style.setProperty('--overlay-bg', t.overlayBg);
      document.body.style.setProperty('--btn-fill', t.cardHoverBorder);
      document.body.style.setProperty('--btn-fill-hover', t.cardBorder);
    } else {
      document.body.style.removeProperty('--custom-a');
      document.body.style.removeProperty('--custom-b');
      document.body.style.removeProperty('--custom-c');
      document.body.style.removeProperty('--page-bg');
      document.body.style.removeProperty('--black');
      document.body.style.removeProperty('--btn-fill-text');
      document.body.style.removeProperty('--glass');
      document.body.style.removeProperty('--surface-soft');
      document.body.style.removeProperty('--surface-strong');
      document.body.style.removeProperty('--shadow');
      document.body.style.removeProperty('--input-bg');
      document.body.style.removeProperty('--select-bg');
      document.body.style.removeProperty('--soft-surface');
      document.body.style.removeProperty('--card-bg');
      document.body.style.removeProperty('--card-border');
      document.body.style.removeProperty('--card-hover-border');
      document.body.style.removeProperty('--modal-surface');
      document.body.style.removeProperty('--muted-surface');
      document.body.style.removeProperty('--overlay-bg');
      document.body.style.removeProperty('--btn-fill');
      document.body.style.removeProperty('--btn-fill-hover');
    }
  } catch {}
}

function applySongsViewMode() {
  try {
    const mode = String(state.songsViewMode || 'card').trim() || 'card';
    const wrap = $('songCardList');
    // edit 모드에서는 항상 카드형(행 편집 UX 유지)
    const listMode = mode === 'list' && !state.availabilityEditMode && !state.proficiencyEditMode;
    if (wrap) wrap.classList.toggle('view-list', listMode);
  } catch {}
}

function updateViewModeControls() {
  const c = $('viewCardBtn');
  const l = $('viewListBtn');
  if (c) c.classList.toggle('active', state.songsViewMode === 'card');
  if (l) l.classList.toggle('active', state.songsViewMode === 'list');
}

function isArchiveOwner() {
  return (
    state.isArchiveMode &&
    String(state.userId || '') &&
    String(state.archiveTargetUserId || '') &&
    String(state.userId || '') === String(state.archiveTargetUserId || '') &&
    Boolean(state.hasPublicBook) &&
    state.archiveAuthorized &&
    !state.archiveViewOnly
  );
}

function getSetlistTagTextForCard(card) {
  const keyLabel = String(card?.keyLabel || '-').trim() || '-';
  const prof = Math.max(0, Math.min(3, Number(card?.proficiencyLevel || 0) || 0));
  const showProf = state.isArchiveMode && prof > 0;
  return `${keyLabel}${showProf ? ` · ${getProficiencyLabel(prof)}` : ''}`.trim();
}

function buildReviewThreadMap(threads) {
  const map = new Map();
  (Array.isArray(threads) ? threads : []).forEach((t) => {
    const id = String(t?.cardId || '').trim();
    if (!id) return;
    map.set(id, t);
  });
  return map;
}

async function loadReviews() {
  if (!state.isArchiveMode || !state.archiveTargetUserId) return;
  const r = await apiGet(`/api/reviews/${encodeURIComponent(state.archiveTargetUserId)}`);
  if (!r.ok) {
    state.reviewEnabled = false;
    state.reviewThreads = [];
    state.reviewThreadMap = new Map();
    return;
  }
  state.reviewEnabled = Boolean(r.enabled);
  state.reviewThreads = Array.isArray(r.threads) ? r.threads : [];
  state.reviewThreadMap = buildReviewThreadMap(state.reviewThreads);
}

async function loadPrivateRequests(force = false) {
  if (!state.isArchiveMode || !state.archiveTargetUserId) return;
  if (!force && state.privateRequestsLoaded) return;
  const r = await apiGet(`/api/private-requests/${encodeURIComponent(state.archiveTargetUserId)}`);
  state.privateRequests = r.ok && Array.isArray(r.items) ? r.items : [];
  state.privateRequestsLoaded = true;
}

function mergePrivateRequestsIntoCards() {
  if (!state.isArchiveMode) return;
  const base = Array.isArray(state.songCardsAll) ? state.songCardsAll.filter((c) => !c._privateRequest) : [];
  const availIds = new Set(base.map((c) => String(c.cardId || '')));
  const merged = base.slice();
  (state.privateRequests || []).forEach((r) => {
    const title = String(r.title || '').trim();
    const artist = String(r.artist || '').trim();
    const cardId = `__req__${String(r.googleFileId || '').trim()}`;
    // 이미 가능곡으로 있으면(승격됐을 확률) 요청카드는 숨김
    if (availIds.has(`${title.toLowerCase()}||${artist.toLowerCase()}`)) return;
    merged.unshift({
      _privateRequest: true,
      _requestStatus: String(r.status || 'pending'),
      _requestMemo: String(r.memo || ''),
      _requestCreatedAtMs: new Date(r.createdAt || 0).getTime() || 0,
      title,
      artist,
      cardId,
      keyLabel: String(r.key || '-'),
      variants: [{ key: String(r.key || ''), googleFileId: String(r.googleFileId || ''), driveUrl: String(r.driveUrl || '') }],
      isLatest: false,
      genre: '',
      mood: '',
      vocal: '',
      searchText: `${title} ${artist}`.toLowerCase()
    });
  });
  state.songCardsAll = merged;
}

function openReviewComposer({ cardId, title, artist, tagText }) {
  const box = $('reviewComposer');
  const input = $('reviewComposerInput');
  if (!box || !input) return;
  state._reviewComposer = { cardId, title, artist, tagText };
  input.value = '';
  box.style.display = 'block';
  input.focus();
}

function closeReviewComposer() {
  const box = $('reviewComposer');
  if (box) box.style.display = 'none';
  state._reviewComposer = null;
}

function openPrivateRequestPanel() {
  if (!state.isArchiveMode || !state.archiveTargetUserId) return;
  const panel = $('privateRequestPanel');
  const res = $('privateRequestSearchResult');
  const sel = $('privateRequestSelected');
  const memo = $('privateRequestMemo');
  if (!panel || !res || !sel || !memo) return;
  state._requestDraft = null;
  $('privateRequestSearchInput').value = '';
  memo.value = '';
  sel.style.display = 'none';
  res.innerHTML = `<div class="muted" style="padding:10px 2px; font-weight:900; opacity:0.7;">검색어를 입력해 주세요.</div>`;
  panel.style.display = 'flex';
}

function closePrivateRequestPanel() {
  const panel = $('privateRequestPanel');
  if (panel) panel.style.display = 'none';
  state._requestDraft = null;
}

async function searchPrivateRequestSongs() {
  if (!state.isArchiveMode) return;
  const q = String($('privateRequestSearchInput')?.value || '').trim();
  const out = $('privateRequestSearchResult');
  if (!out) return;
  if (!q) {
    out.innerHTML = `<div class="muted" style="padding:10px 2px; font-weight:900; opacity:0.7;">검색어를 입력해 주세요.</div>`;
    return;
  }
  out.innerHTML = `<div class="muted" style="padding:10px 2px; font-weight:900; opacity:0.7;">검색 중...</div>`;
  const r = await apiGet(`/api/songs?q=${encodeURIComponent(q)}&limit=500`);
  const items = r.ok && Array.isArray(r.items) ? r.items : [];
  if (!items.length) {
    out.innerHTML = `<div class="muted" style="padding:10px 2px; font-weight:900; opacity:0.75;">서버가 보유한 악보가 없습니다. 방명록으로 신청해보세요!</div>`;
    return;
  }
  out.innerHTML = '';
  items.slice(0, 300).forEach((s) => {
    const row = document.createElement('div');
    row.className = 'request-search-item';
    const title = String(s.displayTitle || s.title || '').trim();
    const artist = String(s.artist || '').trim();
    const key = String(s.key || '').trim();
    row.innerHTML = `
      <div class="request-search-note" aria-hidden="true">♪</div>
      <div class="request-search-main">
        <div class="request-search-title">${esc(title)}</div>
        ${artist ? `<div class="request-search-artist">${esc(artist)}</div>` : ''}
        ${key ? `<div class="request-search-tags"><span class="chip">${esc(key)}</span></div>` : ''}
      </div>
    `;
    row.onclick = () => {
      state._requestDraft = {
        googleFileId: String(s.googleFileId || '').trim(),
        driveUrl: String(s.driveUrl || '').trim(),
        title,
        artist,
        key
      };
      const sel = $('privateRequestSelected');
      if (sel) {
        sel.textContent = `신청할 노래: ${title}${artist ? ` - ${artist}` : ''}${key ? ` (${key})` : ''}`;
        sel.style.display = 'block';
      }
      // 선택 시 가볍게 강조
      row.classList.remove('selected');
      void row.offsetWidth;
      row.classList.add('selected');
    };
    out.appendChild(row);
  });
}

async function submitPrivateRequest() {
  if (!state.isArchiveMode || !state.archiveTargetUserId) return;
  if (!state._requestDraft?.googleFileId) return toast('신청할 노래를 선택해 주세요.');
  const memo = String($('privateRequestMemo')?.value || '').trim();
  const payload = { ...state._requestDraft, memo };
  const r = await apiJson(`/api/private-requests/${encodeURIComponent(state.archiveTargetUserId)}`, 'POST', payload);
  if (!r.ok) return toast('신청 실패');
  toast('신청 완료');
  closePrivateRequestPanel();
  await loadSongs(true);
  applySongFilters();
}

function openPrivateRequestManage(card) {
  const modal = $('privateRequestManageModal');
  if (!modal) return;
  const title = $('privateRequestManageTitle');
  const desc = $('privateRequestManageDesc');
  const primary = $('privateRequestManagePrimaryBtn');
  const del = $('privateRequestManageDeleteBtn');
  if (!primary || !del) return;

  const v = Array.isArray(card.variants) ? card.variants[0] : null;
  const googleFileId = String(v?.googleFileId || '').trim();
  const driveUrl = String(v?.driveUrl || '').trim();
  const status = String(card._requestStatus || 'pending');
  modal.dataset.fid = googleFileId;
  modal.dataset.status = status;
  modal.dataset.driveUrl = driveUrl;
  if (title) title.textContent = `${String(card.title || '').trim()} 신청곡 관리`;
  const memo = String(card._requestMemo || '').trim();
  const statusText = status === 'practicing' ? '신청곡 연습중' : '신청곡 대기중';
  if (desc) desc.textContent = `상태: ${statusText}${memo ? `\n코멘트: ${memo}` : '\n코멘트: (없음)'}`;

  if (status === 'practicing') {
    primary.textContent = '가능곡으로 설정';
    del.textContent = '삭제';
  } else {
    primary.textContent = '수락';
    del.textContent = '거절(삭제)';
  }
  modal.style.display = 'flex';
}

function renderReviewListForCard(cardId, anchorEl) {
  const panel = $('reviewListPanel');
  const body = $('reviewListBody');
  const titleEl = $('reviewListTitle');
  if (!panel || !body) return;
  const th = state.reviewThreadMap.get(String(cardId || '').trim());
  const items = Array.isArray(th?.comments) ? th.comments : [];
  const title = String(th?.title || '').trim();
  if (titleEl) titleEl.textContent = `${title || '이 곡'} 합주 코멘트`;

  // 카드 옆에 패널 띄우기(뷰포트 클램프)
  try {
    if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
      const r = anchorEl.getBoundingClientRect();
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      // 일단 표시해서 실제 width/height 측정
      panel.style.display = 'flex';
      const pr = panel.getBoundingClientRect();
      const vw = window.innerWidth || 1200;
      const vh = window.innerHeight || 800;
      const gap = 12;
      const preferRight = r.right + gap + pr.width <= vw - 8;
      const x = preferRight ? r.right + gap : Math.max(8, r.left - gap - pr.width);
      const y = Math.min(Math.max(8, r.top - 6), Math.max(8, vh - pr.height - 8));
      panel.style.left = `${Math.round(x)}px`;
      panel.style.top = `${Math.round(y)}px`;
    }
  } catch {}

  body.innerHTML = '';
  if (!items.length) {
    body.innerHTML = `<div class="muted" style="padding:10px 2px; font-weight:900; opacity:0.7;">아직 코멘트가 없습니다.</div>`;
  } else {
    items
      .slice()
      .reverse()
      .forEach((c) => {
        const row = document.createElement('div');
        row.className = 'guestbook-item';
        const cid = String(c?._id || '').trim();
        row.innerHTML = `
          <div class="review-comment-row">
            <div class="review-comment-text">${esc(String(c?.text || ''))}</div>
            ${
              isArchiveOwner() && cid
                ? `<button class="review-comment-del" type="button" data-action="del" data-cid="${esc(cid)}">삭제</button>`
                : ''
            }
          </div>
        `;
        row.querySelector('[data-action="del"]')?.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isArchiveOwner()) return;
          const commentId = String(e.currentTarget?.dataset?.cid || '').trim();
          if (!commentId) return;
          const r = await apiJson(
            `/api/reviews/${encodeURIComponent(state.archiveTargetUserId)}/${encodeURIComponent(String(cardId || '').trim())}/${encodeURIComponent(commentId)}`,
            'DELETE',
            {}
          );
          if (!r.ok) return toast('삭제 실패');
          await loadReviews();
          applySongFilters();
          renderReviewListForCard(cardId, anchorEl);
        });
        body.appendChild(row);
      });
  }
  panel.style.display = 'flex';
}

async function submitReviewComment() {
  if (!state.isArchiveMode || !state.reviewEnabled) return;
  const ctx = state._reviewComposer;
  if (!ctx?.cardId) return;
  const input = $('reviewComposerInput');
  const text = String(input?.value || '').trim();
  if (!text) return toast('코멘트를 입력하세요.');
  const res = await apiJson(`/api/reviews/${encodeURIComponent(state.archiveTargetUserId)}`, 'POST', {
    cardId: ctx.cardId,
    title: ctx.title,
    artist: ctx.artist,
    tagText: ctx.tagText,
    text
  });
  if (!res.ok) return toast('저장 실패');
  toast('남겼어요');
  closeReviewComposer();
  // 즉시 반영을 위해 reload
  await loadReviews();
  applySongFilters();
  // 코멘트 버튼 하이라이트
  try {
    const btn = document.querySelector(`.review-bubble-btn[data-card-id="${cssEsc(ctx.cardId)}"]`);
    if (btn) {
      btn.classList.add('active');
      setTimeout(() => btn.classList.remove('active'), 700);
    }
  } catch {}
}

function applySetlistPanelSize() {
  const panel = $('setlistPanel');
  if (!panel) return;
  const w = Math.max(340, Math.min(640, Number(state.setlistPanelSize?.w || 420) || 420));
  const h = Math.max(360, Math.min(780, Number(state.setlistPanelSize?.h || 520) || 520));
  panel.style.width = `min(${w}px, calc(100vw - 44px))`;
  panel.style.height = `min(${h}px, calc(100vh - 140px))`;
}

function renderSetlistPanel() {
  const panel = $('setlistPanel');
  const list = $('setlistList');
  const fab = $('setlistFab');
  const headerActions = $('setlistHeaderActions');
  const help = $('setlistHelp');
  if (!panel || !list || !fab || !headerActions || !help) return;

  const hasItems = Array.isArray(state.setlistItems) && state.setlistItems.length > 0;
  const owner = isArchiveOwner();
  const showBtn = $('setlistShowBtn');

  // 버튼(오너만)
  fab.style.display = owner ? 'inline-flex' : 'none';
  fab.textContent = hasItems ? '셋리스트 편집하기' : '셋리스트 만들기';

  // 뷰어: 아이템이 없으면 패널 자체를 숨김
  if (!owner && !hasItems) {
    panel.style.display = 'none';
    if (showBtn) showBtn.style.display = 'none';
    return;
  }

  // 사용자가 직접 숨긴 경우(편집 중에는 무시한다)
  if (state.setlistHidden && !state.setlistEditMode) {
    panel.style.display = 'none';
    if (showBtn) showBtn.style.display = 'inline-flex';
    return;
  }
  if (showBtn) showBtn.style.display = 'none';
  // 오너: 편집 모드거나 아이템이 있으면 패널 표시(없어도 편집 진입 중이면 표시)
  if (owner && (state.setlistEditMode || hasItems)) panel.style.display = 'flex';
  else if (hasItems) panel.style.display = 'flex';
  else panel.style.display = 'none';

  applySetlistPanelSize();

  headerActions.style.display = owner && state.setlistEditMode ? 'flex' : 'none';
  help.style.display = owner && state.setlistEditMode && !hasItems ? 'block' : 'none';

  list.innerHTML = '';
  (state.setlistItems || []).forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = `setlist-item ${it.done ? 'done' : ''}`;
    row.dataset.idx = String(idx);

    const handle = `<div class="setlist-handle" ${owner && state.setlistEditMode ? "draggable='true'" : ''} data-action="drag">≡</div>`;
    const tag = String(it.tagText || '').trim();
    const driveUrl = String(it.driveUrl || '').trim();
    row.innerHTML = `
      ${handle}
      <div class="setlist-row" data-action="open">
        <div class="setlist-title-cell">${esc(it.title || '')}</div>
        <div class="setlist-artist-cell">${esc(it.artist || '')}</div>
        <div class="setlist-tag-cell">${tag ? `<span class="chip">${esc(tag)}</span>` : ''}</div>
      </div>
      <div class="setlist-actions">
        ${
          owner && state.setlistEditMode
            ? `
              <button class="setlist-mini-btn" type="button" data-action="toggleDone">${it.done ? '미완료' : '완료'}</button>
              <button class="setlist-mini-btn" type="button" data-action="remove">삭제</button>
            `
            : ''
        }
      </div>
      <div class="setlist-copied-label" aria-hidden="true">링크 복사됨!</div>
    `;

    row.querySelector('[data-action="open"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (owner && state.setlistEditMode) return;
      if (!driveUrl) return toast('링크가 없습니다.');
      try {
        await navigator.clipboard.writeText(driveUrl);
        row.classList.remove('copied');
        void row.offsetWidth;
        row.classList.add('copied');
        setTimeout(() => row.classList.remove('copied'), 950);
      } catch {
        toast('복사 실패(브라우저 권한 확인)');
      }
    });
    row.querySelector('[data-action="toggleDone"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!owner || !state.setlistEditMode) return;
      state.setlistItems[idx].done = !state.setlistItems[idx].done;
      renderSetlistPanel();
    });
    row.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!owner || !state.setlistEditMode) return;
      state.setlistItems.splice(idx, 1);
      renderSetlistPanel();
    });

    // drag reorder (edit only)
    if (owner && state.setlistEditMode) {
      const h = row.querySelector('[data-action="drag"]');
      if (h) {
        h.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/plain', String(idx));
        });
      }
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer?.getData('text/plain') || -1);
        const to = idx;
        if (from < 0 || from === to) return;
        const moved = state.setlistItems.splice(from, 1)[0];
        state.setlistItems.splice(to, 0, moved);
        renderSetlistPanel();
      });
    }

    list.appendChild(row);
  });
}

async function loadSetlist() {
  if (!state.isArchiveMode || !state.archiveTargetUserId) return;
  const r = await apiGet(`/api/setlist/${encodeURIComponent(state.archiveTargetUserId)}`);
  if (!r.ok) {
    state.setlistItems = [];
    state.setlistLoaded = true;
    renderSetlistPanel();
    return;
  }
  state.setlistItems = Array.isArray(r.items) ? r.items : [];
  state.setlistLoaded = true;
  renderSetlistPanel();
}

async function saveSetlistToServer() {
  if (!isArchiveOwner()) return toast('권한 없음');
  const res = await apiJson('/api/setlist', 'PATCH', { items: state.setlistItems || [] });
  if (!res.ok) return toast('저장 실패');
  state.setlistItems = Array.isArray(res.items) ? res.items : [];
  toast('저장 완료');
}

function enterSetlistEditMode() {
  if (!isArchiveOwner()) return;
  state.setlistEditMode = true;
  state.setlistOriginalItems = JSON.parse(JSON.stringify(state.setlistItems || []));
  state.setlistSelectedCardIds = new Set();
  renderSetlistPanel();
  applySongFilters();
}

function exitSetlistEditMode(revert) {
  if (revert && state.setlistOriginalItems) {
    state.setlistItems = JSON.parse(JSON.stringify(state.setlistOriginalItems));
  }
  state.setlistEditMode = false;
  state.setlistOriginalItems = null;
  state.setlistSelectedCardIds = new Set();
  renderSetlistPanel();
  applySongFilters();
}

function getArchiveThemeLabel(themeInput) {
  const theme = String(themeInput !== undefined ? themeInput : state.archiveTheme || 'pink').trim();
  if (theme === 'dark') return '다크';
  if (theme === 'sky') return '하늘색';
  if (theme === 'green') return '연두색';
  if (theme === 'amber') return '노랑/주황';
  if (theme === 'lavender') return '라벤더 나이트';
  if (theme === 'midnight') return '미드나잇 블루';
  if (theme === 'rosebeige') return '로즈 베이지';
  if (theme === 'mint') return '포레스트 민트';
  if (theme === 'coral') return '선셋 코랄';
  if (theme === 'mocha') return '모카 크림';
  if (theme === 'custom') return '커스텀(3색)';
  return '핑크';
}

function setBookThemeSelection(theme) {
  const next = String(theme || 'pink').trim() || 'pink';
  const sel = $('bookThemeSelect');
  if (sel) sel.value = next;
  document.querySelectorAll('#themePickerPalette .book-theme-card').forEach((btn) => {
    const active = String(btn.dataset.themeValue || '').trim() === next;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  // custom 입력 UI
  const customBox = $('customThemeBox');
  if (customBox) customBox.style.display = next === 'custom' ? 'block' : 'none';

  // settings modal mini preview
  try {
    const label = $('bookThemeCurrentLabel');
    if (label) label.textContent = getArchiveThemeLabel(next);
    const swWrap = $('bookThemeCurrentSwatches');
    if (swWrap) {
      const spans = swWrap.querySelectorAll('span');
      let a = '#ffd3e5',
        b = '#fff4f9',
        c = '#ff8fbe';
      if (next === 'custom') {
        a = String(state.archiveThemeCustomA || a);
        b = String(state.archiveThemeCustomB || b);
        c = String(state.archiveThemeCustomC || c);
      } else {
        const btn = document.querySelector(`#themePickerPalette .book-theme-card[data-theme-value=\"${CSS.escape(next)}\"]`);
        if (btn) {
          const cs = getComputedStyle(btn);
          a = cs.getPropertyValue('--theme-a').trim() || a;
          b = cs.getPropertyValue('--theme-b').trim() || b;
          c = cs.getPropertyValue('--theme-c').trim() || c;
        }
      }
      if (spans?.[0]) spans[0].style.background = a;
      if (spans?.[1]) spans[1].style.background = b;
      if (spans?.[2]) spans[2].style.background = c;
    }
  } catch {}
}

function updateSortControls() {
  const field = $('sortFieldSelect');
  const asc = $('sortAscBtn');
  const desc = $('sortDescBtn');
  if (field) field.value = String(state.sortField || 'createdAt');
  if (asc) asc.classList.toggle('active', state.sortDir === 'asc');
  if (desc) desc.classList.toggle('active', state.sortDir === 'desc');
}

function triggerListMotion() {
  const wrap = $('songCardList');
  if (!wrap) return;
  wrap.classList.remove('list-enter');
  void wrap.offsetWidth;
  wrap.classList.add('list-enter');
  clearTimeout(state._listAnimTimer);
  state._listAnimTimer = setTimeout(() => wrap.classList.remove('list-enter'), 520);
}

function updateArchiveStatusCard() {
  const card = $('archiveStatusCard');
  if (!card) return;
  if (!state.isArchiveMode) {
    card.style.display = 'none';
    return;
  }
  const name = state.archiveDisplayName || state.archiveTargetUserId || '이 노래책';
  const headline = $('archiveStatusHeadline');
  const body = $('archiveStatusBody');
  const title = String(state.archiveStatusTitle || '').trim();
  const desc = String(state.archiveStatusDesc || '').trim();
  const fallbackTitle = `${name}님의 노래책`;
  const fallbackDesc =
    state.proficiencyEditMode
      ? '숙련도 기준으로 곡을 정리할 수 있어요.'
      : state.availabilityEditMode
        ? '가능곡을 체크하는 중이에요. 저장 전까지는 화면에서 바로 수정돼요.'
        : '검색/필터/정렬로 오늘 부르고 싶은 곡을 골라보세요.';
  const finalTitle = title || fallbackTitle;
  const finalDesc = desc || '';
  if (headline) headline.textContent = finalTitle;
  if (body) body.textContent = finalDesc || fallbackDesc;
  // 둘 다 비어있으면(=기본값도 숨기고 싶을 때) 카드 숨김
  if (!title && !desc) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
}

// GitHub Pages/정적 호스팅 딥링크(404.html -> /public/musicbook/ 리다이렉트) 복구
try {
  const redir = sessionStorage.getItem('mb_spa_redirect_v1') || '';
  if (redir) {
    sessionStorage.removeItem('mb_spa_redirect_v1');
    // 원래 경로로 URL을 복구해야 archive userId(path 기반)가 정상 인식된다.
    window.history.replaceState(null, '', redir);
  }
} catch {}

function detectArchiveTargetUserId() {
  const pathname = String(window.location.pathname || '');
  // 안정적인 고정 경로: /public/musicbook/u/<userId>
  const patterns = ['/public/musicbook/u/', '/musicbook/u/'];
  for (const base of patterns) {
    const idx = pathname.indexOf(base);
    if (idx < 0) continue;
    const rest = pathname.slice(idx + base.length); // "<userId>/..."
    const seg = String(rest.split('/').filter(Boolean)[0] || '').trim();
    if (!seg || seg === 'index.html' || seg.endsWith('.css') || seg.endsWith('.js')) return '';
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  }
  return '';
}

function setArchiveShellUI() {
  document.body.classList.add('archive-mode');
  applyArchiveTheme();
  applySongsViewMode();
  // 메인/패널 제거 + 곡 리스트만 노출
  try {
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    $('songsPage')?.classList?.add('active');
  } catch {}
  try {
    $('songsNavBtn')?.classList?.add('active');
    $('mainNavBtn')?.classList?.remove?.('active');
  } catch {}
  // 타이틀
  try {
    const row = $('songsTitleRow');
    if (row) row.style.display = 'flex';
    const t = $('archiveTitleText');
    if (t) {
      // 이름 텍스트는 좌측 컬럼으로 이동(가독성/레이아웃 안정)
      t.style.display = 'none';
    }
    const navTitle = $('archiveNavTitle');
    if (navTitle) {
      const name = state.archiveDisplayName || state.archiveTargetUserId;
      navTitle.style.display = 'block';
      navTitle.textContent = `${name}의 노래책`;
    }
    const profileWrap = $('archiveNavProfileWrap');
    const profileImg = $('archiveNavProfile');
    if (profileWrap && profileImg) {
      const photo = normalizeProfilePhotoUrl(state.archiveProfilePhoto || '', 320);
      profileImg.src = photo || '';
      profileWrap.style.display = photo ? 'flex' : 'none';
    }
    const img = $('songsTitleLogo');
    if (img) {
      const u = normalizeProfilePhotoUrl(state.archiveTitleImage || '', 1200);
      img.src = u || '';
      img.style.display = u ? 'block' : 'none';
    }
    updateArchiveStatusCard();
    document.title = `${state.archiveDisplayName || state.archiveTargetUserId}의 노래책`;
  } catch {}
}

function setLoadingContext({ titleImage = '', profilePhoto = '', displayName = '' } = {}) {
  try {
    const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const ti = document.getElementById('loadingTitleImage');
    if (ti) {
      const u = normalizeProfilePhotoUrl(titleImage || '', 1200);
      ti.src = u || blank;
      ti.style.display = 'block';
    }
    const pi = document.getElementById('loadingProfileImage');
    if (pi) {
      const u = normalizeProfilePhotoUrl(profilePhoto || '', 240);
      pi.src = u || blank;
      pi.style.display = 'block';
    }
    const nn = document.getElementById('loadingNickname');
    if (nn) nn.textContent = String(displayName || '').trim() || '로딩 중...';
  } catch {}
}

function toMs(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function getSortValue(item, field) {
  const f = String(field || '');
  if (f === 'createdAt') {
    // 카드(createdAt=ms) / 파일(드라이브 수정시간=ms) 모두 지원
    return Number(item?.createdAtMs ?? item?.driveModifiedMs ?? item?.createdAt ?? 0) || 0;
  }
  if (f === 'proficiency') return Number(item?.proficiencyLevel ?? item?.proficiency ?? 0) || 0;
  if (f === 'key') return String(item?.keyLabel ?? item?.key ?? '').trim();
  return String(item?.[f] ?? '').trim();
}

// ---- DOM helpers -----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssEsc = (s) => {
  try {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(s ?? ''));
  } catch {}
  return String(s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
};
// 가능곡 벌크 추가(악보없음/코드위키)에서 자유입력으로 들어온 링크가 실제로 열어볼 만한 URL인지 확인.
// http(s)가 아니면 "링크 있음"으로 취급하지 않는다(배지/열기 버튼 오작동 방지).
const looksLikeUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());

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

// ---- 초성 검색 -------------------------------------------------------------------
const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
function isChoseongQuery(q) {
  return /^[ㄱ-ㅎ]+$/.test(String(q || '').trim());
}
function toChoseongString(s) {
  const str = String(s ?? '');
  let out = '';
  for (const ch of Array.from(str)) {
    const code = ch.charCodeAt(0);
    // Hangul syllables
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = Math.floor((code - 0xac00) / 588);
      out += CHOSEONG[idx] || '';
      continue;
    }
    // keep ASCII letters/digits for mixed search
    out += normLower(ch);
  }
  return out.replace(/\s+/g, '');
}

function highlightHtml(text, q) {
  const raw = String(text ?? '');
  const query = String(q || '').trim();
  if (!query) return esc(raw);
  const qNoSpace = query.replace(/\s+/g, '').slice(0, 64);
  // 초성 검색 하이라이트 (T-22)
  if (isChoseongQuery(qNoSpace)) {
    const chars = Array.from(raw);
    // build choseong string + mapping(repIndex -> rawCharIndex)
    let rep = '';
    /** @type {number[]} */
    const map = [];
    chars.forEach((ch, rawIdx) => {
      if (/\s/.test(ch)) return;
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const idx = Math.floor((code - 0xac00) / 588);
        rep += CHOSEONG[idx] || '';
        map.push(rawIdx);
        return;
      }
      rep += normLower(ch);
      map.push(rawIdx);
    });
    const marks = new Set();
    let pos = rep.indexOf(qNoSpace);
    while (pos !== -1) {
      for (let i = pos; i < pos + qNoSpace.length; i += 1) {
        const rawIdx = map[i];
        if (rawIdx !== undefined) marks.add(rawIdx);
      }
      pos = rep.indexOf(qNoSpace, pos + 1);
    }
    if (!marks.size) return esc(raw);
    // render with mark groups
    let out = '';
    let inMark = false;
    chars.forEach((ch, rawIdx) => {
      const on = marks.has(rawIdx);
      if (on && !inMark) {
        out += '<mark class="hl">';
        inMark = true;
      }
      if (!on && inMark) {
        out += '</mark>';
        inMark = false;
      }
      out += esc(ch);
    });
    if (inMark) out += '</mark>';
    return out;
  }

  // 일반 문자열 하이라이트
  const qq = query.slice(0, 64);
  try {
    const re = new RegExp(qq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    return esc(raw).replace(re, (m) => `<mark class="hl">${m}</mark>`);
  } catch {
    return esc(raw);
  }
}

let _loadingShownAt = 0;
let _loadingHideTimer = null;
function showLoading(on) {
  const el = $('loadingScreen');
  if (!el) return;
  const enabled = Boolean(on);
  if (_loadingHideTimer) {
    clearTimeout(_loadingHideTimer);
    _loadingHideTimer = null;
  }
  if (enabled) {
    _loadingShownAt = Date.now();
    // 애니메이션 재시작을 위해 active를 강제로 토글
    el.classList.remove('active');
    // force reflow
    void el.offsetHeight; // eslint-disable-line no-unused-expressions
    el.classList.add('active');
    return;
  }

  // 개인 노래책에서는 로딩 애니메이션이 눈에 보이도록 최소 노출 시간을 준다.
  const minMs = state?.isArchiveMode ? 1100 : 0;
  const elapsed = Date.now() - (_loadingShownAt || 0);
  const wait = Math.max(0, minMs - elapsed);
  if (wait) _loadingHideTimer = setTimeout(() => el.classList.remove('active'), wait);
  else el.classList.remove('active');
}

// T-21: 로딩 중 이전 결과 유지(리스트 흐림 처리)
function setListDimLoading(on) {
  const wrap = $('songCardList');
  if (!wrap) return;
  wrap.classList.toggle('loading-dim', Boolean(on));
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

function formatDateTime(v) {
  try {
    return new Date(v).toLocaleString('ko-KR', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function runCardParticleBurst(event) {
  if (!state.isArchiveMode) return Promise.resolve();
  const x = Number(event?.clientX || 0);
  const y = Number(event?.clientY || 0);
  if (!x && !y) return Promise.resolve();
  const host = document.createElement('div');
  host.className = 'card-particle-burst';
  const colors = ['#ffd7ea', '#ffe67c', '#b9ffd8', '#fff7fb', '#ffc4dd'];
  const count = 14;
  for (let i = 0; i < count; i += 1) {
    const p = document.createElement('span');
    p.className = 'card-particle';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.24;
    const distance = 34 + Math.random() * 44;
    const size = 5 + Math.random() * 8;
    p.style.setProperty('--start-x', `${x}px`);
    p.style.setProperty('--start-y', `${y}px`);
    p.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    p.style.setProperty('--particle-color', colors[i % colors.length]);
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    host.appendChild(p);
  }
  document.body.appendChild(host);
  return new Promise((resolve) => {
    setTimeout(() => {
      host.remove();
      resolve();
    }, 240);
  });
}

function canManageGuestbook() {
  if (!state.isArchiveMode) return false;
  if (state.role === 'admin') return true;
  return Boolean(state.hasPublicBook) && String(state.userId || '') === String(state.archiveTargetUserId || '');
}

function getGuestbookNicknameSeed() {
  const stored = String(localStorage.getItem('mb_guestbook_nick') || '').trim();
  if (stored) return stored;
  if (state.role !== 'viewer' && String(state.displayName || '').trim()) return String(state.displayName || '').trim();
  return '';
}

function renderGuestbook() {
  const panel = $('guestbookPanel');
  const showBtn = $('guestbookShowBtn');
  const list = $('guestbookList');
  if (!panel || !showBtn || !list) return;
  const visible = state.isArchiveMode;
  panel.style.display = visible ? 'flex' : 'none';
  showBtn.style.display = 'none';
  // compose는 기본 숨김, "방명록 쓰기" 버튼으로 토글
  try {
    const compose = $('guestbookCompose');
    const writeBtn = $('guestbookWriteBtn');
    const open = compose?.dataset?.open === '1';
    if (compose) compose.style.display = open ? 'flex' : 'none';
    if (writeBtn) writeBtn.textContent = open ? '남기기' : '방명록 쓰기';
  } catch {}
  const nickInput = $('guestbookNicknameInput');
  if (nickInput && !nickInput.value.trim()) nickInput.value = getGuestbookNicknameSeed();
  if (!visible) return;

  list.innerHTML = '';
  const items = Array.isArray(state.guestbookItems) ? state.guestbookItems : [];
  if (!items.length) {
    list.innerHTML = `<div class="guestbook-item"><div class="guestbook-item-content">아직 방명록이 없습니다.</div></div>`;
    return;
  }
  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'guestbook-item';
    const canDelete = canManageGuestbook();
    el.innerHTML = `
      <div class="guestbook-item-top">
        <div>
          <div class="guestbook-item-name">${esc(item.nickname || '익명')}</div>
          <div class="guestbook-item-date">${esc(formatDateTime(item.createdAt))}</div>
        </div>
        ${canDelete ? `<button class="floating-btn compact-btn" data-del="${esc(item._id || '')}" type="button">삭제</button>` : ''}
      </div>
      <div class="guestbook-item-content">${esc(item.content || '')}</div>
    `;
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      const r = await apiJson(`/api/guestbook/${encodeURIComponent(item._id)}`, 'DELETE', {});
      if (!r.ok) return toast('삭제 실패');
      await loadGuestbook(true);
    });
    list.appendChild(el);
  });
}

async function loadGuestbook(force = false) {
  if (!state.isArchiveMode || !state.archiveTargetUserId) return;
  if (!force && state.archiveGuestbookLoaded) return;
  const r = await apiGet(`/api/guestbook/${encodeURIComponent(state.archiveTargetUserId)}`);
  if (!r?.ok) return;
  state.guestbookItems = Array.isArray(r.items) ? r.items : [];
  state.archiveGuestbookLoaded = true;
  renderGuestbook();
}

function ensureGuestbookPosition() {
  const panel = $('guestbookPanel');
  if (!panel) return;
  if (!panel.dataset.positioned) {
    panel.style.left = '22px';
    panel.style.top = '220px';
    panel.dataset.positioned = '1';
  }
}

function initGuestbookDrag() {
  const panel = $('guestbookPanel');
  const handle = $('guestbookDragHandle');
  if (!panel || !handle || handle.dataset.bound === '1') return;
  handle.dataset.bound = '1';
  const onPointerMove = (e) => {
    if (!state._guestbookDrag) return;
    const nextLeft = e.clientX - state._guestbookDrag.offsetX;
    const nextTop = e.clientY - state._guestbookDrag.offsetY;
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth - 8);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight - 8);
    panel.style.left = `${Math.max(8, Math.min(maxLeft, nextLeft))}px`;
    panel.style.top = `${Math.max(8, Math.min(maxTop, nextTop))}px`;
  };
  const onPointerUp = () => {
    state._guestbookDrag = null;
    handle.style.cursor = 'grab';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (!state.isArchiveMode) return;
    const rect = panel.getBoundingClientRect();
    state._guestbookDrag = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    handle.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });
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
  const target = page === 'songs' ? $('songsPage') : $('mainPage');
  if (target) {
    target.classList.remove('page-enter');
    void target.offsetWidth;
    target.classList.add('page-enter');
    clearTimeout(state._pageAnimTimer);
    state._pageAnimTimer = setTimeout(() => target.classList.remove('page-enter'), 360);
  }
}

// ---- API -------------------------------------------------------------------------
async function apiGet(url) {
  try {
    const res = await fetch(apiUrl(url), { credentials: 'include' });
    try {
      return await res.json();
    } catch {
      return { ok: false, error: `BAD_JSON:${res.status}` };
    }
  } catch (e) {
    // CORS/광고차단/망 차단 등으로 fetch 자체가 실패하면 여기로 온다.
    return { ok: false, error: `NETWORK_ERROR:${String(e?.message || e)}` };
  }
}
async function apiJson(url, method, body) {
  try {
    const res = await fetch(apiUrl(url), {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    });
    try {
      return await res.json();
    } catch {
      return { ok: false, error: `BAD_JSON:${res.status}` };
    }
  } catch (e) {
    return { ok: false, error: `NETWORK_ERROR:${String(e?.message || e)}` };
  }
}
// multipart/form-data 업로드용(apiJson은 JSON 전용이라 별도로 둠). formData는 이미 구성된
// FormData 인스턴스를 받는다(Content-Type은 브라우저가 boundary 포함해서 자동으로 채움).
async function apiUpload(url, formData) {
  try {
    const res = await fetch(apiUrl(url), { method: 'POST', credentials: 'include', body: formData });
    try {
      return await res.json();
    } catch {
      return { ok: false, error: `BAD_JSON:${res.status}` };
    }
  } catch (e) {
    return { ok: false, error: `NETWORK_ERROR:${String(e?.message || e)}` };
  }
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

// UX-3(2차 감사): 곡 목록 로드 실패 시 스켈레톤+"로딩 중"이 영구 고착되고 1.4초
// 토스트 외 피드백/복구 수단이 없었다 — 에러 상태와 재시도 버튼을 렌더한다.
function renderSongsLoadError() {
  const wrap = $('songCardList');
  if (wrap) {
    wrap.innerHTML = `
      <div class="song-card" style="grid-column:1/-1; text-align:center; padding:26px 16px;">
        <div style="font-weight:700; margin-bottom:6px;">곡 목록을 불러오지 못했습니다</div>
        <div class="muted" style="font-size:13px; margin-bottom:14px;">네트워크 상태를 확인한 뒤 다시 시도해 주세요.</div>
        <button type="button" id="retrySongsBtn" class="floating-btn black-btn">다시 시도</button>
      </div>`;
    const btn = wrap.querySelector('#retrySongsBtn');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await loadSongs(true);
          await loadSongFiles(true);
          applySongFilters();
        } catch (e) {
          console.error(e);
          toast('다시 시도했지만 실패했습니다');
        } finally {
          btn.disabled = false;
        }
      };
    }
  }
  if ($('resultCount')) $('resultCount').textContent = '불러오기 실패';
}

async function loadSongs(force = false) {
  if (!force && state.songCardsAll.length) return;
  const firstLoad = !state.songCardsAll.length;
  try {
    if (firstLoad) showLoading(true);
    if ($('resultCount')) $('resultCount').textContent = '로딩 중...';
    if (firstLoad) {
      // simple skeleton (prevents "empty flash")
      const wrap = $('songCardList');
      if (wrap) {
        wrap.innerHTML = Array.from({ length: 8 })
          .map(
            () =>
              `<div class="song-card" style="opacity:0.55;">
                 <div class="song-card-header">
                   <div class="song-card-top">
                     <div class="song-card-title"><span style="display:inline-block; width:60%; height:14px; background:rgba(140,150,170,0.25); border-radius:6px;"></span></div>
                   </div>
                   <div class="song-card-artist" style="margin-top:8px;"><span style="display:inline-block; width:45%; height:12px; background:rgba(140,150,170,0.18); border-radius:6px;"></span></div>
                 </div>
               </div>`
          )
          .join('');
      }
    }
    const params = new URLSearchParams();
    // 이 아카이브 오너의 private-scope placeholder 곡(악보없음/코드위키)도 함께 보이게 한다.
    // edit 모드 여부와 무관하게 항상 붙인다 - "전체 곡 중에서 고르는" edit 모드에서도
    // 다른 사람의 private 곡이 섞여 나오면 안 되니, 항상 "이 아카이브 오너 것만" 범위로 제한한다.
    if (state.isArchiveMode && state.archiveTargetUserId) {
      params.set('privateOwnerId', String(state.archiveTargetUserId));
    }
    if (!state._forceAllSongsForEdit && state.isArchiveMode && !state.availabilityEditMode && state.archiveTargetUserId) {
      params.set('availableUserId', String(state.archiveTargetUserId));
    }
    const url = `/api/songs/cards${params.toString() ? `?${params.toString()}` : ''}`;
    const data = await apiGet(url);
    if (!data.ok) {
      renderSongsLoadError(); // UX-3: 스켈레톤 고착 대신 에러+재시도 UI
      throw new Error('songs load failed');
    }
    state.songCardsTotal = Number(data.totalCards || 0) || Number(data.total || 0) || 0;
    state.songCardsAll = (data.items || []).map((c) => ({
      ...c,
      keyLabel: (c.keys || []).filter(Boolean).join('/') || '-',
      _searchNorm: normSearch(c.searchText || ''),
      _titleNorm: normSearch(c.title || ''),
      _artistNorm: normSearch(c.artist || '')
    }));
    // archive: 신청곡 카드도 같이 섞어서 보이게
    if (state.isArchiveMode) {
      await loadPrivateRequests(true);
      mergePrivateRequestsIntoCards();
      // norms re-attach (for merged cards)
      state.songCardsAll = (state.songCardsAll || []).map((c) => ({
        ...c,
        _searchNorm: c._searchNorm || normSearch(c.searchText || ''),
        _titleNorm: c._titleNorm || normSearch(c.title || ''),
        _artistNorm: c._artistNorm || normSearch(c.artist || '')
      }));
    }
    if (!state.songCardsAll.length) {
      $('resultCount').textContent = '곡 데이터가 없습니다. /admin에서 Drive 동기화를 실행해 주세요.';
    }
  } finally {
    if (firstLoad) showLoading(false);
  }
}

async function loadSongFiles(force = false) {
  if (!force && state.songFilesAll.length) return;
  // NOTE:
  // - file 단위 목록과 card 단위 목록이 서로 다른 API(/api/songs vs /api/songs/cards)를 사용하면
  //   5000 cap 환경에서 "한쪽에는 있는데 다른 쪽에는 없는" 불일치가 발생할 수 있다(정렬/limit 기준 차이).
  // - 따라서 file 목록도 cards 응답을 펼쳐서 생성해 UI/정렬/노출을 일관되게 유지한다.
  const params = new URLSearchParams();
  // 이 아카이브 오너의 private-scope placeholder 곡(악보없음/코드위키)도 함께 보이게 한다.
  // loadSongs()와 동일한 이유로 edit 모드 여부와 무관하게 항상 붙인다.
  if (state.isArchiveMode && state.archiveTargetUserId) {
    params.set('privateOwnerId', String(state.archiveTargetUserId));
  }
  // archive 기본 화면은 "내 가능곡만"이므로, 파일 목록도 동일하게 제한(편집 모드에서는 전체 곡을 봐야 한다)
  if (!state._forceAllSongsForEdit && state.isArchiveMode && !state.availabilityEditMode && state.archiveTargetUserId) {
    params.set('availableUserId', String(state.archiveTargetUserId));
  }
  const url = `/api/songs/cards${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await apiGet(url);
  if (!data.ok) throw new Error('songs load failed');
  state.songFilesTotal = Number(data.totalDocs || 0) || 0;
  const files = [];
  (data.items || []).forEach((c) => {
    const cardTitle = String(c.title || '').trim();
    const cardArtist = String(c.artist || '').trim();
    const genre = String(c.genre || '').trim();
    const mood = String(c.mood || '').trim();
    const vocal = String(c.vocal || '').trim();
    const baseSearch = String(c.searchText || `${cardTitle} ${cardArtist} ${genre} ${mood} ${vocal}` || '').trim();
    (c.variants || []).forEach((v) => {
      if (!v?.googleFileId) return;
      const key = String(v.key || '').trim();
      const driveModifiedMs = Number(v.driveModifiedMs || 0) || 0;
      // 문서(variant) 자체의 title/artist가 있으면 그걸 쓴다(카드는 여러 variant를 묶기 위한
      // 정규화 값이라 개별 문서와 다를 수 있음). displayTitle은 비어있으면 title로 대체 표시.
      const title = String(v.title || '').trim() || cardTitle;
      const artist = String(v.artist || '').trim() || cardArtist;
      const displayTitle = String(v.displayTitle || '').trim() || title;
      files.push({
        // Song 문서(Mongo _id). 가능곡 편집모드(관리자)의 인라인 메타데이터 저장(PATCH /api/admin/songs/:id)에 필요.
        songId: String(v.songId || ''),
        googleFileId: v.googleFileId,
        driveUrl: v.driveUrl || '',
        driveModifiedTime: driveModifiedMs ? new Date(driveModifiedMs).toISOString() : '',
        driveModifiedMs,
        // createdAt 정렬은 "드라이브 수정일" 기반으로 통일
        createdAtMs: driveModifiedMs,
        title,
        displayTitle,
        artist,
        key,
        genre,
        mood,
        vocal,
        searchText: `${baseSearch} ${key}`.trim()
      });
    });
  });
  state.songFilesAll = files.map((s) => ({
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
  setListDimLoading(true);
  const data = await apiGet(`/api/availability?userId=${encodeURIComponent(userId)}`);
  setListDimLoading(false);
  if (!data.ok) return;
  const set = new Set();
  (data.items || []).forEach((a) => {
    if (a.available) set.add(a.googleFileId);
  });
  state.filterAvailableVocalSet = set;
}

// MB-5(2차 감사): 가능보컬 세트 로딩이 한 번 실패하면 목록이 '로딩 중' dim으로
// 영구 고착됐다(재시도 트리거 없음). 누락 세트가 있는 동안 4초 간격으로 자동
// 재시도해 네트워크 회복 시 스스로 풀리게 한다.
let _vocalSetRetryTimer = null;
function scheduleVocalSetRetry() {
  if (_vocalSetRetryTimer) return;
  _vocalSetRetryTimer = setTimeout(async () => {
    _vocalSetRetryTimer = null;
    const ids = getSelectedAvailableVocalUserIds();
    const missing = ids.filter((uid) => !state.filterAvailableVocalSetsByUserId.get(uid));
    if (!missing.length) return;
    try {
      await loadAvailableVocalSets(ids);
    } catch (e) {
      console.error(e);
    }
    applySongFilters();
  }, 4000);
}

async function loadAvailableVocalSets(userIds) {
  const ids = Array.isArray(userIds) ? userIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const selected = new Set(ids);
  // prune cache
  for (const k of state.filterAvailableVocalSetsByUserId.keys()) {
    if (!selected.has(k)) state.filterAvailableVocalSetsByUserId.delete(k);
  }
  const missing = ids.filter((uid) => !state.filterAvailableVocalSetsByUserId.has(uid));
  if (missing.length) setListDimLoading(true);
  await Promise.all(
    missing.map(async (uid) => {
      const data = await apiGet(`/api/availability?userId=${encodeURIComponent(uid)}`);
      if (!data.ok) {
        toast('가능보컬 데이터 로딩 실패(이전 결과 유지)');
        return;
      }
      const set = new Set();
      (data.items || []).forEach((a) => {
        if (a.available) set.add(a.googleFileId);
      });
      state.filterAvailableVocalSetsByUserId.set(uid, set);
    })
  );
  if (missing.length) setListDimLoading(false);
}

function getSelectedAvailableVocalUserIds() {
  if (state.isArchiveMode) return [];
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
  const userId = state.isArchiveMode && state.archiveTargetUserId ? state.archiveTargetUserId : state.userId || '';
  state.myAvailabilitySet = null;
  state.myAvailabilityProficiencyMap = null;
  if (!userId) return null;
  const data = await apiGet(`/api/availability?userId=${encodeURIComponent(userId)}`);
  if (!data.ok) return null;
  const set = new Set();
  const profMap = new Map();
  (data.items || []).forEach((a) => {
    if (a.available) set.add(a.googleFileId);
    profMap.set(String(a.googleFileId || ''), Math.max(0, Math.min(3, Number(a.proficiency || 0) || 0)));
  });
  state.myAvailabilitySet = set;
  state.myAvailabilityProficiencyMap = profMap;
  return set;
}

function applySongFilters() {
  const qRaw = String($('searchInput')?.value || '').trim();
  const q = normSearch(qRaw);
  const qCho = qRaw.replace(/\s+/g, '');
  const qIsCho = isChoseongQuery(qCho);
  // renderer에서 하이라이트/표시용
  state._lastSearchRaw = qRaw;
  state._lastSearchIsCho = qIsCho;
  // 기본은 로딩 dim 해제(필요 시 아래에서 다시 켠다)
  setListDimLoading(false);
  const genre = $('genreFilter').value;
  const mood = $('moodFilter').value;
  const vocal = $('vocalFilter').value;
  const proficiencyFilter = Number($('proficiencyFilter')?.value || 0) || 0;
  const availableVocalUserIds = getSelectedAvailableVocalUserIds();

  const hideTags = true; // 기본은 항상 태그 숨김(토글 제거)

  if (state.availabilityEditMode || state.proficiencyEditMode) {
    let list = state.songFilesAll.slice().filter((s) => !s.hidden);
    if (genre) list = list.filter((s) => s.genre === genre);
    if (mood) list = list.filter((s) => s.mood === mood);
    if (vocal) list = list.filter((s) => s.vocal === vocal);
    if (q) {
      if (qIsCho) {
        const qq = qCho;
        list = list.filter((s) => {
          s._titleCho ||= toChoseongString(s.title || '');
          s._displayTitleCho ||= toChoseongString(s.displayTitle || '');
          s._artistCho ||= toChoseongString(s.artist || '');
          s._searchCho ||= toChoseongString(s.searchText || '');
          return (
            s._searchCho.includes(qq) || s._titleCho.includes(qq) || s._displayTitleCho.includes(qq) || s._artistCho.includes(qq)
          );
        });
      } else {
        list = list.filter(
          (s) =>
            (s._searchNorm || normSearch(s.searchText || '')).includes(q) ||
            (s._titleNorm || normSearch(s.title || '')).includes(q) ||
            (s._displayTitleNorm || normSearch(s.displayTitle || '')).includes(q) ||
            (s._artistNorm || normSearch(s.artist || '')).includes(q)
        );
      }
    }

    // 가능보컬(AND) 필터도 편집모드(파일 단위)에 동일 적용
    if (availableVocalUserIds.length) {
      const ids = availableVocalUserIds;
      const hasMissing = ids.some((uid) => !state.filterAvailableVocalSetsByUserId.get(uid));
      if (hasMissing) {
        setListDimLoading(true);
        $('resultCount').textContent = '로딩 중...(가능보컬 필터, 자동 재시도 중)';
        scheduleVocalSetRetry(); // MB-5: 실패 시 영구 고착 방지
        return;
      }
      list = list.filter((s) => {
        const fid = String(s.googleFileId || '');
        return ids.every((uid) => {
          const set = state.filterAvailableVocalSetsByUserId.get(uid);
          if (!set) return false;
          return set.has(fid);
        });
      });
    }

    // 옵션: 기존 가능곡(이미 체크된 곡) 숨기기
    if (state.availabilityEditMode && state.availabilityHideExisting && state.availabilityDraftSet) {
      const set = state.availabilityDraftSet;
      list = list.filter((s) => !set.has(String(s.googleFileId || '')));
    }

    // 숙련도 설정 모드에서는 "내 가능곡"만 노출
    if (state.proficiencyEditMode) {
      const set = state.myAvailabilitySet || new Set();
      list = list.filter((s) => set.has(String(s.googleFileId || '')));
    }
    if (proficiencyFilter > 0) {
      const profMap = state.proficiencyDraftMap || state.myAvailabilityProficiencyMap || new Map();
      list = list.filter((s) => (Number(profMap.get(String(s.googleFileId || '')) || 0) || 0) === proficiencyFilter);
    }

    const f = state.sortField;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const profMap = state.proficiencyDraftMap || state.myAvailabilityProficiencyMap || new Map();
      const av =
        f === 'proficiency' ? Number(profMap.get(String(a.googleFileId || '')) || a.proficiency || 0) || 0 : getSortValue(a, f);
      const bv =
        f === 'proficiency' ? Number(profMap.get(String(b.googleFileId || '')) || b.proficiency || 0) || 0 : getSortValue(b, f);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });

    state.songFilesFiltered = list;
    const totalLabel = !state.isArchiveMode && state.songFilesTotal ? ` / 전체: ${state.songFilesTotal}개` : '';
    $('resultCount').textContent = `검색 결과: ${list.length}개(파일 단위)${totalLabel}`;
    if (state.proficiencyEditMode) renderProficiencyEditCards(hideTags);
    else renderAvailabilityEditCards(hideTags);
    renderPager();
    return;
  }

  let list = state.songCardsAll.slice();
  if (genre) list = list.filter((c) => c.genre === genre);
  if (mood) list = list.filter((c) => c.mood === mood);
  if (vocal) list = list.filter((c) => c.vocal === vocal);
  if (proficiencyFilter > 0) {
    list = list.filter((c) => (Number(c.proficiencyLevel || 0) || 0) === proficiencyFilter);
  }
  if (q) {
    if (qIsCho) {
      const qq = qCho;
      list = list.filter((c) => {
        c._titleCho ||= toChoseongString(c.title || '');
        c._artistCho ||= toChoseongString(c.artist || '');
        c._searchCho ||= toChoseongString(c.searchText || '');
        return c._searchCho.includes(qq) || c._titleCho.includes(qq) || c._artistCho.includes(qq);
      });
    } else {
      list = list.filter(
        (c) =>
          (c._searchNorm || normSearch(c.searchText || '')).includes(q) ||
          (c._titleNorm || normSearch(c.title || '')).includes(q) ||
          (c._artistNorm || normSearch(c.artist || '')).includes(q)
      );
    }
  }

  // 가능보컬 필터(AND): 선택된 유저 "모두"가 가능한 곡만 노출
  if (availableVocalUserIds.length) {
    const ids = availableVocalUserIds;
    // T-21: 아직 로딩되지 않은 uid가 있으면 이전 결과 유지 + dim 처리
    const hasMissing = ids.some((uid) => !state.filterAvailableVocalSetsByUserId.get(uid));
    if (hasMissing) {
      setListDimLoading(true);
      $('resultCount').textContent = '로딩 중...(가능보컬 필터, 자동 재시도 중)';
      scheduleVocalSetRetry(); // MB-5: 실패 시 영구 고착 방지
      return;
    }
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
    const aReq = Boolean(a?._privateRequest);
    const bReq = Boolean(b?._privateRequest);
    if (aReq !== bReq) return aReq ? -1 : 1;
    if (aReq && bReq) {
      const aPending = String(a?._requestStatus || '') === 'pending' ? 0 : 1;
      const bPending = String(b?._requestStatus || '') === 'pending' ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      const aReqMs = Number(a?._requestCreatedAtMs || 0) || 0;
      const bReqMs = Number(b?._requestCreatedAtMs || 0) || 0;
      if (aReqMs !== bReqMs) return bReqMs - aReqMs;
    }
    const av = getSortValue(a, f);
    const bv = getSortValue(b, f);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });

  state.songCardsFiltered = list;
  const totalCardsLabel = !state.isArchiveMode && state.songCardsTotal ? ` / 전체: ${state.songCardsTotal}곡` : '';
  $('resultCount').textContent = `검색 결과: ${list.length}곡${totalCardsLabel}`;
  renderSongCards(hideTags);
  renderPager();
  updateArchiveStatusCard();
}

function renderSongCards(hideTags) {
  const wrap = $('songCardList');
  wrap.innerHTML = '';
  applySongsViewMode();

  const totalPages = Math.max(1, Math.ceil(state.songCardsFiltered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const items = state.songCardsFiltered.slice(start, start + state.pageSize);

  const listMode = String(state.songsViewMode || 'card') === 'list';
  const owner = isArchiveOwner();
  const setlistEdit = owner && state.setlistEditMode;

  // archive: "곡 신청하기" 엔트리 카드(첫 페이지, 편집모드 아닐 때)
  if (state.isArchiveMode && state.page === 1 && !setlistEdit && !state.availabilityEditMode && !state.proficiencyEditMode) {
    const entry = document.createElement('div');
    entry.className = 'song-card request-entry-card';
    entry.innerHTML = `<div class="request-entry-center">곡 신청하기</div>`;
    entry.onclick = () => openPrivateRequestPanel();
    wrap.appendChild(entry);
  }

  items.forEach((c) => {
    // 개인 신청곡 카드(가짜 카드)
    if (c._privateRequest) {
      const el = document.createElement('div');
      el.className = 'song-card clickable';
      const status = String(c._requestStatus || 'pending');
      const badge = status === 'practicing' ? '신청곡 연습중' : '신청곡 대기중';
      el.innerHTML = `
        <div class="song-card-header">
          <div class="song-card-top">
            <div class="song-card-title">
              <span>${highlightHtml(c.title || '', state._lastSearchRaw)}</span>
              <span class="request-badge">${esc(badge)}</span>
            </div>
          </div>
          <div class="song-card-artist">${highlightHtml(c.artist || '', state._lastSearchRaw)}</div>
          ${c._requestMemo ? `<div class="song-card-artist" style="opacity:0.85; font-weight:900;">${esc(c._requestMemo)}</div>` : ''}
        </div>
      `;
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (owner) openPrivateRequestManage(c);
      };
      wrap.appendChild(el);
      return;
    }

    const el = document.createElement('div');
    const viewerCanComment = state.isArchiveMode && state.role === 'viewer' && state.reviewEnabled && !setlistEdit;
    const canOpen = !setlistEdit && (state.role !== 'viewer' || viewerCanComment);
    el.className = canOpen ? 'song-card clickable' : 'song-card';
    el.style.setProperty('--stagger-index', String(items.indexOf(c) % 12));
    const title = c.title || '(제목없음)';
    const cardId = String(c.cardId || `${title}::${c.artist || ''}`);
    const commentCount = Number((state.reviewThreadMap.get(cardId)?.comments || []).length || 0) || 0;
    const keyLabel = c.keyLabel || '-';
    const proficiencyLevel = Math.max(0, Math.min(3, Number(c.proficiencyLevel || 0) || 0));
    const showProficiency = state.isArchiveMode && proficiencyLevel > 0;

    // 악보없음/코드위키 placeholder 곡 배지. 대표 variant(첫 번째) 기준으로 판정한다.
    // hasScoreFile 필드 자체가 없는 기존 곡도 있으므로 반드시 !== false로 "있음"을 판정한다.
    const primaryVariant = (c.variants || [])[0];
    const cardHasScoreFile = primaryVariant?.hasScoreFile !== false;
    const scoreBadgeHtml = cardHasScoreFile
      ? ''
      : looksLikeUrl(primaryVariant?.externalLink)
        ? `<span class="score-badge score-badge-link">코드위키</span>`
        : `<span class="score-badge score-badge-none">악보없음</span>`;

    const isAdmin = state.role === 'admin';
    // 악보 연결(placeholder 승격/링크 추가): 오너 본인 또는 관리자만. 서버 권한 체크(song.scope==='private'
    // && privateOwnerId===본인 || requireAdmin)와 동일 조건이라 버튼이 보이면 실제로도 호출 가능하다.
    const canAttachFile = !cardHasScoreFile && (isArchiveOwner() || isAdmin);
    const users = state.isArchiveMode ? [] : Array.isArray(c.availableUsers) ? c.availableUsers : [];
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
    if (listMode) {
      const tagText = `${keyLabel}${showProficiency ? ` · ${getProficiencyLabel(proficiencyLevel)}` : ''}`;
      el.innerHTML = `
        <div class="song-list-row">
          <div class="song-list-title">
            <span class="song-list-title-text">${highlightHtml(title, state._lastSearchRaw)}</span>
            ${c.isLatest ? `<span class="new-badge">new!</span>` : ''}
            ${scoreBadgeHtml}
          </div>
          <div class="song-list-artist">${highlightHtml(c.artist || '', state._lastSearchRaw)}</div>
          <div class="song-list-tags">
            <span class="chip">${esc(tagText)}</span>
            ${
              commentCount
                ? `<button class="review-bubble-btn" type="button" data-action="reviewList" data-card-id="${esc(cardId)}" title="코멘트 보기">
                    <span aria-hidden="true">💬</span><span class="review-bubble-count">${commentCount}</span>
                  </button>`
                : ''
            }
            ${
              setlistEdit
                ? `<label class="setlist-check"><input type="checkbox" data-action="setlistCheck" /> 추가</label>`
                : ''
            }
          </div>
        </div>
      `;
    } else {
      // 카드 레이아웃(3행):
      // 1행 제목(+new) + 우측 편집
      // 2행 가수
      // 3행 가능보컬 프로필(최대 8명 +N)
      el.innerHTML = `
        <div class="song-card-header">
          <div class="song-card-top">
            <div class="song-card-title">
              <span>${highlightHtml(title, state._lastSearchRaw)}</span>
              ${c.isLatest ? `<span class="new-badge">new!</span>` : ''}
              ${scoreBadgeHtml}
            </div>
            <div class="song-card-actions">
              ${canAttachFile ? `<span class="chip edit-chip" data-action="attachFile">악보 연결</span>` : ''}
              ${
                setlistEdit
                  ? `<label class="setlist-check"><input type="checkbox" data-action="setlistCheck" /> 추가</label>`
                  : isAdmin
                    ? `<span class="chip edit-chip" data-action="editSong">편집</span>`
                    : ''
              }
              ${
                commentCount
                  ? `<button class="review-bubble-btn" type="button" data-action="reviewList" data-card-id="${esc(cardId)}" title="코멘트 보기">
                      <span aria-hidden="true">💬</span><span class="review-bubble-count">${commentCount}</span>
                    </button>`
                  : ''
              }
            </div>
          </div>
          <div class="song-card-artist">${highlightHtml(c.artist || '', state._lastSearchRaw)}</div>
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
        ${showProficiency ? `
          <div class="song-card-footer">
            <div class="song-proficiency">
              <div class="song-proficiency-label">${esc(getProficiencyLabel(proficiencyLevel))}</div>
              <div class="song-proficiency-track">
                <div class="song-proficiency-fill level-${proficiencyLevel}"></div>
              </div>
            </div>
          </div>
        ` : ''}
      `;
    }
    el.querySelector('[data-action="editSong"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSongTagModal(c);
    });

    el.querySelector('[data-action="attachFile"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAttachFileModal(c, primaryVariant);
    });

    el.querySelector('[data-action="setlistCheck"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    el.querySelector('[data-action="setlistCheck"]')?.addEventListener('change', (e) => {
      if (!setlistEdit) return;
      const cardId = String(c.cardId || `${c.title || ''}::${c.artist || ''}`);
      if (e.target.checked) state.setlistSelectedCardIds.add(cardId);
      else state.setlistSelectedCardIds.delete(cardId);
    });
    // 체크 상태 복구
    if (setlistEdit) {
      const cardId = String(c.cardId || `${c.title || ''}::${c.artist || ''}`);
      const chk = el.querySelector('[data-action="setlistCheck"]');
      if (chk) chk.checked = state.setlistSelectedCardIds.has(cardId);
    }
    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100;
      const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100;
      el.style.setProperty('--hover-x', `${x}%`);
      el.style.setProperty('--hover-y', `${y}%`);
    });

    // 코멘트 리스트 버튼
    el.querySelector('[data-action="reviewList"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      renderReviewListForCard(cardId, el);
    });

    if (canOpen) {
      el.onclick = async (e) => {
        if (viewerCanComment) {
          openReviewComposer({ cardId, title: c.title || '', artist: c.artist || '', tagText: getSetlistTagTextForCard(c) });
          return;
        }
        await runCardParticleBurst(e);
        openCardFlow(c).catch(() => {});
      };
    }
    wrap.appendChild(el);
  });
  triggerListMotion();
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

function updateProficiencyEditCount() {
  const el = $('proficiencyEditCount');
  if (!el) return;
  if (!state.proficiencyEditMode) {
    el.textContent = '';
    return;
  }
  const orig = state.proficiencyOriginalMap || new Map();
  const draft = state.proficiencyDraftMap || new Map();
  const keys = new Set([...orig.keys(), ...draft.keys()]);
  let changed = 0;
  keys.forEach((fid) => {
    if ((Number(orig.get(fid) || 0) || 0) !== (Number(draft.get(fid) || 0) || 0)) changed += 1;
  });
  el.textContent = `변경됨: ${changed}곡`;
}

// ---- 가능곡 편집모드(관리자): 곡 메타데이터 인라인 편집 ----------------------------
const CATALOG_EDIT_FIELDS = ['title', 'displayTitle', 'artist', 'key', 'genre', 'mood', 'vocal'];

function getCatalogEditOriginal(songId) {
  const id = String(songId || '').trim();
  if (!id) return null;
  return (state.songFilesAll || []).find((s) => String(s.songId || '') === id) || null;
}

// draft가 있으면 draft, 없으면 원본값
function getCatalogEditValue(songId, field) {
  const draft = state.catalogEditDraftMap.get(String(songId || ''));
  if (draft && Object.prototype.hasOwnProperty.call(draft, field)) return draft[field];
  return getCatalogEditOriginal(songId)?.[field] || '';
}

function setCatalogEditField(songId, field, value) {
  const id = String(songId || '').trim();
  if (!id || !CATALOG_EDIT_FIELDS.includes(field)) return;
  const original = getCatalogEditOriginal(id);
  if (!original) return;
  const draft = state.catalogEditDraftMap.get(id) || {};
  draft[field] = String(value ?? '').trim();
  // 원본과 완전히 같아지면 draft에서 지운다(= 저장할 변경사항 없음으로 취급)
  const stillDiffers = CATALOG_EDIT_FIELDS.some((f) => {
    const v = Object.prototype.hasOwnProperty.call(draft, f) ? draft[f] : original[f] || '';
    return String(v || '') !== String(original[f] || '');
  });
  if (stillDiffers) state.catalogEditDraftMap.set(id, draft);
  else state.catalogEditDraftMap.delete(id);
  updateCatalogEditCount();
}

function updateCatalogEditCount() {
  const el = $('catalogEditCount');
  const btn = $('catalogEditSaveBtn');
  const n = state.catalogEditDraftMap.size;
  if (el) el.textContent = state.availabilityEditMode && state.role === 'admin' && n ? `곡정보 변경: ${n}곡` : '';
  if (btn) btn.disabled = n === 0;
}

// 제목/가수가 뒤바뀐 곡을 바로잡는 스왑. "promote"는 신청곡 승격(musicbook.js 3906번 줄 부근)에서
// 이미 다른 의미로 쓰이고 있어 혼동을 피하려고 이름을 다르게 둔다.
function computeSwapTitleArtist(original, draft) {
  const cur = { ...original, ...(draft || {}) };
  const oldTitle = String(cur.title || '').trim();
  const oldDisplay = String(cur.displayTitle || '').trim();
  const oldArtist = String(cur.artist || '').trim();
  return {
    title: oldArtist,
    displayTitle: oldArtist,
    // displayTitle이 실제로 입력돼 있었다면 그게 "진짜" 제목이므로 그걸 가수 자리로 보낸다.
    // 비어있었다면(=title과 같다고 취급) title 값을 그대로 사용한다.
    artist: oldDisplay || oldTitle
  };
}

async function swapTitleArtist(songId) {
  if (state.role !== 'admin') return; // 서버도 requireAdmin으로 막지만, 클라이언트에서도 조용히 막는다
  const id = String(songId || '').trim();
  const original = getCatalogEditOriginal(id);
  if (!id || !original) return;
  const draft = state.catalogEditDraftMap.get(id);
  const next = computeSwapTitleArtist(original, draft);
  const oldTitle = draft?.title ?? original.title ?? '';
  const oldArtist = draft?.artist ?? original.artist ?? '';
  if (!confirm(`제목/가수를 바꿀까요?\n제목: ${oldTitle || '(비어있음)'} → ${next.title || '(비어있음)'}\n가수: ${oldArtist || '(비어있음)'} → ${next.artist || '(비어있음)'}\n\nDrive 파일명도 함께 바뀝니다.`))
    return;
  const res = await apiJson(`/api/admin/songs/${encodeURIComponent(id)}`, 'PATCH', { ...next, renameDriveName: true });
  if (!res.ok) return toast('저장 실패');
  toast(res.renameError ? `저장됨 (파일명 변경 실패: ${res.renameError})` : '제목/가수를 바꿨습니다');
  state.catalogEditDraftMap.delete(id);
  updateCatalogEditCount();
  await loadSongFiles(true);
  applySongFilters();
}

async function saveCatalogEdits() {
  if (state.role !== 'admin') return;
  if (!state.catalogEditDraftMap.size) return;
  const btn = $('catalogEditSaveBtn');
  const entries = Array.from(state.catalogEditDraftMap.entries());
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '저장 중...';
    }
    const results = await Promise.allSettled(
      entries.map(([songId, patch]) => apiJson(`/api/admin/songs/${encodeURIComponent(songId)}`, 'PATCH', patch))
    );
    let okCount = 0;
    let failCount = 0;
    const renameErrors = [];
    results.forEach((r, i) => {
      const ok = r.status === 'fulfilled' && r.value?.ok;
      if (ok) {
        okCount += 1;
        state.catalogEditDraftMap.delete(entries[i][0]);
        if (r.value?.renameError) renameErrors.push(r.value.renameError);
      } else {
        failCount += 1;
      }
    });
    updateCatalogEditCount();
    await loadSongFiles(true);
    applySongFilters();
    if (failCount) toast(`저장 완료 ${okCount}곡 · 실패 ${failCount}곡`);
    else if (renameErrors.length) toast(`저장 완료(${okCount}곡) · 파일명 변경 실패 ${renameErrors.length}건`);
    else toast(`저장 완료(${okCount}곡)`);
  } finally {
    if (btn) {
      btn.disabled = state.catalogEditDraftMap.size === 0;
      btn.textContent = '곡정보 저장';
    }
  }
}

const CATALOG_EDIT_GENRE_OPTIONS = ['KPOP', 'JPOP', 'POP', 'OST', '기타'];
const CATALOG_EDIT_MOOD_OPTIONS = ['발라드', '락발라드', '밴드송', '댄스', '뮤지컬', '힙합', '동요'];
const CATALOG_EDIT_VOCAL_OPTIONS = ['남솔로', '여솔로', '듀엣', '그룹곡'];

function buildCatalogEditSelectHtml(field, placeholder, options, selected) {
  const opts = options
    .map((o) => `<option value="${esc(o)}" ${selected === o ? 'selected' : ''}>${esc(o)}</option>`)
    .join('');
  return `
    <select class="catalog-edit-field" data-field="${field}">
      <option value="" ${selected ? '' : 'selected'}>${esc(placeholder)}</option>
      ${opts}
    </select>
  `;
}

function buildCatalogEditFieldsHtml(s) {
  if (!s.songId) return ''; // songId 없으면 PATCH 대상 자체가 없음(구 데이터 방어)
  const v = (field) => getCatalogEditValue(s.songId, field);
  return `
    <div class="catalog-edit-fields" data-song-id="${esc(s.songId)}">
      <div class="catalog-edit-row">
        <input class="catalog-edit-field" data-field="title" placeholder="제목" value="${esc(v('title'))}" />
        <input class="catalog-edit-field" data-field="artist" placeholder="가수" value="${esc(v('artist'))}" />
        <button type="button" class="catalog-edit-swap-btn" title="제목/가수 순서 바꾸기">⇄</button>
      </div>
      <div class="catalog-edit-row">
        <input class="catalog-edit-field" data-field="displayTitle" placeholder="표시제목(옵션)" value="${esc(v('displayTitle'))}" />
        <input class="catalog-edit-field catalog-edit-field-key" data-field="key" placeholder="조성(옵션)" value="${esc(v('key'))}" />
      </div>
      <div class="catalog-edit-row">
        ${buildCatalogEditSelectHtml('genre', '장르(비움)', CATALOG_EDIT_GENRE_OPTIONS, v('genre'))}
        ${buildCatalogEditSelectHtml('mood', '분위기(비움)', CATALOG_EDIT_MOOD_OPTIONS, v('mood'))}
        ${buildCatalogEditSelectHtml('vocal', '보컬(비움)', CATALOG_EDIT_VOCAL_OPTIONS, v('vocal'))}
      </div>
      <label class="inline-check catalog-edit-rename-check">
        <input type="checkbox" data-field="renameDriveName" />
        Drive 파일명도 함께 변경
      </label>
    </div>
  `;
}

function wireCatalogEditFields(el, s) {
  if (!s.songId) return;
  const fieldsEl = el.querySelector('.catalog-edit-fields');
  if (!fieldsEl) return;
  fieldsEl.querySelectorAll('[data-field]').forEach((input) => {
    const field = input.dataset.field;
    const eventName = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      if (field === 'renameDriveName') {
        const id = String(s.songId || '').trim();
        const draft = state.catalogEditDraftMap.get(id) || {};
        draft.renameDriveName = input.checked;
        state.catalogEditDraftMap.set(id, draft);
        return;
      }
      setCatalogEditField(s.songId, field, input.value);
    });
  });
  fieldsEl.querySelector('.catalog-edit-swap-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    swapTitleArtist(s.songId);
  });
}

// ---- 벌크 입력 그리드(재사용 컴포넌트) ----------------------------------------------
// 컬럼 구성을 하드코딩하지 않는다 - 이번엔 "가능곡 추가"에서 쓰지만, 다음 phase의
// 파일 업로드 미리보기 등에서도 같은 컴포넌트를 그대로 재사용할 수 있게 설계했다.
//
// container에 <table class="bulk-grid">를 그려 넣고, 아래 기능을 제공한다:
// - Tab: 다음 셀로(브라우저 기본 DOM 탭 순서로 자연히 동작 - 별도 처리 불필요)
// - Enter: 같은 열의 아래 행으로 이동
// - 붙여넣기: 탭/줄바꿈 구분 텍스트를 여러 셀에 자동으로 채움(스프레드시트 표 붙여넣기)
// - 마지막 행이 채워지면 자동으로 새 빈 행 추가(growable:false면 안 함 - 파일 드롭처럼
//   행 개수가 외부 목록에 고정되는 경우용)
// - initialRows: [{ values, tag }] - 미리 채워진 값 + 임의의 태그(예: 파일 객체 참조)로
//   행을 만들어둘 수 있다. tag는 getFilledRows()가 그대로 돌려주므로, 필터링/사용자 수정과
//   무관하게 행-외부객체 연결을 안정적으로 유지할 수 있다(Phase 4의 파일 업로드 그리드에서 사용).
function createBulkGrid(container, columns, { minRows = 4, growable = true, initialRows = null } = {}) {
  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'bulk-grid';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>${columns.map((c) => `<th>${esc(c.label || c.key)}${c.required ? '*' : ''}</th>`).join('')}<th></th></tr>`;
  const tbody = document.createElement('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);

  function rowIndexOf(tr) {
    return Array.from(tbody.children).indexOf(tr);
  }
  function colIndexOf(input) {
    return columns.findIndex((c) => c.key === input.dataset.key);
  }
  function cellInputAt(rowIdx, colIdx) {
    const tr = tbody.children[rowIdx];
    if (!tr) return null;
    return tr.children[colIdx]?.querySelector('input') || null;
  }
  function rowHasAnyValue(tr) {
    return columns.some((col) => String(tr.querySelector(`input[data-key="${col.key}"]`)?.value || '').trim());
  }

  function ensureTrailingEmptyRow() {
    if (!growable) return;
    const rows = Array.from(tbody.children);
    const last = rows[rows.length - 1];
    if (!last || rowHasAnyValue(last)) buildRow();
  }

  function wireRow(tr) {
    tr.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        tr.classList.remove('bulk-row-error');
        const statusTd = tr.querySelector('.bulk-grid-status');
        if (statusTd) statusTd.textContent = '';
        ensureTrailingEmptyRow();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        const rowIdx = rowIndexOf(tr);
        const colIdx = colIndexOf(input);
        ensureTrailingEmptyRow();
        cellInputAt(rowIdx + 1, colIdx)?.focus();
      });
      input.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text/plain') || '';
        // 셀 하나 값만 붙여넣는 흔한 경우는 브라우저 기본 동작에 맡긴다.
        if (!text || !/[\t\n]/.test(text)) return;
        e.preventDefault();
        const rowIdx = rowIndexOf(tr);
        const colIdx = colIndexOf(input);
        const lines = text.replace(/\r/g, '').split('\n');
        // 맨 끝의 빈 줄(줄바꿈으로 끝나는 붙여넣기)은 무시
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        lines.forEach((line, i) => {
          const cells = line.split('\t');
          cells.forEach((val, j) => {
            const targetColIdx = colIdx + j;
            if (targetColIdx >= columns.length) return; // 컬럼 수 넘어가는 값은 버림
            const targetRowIdx = rowIdx + i;
            // growable:false(예: 파일 바인딩 그리드)면 기존 행 범위를 벗어나는 값은 버린다 -
            // 새로 만든 행은 바인딩된 파일/태그가 없어서 의미가 없다.
            if (!growable && targetRowIdx >= tbody.children.length) return;
            while (targetRowIdx >= tbody.children.length) buildRow();
            const cell = cellInputAt(targetRowIdx, targetColIdx);
            if (cell) cell.value = val.trim();
          });
        });
        ensureTrailingEmptyRow();
      });
    });
  }

  function buildRow(initialValues, tag) {
    const tr = document.createElement('tr');
    tr._bulkGridTag = tag; // 임의 태그(예: 바인딩된 File 객체) - DOM에 직렬화되지 않는 순수 JS 참조
    columns.forEach((col) => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.key = col.key;
      input.placeholder = col.placeholder || col.label || '';
      if (initialValues && initialValues[col.key] !== undefined) input.value = String(initialValues[col.key] || '');
      td.appendChild(input);
      tr.appendChild(td);
    });
    const statusTd = document.createElement('td');
    statusTd.className = 'bulk-grid-status';
    tr.appendChild(statusTd);
    tbody.appendChild(tr);
    wireRow(tr);
    return tr;
  }

  if (Array.isArray(initialRows) && initialRows.length) {
    initialRows.forEach((r) => buildRow(r?.values, r?.tag));
  } else {
    for (let i = 0; i < Math.max(1, minRows); i += 1) buildRow();
  }

  // 값이 하나라도 채워진 행만 { tr, values, tag } 형태로 반환한다.
  // growable 그리드는 반환 배열의 인덱스가 곧 백엔드에 보낼 items 배열의 인덱스와 같다(row 매칭용).
  // 파일 바인딩처럼 인덱스가 필터링에 흔들리면 안 되는 경우엔 tag로 원본 객체를 직접 찾는다.
  function getFilledRows() {
    return Array.from(tbody.children)
      .map((tr) => {
        const values = {};
        columns.forEach((col) => {
          values[col.key] = String(tr.querySelector(`input[data-key="${col.key}"]`)?.value || '').trim();
        });
        return { tr, values, tag: tr._bulkGridTag };
      })
      .filter((r) => Object.values(r.values).some(Boolean));
  }

  function reset() {
    tbody.innerHTML = '';
    for (let i = 0; i < Math.max(1, minRows); i += 1) buildRow();
  }

  return { getFilledRows, ensureTrailingEmptyRow, reset };
}

const BULK_ADD_SONG_COLUMNS = [
  { key: 'title', label: '곡명', placeholder: '곡명', required: true },
  { key: 'artist', label: '아티스트', placeholder: '아티스트', required: true },
  { key: 'externalLink', label: '링크', placeholder: '링크(선택)', required: false },
  { key: 'genre', label: '장르', placeholder: '장르(선택)', required: false }
];

let bulkAddGrid = null;
function openBulkAddSongsModal() {
  if (!bulkAddGrid) {
    bulkAddGrid = createBulkGrid($('bulkAddGridWrap'), BULK_ADD_SONG_COLUMNS, { minRows: 4 });
  } else {
    bulkAddGrid.reset();
  }
  openModal('bulkAddSongsModal');
}

function bulkAddFailReasonLabel(reason) {
  if (reason === 'TITLE_REQUIRED') return '곡명을 입력해 주세요';
  if (reason === 'ARTIST_REQUIRED') return '아티스트를 입력해 주세요';
  return String(reason || '추가 실패');
}

async function submitBulkAddSongs() {
  if (!bulkAddGrid) return;
  const rows = bulkAddGrid.getFilledRows();
  if (!rows.length) return toast('입력된 곡이 없습니다.');
  const btn = $('bulkAddSubmitBtn');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '추가 중...';
    }
    const res = await apiJson('/api/private-book/available-songs/bulk', 'POST', {
      items: rows.map((r) => r.values)
    });
    if (!res.ok) return toast(res.error === 'FORBIDDEN' ? '개인 노래책 오너만 추가할 수 있어요.' : '추가 실패');

    (res.created || []).forEach((c) => {
      rows[c.row]?.tr.remove();
      // 백엔드가 이미 이 곡을 available:true로 저장했다(bulkUpsertAvailability). 프론트의
      // 가능곡 체크 draft/original/캐시에도 반영해야, 방금 추가한 카드가 "체크 안 됨"으로
      // 잘못 보이거나 - 반영 안 하면 나중에 저장 버튼을 눌러도 diff가 없어서 아무 일도
      // 안 일어나는데 겉보기엔 이미 체크돼 보이는 - 혼란이 생기지 않는다.
      if (state.availabilityDraftSet) state.availabilityDraftSet.add(c.googleFileId);
      if (state.availabilityOriginalSet) state.availabilityOriginalSet.add(c.googleFileId);
      if (state.myAvailabilitySet) state.myAvailabilitySet.add(c.googleFileId);
    });
    (res.failed || []).forEach((f) => {
      const row = rows[f.row];
      if (!row) return;
      row.tr.classList.add('bulk-row-error');
      const statusTd = row.tr.querySelector('.bulk-grid-status');
      if (statusTd) statusTd.textContent = bulkAddFailReasonLabel(f.reason);
    });
    bulkAddGrid.ensureTrailingEmptyRow();

    const createdCount = (res.created || []).length;
    const failedCount = (res.failed || []).length;
    if (createdCount) {
      toast(failedCount ? `${createdCount}곡 추가됨 · ${failedCount}곡 실패` : `${createdCount}곡 추가됨`);
      // 이 버튼은 항상 availabilityEditMode 중에만 보이므로, 화면은 songFilesAll 기준으로 그려진다
      // (renderAvailabilityEditCards). songCardsAll도 같이 비워서 편집모드를 나간 뒤 일반 브라우징
      // 화면으로 돌아가도 새로 추가한 곡이 바로 보이게 한다.
      state.songCardsAll = [];
      state.songFilesAll = [];
      await loadSongFiles(true);
      applySongFilters();
    } else if (failedCount) {
      toast('모두 실패했어요. 빨간 칸을 확인해 주세요.');
    }
  } catch {
    toast('추가 실패(네트워크)');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '일괄 추가';
    }
  }
}

// ---- 악보 연결(placeholder 승격 + 코드위키 링크 추가/교체) --------------------------
let _attachFileTarget = null; // { songId }

function openAttachFileModal(card, variant) {
  const songId = String(variant?.songId || '').trim();
  if (!songId) return toast('연결할 곡 정보를 찾을 수 없습니다.');
  _attachFileTarget = { songId };
  $('attachFileSubtitle').textContent = `${card.title || ''} - ${card.artist || ''}`.trim();
  if ($('attachFileInput')) $('attachFileInput').value = '';
  if ($('attachFileExternalLinkInput')) {
    // 프리필: 기존에 유효한 링크가 있었다면 그대로 두고(안 건드리면 동일 값 재저장 -> 무변화),
    // 없었으면 빈 칸으로 시작한다.
    $('attachFileExternalLinkInput').value = looksLikeUrl(variant?.externalLink) ? variant.externalLink : '';
  }
  openModal('attachFileModal');
}

async function submitAttachFile() {
  if (!_attachFileTarget?.songId) return;
  const file = $('attachFileInput')?.files?.[0];
  const externalLink = String($('attachFileExternalLinkInput')?.value || '').trim();
  if (!file && !externalLink) return toast('파일 또는 링크 중 하나는 입력해 주세요.');

  const btn = $('attachFileSubmitBtn');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '연결 중...';
    }
    const fd = new FormData();
    if (file) fd.append('file', file);
    fd.append('externalLink', externalLink);
    const res = await apiUpload(`/api/songs/${encodeURIComponent(_attachFileTarget.songId)}/attach-file`, fd);
    if (!res.ok) return toast(res.error === 'FORBIDDEN' ? '권한이 없습니다.' : `연결 실패: ${res.error || ''}`);
    toast('악보를 연결했습니다.');
    closeModal('attachFileModal');
    await refreshSongDataAfterMutation();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '연결';
    }
  }
}

// ---- 악보 업로드(드래그&드롭) -------------------------------------------------------
const UPLOAD_ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const UPLOAD_BULK_COLUMNS = [
  { key: 'title', label: '곡명', placeholder: '곡명', required: true },
  { key: 'artist', label: '아티스트', placeholder: '아티스트', required: true },
  { key: 'key', label: '조성', placeholder: '조성(선택)', required: false },
  { key: 'genre', label: '장르', placeholder: '장르(선택)', required: false }
];

function fileExtOf(name) {
  const m = String(name || '').match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : '';
}

let uploadBulkGrid = null;
let uploadDropFiles = [];
let uploadMarkAvailableForSelf = false;

// 이 화면(개인 노래책 편집 중이면 true)에 맞게 곡 목록 캐시를 비우고 재조회한다.
// saveCatalogEdits/submitBulkAddSongs와 같은 이유 - 지금 보이는 화면이 songFilesAll
// 기준(가능곡 편집모드)인지 songCardsAll 기준(일반 브라우징)인지에 따라 다른 로더를 써야 한다.
async function refreshSongDataAfterMutation() {
  state.songCardsAll = [];
  state.songFilesAll = [];
  if (state.availabilityEditMode) await loadSongFiles(true);
  else await loadSongs(true);
  applySongFilters();
}

function resetUploadDropModalUI() {
  uploadDropFiles = [];
  uploadBulkGrid = null;
  setHiddenEl($('uploadDropZone'), false);
  setHiddenEl($('uploadSingleFormWrap'), true);
  setHiddenEl($('uploadBulkGridWrap'), true);
  if ($('uploadBulkGridWrap')) $('uploadBulkGridWrap').innerHTML = '';
  setHiddenEl($('uploadDropSubmitBtn'), true);
  if ($('uploadDropFileInput')) $('uploadDropFileInput').value = '';
  ['uploadSingleTitle', 'uploadSingleArtist', 'uploadSingleKey', 'uploadSingleGenre'].forEach((id) => {
    if ($(id)) $(id).value = '';
  });
}

function openUploadDropModal({ markAvailableForSelf = false } = {}) {
  uploadMarkAvailableForSelf = Boolean(markAvailableForSelf);
  resetUploadDropModalUI();
  openModal('uploadDropModal');
}

async function handleUploadFilesSelected(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  const invalid = files.filter((f) => !UPLOAD_ALLOWED_EXT.has(fileExtOf(f.name)));
  const valid = files.filter((f) => UPLOAD_ALLOWED_EXT.has(fileExtOf(f.name)));
  if (invalid.length) toast(`지원하지 않는 형식이라 제외됨: ${invalid.map((f) => f.name).join(', ')}`);
  if (!valid.length) return;

  uploadDropFiles = valid;
  setHiddenEl($('uploadDropZone'), true);
  setHiddenEl($('uploadDropSubmitBtn'), false);

  if (valid.length === 1) {
    const f = valid[0];
    setHiddenEl($('uploadSingleFormWrap'), false);
    if ($('uploadSingleFileName')) $('uploadSingleFileName').textContent = f.name;
    // 파일명에서 title/key/artist 기본값을 미리 채워준다(driveSync가 이미 쓰는 파서 그대로 재사용).
    const res = await apiJson('/api/songs/parse-filenames', 'POST', { filenames: [f.name] });
    const parsed = res?.items?.[0];
    if ($('uploadSingleTitle')) $('uploadSingleTitle').value = parsed?.title || '';
    if ($('uploadSingleArtist')) $('uploadSingleArtist').value = parsed?.artist || '';
    if ($('uploadSingleKey')) $('uploadSingleKey').value = parsed?.key || '';
  } else {
    setHiddenEl($('uploadBulkGridWrap'), false);
    const res = await apiJson('/api/songs/parse-filenames', 'POST', { filenames: valid.map((f) => f.name) });
    const items = res?.items || [];
    const initialRows = valid.map((f, i) => ({
      values: { title: items[i]?.title || '', artist: items[i]?.artist || '', key: items[i]?.key || '', genre: '' },
      tag: f // 원본 File 객체를 행에 그대로 매달아둔다(인덱스 필터링에 흔들리지 않음)
    }));
    uploadBulkGrid = createBulkGrid($('uploadBulkGridWrap'), UPLOAD_BULK_COLUMNS, { growable: false, initialRows });
  }
}

async function submitUploadDrop() {
  if (!uploadDropFiles.length) return;
  const btn = $('uploadDropSubmitBtn');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '업로드 중...';
    }
    if (uploadDropFiles.length === 1) {
      const title = String($('uploadSingleTitle')?.value || '').trim();
      const artist = String($('uploadSingleArtist')?.value || '').trim();
      if (!title) return toast('곡명을 입력해 주세요.');
      if (!artist) return toast('아티스트를 입력해 주세요.');
      const fd = new FormData();
      fd.append('file', uploadDropFiles[0]);
      fd.append('title', title);
      fd.append('artist', artist);
      fd.append('key', String($('uploadSingleKey')?.value || '').trim());
      fd.append('genre', String($('uploadSingleGenre')?.value || '').trim());
      if (uploadMarkAvailableForSelf) fd.append('markAvailableForSelf', 'true');
      const res = await apiUpload('/api/songs/upload', fd);
      if (!res.ok) return toast(`업로드 실패: ${res.error || ''}`);
      toast('업로드 완료');
      closeModal('uploadDropModal');
      await refreshSongDataAfterMutation();
      return;
    }

    if (!uploadBulkGrid) return;
    const rows = uploadBulkGrid.getFilledRows();
    if (!rows.length) return toast('입력된 곡이 없습니다.');
    const fd = new FormData();
    const meta = [];
    rows.forEach((r) => {
      fd.append('files', r.tag);
      meta.push({ title: r.values.title, artist: r.values.artist, key: r.values.key, genre: r.values.genre });
    });
    fd.append('meta', JSON.stringify(meta));
    if (uploadMarkAvailableForSelf) fd.append('markAvailableForSelf', 'true');
    const res = await apiUpload('/api/songs/upload/bulk', fd);
    if (!res.ok) return toast(`업로드 실패: ${res.error || ''}`);

    (res.created || []).forEach((c) => {
      rows[c.row]?.tr.remove();
    });
    (res.failed || []).forEach((f) => {
      const row = rows[f.row];
      if (!row) return;
      row.tr.classList.add('bulk-row-error');
      const statusTd = row.tr.querySelector('.bulk-grid-status');
      if (statusTd) statusTd.textContent = bulkAddFailReasonLabel(f.reason);
    });

    const createdCount = (res.created || []).length;
    const failedCount = (res.failed || []).length;
    if (createdCount) {
      toast(failedCount ? `${createdCount}곡 업로드됨 · ${failedCount}곡 실패` : `${createdCount}곡 업로드됨`);
      await refreshSongDataAfterMutation();
      if (!failedCount) closeModal('uploadDropModal');
    } else if (failedCount) {
      toast('모두 실패했어요. 빨간 칸을 확인해 주세요.');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '업로드';
    }
  }
}

function wireUploadDropZone() {
  const zone = $('uploadDropZone');
  const input = $('uploadDropFileInput');
  if (!zone || !input) return;
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleUploadFilesSelected(input.files));
  ['dragenter', 'dragover'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');
    })
  );
  zone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files?.length) handleUploadFilesSelected(files);
  });
}

function renderAvailabilityEditCards(hideTags) {
  const wrap = $('songCardList');
  wrap.innerHTML = '';
  applySongsViewMode();

  const totalPages = Math.max(1, Math.ceil(state.songFilesFiltered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const items = state.songFilesFiltered.slice(start, start + state.pageSize);

  const userId = state.userId || '';
  const set = state.availabilityDraftSet || state.myAvailabilitySet;
  const isAdmin = state.role === 'admin';

  items.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'song-card';
    el.style.setProperty('--stagger-index', String(items.indexOf(s) % 12));
    const title = s.displayTitle || s.title || '(제목없음)';
    const checked = !!(set && set.has(s.googleFileId));
    el.innerHTML = `
      <div class="song-card-header">
        <div>
          <div class="song-card-title">${highlightHtml(title, state._lastSearchRaw)} ${s.isLatest ? `<span class="new-badge">new!</span>` : ''}</div>
          <div class="song-card-artist">${highlightHtml(s.artist || '', state._lastSearchRaw)}</div>
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
      ${isAdmin ? buildCatalogEditFieldsHtml(s) : ''}
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
    if (isAdmin) wireCatalogEditFields(el, s);
    wrap.appendChild(el);
  });
  triggerListMotion();
}

function setDraftProficiency(googleFileId, level) {
  if (!state.proficiencyDraftMap) state.proficiencyDraftMap = new Map();
  state.proficiencyDraftMap.set(String(googleFileId || ''), Math.max(0, Math.min(3, Number(level || 0) || 0)));
}

function renderProficiencyEditCards(hideTags) {
  const wrap = $('songCardList');
  wrap.innerHTML = '';
  applySongsViewMode();

  const totalPages = Math.max(1, Math.ceil(state.songFilesFiltered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const items = state.songFilesFiltered.slice(start, start + state.pageSize);
  const profMap = state.proficiencyDraftMap || state.myAvailabilityProficiencyMap || new Map();

  items.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'song-card';
    el.style.setProperty('--stagger-index', String(items.indexOf(s) % 12));
    const title = s.displayTitle || s.title || '(제목없음)';
    const current = Math.max(0, Math.min(3, Number(profMap.get(String(s.googleFileId || '')) || 0) || 0));
    el.innerHTML = `
      <div class="song-card-header">
        <div>
          <div class="song-card-title">${highlightHtml(title, state._lastSearchRaw)} ${s.isLatest ? `<span class="new-badge">new!</span>` : ''}</div>
          <div class="song-card-artist">${highlightHtml(s.artist || '', state._lastSearchRaw)}</div>
        </div>
        <div class="song-card-right">
          <div class="song-proficiency-label" style="position:static;">${esc(getProficiencyLabel(current))}</div>
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
      <div class="song-card-footer">
        <div class="song-proficiency">
          <div class="song-proficiency-track">
            <div class="song-proficiency-fill level-${current}"></div>
          </div>
        </div>
        <div class="proficiency-picker" style="margin-top:10px;">
          <button type="button" class="prof-option ${current === 1 ? 'active level-1' : ''}" data-level="1">더듬더듬</button>
          <button type="button" class="prof-option ${current === 2 ? 'active level-2' : ''}" data-level="2">보통</button>
          <button type="button" class="prof-option ${current === 3 ? 'active level-3' : ''}" data-level="3">잘할수있음</button>
        </div>
      </div>
    `;
    el.querySelectorAll('[data-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const clicked = Number(btn.dataset.level || 0) || 0;
        const next = current === clicked ? 0 : clicked;
        setDraftProficiency(s.googleFileId, next);
        updateProficiencyEditCount();
        renderProficiencyEditCards(hideTags);
      });
    });
    wrap.appendChild(el);
  });
  triggerListMotion();
}

// ---- Song tag edit (admin only) ---------------------------------------------------
let _editCard = null;
function openSongTagModal(card) {
  if (state.role === 'viewer') return toast('로그인이 필요합니다.');
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

function applySongCardTagPatchLocally(card, payload) {
  if (!card) return;
  const nextGenre = String(payload?.genre || '').trim();
  const nextMood = String(payload?.mood || '').trim();
  const nextVocal = String(payload?.vocal || '').trim();
  const cardId = String(card.cardId || '').trim();
  const title = String(card.title || '').trim();
  const artist = String(card.artist || '').trim();

  state.songCardsAll = (state.songCardsAll || []).map((c) => {
    const sameCard =
      (cardId && String(c.cardId || '').trim() === cardId) ||
      (String(c.title || '').trim() === title && String(c.artist || '').trim() === artist);
    if (!sameCard) return c;
    const next = {
      ...c,
      genre: nextGenre,
      mood: nextMood,
      vocal: nextVocal
    };
    next.searchText = `${next.title || ''} ${next.artist || ''} ${next.genre || ''} ${next.mood || ''} ${next.vocal || ''} ${
      (next.keys || []).join(' ') || ''
    }`
      .toLowerCase()
      .trim();
    next._searchNorm = normSearch(next.searchText || '');
    return next;
  });

  state.songFilesAll = (state.songFilesAll || []).map((s) => {
    const sameSong = String(s.title || '').trim() === title && String(s.artist || '').trim() === artist;
    if (!sameSong) return s;
    const next = {
      ...s,
      genre: nextGenre,
      mood: nextMood,
      vocal: nextVocal
    };
    next.searchText = `${next.title || ''} ${next.artist || ''} ${next.genre || ''} ${next.mood || ''} ${next.vocal || ''} ${next.key || ''}`
      .toLowerCase()
      .trim();
    next._searchNorm = normSearch(next.searchText || '');
    return next;
  });

  if (_editCard) {
    _editCard.genre = nextGenre;
    _editCard.mood = nextMood;
    _editCard.vocal = nextVocal;
  }
}

async function saveSongTagModal() {
  if (!_editCard) return;
  const saveBtn = $('songTagSaveBtn');
  if (saveBtn?.disabled) return;
  const payload = {
    genre: $('songGenreSelect').value || '',
    mood: $('songMoodSelect').value || '',
    vocal: $('songVocalSelect').value || ''
  };
  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
    }
    const res = await apiJson(`/api/songs/card-tags`, 'PATCH', { title: _editCard.title, artist: _editCard.artist, ...payload });
    if (!res.ok) return toast(`저장 실패: ${res.error || ''}`);
    applySongCardTagPatchLocally(_editCard, payload);
    closeModal('songTagModal');
    _editCard = null;
    $('songKeySelect').disabled = false;
    applySongFilters();
    toast('저장 완료');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  }
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

  // 악보없음/코드위키 placeholder 곡 분기 + (Phase 4) 악보 있는 곡에 코드위키 링크가 같이 붙은 경우.
  // variant.hasScoreFile !== false(기존 곡, 링크 없음)면 externalLink 관련 두 요소가 전부 숨겨져서
  // 기존 동작(드라이브 링크 복사/세션뷰어) 그대로 나간다 - 이 케이스의 분기 자체는 안 건드림.
  const hasScoreFile = variant?.hasScoreFile !== false;
  const hasExternalLink = looksLikeUrl(variant?.externalLink);
  setHiddenEl($('songActionScoreRow'), !hasScoreFile);
  // 악보가 있어도 코드위키 링크가 있으면 "외부 링크 열기"를 추가로 보여준다(기존 버튼 대체 아님).
  setHiddenEl($('songActionExternalRow'), !hasExternalLink);
  setHiddenEl($('songActionNoScoreNotice'), !(!hasScoreFile && !hasExternalLink));

  openModal('songActionModal');
}

function setHiddenEl(el, hidden) {
  if (!el) return;
  el.style.display = hidden ? 'none' : '';
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
  const targetUrl = viewerUrl({
    fileId: v.googleFileId,
    roomCode,
    bookUserId: state.isArchiveMode && state.archiveTargetUserId ? state.archiveTargetUserId : ''
  });
  if (roomCode && state.isPageTurner) {
    state._socket?.emit?.('session:follow:file', { roomCode, fileId: v.googleFileId, originalLink: v.driveUrl || '' }, () => {
      window.location.href = targetUrl;
    });
  } else {
    window.location.href = targetUrl;
  }
}

function renderPager() {
  const total = state.availabilityEditMode || state.proficiencyEditMode ? state.songFilesFiltered.length : state.songCardsFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const pageInfo = $('pageInfo');
  if (pageInfo && pageInfo.dataset.editing !== '1') {
    pageInfo.textContent = `${state.page} / ${totalPages}`;
  }
  $('prevPageBtn').disabled = state.page <= 1;
  $('nextPageBtn').disabled = state.page >= totalPages;
  updateArchiveStatusCard();
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
  if ($('adminConsoleBtn')) $('adminConsoleBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  $('profileButton').style.display = isPriv ? 'inline-flex' : 'none';
  // archive-only: 노래책 설정(본인 private만)
  try {
    const isOwner = state.isArchiveMode && String(state.userId || '') === String(state.archiveTargetUserId || '');
    const canSettings = state.isArchiveMode && state.archiveAuthorized && !state.archiveViewOnly && Boolean(state.hasPublicBook) && isOwner;
    const btn = $('bookSettingsBtn');
    if (btn) btn.style.display = canSettings ? 'inline-flex' : 'none';
  } catch {}
  renderSetlistPanel();
  $('requestManageToggleBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  const canEditArchiveAvailability =
    state.isArchiveMode && !state.archiveViewOnly && Boolean(state.hasPublicBook) && String(state.userId || '') === String(state.archiveTargetUserId || '');
  $('availabilityEditToggleBtn').style.display = state.isArchiveMode ? (canEditArchiveAvailability ? 'inline-flex' : 'none') : isPriv ? 'inline-flex' : 'none';
  // 가능곡 편집모드 안의 곡정보 인라인 편집(관리자 전용) — 버튼 자체는 availabilityEditBar가
  // 숨겨져 있으면 같이 안 보이므로, 여기서는 role 조건만 반영한다.
  if ($('catalogEditSaveBtn')) $('catalogEditSaveBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  // 노래책에 없는 곡 벌크 추가 - 개인 노래책(private-book) 오너 전용. 메인 노래책 편집 플로우에는 노출 안 함.
  if ($('bulkAddSongsBtn')) $('bulkAddSongsBtn').style.display = canEditArchiveAvailability ? 'inline-flex' : 'none';
  // 실제 악보 파일 업로드(Drive로) - 위와 동일 조건(개인 노래책 오너 전용). 관리자는 adminUploadOpenBtn 사용.
  if ($('uploadDropOpenBtn')) $('uploadDropOpenBtn').style.display = canEditArchiveAvailability ? 'inline-flex' : 'none';
  const profBtn = $('proficiencyEditToggleBtn');
  if (profBtn) profBtn.style.display = canEditArchiveAvailability ? 'inline-flex' : 'none';
  const profFilter = $('proficiencyFilter');
  if (profFilter) profFilter.style.display = state.isArchiveMode ? 'block' : 'none';
  // (legacy) 단일 가능보컬 드롭다운은 사용하지 않음(멀티 선택 모달로 대체)

  $('clearRequestsBtn').style.display = isAdmin ? 'inline-flex' : 'none';

  $('authButton').textContent = state.role === 'viewer' ? '세션 / 관리자 로그인' : '로그아웃';
  if (!isAdmin) state.requestManageMode = false;

  renderGuestbook();

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
    const isOwnerArchive = state.isArchiveMode && String(me.user.userId || '') === String(state.archiveTargetUserId || '');
    state.role = me.user.role;
    state.displayName = me.user.displayName || me.user.userId;
    state.userId = me.user.userId || '';
    state.isPrivate = Boolean(me.user.isPrivate);
    state.hasPublicBook = Boolean(me.user.hasPublicBook || me.user.publicBookEnabled || me.user.isPrivate);
    state.privateArchivePath = String(me.user.privateArchivePath || '').trim();
    if (!state.isArchiveMode || isOwnerArchive) {
      state.archiveTheme = String(me.user.privateTheme || 'pink').trim() || state.archiveTheme || 'pink';
      state.archiveThemeCustomA = String(me.user.privateThemeCustomA || state.archiveThemeCustomA || '#f2f3ff');
      state.archiveThemeCustomB = String(me.user.privateThemeCustomB || state.archiveThemeCustomB || '#ffffff');
      state.archiveThemeCustomC = String(me.user.privateThemeCustomC || state.archiveThemeCustomC || '#6b5bff');
      // 공개 노래책 사용자면 개인 노래책 설정값을 함께 사용한다.
      if (state.hasPublicBook) state.archiveTitleImage = String(me.user.privateTitleImage || '').trim() || state.archiveTitleImage;
      if (state.hasPublicBook) state.archiveStatusTitle = String(me.user.privateStatusTitle || '').trim();
      if (state.hasPublicBook) state.archiveStatusDesc = String(me.user.privateStatusDesc || '').trim();
      if (state.hasPublicBook) state.reviewEnabled = Boolean(me.user.privateReviewEnabled);
    }
    if (state.isArchiveMode && isOwnerArchive && state.archiveTargetUserId) {
      writeThemeCache(
        state.archiveTargetUserId,
        state.archiveTheme,
        state.archiveThemeCustomA,
        state.archiveThemeCustomB,
        state.archiveThemeCustomC
      );
    }
    state.profilePhoto = me.user.profilePhoto || '';
    updateProfileImage('profilePhoto', state.profilePhoto);
    if (isOwnerArchive) {
      state.archiveDisplayName = state.displayName || state.archiveDisplayName || state.archiveTargetUserId;
      state.archiveProfilePhoto = state.profilePhoto || state.archiveProfilePhoto;
    }
  } else {
    state.role = 'viewer';
    state.displayName = '방문자';
    state.userId = '';
    state.isPrivate = false;
    state.hasPublicBook = false;
    state.privateArchivePath = '';
    state.profilePhoto = '';
    state.archiveTheme = state.archiveTheme || 'pink';
    state.songsViewMode = state.songsViewMode || 'card';
    updateProfileImage('profilePhoto', '');
  }
  // Archive access check (best-effort)
  if (state.isArchiveMode && state.archiveTargetUserId) {
    const isAdmin = state.role === 'admin';
    const isOwner = String(state.userId || '') === String(state.archiveTargetUserId || '');
    state.archiveAuthorized = true;
    state.archiveViewOnly = true;
    // 개인 노래책은 방문자/타 사용자도 읽기 가능, 본인(공개 노래책 보유자)만 편집 가능
    if (isOwner && state.hasPublicBook) state.archiveViewOnly = false;
    if (isAdmin) state.archiveViewOnly = true;
    setArchiveShellUI();
  }

  // role UI는 archiveAuthorized/archiveViewOnly 반영 후 렌더되어야 한다.
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
    const meta = await fetch(apiUrl('/api/socket/meta'), { credentials: 'include' }).then((r) => r.json());
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
  if (!res.ok) {
    // 네트워크/CORS 차단이면 사용자에게 원인을 보여준다.
    if (String(res.error || '').startsWith('NETWORK_ERROR')) return toast('로그인 요청이 차단되었습니다(네트워크/확장프로그램/CORS).');
    return toast('로그인 실패');
  }
  closeModal('loginModal');
  $('loginPw').value = '';
  await refreshSession();
  // 사파리/파이어폭스는 cross-site 쿠키(깃헙페이지 -> onrender) 저장이 차단될 수 있다.
  // 이 경우 login 응답은 ok이지만, /api/admin/me가 계속 실패하며 "로그인이 안된 것처럼" 보인다.
  if (state.role === 'viewer') {
    toast('로그인 쿠키가 저장되지 않았습니다(사파리/파폭 추적차단/타사 쿠키 설정 확인).');
    return;
  }
  // 로그인 직후에도 곡 카드 클릭/선택이 바로 활성화되도록 UI를 재렌더링한다.
  applySongFilters();
  await refreshSocketMetaAndReconnect();
  await loadAvailabilityUsersIfNeeded();
  // 아카이브 링크로 접근한 경우: 로그인 후 목록을 로드한다.
  if (state.isArchiveMode && state.archiveAuthorized) {
    state.songCardsAll = [];
    await loadSongs(true);
    applySongFilters();
  }
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
  // NEW! 배지는 "최근 1일"만 표시(도배 방지)
  const res = await apiJson('/api/admin/sync/drive', 'POST', { latestDays: 1 });
  if (!res.ok) return toast(`동기화 실패: ${res.error || ''}`);
  toast(`동기화 완료: ${res.processed}개`);
  await loadSongs(true);
  applySongFilters();
}

function openProfileModal() {
  if (state.role === 'viewer') return openModal('loginModal');
  $('profileDisplayNameInput').value = state.displayName || '';
  $('profilePhotoInput').value = state.profilePhoto || '';
  updateProfileImage('profilePreview', state.profilePhoto || '');
  $('profilePasswordBox').style.display = 'none';
  $('profileCurrentPw').value = '';
  $('profileNewPw').value = '';
  $('profileNewPw2').value = '';
  try {
    const btn = $('privateArchiveOpenBtn');
    // 개인 노래책 페이지 안에서는 "노래책 보기" 버튼을 숨긴다(자기 자신을 다시 여는 버튼 불필요)
    if (btn) btn.style.display = !state.isArchiveMode && state.hasPublicBook && state.privateArchivePath ? 'inline-flex' : 'none';
  } catch {}
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
  const displayName = $('profileDisplayNameInput').value.trim();
  const profilePhoto = $('profilePhotoInput').value.trim();
  const res = await apiJson('/api/admin/profile', 'PATCH', { displayName, profilePhoto });
  if (!res.ok) return toast('프로필 저장 실패');
  state.displayName = res.displayName || state.userId || '방문자';
  state.profilePhoto = res.profilePhoto || '';
  $('userDisplayName').textContent = state.displayName;
  updateProfileImage('profilePhoto', state.profilePhoto);
  updateProfileImage('profilePreview', state.profilePhoto);
  if (state.isArchiveMode && String(state.userId || '') === String(state.archiveTargetUserId || '')) {
    state.archiveDisplayName = state.displayName || state.archiveTargetUserId;
    state.archiveProfilePhoto = state.profilePhoto || '';
    setArchiveShellUI();
    setLoadingContext({
      titleImage: state.archiveTitleImage,
      profilePhoto: state.archiveProfilePhoto,
      displayName: state.archiveDisplayName
    });
  }
  await refreshSocketMetaAndReconnect();
  toast('프로필을 저장했습니다.');
  closeModal('profileModal');
}

async function saveBookSettings() {
  const v = String($('bookTitleImageInput')?.value || '').trim();
  const theme = String($('bookThemeSelect')?.value || 'pink').trim() || 'pink';
  const statusTitle = String($('bookStatusTitleInput')?.value || '').trim();
  const statusDesc = String($('bookStatusDescInput')?.value || '').trim();
  const reviewEnabled = Boolean($('bookReviewEnabledToggle')?.checked);
  const payload = { titleImage: v, theme, statusTitle, statusDesc, reviewEnabled };
  if (theme === 'custom') {
    payload.customA = String(state.archiveThemeCustomA || '#f2f3ff');
    payload.customB = String(state.archiveThemeCustomB || '#ffffff');
    payload.customC = String(state.archiveThemeCustomC || '#6b5bff');
  }
  const res = await apiJson('/api/private-book', 'PATCH', payload);
  if (!res.ok) return toast(`저장 실패: ${res.error || ''}`);
  state.archiveTitleImage = String(res.titleImage || '').trim();
  state.archiveTheme = String(res.theme || 'pink').trim() || 'pink';
  state.archiveThemeCustomA = String(res.customA || state.archiveThemeCustomA || '#f2f3ff');
  state.archiveThemeCustomB = String(res.customB || state.archiveThemeCustomB || '#ffffff');
  state.archiveThemeCustomC = String(res.customC || state.archiveThemeCustomC || '#6b5bff');
  if (state.isArchiveMode && state.archiveTargetUserId) {
    writeThemeCache(state.archiveTargetUserId, state.archiveTheme, state.archiveThemeCustomA, state.archiveThemeCustomB, state.archiveThemeCustomC);
  }
  state.archiveStatusTitle = String(res.statusTitle || '').trim();
  state.archiveStatusDesc = String(res.statusDesc || '').trim();
  state.reviewEnabled = Boolean(res.reviewEnabled);
  if (!state.reviewEnabled) {
    state.reviewThreads = [];
    state.reviewThreadMap = new Map();
  }
  // header + loading 갱신
  setArchiveShellUI();
  applyArchiveTheme();
  applySongFilters();
  setLoadingContext({ titleImage: state.archiveTitleImage, profilePhoto: state.archiveProfilePhoto, displayName: state.archiveDisplayName });
  toast('저장 완료');
  closeModal('bookSettingsModal');
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
  if ($('adminConsoleBtn')) {
    $('adminConsoleBtn').onclick = () => {
      try {
        // GitHub Pages(/Musicbook/public/musicbook/) 안에서 제공되는 admin 콘솔로 이동
        const url = new URL('../admin/', window.location.href).toString();
        window.open(url, '_blank');
      } catch {
        try {
          window.open('../admin/', '_blank');
        } catch {}
      }
    };
  }

  $('profileButton').onclick = () => openProfileModal();
  $('profileCancelBtn').onclick = () => closeModal('profileModal');
  $('profileSaveBtn').onclick = () => submitProfilePhoto().catch(() => {});
  $('toggleProfilePwBtn').onclick = () => toggleProfilePasswordBox();
  $('profilePwSaveBtn').onclick = () => submitPasswordChangeFromProfile().catch(() => {});
  $('privateArchiveOpenBtn').onclick = () => {
    const url = String(state.privateArchivePath || '').trim();
    if (!url) return;
    try {
      window.open(url, '_blank', 'noopener');
    } catch {
      window.location.href = url;
    }
  };
  $('profilePhotoInput').addEventListener('input', (e) => updateProfileImage('profilePreview', e.target.value.trim()));

  // private book settings (archive only)
  $('bookSettingsBtn').onclick = () => {
    try {
      $('bookTitleImageInput').value = state.archiveTitleImage || '';
      setBookThemeSelection(state.archiveTheme || 'pink');
      try {
        const a = $('customThemeA');
        const b = $('customThemeB');
        const c = $('customThemeC');
        if (a) a.value = String(state.archiveThemeCustomA || '#f2f3ff');
        if (b) b.value = String(state.archiveThemeCustomB || '#ffffff');
        if (c) c.value = String(state.archiveThemeCustomC || '#6b5bff');
        const customCard = $('customThemeCard');
        if (customCard) {
          customCard.style.setProperty('--theme-a', String(state.archiveThemeCustomA || '#f2f3ff'));
          customCard.style.setProperty('--theme-b', String(state.archiveThemeCustomB || '#ffffff'));
          customCard.style.setProperty('--theme-c', String(state.archiveThemeCustomC || '#6b5bff'));
        }
      } catch {}
      $('bookStatusTitleInput').value = state.archiveStatusTitle || '';
      $('bookStatusDescInput').value = state.archiveStatusDesc || '';
      try {
        $('bookReviewEnabledToggle').checked = Boolean(state.reviewEnabled);
      } catch {}
      const pv = $('bookTitleImagePreview');
      if (pv) {
        const u = normalizeProfilePhotoUrl(state.archiveTitleImage || '', 1200);
        pv.src = u || 'https://placehold.co/1200x400?text=NO+IMAGE';
      }
    } catch {}
    openModal('bookSettingsModal');
  };
  $('bookSettingsCancelBtn').onclick = () => closeModal('bookSettingsModal');
  $('bookSettingsSaveBtn').onclick = () => saveBookSettings().catch(() => {});
  // theme picker modal
  $('bookThemeOpenBtn').onclick = () => {
    state._themePickerPrev = {
      theme: String($('bookThemeSelect')?.value || state.archiveTheme || 'pink'),
      a: String(state.archiveThemeCustomA || '#f2f3ff'),
      b: String(state.archiveThemeCustomB || '#ffffff'),
      c: String(state.archiveThemeCustomC || '#6b5bff')
    };
    try {
      const a = $('customThemeA');
      const b = $('customThemeB');
      const c = $('customThemeC');
      if (a) a.value = state._themePickerPrev.a;
      if (b) b.value = state._themePickerPrev.b;
      if (c) c.value = state._themePickerPrev.c;
      const customCard = $('customThemeCard');
      if (customCard) {
        customCard.style.setProperty('--theme-a', state._themePickerPrev.a);
        customCard.style.setProperty('--theme-b', state._themePickerPrev.b);
        customCard.style.setProperty('--theme-c', state._themePickerPrev.c);
      }
    } catch {}
    openModal('themePickerModal');
  };
  $('themePickerCancelBtn').onclick = () => {
    try {
      const prev = state._themePickerPrev;
      if (prev?.theme) setBookThemeSelection(prev.theme);
      if (prev?.a) state.archiveThemeCustomA = prev.a;
      if (prev?.b) state.archiveThemeCustomB = prev.b;
      if (prev?.c) state.archiveThemeCustomC = prev.c;
      const customCard = $('customThemeCard');
      if (customCard) {
        customCard.style.setProperty('--theme-a', String(state.archiveThemeCustomA || '#f2f3ff'));
        customCard.style.setProperty('--theme-b', String(state.archiveThemeCustomB || '#ffffff'));
        customCard.style.setProperty('--theme-c', String(state.archiveThemeCustomC || '#6b5bff'));
      }
      setBookThemeSelection(String(prev?.theme || 'pink'));
    } catch {}
    closeModal('themePickerModal');
  };
  $('themePickerApplyBtn').onclick = () => closeModal('themePickerModal');
  document.querySelectorAll('#themePickerPalette .book-theme-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      setBookThemeSelection(String(btn.dataset.themeValue || 'pink').trim() || 'pink');
    });
  });
  // custom colors (3)
  ['customThemeA', 'customThemeB', 'customThemeC'].forEach((id) => {
    $(id)?.addEventListener?.('input', () => {
      const a = String($('customThemeA')?.value || '#f2f3ff');
      const b = String($('customThemeB')?.value || '#ffffff');
      const c = String($('customThemeC')?.value || '#6b5bff');
      state.archiveThemeCustomA = a;
      state.archiveThemeCustomB = b;
      state.archiveThemeCustomC = c;
      const customCard = $('customThemeCard');
      if (customCard) {
        customCard.style.setProperty('--theme-a', a);
        customCard.style.setProperty('--theme-b', b);
        customCard.style.setProperty('--theme-c', c);
      }
      setBookThemeSelection('custom');
    });
  });
  $('bookTitleImageInput')?.addEventListener?.('input', (e) => {
    try {
      const pv = $('bookTitleImagePreview');
      const u = normalizeProfilePhotoUrl(String(e.target?.value || '').trim(), 1200);
      if (pv) pv.src = u || 'https://placehold.co/1200x400?text=NO+IMAGE';
    } catch {}
  });

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
      // GitHub Pages(/Musicbook/public/musicbook/)에서도 동작하도록 상대 경로로 계산
      const url = new URL('../requests/', window.location.href).toString();
      window.open(url, 'requestBoard', 'width=420,height=820');
    } catch {}
  };
  $('requestHideBtn').onclick = () => {
    $('requestDock').style.display = 'none';
    $('requestShowBtn').style.display = 'inline-flex';
  };
  $('requestShowBtn').onclick = () => {
    $('requestDock').style.display = 'block';
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
    if ($('proficiencyFilter')) $('proficiencyFilter').value = '';
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
    const userId = state.isArchiveMode && state.archiveTargetUserId ? state.archiveTargetUserId : state.userId || '';
    if (!userId) return toast('로그인이 필요합니다.');
    if (state.isArchiveMode) {
      // 개인 아카이브에서는 "본인(private)"만 편집 가능
      if (state.archiveViewOnly || !state.hasPublicBook || String(state.userId || '') !== String(state.archiveTargetUserId || '')) return;
    }
    const btn = $('availabilityEditToggleBtn');
    const sp = $('availabilityEditSpinner');
    try {
      if (btn) btn.disabled = true;
      if (sp) sp.style.display = 'inline-block';
      // 편집 모드에서는 전체 곡을 봐야 한다.
      try {
        state.proficiencyEditMode = false;
        state.proficiencyOriginalMap = null;
        state.proficiencyDraftMap = null;
        $('proficiencyEditBar').style.display = 'none';
        state._forceAllSongsForEdit = true;
        await loadSongFiles(true);
      } finally {
        state._forceAllSongsForEdit = false;
      }
      await loadMyAvailabilitySet();
      state.availabilityOriginalSet = new Set(Array.from(state.myAvailabilitySet || []));
      state.availabilityDraftSet = new Set(Array.from(state.myAvailabilitySet || []));
      state.availabilityEditMode = true;
      state.availabilityHideExisting = false;
      try {
        $('availabilityHideExistingToggle').checked = false;
      } catch {}
      // 선택모드는 "최신곡" 정렬이 기본
      state.sortField = 'createdAt';
      state.sortDir = 'desc';
      updateSortControls();
      if (btn) btn.style.display = 'none';
      $('availabilityEditBar').style.display = 'flex';
      $('availabilityEditTitle').textContent = state.isArchiveMode
        ? `가능곡 편집 · ${state.archiveTargetUserId}`
        : `가능곡 선택모드 · ${state.displayName || userId}`;
      updateAvailabilityEditCount();
      updateCatalogEditCount();
      state.page = 1;
      applySongFilters();
    } finally {
      if (sp) sp.style.display = 'none';
      if (btn) btn.disabled = false;
    }
  };

  $('availabilityEditCancelBtn').onclick = async () => {
    state.availabilityEditMode = false;
    state.availabilityDraftSet = null;
    state.availabilityHideExisting = false;
    state.myAvailabilitySet = state.availabilityOriginalSet ? new Set(Array.from(state.availabilityOriginalSet)) : state.myAvailabilitySet;
    state.availabilityOriginalSet = null;
    $('availabilityEditBar').style.display = 'none';
    applyRoleUI();
    updateAvailabilityEditCount();
    updateCatalogEditCount();
    if (state.isArchiveMode) {
      // 기본 화면은 "내 가능곡만"이므로, 편집 취소 시에도 목록을 재조회해 복구한다.
      state.songCardsAll = [];
      await loadSongs(true);
    }
    applySongFilters();
    toast('취소됨');
  };

  $('availabilityEditSaveBtn').onclick = async () => {
    const userId = state.isArchiveMode && state.archiveTargetUserId ? state.archiveTargetUserId : state.userId || '';
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
    state.availabilityHideExisting = false;
    $('availabilityEditBar').style.display = 'none';
    applyRoleUI();
    updateAvailabilityEditCount();
    updateCatalogEditCount();
    if (state.isArchiveMode) {
      // 저장 후 "내 가능곡만" 목록으로 자동 복귀
      state.songCardsAll = [];
      await loadSongs(true);
    }
    applySongFilters();
    toast('저장 완료');
  };

  // 가능곡 편집모드 안에서 곡 메타데이터(제목/가수/조성/장르 등) 인라인 편집 일괄저장(관리자 전용).
  // 위 availabilityEditSaveBtn(가능곡 체크 저장)과는 완전히 별개 데이터/버튼이다.
  if ($('catalogEditSaveBtn')) $('catalogEditSaveBtn').onclick = () => saveCatalogEdits().catch(() => toast('저장 실패'));

  // 가능곡 편집모드 안에서 "노래책에 없는 곡" 벌크 추가(개인 노래책 오너 전용).
  if ($('bulkAddSongsBtn')) $('bulkAddSongsBtn').onclick = () => openBulkAddSongsModal();
  if ($('bulkAddCancelBtn')) $('bulkAddCancelBtn').onclick = () => closeModal('bulkAddSongsModal');
  if ($('bulkAddSubmitBtn')) $('bulkAddSubmitBtn').onclick = () => submitBulkAddSongs();

  // 악보 연결(placeholder 승격 + 코드위키 링크).
  if ($('attachFileCancelBtn')) $('attachFileCancelBtn').onclick = () => closeModal('attachFileModal');
  if ($('attachFileSubmitBtn')) $('attachFileSubmitBtn').onclick = () => submitAttachFile().catch(() => toast('연결 실패'));

  // 악보 업로드(드래그&드롭). 개인 노래책(가능곡 편집 중)에서는 markAvailableForSelf:true,
  // 메인 노래책(관리자)에서는 false로 연다.
  wireUploadDropZone();
  if ($('uploadDropOpenBtn')) $('uploadDropOpenBtn').onclick = () => openUploadDropModal({ markAvailableForSelf: true });
  if ($('adminUploadOpenBtn')) $('adminUploadOpenBtn').onclick = () => openUploadDropModal({ markAvailableForSelf: false });
  if ($('uploadDropCancelBtn')) $('uploadDropCancelBtn').onclick = () => closeModal('uploadDropModal');
  if ($('uploadDropSubmitBtn')) $('uploadDropSubmitBtn').onclick = () => submitUploadDrop().catch(() => toast('업로드 실패'));

  $('proficiencyEditToggleBtn').onclick = async () => {
    const userId = state.isArchiveMode && state.archiveTargetUserId ? state.archiveTargetUserId : state.userId || '';
    if (!userId) return toast('로그인이 필요합니다.');
    if (state.archiveViewOnly || !state.hasPublicBook || String(state.userId || '') !== String(state.archiveTargetUserId || '')) return;
    try {
      state.availabilityEditMode = false;
      state.availabilityOriginalSet = null;
      state.availabilityDraftSet = null;
      $('availabilityEditBar').style.display = 'none';
      state._forceAllSongsForEdit = true;
      await loadSongFiles(true);
    } finally {
      state._forceAllSongsForEdit = false;
    }
    await loadMyAvailabilitySet();
    state.proficiencyOriginalMap = new Map(Array.from(state.myAvailabilityProficiencyMap || new Map()));
    state.proficiencyDraftMap = new Map(Array.from(state.myAvailabilityProficiencyMap || new Map()));
    state.proficiencyEditMode = true;
    state.sortField = 'createdAt';
    state.sortDir = 'desc';
    updateSortControls();
    $('proficiencyEditBar').style.display = 'flex';
    updateProficiencyEditCount();
    state.page = 1;
    applySongFilters();
  };

  $('proficiencyEditCancelBtn').onclick = async () => {
    state.proficiencyEditMode = false;
    state.proficiencyDraftMap = null;
    state.myAvailabilityProficiencyMap = state.proficiencyOriginalMap
      ? new Map(Array.from(state.proficiencyOriginalMap))
      : state.myAvailabilityProficiencyMap;
    state.proficiencyOriginalMap = null;
    $('proficiencyEditBar').style.display = 'none';
    applyRoleUI();
    updateProficiencyEditCount();
    if (state.isArchiveMode) {
      state.songCardsAll = [];
      await loadSongs(true);
    }
    applySongFilters();
    toast('취소됨');
  };

  $('proficiencyEditSaveBtn').onclick = async () => {
    const userId = state.isArchiveMode && state.archiveTargetUserId ? state.archiveTargetUserId : state.userId || '';
    if (!userId) return;
    const before = state.proficiencyOriginalMap || new Map();
    const after = state.proficiencyDraftMap || new Map();
    const all = new Set([...before.keys(), ...after.keys()]);
    const items = [];
    all.forEach((fid) => {
      const b = Number(before.get(fid) || 0) || 0;
      const a = Number(after.get(fid) || 0) || 0;
      if (a !== b) items.push({ googleFileId: fid, proficiency: a });
    });
    if (items.length) {
      const res = await apiJson('/api/availability/bulk', 'POST', { userId, items });
      if (!res.ok) return toast('저장 실패');
    }
    state.myAvailabilityProficiencyMap = new Map(Array.from(after));
    state.proficiencyEditMode = false;
    state.proficiencyOriginalMap = null;
    state.proficiencyDraftMap = null;
    $('proficiencyEditBar').style.display = 'none';
    applyRoleUI();
    updateProficiencyEditCount();
    if (state.isArchiveMode) {
      state.songCardsAll = [];
      await loadSongs(true);
    }
    applySongFilters();
    toast('저장 완료');
  };

  $('availabilityHideExistingToggle').onchange = () => {
    state.availabilityHideExisting = Boolean($('availabilityHideExistingToggle')?.checked);
    state.page = 1;
    applySongFilters();
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
  ['searchInput', 'genreFilter', 'moodFilter', 'vocalFilter', 'proficiencyFilter'].forEach((id) => $(id)?.addEventListener('input', debouncedFilter));
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
    const total = state.availabilityEditMode || state.proficiencyEditMode ? state.songFilesFiltered.length : state.songCardsFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(totalPages, state.page + 1);
    applySongFilters();
  };
  $('pageInfo').ondblclick = () => {
    const host = $('pageInfo');
    if (!host || host.dataset.editing === '1') return;
    host.dataset.editing = '1';
    const total = state.availabilityEditMode || state.proficiencyEditMode ? state.songFilesFiltered.length : state.songCardsFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const input = document.createElement('input');
    input.className = 'input pageinfo-inline-input';
    input.inputMode = 'numeric';
    input.value = String(state.page || 1);
    host.textContent = '';
    host.appendChild(input);
    input.focus();
    input.select();

    const cleanup = () => {
      host.dataset.editing = '0';
      host.textContent = `${state.page} / ${totalPages}`;
    };
    const commit = () => {
      const raw = Number(String(input.value || '').trim() || 0) || 0;
      if (!raw) return cleanup();
      state.page = Math.max(1, Math.min(totalPages, raw));
      host.dataset.editing = '0';
      applySongFilters();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') cleanup();
    });
    input.addEventListener('blur', () => commit());
  };

  // view mode (card/list) - local only (for viewers too)
  $('viewCardBtn').onclick = () => {
    state.songsViewMode = 'card';
    try {
      sessionStorage.setItem('mb_songs_view_mode_v1', 'card');
    } catch {}
    updateViewModeControls();
    applySongFilters();
  };
  $('viewListBtn').onclick = () => {
    state.songsViewMode = 'list';
    try {
      sessionStorage.setItem('mb_songs_view_mode_v1', 'list');
    } catch {}
    updateViewModeControls();
    applySongFilters();
  };

  // review (viewer comment)
  $('reviewComposerCancelBtn').onclick = () => closeReviewComposer();
  $('reviewComposerSaveBtn').onclick = () => submitReviewComment().catch(() => {});
  $('reviewListCloseBtn').onclick = () => {
    const p = $('reviewListPanel');
    if (p) p.style.display = 'none';
  };

  // private requests (archive)
  $('privateRequestCloseBtn').onclick = () => closePrivateRequestPanel();
  $('privateRequestCancelBtn').onclick = () => closePrivateRequestPanel();
  $('privateRequestSearchBtn').onclick = () => searchPrivateRequestSongs().catch(() => {});
  $('privateRequestSearchInput')?.addEventListener?.('keydown', (e) => {
    if (e.key === 'Enter') searchPrivateRequestSongs().catch(() => {});
  });
  $('privateRequestSubmitBtn').onclick = () => submitPrivateRequest().catch(() => {});
  $('privateRequestManageCancelBtn').onclick = () => {
    const m = $('privateRequestManageModal');
    if (m) m.style.display = 'none';
  };
  $('privateRequestManageCopyBtn').onclick = async () => {
    const m = $('privateRequestManageModal');
    if (!m) return;
    const url = String(m.dataset.driveUrl || '').trim();
    if (!url) return toast('링크가 없습니다.');
    try {
      await navigator.clipboard.writeText(url);
      toast('링크 복사됨');
    } catch {
      toast('복사 실패(브라우저 권한 확인)');
    }
  };
  $('privateRequestManageDeleteBtn').onclick = async () => {
    const m = $('privateRequestManageModal');
    if (!m) return;
    const fid = String(m.dataset.fid || '').trim();
    if (!fid) return;
    const r = await apiJson(`/api/private-requests/${encodeURIComponent(state.archiveTargetUserId)}/${encodeURIComponent(fid)}`, 'PATCH', {
      action: 'delete'
    });
    if (!r.ok) return toast('삭제 실패');
    m.style.display = 'none';
    state.privateRequestsLoaded = false;
    await loadSongs(true);
    applySongFilters();
  };
  $('privateRequestManagePrimaryBtn').onclick = async () => {
    const m = $('privateRequestManageModal');
    if (!m) return;
    const fid = String(m.dataset.fid || '').trim();
    const status = String(m.dataset.status || 'pending');
    if (!fid) return;
    const action = status === 'practicing' ? 'promote' : 'accept';
    const r = await apiJson(`/api/private-requests/${encodeURIComponent(state.archiveTargetUserId)}/${encodeURIComponent(fid)}`, 'PATCH', {
      action
    });
    if (!r.ok) return toast('처리 실패');
    m.style.display = 'none';
    state.privateRequestsLoaded = false;
    await loadSongs(true);
    applySongFilters();
    toast(action === 'promote' ? '가능곡으로 설정됨' : '수락됨');
  };

  // setlist (archive / owner only edit)
  $('setlistFab').onclick = () => {
    if (!isArchiveOwner()) return;
    if (state.setlistEditMode) return exitSetlistEditMode(true);
    // 숨겨둔 상태에서 편집에 들어가면 패널이 보여야 한다.
    state.setlistHidden = false;
    enterSetlistEditMode();
  };
  $('setlistHideBtn').onclick = () => {
    state.setlistHidden = true;
    renderSetlistPanel();
  };
  $('setlistShowBtn').onclick = () => {
    state.setlistHidden = false;
    renderSetlistPanel();
  };
  $('setlistCancelBtn').onclick = () => exitSetlistEditMode(true);
  $('setlistClearBtn').onclick = () => {
    if (!isArchiveOwner() || !state.setlistEditMode) return;
    if (!confirm('셋리스트를 초기화할까요?')) return;
    state.setlistItems = [];
    renderSetlistPanel();
  };
  $('setlistSaveBtn').onclick = async () => {
    if (!isArchiveOwner() || !state.setlistEditMode) return;
    // 선택된 카드 → 셋리스트에 추가(중복 방지)
    const selected = Array.from(state.setlistSelectedCardIds || new Set());
    if (selected.length) {
      const existingKeys = new Set(
        (state.setlistItems || [])
          .map((x) => String(x.googleFileId || x.driveUrl || '').trim())
          .filter(Boolean)
      );
      selected.forEach((cid) => {
        const card = (state.songCardsAll || []).find((c) => String(c.cardId || '') === String(cid));
        if (!card) return;
        const v = Array.isArray(card.variants) ? card.variants[0] : null;
        const googleFileId = String(v?.googleFileId || '').trim();
        const driveUrl = String(v?.driveUrl || '').trim();
        const key = googleFileId || driveUrl;
        if (!key || existingKeys.has(key)) return;
        existingKeys.add(key);
        state.setlistItems.push({
          googleFileId,
          driveUrl,
          title: String(card.title || '').trim(),
          artist: String(card.artist || '').trim(),
          tagText: getSetlistTagTextForCard(card),
          done: false
        });
      });
    }
    await saveSetlistToServer();
    exitSetlistEditMode(false);
  };

  // resize (panel)
  (() => {
    const handle = $('setlistResizeHandle');
    const panel = $('setlistPanel');
    if (!handle || !panel) return;
    let start = null;
    const onMove = (e) => {
      if (!start) return;
      const dx = start.x - e.clientX; // left drag increases width
      const dy = start.y - e.clientY; // up drag increases height
      state.setlistPanelSize = { w: start.w + dx, h: start.h + dy };
      applySetlistPanelSize();
    };
    const onUp = () => {
      if (!start) return;
      start = null;
      try {
        localStorage.setItem('mb_setlist_panel_size_v1', JSON.stringify(state.setlistPanelSize || {}));
      } catch {}
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', (e) => {
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {}
      start = { x: e.clientX, y: e.clientY, w: panel.getBoundingClientRect().width, h: panel.getBoundingClientRect().height };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  })();

  $('sortFieldSelect').onchange = () => {
    state.sortField = String($('sortFieldSelect').value || 'createdAt');
    if (state.sortField === 'createdAt' && !state.sortDir) state.sortDir = 'desc';
    state.page = 1;
    updateSortControls();
    applySongFilters();
  };
  $('sortAscBtn').onclick = () => {
    state.sortDir = 'asc';
    state.page = 1;
    updateSortControls();
    applySongFilters();
  };
  $('sortDescBtn').onclick = () => {
    state.sortDir = 'desc';
    state.page = 1;
    updateSortControls();
    applySongFilters();
  };
  updateSortControls();

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
      window.location.href = viewerUrl({ roomCode: String(ack.roomCode || '') });
    });
  };
  $('sessionJoinBtn').onclick = () => {
    if (state.role === 'viewer') return toast('로그인된 멤버만 세션에 참여할 수 있습니다.');
    const code = (prompt('Room Code를 입력하세요:', state.sessionRoomCode || '') || '').trim().toUpperCase();
    if (!code) return;
    window.location.href = viewerUrl({ roomCode: code });
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
    // 공유 링크는 "송북"으로 보내고, 들어가서 room이 있으면 viewer로 이동하는 구조가 가장 자연스럽다.
    const url = new URL('./?room=' + encodeURIComponent(state.sessionRoomCode), window.location.href).toString();
    try {
      await navigator.clipboard.writeText(url);
      toast('세션 링크 복사됨');
    } catch {
      prompt('복사해서 공유하세요:', url);
    }
  };

  // 가능보컬 필터(AND 멀티 선택)
  if (!state.isArchiveMode) {
    $('availableVocalOpenBtn').onclick = () => openAvailableVocalModal();
    $('availableVocalCloseBtn').onclick = () => closeAvailableVocalModal();
    $('availableVocalModal')?.addEventListener('click', (e) => {
      if (e.target?.id === 'availableVocalModal') closeAvailableVocalModal();
    });
    $('availableVocalSearch')?.addEventListener('input', (e) => {
      renderAvailableVocalModalList(e.target.value || '');
    });
  }

  $('guestbookHideBtn').onclick = () => {
    $('guestbookPanel').style.display = 'none';
    $('guestbookShowBtn').style.display = state.isArchiveMode ? 'inline-flex' : 'none';
  };
  $('guestbookShowBtn').onclick = () => {
    $('guestbookPanel').style.display = 'flex';
    $('guestbookShowBtn').style.display = 'none';
    ensureGuestbookPosition();
    renderGuestbook();
  };
  $('guestbookWriteBtn').onclick = async () => {
    if (!state.isArchiveMode || !state.archiveTargetUserId) return;
    const compose = $('guestbookCompose');
    const btn = $('guestbookWriteBtn');
    if (!compose || !btn) return;
    const open = compose.dataset.open === '1';
    if (!open) {
      compose.style.display = 'flex';
      compose.dataset.open = '1';
      btn.textContent = '남기기';
      try {
        const nick = $('guestbookNicknameInput');
        if (nick && !nick.value) nick.value = String(localStorage.getItem('mb_guestbook_nick') || '').trim();
        (nick || $('guestbookContentInput'))?.focus?.();
      } catch {}
      return;
    }
    const nickname = String($('guestbookNicknameInput')?.value || '').trim();
    const content = String($('guestbookContentInput')?.value || '').trim();
    if (!nickname || !content) return toast('닉네임과 내용을 입력해 주세요.');
    const r = await apiJson(`/api/guestbook/${encodeURIComponent(state.archiveTargetUserId)}`, 'POST', { nickname, content });
    if (!r.ok) return toast('등록 실패');
    try {
      localStorage.setItem('mb_guestbook_nick', nickname);
    } catch {}
    $('guestbookContentInput').value = '';
    compose.style.display = 'none';
    compose.dataset.open = '0';
    btn.textContent = '방명록 쓰기';
    await loadGuestbook(true);
    toast('방명록을 남겼습니다.');
  };

  // action modals
  $('keySelectCancelBtn').onclick = () => closeModal('keySelectModal');
  $('songActionCancelBtn').onclick = () => closeModal('songActionModal');
  $('copyDriveLinkBtn').onclick = () => copyDriveLink().catch(() => {});
  $('openViewerBtn').onclick = () => openInViewer().catch(() => toast('열기 실패'));
  if ($('openExternalLinkBtn')) {
    $('openExternalLinkBtn').onclick = () => {
      const url = String(state._pendingVariant?.externalLink || '').trim();
      if (!looksLikeUrl(url)) return;
      window.open(url, '_blank', 'noopener,noreferrer');
      closeModal('songActionModal');
    };
  }
}

function attachSockets() {
  // UX-2(2차 감사): socket.io CDN 로드 실패 시 여기의 ReferenceError가 bootstrap
  // 전체를 중단시켜 곡 목록조차 안 떴다 — 실시간 기능만 끄고 부팅은 계속한다.
  // (_socket 사용부는 전부 `if (!socket) return` / `?.` 가드가 이미 있다)
  if (typeof io !== 'function') {
    console.warn('[musicbook] socket.io 로드 실패 — 실시간 기능(신청곡 갱신/접속자/세션) 비활성');
    return;
  }
  const nickname = getOrCreatePresenceNickname();
  const metaToken = state.metaToken || '';
  const socket = io(API_URL, { withCredentials: true, auth: { nickname, metaToken } });
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
  const saved = String(localStorage.getItem(key) || '').trim();
  if (saved && saved !== '익명') return saved;
  // 익명 금지: 자동 임시 고유 닉네임 생성(프롬프트 없음)
  const midKey = 'mb_member_id';
  let memberId = String(localStorage.getItem(midKey) || '').trim();
  if (!memberId) {
    memberId = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      localStorage.setItem(midKey, memberId);
    } catch {}
  }
  const suffix = memberId.replace(/[^a-zA-Z0-9]/g, '').slice(-4) || String(Math.random()).slice(2, 6);
  const nick = `게스트-${suffix}`;
  try {
    localStorage.setItem(key, nick);
  } catch {}
  return nick;
}

function renderPresence(items) {
  const wrap = $('presenceList');
  if (!wrap) return;
  wrap.innerHTML = '';

  const list = Array.isArray(items) ? items : [];

  // 중복 탭/브라우저로 같은 사람이 2번 뜨는 문제 완화:
  // - displayName(또는 nickname) 기준으로 병합
  // - role은 admin > session > viewer 우선
  // - 최신 ts(서버 기록)가 우선
  const roleRank = (r) => (r === 'admin' ? 3 : r === 'session' ? 2 : 1);
  const merged = new Map(); // key -> item
  list.forEach((p) => {
    const name = String(p?.displayName || p?.nickname || '').trim() || '익명';
    const role = String(p?.role || 'viewer');
    // 방문자/익명은 병합하지 않는다(카운트 정확성 + 중복 탭 감지)
    const k =
      role === 'viewer' || name === '익명'
        ? `__anon__:${String(p?.socketId || '') || String(p?.ts || '') || String(Math.random())}`
        : name.toLowerCase();
    const prev = merged.get(k);
    if (!prev) return merged.set(k, { ...p, _nameKey: name });
    const a = prev;
    const b = p;
    const keep =
      roleRank(String(b?.role || 'viewer')) > roleRank(String(a?.role || 'viewer'))
        ? b
        : roleRank(String(b?.role || 'viewer')) < roleRank(String(a?.role || 'viewer'))
          ? a
          : Number(b?.ts || 0) > Number(a?.ts || 0)
            ? b
            : a;
    const other = keep === a ? b : a;
    merged.set(k, {
      ...keep,
      _nameKey: name,
      // 보조 정보는 가능한 채우기
      displayName: keep.displayName || other.displayName || '',
      nickname: keep.nickname || other.nickname || '',
      profilePhoto: keep.profilePhoto || other.profilePhoto || ''
    });
  });

  const uniq = Array.from(merged.values());
  const viewers = uniq.filter((p) => String(p?.role || '') === 'viewer');
  const members = uniq.filter((p) => String(p?.role || '') !== 'viewer');

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
    const initial = window.mbAvatar?.initial ? window.mbAvatar.initial(n) : (n ? n.slice(0, 1) : '?');
    const bg = window.mbAvatar?.color ? window.mbAvatar.color(n) : 'rgba(0,0,0,0.18)';
    const finalPhoto = normalizeProfilePhotoUrl(photo || '', 80);
    if (finalPhoto) return `<span class="presence-avatar"><img src="${esc(finalPhoto)}" alt="" /></span>`;
    return `<span class="presence-avatar" style="background:${esc(bg)}">${esc(initial)}</span>`;
  };

  members.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'presence-item';
    el.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center;">
        ${avatarCircle(p.displayName || p.nickname || p._nameKey || '익명', p.profilePhoto)}
        <div>
          <div>${esc(p.displayName || p.nickname || p._nameKey || '익명')}</div>
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

async function loadAvailabilityUsersIfNeeded() {
  // 개인 아카이브/스텔스 문맥에서는 "가능보컬 선택" UI 자체가 없다.
  if (state.isArchiveMode) return;
  await loadAvailableVocalUsers();
}

async function bootstrap() {
  showLoading(true);
  try {
    try {
      const saved = JSON.parse(localStorage.getItem('mb_setlist_panel_size_v1') || 'null');
      if (saved && typeof saved === 'object') state.setlistPanelSize = { w: saved.w, h: saved.h };
    } catch {}
    try {
      const saved = String(sessionStorage.getItem('mb_songs_view_mode_v1') || '').trim();
      if (saved === 'card' || saved === 'list') state.songsViewMode = saved;
    } catch {}
    // archive mode detection (path-based: /public/musicbook/u/<id>)
    state.archiveTargetUserId = detectArchiveTargetUserId();
    state.isArchiveMode = Boolean(state.archiveTargetUserId);
    // 로딩 화면부터 아카이브 전용 UI/애니메이션이 적용되도록, 초기에 class를 세팅한다.
    if (state.isArchiveMode) {
      document.body.classList.add('archive-mode');
      // 로딩 화면에서도 테마가 어느 정도 보이도록, 마지막 저장된 테마를 먼저 적용(캐시).
      const cached = readThemeCache(state.archiveTargetUserId);
      if (cached?.theme) state.archiveTheme = cached.theme;
      if (cached?.customA) state.archiveThemeCustomA = cached.customA;
      if (cached?.customB) state.archiveThemeCustomB = cached.customB;
      if (cached?.customC) state.archiveThemeCustomC = cached.customC;
      applyArchiveTheme();
    }

    wireEvents();
    updateViewModeControls();
    // archive public profile (for header/loading animation)
    if (state.isArchiveMode && state.archiveTargetUserId) {
      try {
        const r = await apiGet(`/api/private-book/${encodeURIComponent(state.archiveTargetUserId)}`);
        if (r?.ok && r.user) {
          state.archiveDisplayName = String(r.user.displayName || r.user.userId || state.archiveTargetUserId);
          state.archiveProfilePhoto = String(r.user.profilePhoto || '');
          state.archiveTitleImage = String(r.user.titleImage || '');
          state.archiveTheme = String(r.user.theme || 'pink').trim() || 'pink';
          state.archiveThemeCustomA = String(r.user.customA || state.archiveThemeCustomA || '#f2f3ff');
          state.archiveThemeCustomB = String(r.user.customB || state.archiveThemeCustomB || '#ffffff');
          state.archiveThemeCustomC = String(r.user.customC || state.archiveThemeCustomC || '#6b5bff');
          state.archiveStatusTitle = String(r.user.statusTitle || '').trim();
          state.archiveStatusDesc = String(r.user.statusDesc || '').trim();
          state.reviewEnabled = Boolean(r.user.reviewEnabled);
          writeThemeCache(
            state.archiveTargetUserId,
            state.archiveTheme,
            state.archiveThemeCustomA,
            state.archiveThemeCustomB,
            state.archiveThemeCustomC
          );
          applyArchiveTheme();
          applySongsViewMode();
          setLoadingContext({
            titleImage: state.archiveTitleImage,
            profilePhoto: state.archiveProfilePhoto,
            displayName: state.archiveDisplayName
          });
        } else {
          // fallback text
          state.archiveDisplayName = state.archiveTargetUserId;
          setLoadingContext({ displayName: state.archiveDisplayName });
        }
      } catch {
        state.archiveDisplayName = state.archiveTargetUserId;
        setLoadingContext({ displayName: state.archiveDisplayName });
      }
    }

    // socket meta for role hardening
    try {
      const meta = await fetch(apiUrl('/api/socket/meta'), { credentials: 'include' }).then((r) => r.json());
      if (meta?.ok) state.metaToken = meta.token;
    } catch {}
    attachSockets();
    await refreshSession();
    if (!state.isArchiveMode) await loadMainPage();
    if (!state.isArchiveMode || state.archiveAuthorized) await loadSongs(true);
    // 파일 단위 목록은 무거우므로 필요 시(가능곡 편집 진입 시) 로드
    if (!state.isArchiveMode) await loadSongFiles(true);
    await loadAvailabilityUsersIfNeeded();
    if (state.isArchiveMode) {
      ensureGuestbookPosition();
      initGuestbookDrag();
      await loadGuestbook(true);
    }
    if (state.isArchiveMode) await loadReviews();
    if (state.isArchiveMode) await loadSetlist();
    applySongFilters();
    if (!state.isArchiveMode) await loadRequests(true);

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

// ---- Mobile bottom sheet (<=720px) -----------------------------------------------
// 좁은 화면에서 떠있는 패널(셋리스트/방명록/신청곡/접속자/세션)이 서로 겹치는 문제를
// 하단 시트 + 탭 전환으로 해결한다. 데스크톱(>720px)에서는 아무 것도 하지 않는다.
//
// 설계 메모:
// - 패널들은 저장된 드래그 위치/리사이즈 크기를 인라인 style로 되살린다. 인라인은
//   스타일시트를 이기므로, 시트 모드의 위치/크기는 CSS에서 !important로 강제한다.
// - 시트 모드에서는 탭 바가 "어떤 패널을 보여줄지"의 단일 진실 공급원이다.
//   따라서 개별 숨기기/보이기 버튼은 CSS로 감춘다.
(function initMobileSheet() {
  const MQ = window.matchMedia('(max-width: 720px)');

  // id -> { label, display: 표시할 때 쓸 display 값 }
  const PANELS = {
    setlistPanel: { label: '셋리스트', display: 'flex' },
    guestbookPanel: { label: '방명록', display: 'flex' },
    requestDock: { label: '신청곡', display: 'block' },
    presencePanel: { label: '접속자', display: 'block' },
    sessionPanel: { label: '세션', display: 'block' }
  };

  let tabsEl = null;
  let activeId = '';
  let applying = false; // MutationObserver 재진입 방지

  // 현재 모드에서 의미 있는 패널만 고른다.
  function availableIds() {
    const out = [];
    if (state.isArchiveMode) {
      const hasSetlist = (state.setlistItems || []).length > 0;
      const owner = typeof isArchiveOwner === 'function' ? isArchiveOwner() : false;
      if (hasSetlist || owner) out.push('setlistPanel');
      out.push('guestbookPanel');
    } else {
      out.push('requestDock');
      out.push('presencePanel');
      if (state.sessionRoomCode) out.push('sessionPanel');
    }
    return out.filter((id) => document.getElementById(id));
  }

  function ensureTabs() {
    if (tabsEl) return tabsEl;
    tabsEl = document.createElement('nav');
    tabsEl.className = 'mb-sheet-tabs';
    tabsEl.id = 'mbSheetTabs';
    document.body.appendChild(tabsEl);
    return tabsEl;
  }

  function applyVisibility(ids) {
    applying = true;
    try {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('mb-sheet-panel');
        el.style.display = id === activeId ? PANELS[id].display : 'none';
      });
    } finally {
      applying = false;
    }
  }

  function renderTabs(ids) {
    const bar = ensureTabs();
    bar.innerHTML = '';
    ids.forEach((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mb-sheet-tab' + (id === activeId ? ' active' : '');
      btn.textContent = PANELS[id].label;
      btn.onclick = () => {
        activeId = activeId === id ? '' : id; // 같은 탭을 다시 누르면 접는다
        refresh();
        if (id === 'presencePanel' && activeId === id) state._socket?.emit?.('presence:refresh');
        if (id === 'guestbookPanel' && activeId === id && typeof renderGuestbook === 'function') renderGuestbook();
      };
      bar.appendChild(btn);
    });
  }

  function teardown() {
    document.body.classList.remove('mb-sheet');
    if (tabsEl) tabsEl.innerHTML = '';
    applying = true;
    try {
      Object.keys(PANELS).forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('mb-sheet-panel');
        el.style.display = '';
      });
    } finally {
      applying = false;
    }
  }

  function refresh() {
    if (!MQ.matches) {
      if (document.body.classList.contains('mb-sheet')) teardown();
      return;
    }
    document.body.classList.add('mb-sheet');
    const ids = availableIds();
    if (activeId && !ids.includes(activeId)) activeId = '';
    applyVisibility(ids);
    renderTabs(ids);
  }

  // 앱 로직이 패널 display를 다시 건드리면 시트 상태를 복구한다.
  const observer = new MutationObserver(() => {
    if (applying || !MQ.matches) return;
    refresh();
  });
  Object.keys(PANELS).forEach((id) => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['style'] });
  });

  MQ.addEventListener('change', refresh);
  window.addEventListener('resize', refresh);
  window.mbSheetRefresh = refresh;
  refresh();
})();
