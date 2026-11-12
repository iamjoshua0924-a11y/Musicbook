// 곡 태그(장르/분위기/보컬) 일괄 편집용 CSV 내보내기/가져오기.
//
// 단위는 "카드"(제목+가수 묶음)다. 노래책 화면의 태그는 카드 단위로 보이고(키 변형 파일 여러 개가
// 한 카드), 기존 편집 UI(/songs/card-tags)도 카드의 모든 파일을 같이 바꾼다. 그래서 한 행 = 한 카드이고,
// 첫 열의 ID 목록(카드에 속한 Song _id들)으로 다시 찾아간다. 제목/가수를 시트에서 고쳐도 매칭이 깨지지 않는다.
//
// DB 접근 없는 순수 함수만 둔다(테스트 가능). 실제 조회/저장은 routes/admin.js에서 한다.

const TAG_OPTIONS = {
  genre: ['KPOP', 'JPOP', 'POP', 'OST', '기타'],
  mood: ['발라드', '락발라드', '밴드송', '댄스', '뮤지컬', '힙합', '동요'],
  vocal: ['남솔로', '여솔로', '듀엣', '그룹곡']
};
const TAG_FIELDS = ['genre', 'mood', 'vocal'];
const FIELD_LABEL = { genre: '장르', mood: '분위기', vocal: '보컬' };

const EXPORT_HEADERS = ['ID(수정금지)', '제목', '가수', '조성', '파일수', '장르', '분위기', '보컬'];

// 헤더 이름 → 필드. 시트에서 헤더를 영어로 바꿔도 받아준다.
const HEADER_ALIASES = {
  ids: ['id(수정금지)', 'id', 'ids', 'songid', 'songids', '곡id'],
  title: ['제목', 'title'],
  artist: ['가수', 'artist'],
  genre: ['장르', 'genre'],
  mood: ['분위기', 'mood'],
  vocal: ['보컬', 'vocal']
};

const normHeader = (s) => String(s || '').replace(/^﻿/, '').replace(/\s+/g, '').toLowerCase();
const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// 값 정규화: 대소문자/공백 차이는 허용하고 표준 표기로 바꾼다("kpop" → "KPOP", "락 발라드" → "락발라드").
// 목록에 없는 값은 null(오류). 빈 값은 ''(태그 지우기).
function normalizeTagValue(field, raw) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  const hit = TAG_OPTIONS[field].find((opt) => squash(opt) === squash(v));
  return hit || null;
}

// CSV/TSV 파서. 따옴표 안의 쉼표/줄바꿈/"" 이스케이프 지원.
// 구분자는 첫 줄로 판단: 탭이 있으면 TSV(구글 시트/엑셀에서 복사-붙여넣기), 아니면 CSV.
function parseDelimited(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') inQ = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') inQ = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c || '').trim() !== ''));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// songs(lean 문서 배열) → 카드 목록. 노래책의 카드 묶음 규칙(표시제목||제목 + 가수, 대소문자 무시)과 같다.
// 카드의 태그 값은 노래책 화면과 같게 "처음으로 비어있지 않은 값"을 쓴다.
function groupSongsIntoCards(songs) {
  const byKey = new Map();
  (songs || []).forEach((s) => {
    const title = String(s.displayTitle || s.title || '').trim();
    const artist = String(s.artist || '').trim();
    const key = `${title.toLowerCase()}||${artist.toLowerCase()}`;
    let card = byKey.get(key);
    if (!card) {
      card = { title, artist, ids: [], keys: [], genre: '', mood: '', vocal: '' };
      byKey.set(key, card);
    }
    card.ids.push(String(s._id));
    const k = String(s.key || '').trim();
    if (k && !card.keys.includes(k)) card.keys.push(k);
    TAG_FIELDS.forEach((f) => {
      if (!card[f] && s[f]) card[f] = String(s[f]).trim();
    });
  });
  return Array.from(byKey.values()).sort(
    (a, b) => a.title.localeCompare(b.title, 'ko') || a.artist.localeCompare(b.artist, 'ko')
  );
}

