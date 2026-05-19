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

const BAD_TOKENS_RE =
  /(악보바다|악보|스코어|score|sheet|3단|2단|4단|단|MR|inst|instrumental|파트|피아노|기타|드럼|베이스)/i;

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
  if (rawParts.length >= 3 && BAD_TOKENS_RE.test(raw)) {
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
    // delimiter가 없으면 제목만으로 저장(키는 괄호에서 추출)
    const kOnly = extractKeyAndStrip(raw);
    const titleOnly = kOnly.stripped || raw;
    return {
      title: titleOnly,
      key: kOnly.key || '',
      artist: '',
      normalized: `${titleOnly}//${kOnly.key || ''}//`,
      parseError: 'FILENAME_PARSE_FAILED'
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

module.exports = { normalizeSongFileName, KEY_IN_PAREN_RE };
