const $ = (id) => document.getElementById(id);
const setDisplay = (id, display) => {
  const el = $(id);
  if (el) el.style.display = display;
};
let syncRunning = false;
let syncPoller = null;

// TODO: Render 백엔드 배포 후 발급받은 새 주소를 여기에 입력할 예정
// (또는 public/config.js에서 window.API_URL을 설정)
const API_URL = String(window.API_URL || window.MB_API || window.location.origin || '').replace(/\/$/, '');
const apiUrl = (path) => {
  const p = String(path || '');
  if (!p) return API_URL;
  if (/^https?:\/\//i.test(p)) return p;
  return `${API_URL}${p.startsWith('/') ? '' : '/'}${p}`;
};

// 네트워크 실패/프록시 HTML 에러(502 등)에서도 항상 {ok:false,error}로 돌려줘서
// 호출부의 if (!r.ok) 분기가 사용자에게 실패를 보여줄 수 있게 한다.
async function apiGet(url) {
  try {
    const res = await fetch(apiUrl(url), { credentials: 'include' });
    try {
      return await res.json();
    } catch {
      return { ok: false, error: `HTTP_${res.status}` };
    }
  } catch (e) {
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
      return { ok: false, error: `HTTP_${res.status}` };
    }
  } catch (e) {
    return { ok: false, error: `NETWORK_ERROR:${String(e?.message || e)}` };
  }
}
const ERROR_LABELS = {
  INVALID_CREDENTIALS: '아이디 또는 비밀번호가 올바르지 않습니다.',
  UNAUTHORIZED: '로그인이 필요합니다.',
  FORBIDDEN: '권한이 없습니다(관리자 전용).',
  USER_EXISTS: '이미 존재하는 유저 ID입니다.',
  BAD_REQUEST: '입력값을 확인해 주세요.'
};
function errorLabel(code) {
  const c = String(code || '');
  if (ERROR_LABELS[c]) return ERROR_LABELS[c];
  if (c.startsWith('NETWORK_ERROR')) return '서버에 연결하지 못했습니다(네트워크/CORS).';
  if (c.startsWith('HTTP_')) return `서버 오류(${c.slice(5)})`;
  return c || '알 수 없는 오류';
}
// 처리 중 중복 클릭 방지
async function withBusy(btn, fn, busyLabel) {
  if (!btn) return fn();
  if (btn.dataset.busy === '1') return undefined;
  const prev = btn.textContent;
  btn.dataset.busy = '1';
  btn.disabled = true;
  if (busyLabel) btn.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    btn.dataset.busy = '0';
    btn.disabled = false;
    if (busyLabel) btn.textContent = prev;
  }
}

// Back link: Express(/admin/)에서 열리면 ../musicbook/ 경로는 index.html만 내려주고 css/js가 없다.
// GitHub Pages(/Musicbook/public/admin/)에서는 ../musicbook/이 맞으므로, 경로 형태로 구분한다.
try {
  const a = document.getElementById('backToSongbook');
  if (a) {
    const p = String(window.location.pathname || '');
    if (!/\/public\/admin\/?$/.test(p)) a.href = '/';
  }
} catch {}

function showAuthed(on, role = '') {
  setDisplay('loginCard', on ? 'none' : 'block');
  // CSV 임포트 기능은 더 이상 사용하지 않으므로 UI에서 제거
  // 진단/운영 콘솔은 /dev로 이관됨
  setDisplay('meCard', on ? 'block' : 'none');
  // 메인 설정/유저 관리는 서버가 requireAdmin이라 세션 멤버에게 보여줘도 전부 실패한다
  const isAdmin = role === 'admin';
  ['mainCard', 'usersCard'].forEach((id) => setDisplay(id, on && isAdmin ? 'block' : 'none'));
  setDisplay('sessionOnlyNote', on && !isAdmin ? 'block' : 'none');
  ['syncCard', 'parseErrorCard', 'trafficCard'].forEach((id) => setDisplay(id, 'none'));
}

async function refreshMe() {
  const me = await apiGet('/api/admin/me');
  if (!me.ok) {
    showAuthed(false);
    return null;
  }
  if ($('meText')) $('meText').textContent = `${me.user.userId} (${me.user.role})`;
  showAuthed(true, String(me.user.role || ''));
  return me.user;
}