// 엑셀이 한글을 깨뜨리지 않도록 UTF-8 BOM을 붙인다. 구글 시트는 BOM이 있어도 정상.
function buildExportCsv(songs) {
  const lines = [EXPORT_HEADERS.map(csvCell).join(',')];
  groupSongsIntoCards(songs).forEach((c) => {
    lines.push(
      [c.ids.join(' '), c.title, c.artist, c.keys.join('/'), c.ids.length, c.genre, c.mood, c.vocal].map(csvCell).join(',')
    );
  });
  return `﻿${lines.join('\r\n')}\r\n`;
}

// 가져오기 계획. songsById: Map<_id 문자열, lean Song>. DB를 건드리지 않고 무엇이 바뀔지만 계산한다.
// - 열이 아예 없으면 그 태그는 건드리지 않는다(부분 열만 붙여넣어도 안전)
// - 칸이 비어 있으면 그 태그를 지운다
// - 목록에 없는 값/찾을 수 없는 ID/중복 행은 그 행 전체를 건너뛰고 오류로 보고한다
function planTagImport(text, songsById) {
  const rows = parseDelimited(text);
  if (!rows.length) return { ok: false, error: 'EMPTY' };

  const header = rows[0].map(normHeader);
  const col = {};
  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[field] = idx;
  });
  if (col.ids === undefined) return { ok: false, error: 'ID_COLUMN_MISSING' };
  const presentFields = TAG_FIELDS.filter((f) => col[f] !== undefined);
  if (!presentFields.length) return { ok: false, error: 'TAG_COLUMNS_MISSING' };

  const changes = [];
  const errors = [];
  let unchanged = 0;
  const seenIds = new Set();

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    const line = r + 1; // 시트 행 번호(헤더=1행)
    const cellAt = (field) => String(cells[col[field]] ?? '');
    const label = [cellAt('title'), cellAt('artist')].filter(Boolean).join(' - ') || `(${line}행)`;

    const ids = cellAt('ids')
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!ids.length) {
      errors.push({ line, label, message: 'ID가 비어 있음(새 행은 추가할 수 없음)' });
      continue;
    }
    const dup = ids.find((id) => seenIds.has(id));
    if (dup) {
      errors.push({ line, label, message: '다른 행과 같은 곡 ID가 있음(중복 행)' });
      continue;
    }
    const songs = ids.map((id) => songsById.get(id)).filter(Boolean);
    if (songs.length !== ids.length) {
      errors.push({ line, label, message: `곡을 찾을 수 없음(${ids.length - songs.length}개). 내보낸 뒤 삭제/숨김 처리됐을 수 있음` });
      continue;
    }

    const next = {};
    const badValues = [];
    presentFields.forEach((f) => {
      const raw = cellAt(f);
      const v = normalizeTagValue(f, raw);
      if (v === null) badValues.push(`${FIELD_LABEL[f]} "${raw.trim()}"`);
      else next[f] = v;
    });
    if (badValues.length) {
      errors.push({ line, label, message: `허용되지 않는 값: ${badValues.join(', ')}` });
      continue;
    }
    ids.forEach((id) => seenIds.add(id));

    // 카드에 속한 파일 중 하나라도 새 값과 다르면 변경 대상(파일끼리 태그가 어긋나 있던 것도 같이 맞춰진다)
    const fieldChanges = [];
    presentFields.forEach((f) => {
      const values = songs.map((s) => String(s[f] || '').trim());
      if (values.every((v) => v === next[f])) return;
      const shown = values.find(Boolean) || '';
      fieldChanges.push({ field: f, before: shown, after: next[f], mixed: new Set(values).size > 1 });
    });
    if (!fieldChanges.length) {
      unchanged += 1;
      continue;
    }
    const first = songs[0];
    changes.push({
      line,
      ids,
      title: String(first.displayTitle || first.title || '').trim(),
      artist: String(first.artist || '').trim(),
      set: Object.fromEntries(fieldChanges.map((c) => [c.field, c.after])),
      fields: fieldChanges
    });
  }

  return { ok: true, totalRows: rows.length - 1, presentFields, changes, errors, unchanged };
}

module.exports = {
  TAG_OPTIONS,
  EXPORT_HEADERS,
  parseDelimited,
  normalizeTagValue,
  groupSongsIntoCards,
  buildExportCsv,
  planTagImport
};
