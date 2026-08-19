/**
 * Drive 파일명 정규화:
 * - 목표: "곡제목(조성)-아티스트" 형태로 DB에 저장
 * - 역배열 케이스("아티스트-곡제목(조성)")도, 괄호 안 조성이 있으면 자동으로 뒤집음
 * - 조성은 (Ab, A, A#, Bb ... G#) 형태만 온다는 전제(사용자 확정)
 *
 * 반환: { title, key, artist, normalized, parseError }
 */
// (Eb), (D#), (Gb) 같은 조성 괄호를 폭넓게 인식:
// - 소문자/대문자 모두 허용
// - ♭/♯ 같은 특수문자도 허용
// - 전각 괄호(（ ）)도 허용
const KEY_IN_PAREN_RE = /[（(]\s*([A-Ga-g])\s*([#b♯♭]?)\s*(m?)\s*[)）]/;

// DS-08(2차 감사): 기존 구현은 파일명 전체에 대한 부분 문자열 매치라서
// '단'이 "단발머리", 'MR'이 "Mr.Children", 'inst'가 "Instinct" 같은 정상 곡명에도
// 걸려 곡이 조용히 숨김 처리됐다(실측 재현). 스크랩 유입 파일명의 실제 형태는
// "아티스트-곡제목-악보바다-3단"처럼 토큰이 하이픈 세그먼트 단위로 붙으므로,
// 판정을 세그먼트 기준으로 좁힌다(차단 의도는 유지):
// - 세그먼트가 토큰과 정확히 일치하면 차단 (예: "…-3단", "…-MR", "…-피아노")
// - '악보'/'악보바다'류 출처 표기는 세그먼트 안 부분 매치 유지 (예: "…-피아노 악보")
const BAD_SEGMENT_TOKENS = new Set(
  ['악보바다', '악보', '스코어', 'score', 'sheet', '3단', '2단', '4단', '단', 'mr', 'inst', 'instrumental', '파트', '피아노', '기타', '드럼', '베이스']
);
const BAD_SEGMENT_SUBSTR_RE = /악보/; // 출처/형태 표기(부분 매치 유지 대상)

function hasBadSegmentToken(parts) {
  return parts.some((seg) => {
    const s = String(seg || '').trim().toLowerCase();
    if (!s) return false;
    if (BAD_SEGMENT_TOKENS.has(s)) return true;
    return BAD_SEGMENT_SUBSTR_RE.test(s);
  });
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function splitByLastHyphen(s) {
  const str = clean(s);
  const idx = str.lastIndexOf('-');
  if (idx < 0) return { left: str, right: '', ok: false };
  const left = clean(str.slice(0, idx));
  const right = clean(str.slice(idx + 1));
  if (!left || !right) return { left, right, ok: false };
  return { left, right, ok: true };
}

function freqOf(map, s) {
  if (!map) return 0;
  const k = clean(s).toLowerCase();
  return Number(map.get(k) || 0);
}

function normalizeKey({ letter, accidental, minorFlag } = {}) {
  const L = String(letter || '').trim();
  if (!L) return '';
  const acc = String(accidental || '').trim();
  const m = String(minorFlag || '').trim();
  const acc2 = acc === '♭' ? 'b' : acc === '♯' ? '#' : acc;
  return `${L.toUpperCase()}${acc2}${m ? 'm' : ''}`.trim();
}

function extractKeyAndStrip(text) {
  const s = clean(text);
  const m = s.match(KEY_IN_PAREN_RE);
  if (!m) return { found: false, key: '', stripped: s };
  const key = normalizeKey({ letter: m[1], accidental: m[2], minorFlag: m[3] });
  const stripped = clean(s.replace(KEY_IN_PAREN_RE, ''));
  return { found: Boolean(key), key, stripped };
}

/**
 * @param {object} args
 * @param {string} args.filenameNoExt - 확장자 제거된 파일명
 * @param {Map<string, number>} [args.artistFreqMap] - DB에서 집계한 artist 빈도(lowercase key)
 */
function normalizeSongFileName({ filenameNoExt, artistFreqMap } = {}) {
  const raw = clean(filenameNoExt);
  if (!raw) return { title: '', key: '', artist: '', normalized: '', parseError: 'EMPTY_NAME' };

  // 이상 패턴(예: 아티스트-곡제목-악보바다-3단)은 사이트 비노출 대상
  // - 하이픈 분절이 3개 이상이면서, 출처/형태 토큰이 포함된 경우
  const rawParts = raw.split('-').map((x) => clean(x)).filter(Boolean);
  if (rawParts.length >= 3 && hasBadSegmentToken(rawParts)) {
    return {
      title: '',
      key: '',
      artist: '',
      normalized: '',
      parseError: 'HIDDEN_BAD_PATTERN'
    };
  }

  // 1) 먼저 하이픈 기준으로 분리(괄호 포함 상태로)한 뒤,
  // 2) 괄호 조성이 어느 쪽(왼쪽/오른쪽)에 붙어있는지로 title/artist 방향을 결정한다.
  const { left: left0, right: right0, ok } = splitByLastHyphen(raw);
  const leftK = extractKeyAndStrip(left0);
  const rightK = extractKeyAndStrip(right0);

  if (!ok) {
    // delimiter가 없으면 기본은 제목만 저장.
    // (요구사항) 아래 케이스는 파싱 실패로 보지 않는다.
    // - "곡제목(키)" -> title=곡제목, key=키, artist=''
    // - "곡제목" -> title=곡제목, key='', artist=''
    const kOnly = extractKeyAndStrip(raw);
    const stripped = kOnly.stripped || raw;
    // "곡제목(키)"만 있는 경우
    if (kOnly.found) {
      return {
        title: stripped,
        key: kOnly.key || '',
        artist: '',
        normalized: `${stripped}//${kOnly.key || ''}//`,
        parseError: ''
      };
    }
    // 제목만 달랑 있는 경우(조성 없음)
    return {
      title: stripped,
      key: '',
      artist: '',
      normalized: `${stripped}// //`,
      parseError: ''
    };
  }

  let title = left0;
  let artist = right0;
  let key = '';
  let parseError = '';

  if (leftK.found && !rightK.found) {
    title = leftK.stripped;
    artist = right0;
    key = leftK.key;
  } else if (rightK.found && !leftK.found) {
    title = rightK.stripped;
    artist = left0;
    key = rightK.key;
  } else if (leftK.found && rightK.found) {
    // 둘 다 키가 있으면, 오른쪽을 title로 우선(아티스트-곡제목(키) 케이스가 더 흔함)
    title = rightK.stripped;
    artist = left0;
    key = rightK.key || leftK.key;
    parseError = 'AMBIGUOUS_BOTH_SIDES_HAVE_KEY';
  } else {
    // 괄호 조성이 없을 때: artist 빈도 기반 판정(동률/정보없음이면 기본=곡제목-아티스트)
    const fL = freqOf(artistFreqMap, left0);
    const fR = freqOf(artistFreqMap, right0);
    if (fL > fR) {
      artist = left0;
      title = right0;
      parseError = 'AMBIGUOUS_RESOLVED_BY_FREQUENCY';
    } else if (fR > fL) {
      artist = right0;
      title = left0;
      parseError = 'AMBIGUOUS_RESOLVED_BY_FREQUENCY';
    } else {
      // 기본값 유지(곡제목-아티스트)
      parseError = 'AMBIGUOUS_DEFAULT_TITLE_FIRST';
    }
    // title 쪽에 키가 붙어있는 경우가 있으니, 최종적으로 title에서 한번 더 키를 추출
    const k2 = extractKeyAndStrip(title);
    if (k2.found) {
      title = k2.stripped;
      key = k2.key;
    }
  }

  return {
    title: clean(title),
    key: clean(key),
    artist: clean(artist),
    normalized: `${clean(title)}//${clean(key)}//${clean(artist)}`,
    parseError
  };
}

/**
 * normalizeSongFileName()의 반대 방향: {title,key,artist} -> Drive에 올릴 파일명.
 * "곡제목(조성)-아티스트.ext" 규칙(admin.js의 rename-on-edit에서 쓰던 buildDriveName을 그대로 이식).
 *
 * @param {object} fields
 * @param {string} fields.title - displayTitle이 있으면 호출부에서 미리 title 자리에 넣어서 넘길 것
 *   (이 함수는 어느 쪽을 우선할지 모르므로 "최종적으로 파일명에 쓸 제목" 하나만 받는다).
 * @param {string} [fields.key]
 * @param {string} [fields.artist]
 * @param {string} ext - 확장자('.pdf' 또는 'pdf' 둘 다 허용). 기존 파일명에서 추출하는 로직은
 *   호출부 책임이다(업로드는 기존 파일명이 없을 수 있어 이 함수에서 강제하지 않는다).
 */
function buildSongFileName({ title, key, artist } = {}, ext) {
  const safe = (s) => String(s || '').replace(/[\\/]/g, '_').trim();
  const t = safe(String(title || '').trim() || '제목없음');
  const k = safe(key);
  const a = safe(artist);
  const base = `${t}${k ? `(${k})` : ''}${a ? `-${a}` : ''}`;
  const rawExt = String(ext || '.pdf').trim() || '.pdf';
  const normalizedExt = rawExt.startsWith('.') ? rawExt : `.${rawExt}`;
  return `${base}${normalizedExt}`;
}

module.exports = { normalizeSongFileName, buildSongFileName, KEY_IN_PAREN_RE };