async function loadUsers() {
  const out = $('usersOut');
  const wrap = $('usersList');
  if (out) out.textContent = '로딩 중...';
  // UX: 새로고침 중 리스트를 비우면 레이아웃이 접혔다 펴지며 화면이 흔들린다.
  // 기존 DOM을 유지한 채로 "로딩 상태"만 표시하고, 응답이 오면 한 번에 replace한다.
  let prevH = 0;
  try {
    if (wrap) {
      prevH = Math.round(wrap.getBoundingClientRect().height || 0);
      if (prevH > 0) wrap.style.minHeight = `${prevH}px`;
      wrap.classList.add('loading');
    }
  } catch {}
  const r = await apiGet('/api/admin/users');
  try {
    if (wrap) wrap.classList.remove('loading');
  } catch {}
  if (!r.ok) {
    if (out) out.textContent = `불러오기 실패: ${r.error || ''}`;
    try {
      if (wrap) wrap.style.minHeight = '';
    } catch {}
    return;
  }
  const items = Array.isArray(r.items) ? r.items : [];
  if (out) out.textContent = `총 ${items.length}명`;
  const frag = document.createDocumentFragment();
  items.forEach((u) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div><span class="kbd">${escapeHtml(u.userId || '')}</span> · <b>${escapeHtml(u.role || '')}</b> ${u.active === false ? '<span class="muted">(비활성)</span>' : ''}</div>
        <div class="muted">${escapeHtml(u.displayName || '')}</div>
        <div class="muted">현재 비밀번호: <span class="kbd">${escapeHtml(u.currentPasswordText || '(알 수 없음)')}</span></div>
      </div>
      <div class="row" style="justify-content:flex-end;">
        <button class="light" data-action="reset">비번 1234</button>
        <button class="light" data-action="toggle">${u.active === false ? '활성화' : '비활성'}</button>
        <button class="light" data-action="delete" style="border-color: rgba(255,107,107,0.5); color:#ffb3b3;">삭제</button>
      </div>
    `;
    el.querySelector('[data-action="reset"]').onclick = async () => {
      const rr = await apiJson(`/api/admin/users/${encodeURIComponent(u.userId)}`, 'PATCH', { password: '1234' });
      if (!rr.ok) return alert('실패');
      alert('비밀번호를 1234로 초기화했습니다.');
      await loadUsers();
    };
    el.querySelector('[data-action="toggle"]').onclick = async () => {
      const next = !(u.active === false);
      const rr = await apiJson(`/api/admin/users/${encodeURIComponent(u.userId)}`, 'PATCH', { active: !next });
      if (!rr.ok) return alert('실패');
      await loadUsers();
    };
    el.querySelector('[data-action="delete"]').onclick = async () => {
      if (!confirm(`정말 삭제할까요?\n- userId: ${u.userId}\n- 관련 가능곡(availability) 데이터도 함께 삭제됩니다.`)) return;
      const rr = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(u.userId)}`), { method: 'DELETE', credentials: 'include' }).then((x) =>
        x.json()
      );
      if (!rr.ok) return alert(`실패: ${rr.error || ''}`);
      await loadUsers();
    };
    frag.appendChild(el);
  });
  try {
    if (wrap) wrap.replaceChildren(frag);
  } catch {
    try {
      if (wrap) {
        wrap.innerHTML = '';
        wrap.appendChild(frag);
      }
    } catch {}
  }
  // 레이아웃 안정화가 끝나면 minHeight 해제
  try {
    if (wrap) setTimeout(() => (wrap.style.minHeight = ''), 0);
  } catch {}
}

async function loadMain() {
  const r = await apiGet('/api/main');
  if (!r.ok) return;
  const d = r.data;
  if ($('titleImage')) $('titleImage').value = d.titleImage || '';
  if ($('bannerImage')) $('bannerImage').value = d.bannerImage || '';
  if ($('notice')) $('notice').value = d.notice || '';
  if ($('discordUrl')) $('discordUrl').value = d.discordUrl || '';
  if ($('youtubeUrl')) $('youtubeUrl').value = d.youtubeUrl || '';
  if ($('chzzkUrl')) $('chzzkUrl').value = d.chzzkUrl || '';
}

