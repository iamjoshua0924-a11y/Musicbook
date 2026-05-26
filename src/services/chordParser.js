// 코드위키(텍스트 악보) 파서 - 서버/클라이언트 공용 로직(Phase 2)
//
// 목표:
// - 입력이 "서버가 수집한 rawText"든 "유저 브라우저가 전달한 rawText"든 동일하게 처리
// - 공백/개행 100% 보존 + chord 위치(인덱스) 1:1 레고 블록(LogBlock[]) 생성
// - 괄호 후리가나(漢字(かな))는 한자 raw 유지 + kr에 독음 주입 + 괄호 구간은 폭 0 처리
// - 괄호 없는 한자는 kuromoji reading(있을 때)로 fallback, 없으면 kr 공백 처리

/**
 * @typedef {Object} LogBlock
 * @property {string} chord
 * @property {string} lyric_raw
 * @property {string} lyric_kr
 */

function isChordTokenChar(ch) {
  // '-'는 리듬 표기와 충돌해 제외
  // '.'은 N.C. 표기 지원
  return /[A-Za-z0-9#b/.()+]/.test(ch);
}

function looksLikeChordToken(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (/^(?:N\.C\.|N\.C|NC)$/i.test(t)) return true;
  // 엄격한 코드 토큰 패턴(메타 텍스트(BPM 등) 오탐 방지)
  return /^[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?$/i.test(t);
}

/**
 * 1단계: 줄(Line) 성격 판별
 * - Chord Line: 코드 토큰/바(|)/대시(-)/공백 등 "코드표기용 ASCII"로만 구성된 줄
 * - Lyric Line: 일본어(한자/카나) 또는 일반 문장 성분이 포함된 줄
 *
 * 절대 원칙:
 * - Chord Line과 Lyric Line은 절대 섞이지 않는다(가사 문자열 사이에 코드 토큰이 들어가면 안 됨)
 */
function isChordLine(line) {
  const s = String(line ?? '');
  const t = s.trim();
  if (!t) return false;

  // 메타 라인은 chord로 취급하지 않는다.
  if (/^\s*(?:key|capo|bpm)\s*[:=]/i.test(t)) return false;

  // 일본어/한글이 섞이면 무조건 가사 라인이다.
  if (/[\u3040-\u30ff\u3400-\u9fff\uAC00-\uD7AF]/.test(s)) return false;

  // 리듬/구분자만 있는 라인도 "가사 없는 섹션"이므로 chord 라인으로 본다.
  if (/^[\s|=:_\-–—~.*+\\/]+$/.test(s)) return true;

  // 허용 문자(ASCII) 외가 있으면 chord 라인이 아니다.
  // (괄호는 일부 표기에서 등장할 수 있어 허용)
  if (!/^[A-Za-z0-9#b/|().+\-_\s]+$/.test(s)) return false;

  // 코드 토큰이 실제로 존재해야 한다.
  const spans = buildChordTokenSpans(s);
  if (!spans.length) return false;

  // 토큰이 너무 적으면(우연히 'A' 같은 문자) chord로 오인할 수 있으니 완화 기준을 둔다.
  const nonSpace = s.replace(/\s/g, '');
  if (spans.length === 1 && nonSpace.length <= 3) return false;

  return true;
}

function buildChordStartMap(chordLine) {
  /** @type {Map<number,string>} */
  const map = new Map();
  const s = String(chordLine || '');
  let idx = 0;
  while (idx < s.length) {
    const ch = s[idx];
    if (ch === ' ' || ch === '\t') {
      idx += 1;
      continue;
    }
    let j = idx;
    while (j < s.length && isChordTokenChar(s[j])) j += 1;
    const token = s.slice(idx, j).trim();
    if (looksLikeChordToken(token)) map.set(idx, token);
    idx = Math.max(j, idx + 1);
  }
  return map;
}

function buildChordTokenSpans(line) {
  const s = String(line || '');
  /** @type {Array<{start:number,end:number,token:string}>} */
  const spans = [];
  let idx = 0;
  while (idx < s.length) {
    const ch = s[idx];
    if (ch === ' ' || ch === '\t') {
      idx += 1;
      continue;
    }
    if (!isChordTokenChar(ch)) {
      idx += 1;
      continue;
    }
    let j = idx;
    while (j < s.length && isChordTokenChar(s[j])) j += 1;
    const token = s.slice(idx, j).trim();
    if (looksLikeChordToken(token)) spans.push({ start: idx, end: j, token });
    idx = Math.max(j, idx + 1);
  }
  return spans;
}

// chord-only 라인은 "코드"는 상단에만 표시하고, 하단에는 bar/리듬 문자만 남겨 화면이 깨지지 않게 한다.
function emitChordOnly(chordLine, _chordMap, out) {
  const s = String(chordLine || '');
  const spans = buildChordTokenSpans(s);
  const spanByStart = new Map(spans.map((x) => [x.start, x]));

  let i = 0;
  while (i < s.length) {
    const sp = spanByStart.get(i);
    if (sp) {
      // 코드 토큰은 "폭 유지"를 위해 토큰 길이만큼 셀을 소비한다.
      // 첫 셀에만 chord를 넣고, 나머지는 placeholder(빈 chord)로 둔다.
      out.push({ chord: sp.token, lyric_raw: '', lyric_kr: '' });
      for (let x = sp.start + 1; x < sp.end; x += 1) out.push({ chord: '', lyric_raw: '', lyric_kr: '' });
      i = sp.end;
      continue;
    }
    const ch = s[i];
    out.push({ chord: '', lyric_raw: ch, lyric_kr: ch });
    i += 1;
  }
}

// ---- Reading (kana -> KR MVP) ----------------------------------------------------
function isHiragana(ch) {
  return /[\u3040-\u309F]/.test(ch);
}
function isKatakana(ch) {
  return /[\u30A0-\u30FF]/.test(ch);
}
function kataToHira(str) {
  return String(str || '').replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const KANA_TO_KR = new Map(
  Object.entries({
    あ: '아', い: '이', う: '우', え: '에', お: '오',
    か: '카', き: '키', く: '쿠', け: '케', こ: '코',
    さ: '사', し: '시', す: '스', せ: '세', そ: '소',
    た: '타', ち: '치', つ: '츠', て: '테', と: '토',
    な: '나', に: '니', ぬ: '누', ね: '네', の: '노',
    は: '하', ひ: '히', ふ: '후', へ: '헤', ほ: '호',
    ま: '마', み: '미', む: '무', め: '메', も: '모',
    や: '야', ゆ: '유', よ: '요',
    ら: '라', り: '리', る: '루', れ: '레', ろ: '로',
    わ: '와', を: '오', ん: '응',
    が: '가', ぎ: '기', ぐ: '구', げ: '게', ご: '고',
    ざ: '자', じ: '지', ず: '즈', ぜ: '제', ぞ: '조',
    だ: '다', ぢ: '지', づ: '즈', で: '데', ど: '도',
    ば: '바', び: '비', ぶ: '부', べ: '베', ぼ: '보',
    ぱ: '파', ぴ: '피', ぷ: '푸', ぺ: '페', ぽ: '포',
    ぁ: '아', ぃ: '이', ぅ: '우', ぇ: '에', ぉ: '오',
    ゃ: '야', ゅ: '유', ょ: '요'
  })
);

const YOON = new Map(
  Object.entries({
    きゃ: '캬', きゅ: '큐', きょ: '쿄',
    しゃ: '샤', しゅ: '슈', しょ: '쇼',
    ちゃ: '챠', ちゅ: '츄', ちょ: '쵸',
    にゃ: '냐', にゅ: '뉴', にょ: '뇨',
    ひゃ: '햐', ひゅ: '휴', ひょ: '효',
    みゃ: '먀', みゅ: '뮤', みょ: '묘',
    りゃ: '랴', りゅ: '류', りょ: '료',
    ぎゃ: '갸', ぎゅ: '규', ぎょ: '교',
    じゃ: '쟈', じゅ: '쥬', じょ: '죠',
    びゃ: '뱌', びゅ: '뷰', びょ: '뵤',
    ぴゃ: '퍄', ぴゅ: '퓨', ぴょ: '표'
  })
);

function toKoreanReadingMvp(input) {
  const s = String(input ?? '');
  if (!s) return '';
  if (s === '\n') return '\n';
  const hasKana = /[\u3040-\u30ff]/.test(s);
  if (!hasKana) return s;
  const hira = kataToHira(s);
  let out = '';
  for (let i = 0; i < hira.length; i += 1) {
    const two = hira.slice(i, i + 2);
    if (YOON.has(two)) {
      out += YOON.get(two);
      i += 1;
      continue;
    }
    const ch = hira[i];
    // 장음/촉음은 한글 표기에서 그대로 두면 어색해서 기본은 제거한다.
    // (정밀 로마자-한글 변환은 차후 필요 시 별도 엔진으로 교체)
    if (ch === 'ー' || ch === 'っ') {
      continue;
    }
    out += KANA_TO_KR.get(ch) || ch;
  }
  return out;
}

// ---- Furigana + kanji fallback ---------------------------------------------------
function isKanji(ch) {
  return /[\u3400-\u9fff]/.test(ch);
}
function isFuriganaChar(ch) {
  return /[\u3040-\u30ffー]/.test(ch);
}

let _tokenizerPromise = null;
function getTokenizer() {
  // kuromoji는 사전 로딩 비용이 매우 커서 기본은 OFF.
  // 필요할 때만 켠다: ENABLE_KUROMOJI=1
  if (String(process.env.ENABLE_KUROMOJI || '') !== '1') return Promise.resolve(null);
  if (_tokenizerPromise) return _tokenizerPromise;
  _tokenizerPromise = (async () => {
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      const kuromoji = require('kuromoji');
      const path = require('node:path');
      const kuromojiMain = require.resolve('kuromoji'); // .../kuromoji/src/kuromoji.js
      const dicPath = path.join(path.dirname(kuromojiMain), '..', 'dict');
      return await new Promise((resolve, reject) => {
        kuromoji.builder({ dicPath }).build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)));
      });
    } catch {
      return null;
    }
  })();
  return _tokenizerPromise;
}

function normalizeTabs(line) {
  // 탭은 코드/가사 정렬을 깨뜨리므로, 고정 폭 스페이스로 치환한다.
  return String(line || '').replace(/\t/g, '  ');
}

function splitGraphemes(str) {
  // Hangul syllable/ASCII 중심이라 기본 Array split로 충분(emoji 등은 여기서 중요하지 않음)
  return Array.from(String(str || ''));
}

function distributeText(text, width) {
  const chars = splitGraphemes(text);
  const w = Math.max(1, Number(width || 1));
  if (chars.length === 0) return Array.from({ length: w }, () => '');
  if (w === 1) return [chars.join('')];
  const out = Array.from({ length: w }, () => '');
  for (let i = 0; i < w; i += 1) {
    const a = Math.floor((i * chars.length) / w);
    const b = Math.floor(((i + 1) * chars.length) / w);
    out[i] = chars.slice(a, Math.max(a + 1, b)).join('');
  }
  return out;
}

function isKana(ch) {
  return /[\u3040-\u30ffー]/.test(String(ch || ''));
}

function tryParseFuriganaToken(s, i) {
  // 패턴: <base>(<kana>)  where base has at least one Kanji and kana has only kana/ー
  // 예: 濁(にご) , 寝言(ねごと)
  const str = String(s || '');
  if (i < 0 || i >= str.length) return null;
  // base는 공백/탭/개행/괄호 이전까지
  let j = i;
  while (j < str.length) {
    const ch = str[j];
    if (ch === '(' || ch === ' ' || ch === '\t') break;
    j += 1;
  }
  if (j <= i) return null;
  if (str[j] !== '(') return null;
  const base = str.slice(i, j);
  const hasKanjiInBase = /[\u3400-\u9fff]/.test(base);
  if (!hasKanjiInBase) return null;

  let k = j + 1;
  while (k < str.length && isKana(str[k])) k += 1;
  if (str[k] !== ')' || k <= j + 1) return null;
  const readingKana = str.slice(j + 1, k);
  const end = k + 1;
  return { base, readingKana, start: i, end };
}

async function buildLyricCellsStrict(line) {
  const src = normalizeTabs(line);
  /** @type {Array<{raw:string, kr:string}>} */
  const cells = [];
  let i = 0;
  while (i < src.length) {
    const tok = tryParseFuriganaToken(src, i);
    if (tok) {
      const readingKr = toKoreanReadingMvp(tok.readingKana);
      // 후리가나 전체는 "표시 폭을 base 길이로만" 소비한다.
      // (괄호와 괄호 안 카나는 폭 0)
      const baseLen = Math.max(1, tok.base.length);
      const segs = baseLen === 1 ? [readingKr] : distributeText(readingKr, baseLen);
      for (let bi = 0; bi < baseLen; bi += 1) {
        const rawCh = tok.base[bi] || '';
        cells.push({ raw: rawCh, kr: segs[bi] || '' });
      }
      i = tok.end;
      continue;
    }

    const ch = src[i];
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') break;
    if (isKana(ch)) {
      cells.push({ raw: ch, kr: toKoreanReadingMvp(ch) });
    } else if (isKanji(ch)) {
      // 후리가나/kuromoji에서 채우기 전까지는 raw를 그대로 보여주고, kr는 빈 값으로 둔다.
      // (렌더링은 lyric_kr 우선이므로, 최종 단계에서 kr가 비면 raw로 채운다)
      cells.push({ raw: ch, kr: '' });
    } else {
      // 영문/기호/공백은 그대로 유지(원칙 3)
      cells.push({ raw: ch, kr: ch });
    }
    i += 1;
  }

  // kuromoji: 괄호 후리가나로 해소되지 않은 한자만 보완한다.
  const needsKuro = cells.some((c) => isKanji(c.raw) && !String(c.kr || '').trim());
  if (!needsKuro) return cells;

  const tokenizer = await getTokenizer();
  if (!tokenizer) return cells;

  const cleanLine = cells.map((c) => c.raw).join('');
  try {
    const tokens = tokenizer.tokenize(cleanLine);
    let pos = 0;
    for (const t of tokens) {
      const surf = String(t.surface_form || '');
      if (!surf) continue;
      if (!cleanLine.startsWith(surf, pos)) {
        const found = cleanLine.indexOf(surf, pos);
        if (found === -1) continue;
        pos = found;
      }
      const start = pos;
      const end = pos + surf.length;
      pos = end;

      const hasKanji = /[\u3400-\u9fff]/.test(surf);
      const reading = String(t.reading || '');
      if (!hasKanji || !reading) continue;
      const readingKr = toKoreanReadingMvp(reading);
      const segs = distributeText(readingKr, surf.length);

      for (let x = start; x < end && x < cells.length; x += 1) {
        // 이미 후리가나로 채워진 경우는 유지
        if (String(cells[x].kr || '').trim()) continue;
        // 한자 위치에만 주입
        if (!isKanji(cells[x].raw)) continue;
        cells[x].kr = segs[x - start] || '';
      }
    }
  } catch {}

  // 마지막 보정: kr가 비어있으면 raw로 채워서 글자 누락/밀림 방지
  for (let x = 0; x < cells.length; x += 1) {
    if (!String(cells[x].kr || '').trim()) cells[x].kr = cells[x].raw;
  }
  return cells;
}

/**
 * rawText -> LogBlock[] (개행 포함)
 * @param {string} rawText
 * @returns {Promise<LogBlock[]>}
 */
async function parseRawTextToBlocks(rawText) {
  const text = String(rawText || '');
  if (!text.trim()) return [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  /** @type {LogBlock[]} */
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = normalizeTabs(lines[i] ?? '');
    const next = normalizeTabs(lines[i + 1] ?? '');

    // 1단계: 줄 성격 판별(Chord vs Lyric)
    const isChord = isChordLine(line);
    const isNextChord = isChordLine(next);

    // 2단계: chord 라인 + 바로 다음 lyric 라인이면 수직 매핑
    if (isChord && next && !isNextChord && next.trim() !== '') {
      const chordMap = buildChordStartMap(line);
      const lyricCells = await buildLyricCellsStrict(next);
      const maxLen = Math.max(String(line).length, lyricCells.length);
      for (let col = 0; col < maxLen; col += 1) {
        const chord = chordMap.get(col) || '';
        const cell = lyricCells[col] || { raw: ' ', kr: ' ' };
        out.push({ chord, lyric_raw: cell.raw, lyric_kr: cell.kr });
      }
      i += 1;
      out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
      continue;
    }

    // 3단계: chord-only (가사 없는 섹션)도 공백/기호를 1셀로 유지
    if (isChord) {
      const chordMap = buildChordStartMap(line);
      emitChordOnly(line, chordMap, out);
      out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
      continue;
    }

    // 4단계: lyric-only (절대 코드 토큰을 섞지 않는다)
    const lyricCells = await buildLyricCellsStrict(line);
    for (let col = 0; col < lyricCells.length; col += 1) {
      const cell = lyricCells[col];
      out.push({ chord: '', lyric_raw: cell.raw, lyric_kr: cell.kr });
    }
    out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
  }

  return out;
}

module.exports = {
  parseRawTextToBlocks
};
