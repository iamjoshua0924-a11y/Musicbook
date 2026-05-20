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
  return /[A-Za-z0-9#b/()+]/.test(ch);
}

function looksLikeChordToken(s) {
  if (!s) return false;
  if (s === 'N.C.' || s === 'NC' || s === 'N.C') return true;
  return /^[A-G]/.test(s);
}

function isChordLine(line) {
  const s = String(line || '');
  if (!s.trim()) return false;
  if (/^\s*key\s*:/i.test(s)) return false;
  const kanaOrKanji = /[\u3040-\u30ff\u3400-\u9fff]/.test(s);
  if (kanaOrKanji) return false;
  const matches = s.match(/\b(?:N\.C\.|NC|N\.C)\b|\b[A-G][#b]?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G][#b]?)?\b/g) || [];
  if (matches.length === 0) return false;
  const density = matches.length / Math.max(1, s.replace(/\s/g, '').length / 8);
  return density >= 0.8;
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

function emitChordOnly(chordLine, chordMap, out) {
  const s = String(chordLine || '');
  for (let col = 0; col < s.length; col += 1) {
    const chord = chordMap.get(col) || '';
    const raw = s[col];
    out.push({ chord, lyric_raw: raw, lyric_kr: raw });
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
    if (ch === 'ー' || ch === 'っ') {
      out += ch;
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

async function buildLyricCellsWithFurigana(line) {
  const s = String(line || '');
  /** @type {Array<{raw:string, kr:string}>} */
  const cells = Array.from({ length: s.length }, () => ({ raw: '', kr: '' }));

  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (isKanji(ch)) {
      let j = i;
      while (j < s.length && isKanji(s[j])) j += 1;
      const kanjiRun = s.slice(i, j);
      if (s[j] === '(') {
        let k = j + 1;
        while (k < s.length && isFuriganaChar(s[k])) k += 1;
        if (s[k] === ')' && k > j + 1) {
          const readingKana = s.slice(j + 1, k);
          const readingKr = toKoreanReadingMvp(readingKana);
          cells[i] = { raw: kanjiRun, kr: readingKr };
          for (let x = i + 1; x < j; x += 1) cells[x] = { raw: '', kr: '' };
          for (let x = j; x <= k; x += 1) cells[x] = { raw: '', kr: '' };
          i = k + 1;
          continue;
        }
      }
    }

    cells[i] = { raw: ch, kr: toKoreanReadingMvp(ch) };
    i += 1;
  }

  const tokenizer = await getTokenizer();
  if (tokenizer) {
    try {
      const tokens = tokenizer.tokenize(s);
      let pos = 0;
      for (const t of tokens) {
        const surf = String(t.surface_form || '');
        if (!surf) continue;
        if (!s.startsWith(surf, pos)) {
          const found = s.indexOf(surf, pos);
          if (found === -1) continue;
          pos = found;
        }
        const spanStart = pos;
        const spanEnd = pos + surf.length;
        pos = spanEnd;

        const hasKanji = /[\u3400-\u9fff]/.test(surf);
        const reading = String(t.reading || '');
        if (!hasKanji || !reading) continue;

        const alreadyMapped = cells[spanStart]?.kr && cells[spanStart].kr !== cells[spanStart].raw;
        if (alreadyMapped) continue;

        const kr = toKoreanReadingMvp(reading); // katakana -> hangul
        cells[spanStart] = { raw: surf, kr };
        for (let x = spanStart + 1; x < spanEnd && x < cells.length; x += 1) cells[x] = { raw: '', kr: '' };
      }
    } catch {}
  } else {
    for (let x = 0; x < cells.length; x += 1) {
      if (isKanji(cells[x].raw) && cells[x].kr === cells[x].raw) cells[x] = { raw: cells[x].raw, kr: '' };
    }
  }

  return cells;
}

async function emitAlignedPair(lyricLine, chordMap, chordLineLen, out) {
  const lyricCells = await buildLyricCellsWithFurigana(String(lyricLine || ''));
  const maxLen = Math.max(chordLineLen, lyricCells.length);
  for (let col = 0; col < maxLen; col += 1) {
    const chord = chordMap.get(col) || '';
    const cell = col < lyricCells.length ? lyricCells[col] : { raw: ' ', kr: ' ' };
    out.push({ chord, lyric_raw: cell.raw, lyric_kr: cell.kr });
  }
}

async function emitLyricOnly(line, out) {
  const cells = await buildLyricCellsWithFurigana(String(line || ''));
  for (const c of cells) out.push({ chord: '', lyric_raw: c.raw, lyric_kr: c.kr });
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
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';

    if (isChordLine(line)) {
      if (next && !isChordLine(next) && next.trim() !== '') {
        const chordMap = buildChordStartMap(line);
        await emitAlignedPair(next, chordMap, String(line).length, out);
        i += 1;
        out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
        continue;
      }
      const chordMap = buildChordStartMap(line);
      emitChordOnly(line, chordMap, out);
      out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
      continue;
    }

    await emitLyricOnly(line, out);
    out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
  }

  return out;
}

module.exports = {
  parseRawTextToBlocks
};