async function saveMain() {
  const fields = ['titleImage', 'bannerImage', 'notice', 'discordUrl', 'youtubeUrl', 'chzzkUrl'];
  for (const f of fields) {
    const el = $(f);
    const v = el ? el.value : '';
    const r = await apiJson('/api/main', 'PATCH', { field: f, value: v });
    if (!r.ok) {
      if ($('mainSaveOut')) $('mainSaveOut').textContent = `저장 실패: ${r.error || ''}`;
      return;
    }
  }
  if ($('mainSaveOut')) $('mainSaveOut').textContent = '저장 완료';
  setTimeout(() => {
    if ($('mainSaveOut')) $('mainSaveOut').textContent = '';
  }, 1200);
}

async function loadDriveRoot() {
  const r = await apiGet('/api/admin/drive-root');
  if (!r.ok) return;
  if ($('rootFolderId')) $('rootFolderId').value = r.rootFolderId || '';
}

async function saveDriveRoot() {
  const rootFolderId = ($('rootFolderId')?.value || '').trim();
  const r = await apiJson('/api/admin/drive-root', 'PATCH', { rootFolderId });
  if (!r.ok) return alert('저장 실패');
  if ($('rootFolderId')) $('rootFolderId').value = r.rootFolderId || '';
}

async function syncDrive() {
  const payload = {
    rootFolderId: ($('rootFolderId')?.value || '').trim(),
    latestDays: Number($('latestDays')?.value || 30),
    limit: 7000,
    incremental: Boolean($('incrementalToggle')?.checked),
    pruneMissing: Boolean($('pruneToggle')?.checked)
  };
  const r = await apiJson('/api/admin/sync/drive', 'POST', payload);
  if ($('syncOut')) $('syncOut').textContent = JSON.stringify(r, null, 2);
  await loadSyncStatus();
}

async function loadSyncStatus() {
  const r = await apiGet('/api/admin/sync/status');
  if (!r.ok) return;
  const s = r.status;
  if (!s) {
    if ($('syncStatusLine')) $('syncStatusLine').textContent = '-';
    syncRunning = false;
    const btn = $('syncBtn');
    if (btn) btn.textContent = '동기화 실행';
    return;
  }
  // 곡 누락 진단: 폴더 조회 실패 / PDF 아님으로 건너뜀 / 숨김처리 보류 사유를 함께 표시
  const warn = [];
  if (Number(s.listFailureCount || 0) > 0) warn.push(`폴더조회실패=${s.listFailureCount}`);
  if (Number(s.skippedNonPdfCount || 0) > 0) warn.push(`PDF아님=${s.skippedNonPdfCount}`);
  if (s.pruneSkippedReason) warn.push(`숨김보류(${s.pruneSkippedReason})`);
  if (s.reachedLimit) warn.push('limit도달');
  const warnMsg = warn.length ? ` · ⚠ ${warn.join(' · ')}` : '';

  const msg = s.running
    ? `RUNNING · processed=${s.processed ?? 0} skipped=${s.skipped ?? 0}${s.currentPath ? ` · path=${s.currentPath}` : ''}${s.currentFile ? ` · file=${s.currentFile}` : ''}`
    : `endedAt=${s.endedAt || '-'} · processed=${s.processed ?? '-'} · skipped=${s.skipped ?? '-'} · hidden=${s.hiddenCount ?? '-'}${
        s.diff ? ` · +${s.diff.addedCount ?? 0} ~${s.diff.changedCount ?? 0} -${s.diff.removedCount ?? 0}` : ''
      }${warnMsg}`;
  if ($('syncStatusLine')) $('syncStatusLine').textContent = msg;
  syncRunning = Boolean(s.running);
  const btn = $('syncBtn');
  if (btn) btn.textContent = syncRunning ? '동기화 중지' : '동기화 실행';
}

function startSyncPolling() {
  if (syncPoller) return;
  syncPoller = setInterval(() => loadSyncStatus().catch(() => {}), 1200);
}
function stopSyncPolling() {
  if (!syncPoller) return;
  clearInterval(syncPoller);
  syncPoller = null;
}

