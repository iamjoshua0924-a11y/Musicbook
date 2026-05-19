/**
 * Drive 파일명 정규화:
 * - 목표: "곡제목(조성)-아티스트" 형태로 DB에 저장
 * - 역배열 케이스("아티스트-곡제목(조성)")도, 괄호 안 조성이 있으면 자동으로 뒤집음
 * - 조성은 (Ab, A, A#, Bb ... G#) 형태만 온다는 전제(사용자 확정)
 *
 * 반환: { title, key, artist, normalized, parseError }
 */
const KEY_IN_PAREN_RE =
  /\((Ab|A#|A|Bb|B|Cb|C#|C|Db|D#|D|Eb|E#|E|Fb|F#|F|Gb|G#|G)\)/;

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

  const keyMatch = raw.match(KEY_IN_PAREN_RE);
  const key = keyMatch ? keyMatch[1] : '';
  const keyIndex = keyMatch ? keyMatch.index ?? -1 : -1;
  const withoutKey = clean(keyMatch ? raw.replace(KEY_IN_PAREN_RE, '') : raw);

  const { left, right, ok } = splitByLastHyphen(withoutKey);
  if (!ok) {
    // delimiter가 없으면 제목만으로 저장(관리자 보정 대상)
    const titleOnly = withoutKey;
    return {
      title: titleOnly,
      key,
      artist: '',
      normalized: `${titleOnly}//${key}//`,
      parseError: 'FILENAME_PARSE_FAILED'
    };
  }

  let title = left;
  let artist = right;
  let parseError = '';

  if (key && keyIndex >= 0) {
    // 괄호 조성이 파일명에서 "곡제목" 쪽에 붙어있다고 가정 → 위치로 판단
    const rawLastHyphen = raw.lastIndexOf('-');
    // key가 마지막 '-' 뒤에 있으면 오른쪽이 title
    const keyOnRight = rawLastHyphen >= 0 && keyIndex > rawLastHyphen;
    if (keyOnRight) {
      title = right;
      artist = left;
    }
  } else {
    // 괄호 조성이 없을 때: artist 빈도 기반 판정(동률/정보없음이면 기본=곡제목-아티스트)
    const fL = freqOf(artistFreqMap, left);
    const fR = freqOf(artistFreqMap, right);
    if (fL > fR) {
      artist = left;
      title = right;
      parseError = 'AMBIGUOUS_RESOLVED_BY_FREQUENCY';
    } else if (fR > fL) {
      artist = right;
      title = left;
      parseError = 'AMBIGUOUS_RESOLVED_BY_FREQUENCY';
    } else {
      // 기본값 유지(곡제목-아티스트)
      parseError = 'AMBIGUOUS_DEFAULT_TITLE_FIRST';
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