async function loadParseErrors() {
  const r = await apiGet('/api/admin/songs/parse-errors?limit=200');
  if (!r.ok) return;
  const wrap = $('parseErrorList');
  if (wrap) wrap.innerHTML = '';
  if ($('parseErrorOut')) $('parseErrorOut').textContent = `총 ${r.items?.length || 0}건`;

  (r.items || []).forEach((s) => {
    const parseLabel = (() => {
      const code = String(s.parseError || '').trim();
      if (!code) return '-';
      if (code === 'EMPTY_NAME') return '제목 인식 안됨';
      if (code === 'HIDDEN_BAD_PATTERN') return '패턴 불량(숨김)';
      if (code.startsWith('AMBIGUOUS')) return '제목/가수 모호';
      if (code.startsWith('NO_HYPHEN')) return '구분자(-) 없음';
      if (code.includes('KEY')) return '조성 인식 안됨';
      return code;
    })();
    const el = document.createElement('div');
    el.className = 'item';
    el.style.alignItems = 'flex-start';
    const driveName = String(s.driveName || '').trim() || '(원본 파일명 없음)';
    const driveUrl = String(s.driveUrl || '').trim();
    el.innerHTML = `
      <div style="flex:1; display:grid; gap:6px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <b>원본파일명:</b> <span class="kbd">${escapeHtml(driveName)}</span>
          ${driveUrl ? `<a href="${escapeHtml(driveUrl)}" target="_blank" class="muted">파일 열기</a>` : ''}
        </div>
        <div class="muted"><b>오류형태:</b> ${escapeHtml(parseLabel)}</div>
        <div class="row" style="margin-top:6px;">
          <input data-k="title" placeholder="title" value="${escapeHtml(s.title || '')}" />
          <input data-k="key" placeholder="key(옵션)" value="${escapeHtml(s.key || '')}" style="max-width:110px;" />
          <input data-k="artist" placeholder="artist" value="${escapeHtml(s.artist || '')}" />
          <input data-k="displayTitle" placeholder="displayTitle(옵션)" value="${escapeHtml(s.displayTitle || '')}" />
        </div>
        <label class="muted" style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input type="checkbox" data-k="renameDriveName" checked />
          원본 파일명도 변경
        </label>
        ${s.folderPath ? `<div class="muted">${escapeHtml(s.folderPath)}</div>` : ''}
      </div>
      <div>
        <button class="light" data-action="save">저장</button>
      </div>
    `;
    el.querySelector('[data-action="save"]').onclick = async () => {
      const payload = {};
      el.querySelectorAll('input[data-k]').forEach((inp) => {
        if (inp.type === 'checkbox') payload[inp.dataset.k] = Boolean(inp.checked);
        else payload[inp.dataset.k] = inp.value;
      });
      const rr = await apiJson(`/api/admin/songs/${encodeURIComponent(s._id)}`, 'PATCH', payload);
      if (!rr.ok) return alert('저장 실패');
      if (rr.renameError) alert(`저장은 됐는데 파일명 변경 실패: ${rr.renameError}`);
      el.remove();
    };
    if (wrap) wrap.appendChild(el);
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function topFileIdsToText(map, topN = 8) {
  const entries = Object.entries(map || {})
    .map(([k, v]) => [k, Number(v?.bytes || 0), Number(v?.count || 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  if (!entries.length) return '-';
  return entries.map(([k, bytes, c]) => `${k} · ${formatBytes(bytes)} · ${c}x`).join('\n');
}

async function loadTraffic() {
  const out = $('trafficOut');
  const pre = $('trafficJson');
  if (out) out.textContent = '로딩 중...';
  if (pre) pre.textContent = '';
  const r = await apiGet('/api/admin/metrics/traffic');
  if (!r.ok) {
    if (out) out.textContent = `불러오기 실패: ${r.error || ''}`;
    return;
  }
  const d = r.data || {};
  const http = d.http || {};
  const ws = d.ws || {};

  let httpBytes = 0;
  let httpCount = 0;
  let httpRanges = 0;
  Object.values(http).forEach((m) => {
    httpBytes += Number(m?.bytes || 0);
    httpCount += Number(m?.count || 0);
    httpRanges += Number(m?.ranges || 0);
  });
  let wsBytes = 0;
  let wsCount = 0;
  Object.values(ws).forEach((m) => {
    wsBytes += Number(m?.bytes || 0);
    wsCount += Number(m?.count || 0);
  });

  if (out) out.textContent = `HTTP ${httpCount}건 / ${formatBytes(httpBytes)} (Range ${httpRanges}건) · WS ${wsCount}건 / ${formatBytes(wsBytes)}`;

  const report = {
    startedAt: d.startedAt,
    summary: {
      http: { count: httpCount, bytes: httpBytes, ranges: httpRanges },
      ws: { count: wsCount, bytes: wsBytes }
    },
    top: {
      drive_pdf: topFileIdsToText(http['drive.pdf']?.topFileIds),
      drive_embed: topFileIdsToText(http['drive.embed']?.topFileIds),
      public_pdf: topFileIdsToText(http['public.pdf']?.topFileIds),
      wb_update: topFileIdsToText(ws['wb.page.update']?.topFileIds)
    },
    http,
    ws
  };
  if (pre) pre.textContent = JSON.stringify(report, null, 2);
}

async function resetTraffic() {
  if (!confirm('트래픽 계측을 리셋할까요?')) return;
  const r = await apiJson('/api/admin/metrics/traffic/reset', 'POST', {});
  if (!r.ok) return alert('리셋 실패');
  await loadTraffic();
}

function wire() {
  const doLogin = () =>
    withBusy($('loginBtn'), async () => {
      const userId = ($('loginId')?.value || '').trim();
      const password = $('loginPw')?.value || '';
      if (!userId || !password) {
        if ($('loginOut')) $('loginOut').textContent = '아이디와 비밀번호를 입력하세요.';
        (userId ? $('loginPw') : $('loginId'))?.focus();
        return;
      }
      if ($('loginOut')) $('loginOut').textContent = '로그인 중...';
      const r = await apiJson('/api/admin/login', 'POST', { userId, password });
      if (r.ok) {
        if ($('loginOut')) $('loginOut').textContent = '로그인 완료';
        location.reload();
        return;
      }
      if ($('loginOut')) $('loginOut').textContent = `로그인 실패: ${errorLabel(r.error)}`;
      $('loginPw')?.focus();
    }, '로그인 중...');
  $('loginBtn')?.addEventListener?.('click', () => doLogin().catch(() => {}));
  ['loginId', 'loginPw'].forEach((id) =>
    $(id)?.addEventListener?.('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) doLogin().catch(() => {});
    })
  );

  $('logoutBtn')?.addEventListener?.('click', async () => {
    await apiJson('/api/admin/logout', 'POST', {});
    location.reload();
  });

  $('saveMainBtn')?.addEventListener?.('click', () =>
    withBusy($('saveMainBtn'), () => saveMain().catch(() => alert('저장 실패(네트워크)')), '저장 중...')
  );
  $('saveRootFolderBtn')?.addEventListener?.('click', () => saveDriveRoot().catch(() => {}));
  $('syncBtn')?.addEventListener?.('click', () =>
    withBusy($('syncBtn'), async () => {
      if (syncRunning) {
        const r = await apiJson('/api/admin/sync/stop', 'POST', {});
        if ($('syncOut')) $('syncOut').textContent = JSON.stringify(r, null, 2);
        await loadSyncStatus();
        return;
      }
      await syncDrive();
    })
  );
  $('reloadParseErrorsBtn')?.addEventListener?.('click', () => loadParseErrors().catch(() => {}));
  $('reloadTrafficBtn')?.addEventListener?.('click', () => loadTraffic().catch(() => {}));
  $('resetTrafficBtn')?.addEventListener?.('click', () => resetTraffic().catch(() => {}));

  $('reloadUsersBtn')?.addEventListener?.('click', () => loadUsers().catch(() => {}));
  $('createUserBtn')?.addEventListener?.('click', () =>
    withBusy($('createUserBtn'), async () => {
      const userId = ($('newUserId')?.value || '').trim();
      const role = $('newUserRole')?.value || '';
      const displayName = ($('newUserName')?.value || '').trim();
      if (!userId) return alert('userId를 입력하세요');
      const r = await apiJson('/api/admin/users', 'POST', { userId, role, displayName });
      if (!r.ok) return alert(`생성 실패: ${errorLabel(r.error)}`);
      if ($('newUserId')) $('newUserId').value = '';
      if ($('newUserName')) $('newUserName').value = '';
      alert(`생성 완료: ${userId} (PW: ${r.password || '1234'})`);
      await loadUsers();
    }, '생성 중...')
  );
}

async function boot() {
  wire();
  const me = await refreshMe();
  if (me) {
    await loadMain();
    if (me.role === 'admin') await loadUsers();
    // 진단/운영 기능은 /dev로 이관됨
    stopSyncPolling();
  } else {
    stopSyncPolling();
  }
}

boot().catch((e) => console.error(e));
