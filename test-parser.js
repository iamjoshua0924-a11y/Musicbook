/**
 * Phase 1 (샌드박스) - 코드위키 파서 검증 스크립트
 *
 * 목표:
 * - 프로덕션(Express/Socket/Mongo/Viewer) 코드는 절대 수정하지 않고,
 *   이 파일(test-parser.js) 하나만으로 "가져오기→추출→파싱→출력" 알고리즘을 독립 검증한다.
 *
 * 사용법:
 *   node test-parser.js <url>
 *
 * 주의(중요):
 * - 본 스크립트는 "차단/우회" 목적의 stealth/캡차 자동화 등을 구현하지 않는다.
 * - 다만 동적 렌더링 사이트의 렌더링 누락/크래시를 줄이기 위해,
 *   Phase 1-2에서 puppeteer 기반의 "호환성 목적 최소 설정(viewport/locale/UA)"을 적용할 수 있다.
 */

// ---- CLI -------------------------------------------------------------------------
function usage() {
  console.log('Usage: node test-parser.js <url>');
  console.log('Example: node test-parser.js https://example.com/song');
  console.log('');
  console.log('Options:');
  console.log('  --engine=auto|fetch|puppeteer   (default: auto)');
  console.log('  --timeoutMs=<number>            (default: 30000)');
  console.log('  --lang=<lang>                   (default: ko-KR)');
  console.log('  --rawFile=<path>                (URL 대신 원문 텍스트 파일을 직접 파싱)');
  console.log('  --format=lines|flat             (default: lines)');
  console.log('  --maxLines=<number>             (default: 60, format=lines일 때 적용)');
  console.log('  --maxCols=<number>              (default: 180, format=lines일 때 라인당 표시 제한)');
  console.log('  --fromLine=<number>             (default: 1, format=lines일 때)');
  console.log('  --onlyTags=<csv>                (예: rhythm,mark,nc,blank)');
  console.log('  --search=<text>                 (rawLine에 포함되는 텍스트로 라인 필터)');
}

function nowIso() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(`[${nowIso()}]`, ...args);
}

function logErr(...args) {
  console.error(`[${nowIso()}]`, ...args);
}

function assertUrl(u) {
  try {
    // eslint-disable-next-line no-new
    new URL(u);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const args = {
    url: '',
    engine: 'auto',
    timeoutMs: 30_000,
    lang: 'ko-KR',
    rawFile: '',
    format: 'lines',
    maxLines: 60,
    maxCols: 180,
    fromLine: 1,
    onlyTags: '',
    search: ''
  };
  const rest = [];
  for (const a of argv.slice(2)) {
    if (a.startsWith('--engine=')) args.engine = a.split('=')[1] || 'auto';
    else if (a.startsWith('--timeoutMs=')) args.timeoutMs = Number(a.split('=')[1] || '30000');
    else if (a.startsWith('--lang=')) args.lang = a.split('=')[1] || 'ko-KR';
    else if (a.startsWith('--rawFile=')) args.rawFile = a.split('=')[1] || '';
    else if (a.startsWith('--format=')) args.format = a.split('=')[1] || 'lines';
    else if (a.startsWith('--maxLines=')) args.maxLines = Number(a.split('=')[1] || '60');
    else if (a.startsWith('--maxCols=')) args.maxCols = Number(a.split('=')[1] || '180');
    else if (a.startsWith('--fromLine=')) args.fromLine = Number(a.split('=')[1] || '1');
    else if (a.startsWith('--onlyTags=')) args.onlyTags = a.split('=')[1] || '';
    else if (a.startsWith('--search=')) args.search = a.split('=')[1] || '';
    else if (!a.startsWith('--')) rest.push(a);
  }
  args.url = rest[0] || '';
  if (!['auto', 'fetch', 'puppeteer'].includes(args.engine)) args.engine = 'auto';
  if (!['lines', 'flat'].includes(args.format)) args.format = 'lines';
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) args.timeoutMs = 30_000;
  if (!Number.isFinite(args.maxLines) || args.maxLines < 1) args.maxLines = 60;
  if (!Number.isFinite(args.maxCols) || args.maxCols < 40) args.maxCols = 180;
  if (!Number.isFinite(args.fromLine) || args.fromLine < 1) args.fromLine = 1;
  return args;
}

// ---- Types (JSDoc) ---------------------------------------------------------------
/**
 * @typedef {Object} LogBlock
 * @property {string} chord
 * @property {string} lyric_kr
 * @property {string=} lyric_raw
 */

// ---- Phase 1-2 placeholders ------------------------------------------------------
/**
 * 1차: 단순 fetch로 HTML 가져오기(가장 안전).
 * 2차: puppeteer 렌더 후 DOM 추출(필요 시).
 *
 * - 주의: 본 스크립트는 사이트의 차단을 우회하지 않는다.
 *   로봇검증/캡차/보안검증 화면이 뜨는 경우, 실패로 처리하고 사용자에게 대안을 안내한다.
 *
 * @param {string} url
 * @param {{ timeoutMs: number }} opt
 * @returns {Promise<{ ok: boolean, html?: string, error?: string }>}
 */
async function fetchHtml(url, opt) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opt.timeoutMs);
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    clearTimeout(t);
    if (!res.ok) {
      return { ok: false, error: `HTTP_${res.status}` };
    }
    return { ok: true, html: text };
  } catch (e) {
    return { ok: false, error: `FETCH_ERROR: ${String(e?.message || e)}` };
  }
}

async function importPuppeteer() {
  // puppeteer는 Phase 1-2에서만 사용. 프로젝트에 의존성이 없을 수 있으므로 동적 import.
  // NOTE: puppeteer-core는 export object가 non-extensible이라 flag 주입이 불가하므로,
  //       { lib, isCore } 구조로 반환한다.
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return { lib: require('puppeteer'), isCore: false };
  } catch {
    // fallback: puppeteer-core (크로미움 다운로드 없이 로컬 Chrome 사용)
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      return { lib: require('puppeteer-core'), isCore: true };
    } catch {
      return null;
    }
  }
}

function looksLikeBotCheck(html) {
  const s = String(html || '').toLowerCase();
  // chordwiki가 WebFetch에서 보여준 문구
  if (s.includes('performing security verification')) return true;
  if (s.includes('verify you are not a bot')) return true;
  if (s.includes('checking your browser')) return true;
  if (s.includes('cloudflare')) return true;
  return false;
}

function findChromeExecutablePath() {
  const fs = require('fs');
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    `${process.env.LOCALAPPDATA || ''}\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe`
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return '';
}

/**
 * puppeteer로 렌더 후 HTML을 가져온다(호환성 목적 최소 설정).
 * - viewport / locale / Accept-Language / 표준 Chrome UA 지정(호환성 목적)
 * - networkidle2 대기 + 타임아웃
 *
 * @param {string} url
 * @param {{ timeoutMs: number, lang: string }} opt
 * @returns {Promise<{ ok: boolean, html?: string, error?: string, finalUrl?: string }>}
 */
async function fetchHtmlWithPuppeteer(url, opt) {
  const imported = await importPuppeteer();
  if (!imported) {
    return {
      ok: false,
      error:
        'PUPPETEER_NOT_INSTALLED: npm i --no-save puppeteer-core (권장) 또는 puppeteer (Phase1 샌드박스용)'
    };
  }
  const puppeteer = imported.lib;

  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  let browser = null;
  try {
    const launchOpt = {
      headless: 'new',
      args: []
    };
    if (imported.isCore) {
      const chromePath = findChromeExecutablePath();
      if (!chromePath) {
        return { ok: false, error: 'CHROME_NOT_FOUND: puppeteer-core 사용을 위해 Chrome 설치 경로를 찾지 못했습니다.' };
      }
      launchOpt.executablePath = chromePath;
    }

    browser = await puppeteer.launch({
      ...launchOpt
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 768, deviceScaleFactor: 1 });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({
      'Accept-Language': opt.lang
    });

    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: opt.timeoutMs });
    if (!resp) return { ok: false, error: 'PUPPETEER_GOTO_FAILED' };
    const html = await page.content();
    const finalUrl = page.url();
    if (looksLikeBotCheck(html)) {
      return {
        ok: false,
        error:
          'BOT_PROTECTION_PAGE: 대상 사이트에서 보안 검증/캡차 화면이 감지되었습니다. 이 스크립트는 우회하지 않으며, 대안(원문 붙여넣기/허용된 소스)을 사용해야 합니다.'
      };
    }
    return { ok: true, html, finalUrl };
  } catch (e) {
    return { ok: false, error: `PUPPETEER_ERROR: ${String(e?.message || e)}` };
  } finally {
    try {
      await browser?.close?.();
    } catch {}
  }
}

/**
 * 사이트별 extractor가 반환해야 하는 "정렬 보존 텍스트" 형태(임시).
 * @typedef {Object} ExtractedScoreText
 * @property {string} rawText  공백/개행 포함, 가능한 한 원문 그대로
 * @property {Object=} meta
 */

/**
 * HTML에서 악보 본문을 텍스트로 추출한다.
 * (Phase 1-2에서 사이트별 규칙/selector를 확장)
 *
 * @param {string} url
 * @param {string} html
 * @returns {Promise<ExtractedScoreText>}
 */
async function extractScoreText(url, html) {
  const host = new URL(url).hostname;
  const lower = String(html || '').toLowerCase();

  if (looksLikeBotCheck(lower)) {
    throw new Error('BOT_PROTECTION_PAGE: fetch 결과가 보안 검증 화면입니다(puppeteer 필요/또는 대안 필요).');
  }

  // (1) chordwiki: 서버 사이드에 본문이 포함되어 있으면 <pre>가 가장 안전(공백/개행 보존)
  if (host.includes('chordwiki.org')) {
    const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (m?.[1]) {
      return { rawText: decodeHtml(m[1]), meta: { source: 'pre' } };
    }
  }

  // (2) fallback: 가장 큰 <pre>를 선택
  const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((x) => x?.[1] || '');
  if (pres.length) {
    const best = pres.sort((a, b) => b.length - a.length)[0];
    return { rawText: decodeHtml(best), meta: { source: 'largest_pre' } };
  }

  // (3) 마지막 fallback: 텍스트 추출(정렬은 보장 못함) - Phase1에서는 실패 처리 권장
  throw new Error('EXTRACT_FAILED: <pre> 기반 본문을 찾지 못했습니다. Phase1-2에서 puppeteer extractor로 확장합니다.');
}

function decodeHtml(s) {
  // 최소치: HTML entity decode + <br> -> \n + <p> -> \n\n 정도만 처리
  const x = String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return x
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

// ---- Phase 1-3/4 placeholders ----------------------------------------------------
/**
 * 공백/개행을 100% 보존하는 "레고 블록" 파싱(Phase 1-3).
 * 독음 변환(Phase 1-4).
 *
 * @param {ExtractedScoreText} extracted
 * @returns {Promise<LogBlock[]>}
 */
async function parseToLogBlocks(extracted) {
  const rawText = String(extracted?.rawText || '');
  if (!rawText.trim()) return [];

  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  /** @type {LogBlock[]} */
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';

    if (isChordLine(line)) {
      // chord line + lyric line pair (바로 아래가 가사인 경우)
      if (next && !isChordLine(next) && next.trim() !== '') {
        const chordMap = buildChordStartMap(line);
        await emitAlignedPair(line, next, chordMap, out);
        i += 1; // consume lyric line
        out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
        continue;
      }

      // chord-only line (가사 라인이 없거나, 공백 라인이 오는 경우)
      const chordMap = buildChordStartMap(line);
      emitChordOnly(line, chordMap, out);
      out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
      continue;
    }

    // lyric-only (or rhythm only) line: keep as-is
    await emitLyricOnly(line, out);
    out.push({ chord: '', lyric_raw: '\n', lyric_kr: '\n' });
  }

  return out;
}

// ---- Phase 1-3: chord/lyric alignment -------------------------------------------
function isChordTokenChar(ch) {
  // NOTE:
  // - '-'(리듬 표기)까지 포함하면 "Em--D/F#--" 같은 덩어리로 토큰이 커져서 제외한다.
  // - 코드 표기는 Em, maj, sus, dim 등 다양한 영문 조합을 포함하므로 A-G 범위로 제한하면 안 된다.
  return /[A-Za-z0-9#b/.()+]/.test(ch);
}

function looksLikeChordToken(s) {
  // permissive chord pattern: root + modifiers
  // examples: C, Am, AM7, F#dim, Bb, D/F#, N.C.
  if (!s) return false;
  const t = String(s).trim();
  if (/^(?:N\.C\.|N\.C|NC)$/i.test(t)) return true;
  return /^[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?$/i.test(t);
}

function isChordLine(line) {
  const s = String(line || '');
  if (!s.trim()) return false;
  if (/^\s*key\s*:/i.test(s)) return false; // "Key: Em" 같은 메타 라인은 chordline으로 취급하지 않음
  // chord line usually has many chord-like tokens and few kana/kanji
  const kanaOrKanji = /[\u3040-\u30ff\u3400-\u9fff]/.test(s);
  if (kanaOrKanji) return false;
  // Allow barlines and separators; detect chord patterns inside.
  const matches = s.match(/\b(?:N\.C\.|NC|N\.C)\b|\b[A-G][#b]?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G][#b]?)?\b/g) || [];
  if (matches.length === 0) return false;
  // Heuristic: if the line has many chord-ish matches relative to length, treat as chord line.
  const density = matches.length / Math.max(1, s.replace(/\s/g, '').length / 8);
  return density >= 0.8;
}

/**
 * chordLine에서 chord 토큰 시작 위치(index) -> chord 문자열 맵을 만든다.
 * 예: "  Am7    Bm  C" => {2:"Am7", 9:"Bm", 13:"C"}
 */
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
    // read token
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

async function emitAlignedPair(chordLine, lyricLine, chordMap, out) {
  const lyricCells = await buildLyricCellsWithFurigana(String(lyricLine || ''));
  const maxLen = Math.max(String(chordLine || '').length, lyricCells.length);
  for (let col = 0; col < maxLen; col += 1) {
    const chord = chordMap.get(col) || '';
    const cell = col < lyricCells.length ? lyricCells[col] : { raw: ' ', kr: ' ' };
    const lyricRaw = cell.raw;
    const lyricKr = cell.kr;
    out.push({ chord, lyric_raw: lyricRaw, lyric_kr: lyricKr });
  }
}

function emitChordOnly(chordLine, chordMap, out) {
  const s = String(chordLine || '');
  const spans = buildChordTokenSpans(s);
  const spanByStart = new Map(spans.map((x) => [x.start, x]));
  let i = 0;
  while (i < s.length) {
    const sp = spanByStart.get(i);
    if (sp) {
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

async function emitLyricOnly(line, out) {
  const cells = await buildLyricCellsWithFurigana(String(line || ''));
  for (let col = 0; col < cells.length; col += 1) {
    out.push({ chord: '', lyric_raw: cells[col].raw, lyric_kr: cells[col].kr });
  }
}

// ---- Phase 1-4 (MVP): 일본어 독음 변환 ------------------------------------------
// MVP 목표:
// - 카나(히라가나/가타카나) → (대략적인) 한글 표기
// - 한자/기호/영문/공백은 그대로 반환
//
// 주의: 한자 독음은 사전/형태소 분석이 필요하므로 MVP에서는 “원문 유지”로 둔다.

function isHiragana(ch) {
  return /[\u3040-\u309F]/.test(ch);
}
function isKatakana(ch) {
  return /[\u30A0-\u30FF]/.test(ch);
}
function isKana(ch) {
  return isHiragana(ch) || isKatakana(ch);
}

function kataToHira(str) {
  return String(str || '').replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 한글 조합을 간단히 만들기 위한 기본 매핑(모라 단위)
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

// 요음(きゃ/しゃ/ちゃ …) 최소 대응
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
  // 단일 문자 또는 카나 문자열(후리가나)을 한글 표기로 변환(MVP)
  const s = String(input ?? '');
  if (!s) return '';
  if (s === '\n') return '\n';

  // 카나 문자열이 아니면 그대로(한자/기호/영문/공백)
  const hasKana = /[\u3040-\u30ff]/.test(s);
  if (!hasKana) return s;

  const hira = kataToHira(s);
  let out = '';
  for (let i = 0; i < hira.length; i += 1) {
    // 요음 2글자 우선
    const two = hira.slice(i, i + 2);
    if (YOON.has(two)) {
      out += YOON.get(two);
      i += 1;
      continue;
    }
    const ch = hira[i];
    // 장음/촉음은 MVP에서 그대로 유지(추후 규칙 개선 가능)
    if (ch === 'ー' || ch === 'っ') {
      out += ch;
      continue;
    }
    out += KANA_TO_KR.get(ch) || ch;
  }
  return out;
}

// ---- Furigana(괄호 후리가나) 결합 처리 ------------------------------------------
// 요구사항:
// - "漢字(かな)" 패턴 발견 시:
//   - 한자 위치 lyric_raw에는 한자 원문을 남기되,
//   - lyric_kr에는 괄호 안 카나를 한글 발음으로 변환하여 주입
//   - 뒤따르는 "(" ... ")" 구간은 정렬을 위해 raw/kr를 ""로 처리(폭 0)
//
// 구현 정책(MVP):
// - 한자 1~N 글자 연속 + '(' + 카나/장음/촉음 + ')' 를 탐지
// - N>1인 경우, 첫 글자 칸에 "한자 런 전체"를 raw로 넣고(요구: 한자 원문 유지),
//   나머지 한자 칸은 raw/kr=""로 처리(폭 0)하여 중복/시프트를 줄임.

function isKanji(ch) {
  return /[\u3400-\u9fff]/.test(ch);
}

function isFuriganaChar(ch) {
  // 카나 + 장음(ー) + 촉음(っ) + 소문자류 포함
  return /[\u3040-\u30ffー]/.test(ch);
}

let _tokenizerPromise = null;
function getTokenizer() {
  if (_tokenizerPromise) return _tokenizerPromise;
  _tokenizerPromise = (async () => {
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      const kuromoji = require('kuromoji');
      const path = require('path');
      const kuromojiMain = require.resolve('kuromoji'); // .../kuromoji/src/kuromoji.js
      const dicPath = path.join(path.dirname(kuromojiMain), '..', 'dict');
      return await new Promise((resolve, reject) => {
        kuromoji
          .builder({ dicPath })
          .build((err, tokenizer) => {
            if (err) reject(err);
            else resolve(tokenizer);
          });
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

    // kanjiRun(1+) + '(' + furigana + ')'
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

          // 첫 칸에 원문 한자(런) + 독음(한글) 주입
          cells[i] = { raw: kanjiRun, kr: readingKr };
          // 나머지 한자 칸은 폭 0 처리
          for (let x = i + 1; x < j; x += 1) cells[x] = { raw: '', kr: '' };
          // '(' ... ')' 영역 폭 0 처리
          for (let x = j; x <= k; x += 1) cells[x] = { raw: '', kr: '' };

          i = k + 1;
          continue;
        }
      }
    }

    // 기본: 1글자 그대로 + 카나는 MVP 변환
    cells[i] = { raw: ch, kr: toKoreanReadingMvp(ch) };
    i += 1;
  }

  // Fallback: 괄호 후리가나가 없는 한자/일본어 토큰은 형태소 분석(kuromoji reading)으로 kr 채우기
  const tokenizer = await getTokenizer();
  if (tokenizer) {
    try {
      const tokens = tokenizer.tokenize(s);
      let pos = 0;
      for (const t of tokens) {
        const surf = String(t.surface_form || '');
        if (!surf) continue;
        // align to current pos
        if (s.startsWith(surf, pos)) {
          // ok
        } else {
          const found = s.indexOf(surf, pos);
          if (found === -1) continue;
          pos = found;
        }

        const spanStart = pos;
        const spanEnd = pos + surf.length;
        pos = spanEnd;

        const hasKanji = /[\u3400-\u9fff]/.test(surf);
        const reading = String(t.reading || ''); // katakana
        if (!hasKanji || !reading) continue;

        // skip if already mapped by explicit furigana (kr가 kanji 그대로가 아닌 경우)
        const alreadyMapped = cells[spanStart]?.kr && cells[spanStart].kr !== cells[spanStart].raw;
        if (alreadyMapped) continue;

        const kr = toKoreanReadingMvp(reading); // katakana -> hangul MVP
        cells[spanStart] = { raw: surf, kr };
        for (let x = spanStart + 1; x < spanEnd && x < cells.length; x += 1) cells[x] = { raw: '', kr: '' };
      }
    } catch {}
  } else {
    // tokenizer 미설치 시: lyric_kr에 한자가 그대로 노출되는 문제를 최소화하기 위해, 단독 한자는 빈칸 처리.
    for (let x = 0; x < cells.length; x += 1) {
      if (isKanji(cells[x].raw) && cells[x].kr === cells[x].raw) cells[x] = { raw: cells[x].raw, kr: '' };
    }
  }

  return cells;
}

/**
 * 요구 함수 시그니처(명세): URL에서 가져오고 파싱하고 독음까지 적용해 블록 반환.
 * @param {string} url
 * @param {{ engine: 'auto'|'fetch'|'puppeteer', timeoutMs: number, lang: string }} opt
 * @returns {Promise<LogBlock[]>}
 */
async function parseAndTranslateJpop(url, opt) {
  // raw file shortcut: fetch/extract 단계 없이 파서 알고리즘만 검증
  if (opt.rawFile) {
    const fs = require('fs');
    let rawText = '';
    try {
      rawText = fs.readFileSync(opt.rawFile, 'utf-8');
    } catch (e) {
      throw new Error(`RAWFILE_READ_FAILED: ${opt.rawFile} (${String(e?.message || e)})`);
    }
    const extracted = { rawText, meta: { source: 'rawFile', rawFile: opt.rawFile } };
    return parseToLogBlocks(extracted);
  }

  let fetched = null;

  if (opt.engine === 'fetch') {
    fetched = await fetchHtml(url, opt);
  } else if (opt.engine === 'puppeteer') {
    fetched = await fetchHtmlWithPuppeteer(url, opt);
  } else {
    // auto: fetch 먼저 시도 → botcheck/추출실패면 puppeteer 시도
    fetched = await fetchHtml(url, opt);
    if (fetched.ok && looksLikeBotCheck(fetched.html)) {
      fetched = await fetchHtmlWithPuppeteer(url, opt);
    }
  }

  if (!fetched?.ok) throw new Error(fetched?.error || 'FETCH_FAILED');

  const extracted = await extractScoreText(url, fetched.html || '');
  const blocks = await parseToLogBlocks(extracted);
  return blocks;
}

// ---- Output formatting (Phase 1-5) ------------------------------------------------
function blocksToLines(blocks, maxCols) {
  /** @type {Array<{ lineNo: number, tags: string[], hasChord: boolean, rawLine: string, krLine: string, blocks: Array<{ chord: string, raw: string, kr: string }> }>} */
  const lines = [];
  let cur = [];
  let hasChord = false;
  let lineNo = 1;

  const flush = () => {
    const rawLine = cur.map((b) => b.raw).join('');
    const krLine = cur.map((b) => b.kr).join('');
    const tags = [];
    if (/===|----/.test(rawLine)) tags.push('rhythm');
    if (/[♥♠]/.test(rawLine)) tags.push('mark');
    if (/\bN\.C\.\b/.test(rawLine)) tags.push('nc');
    if (rawLine.trim() === '') tags.push('blank');

    const trimmed = cur.slice(0, maxCols);
    lines.push({ lineNo, tags, hasChord, rawLine: rawLine.slice(0, maxCols), krLine: krLine.slice(0, maxCols), blocks: trimmed });
    lineNo += 1;
    cur = [];
    hasChord = false;
  };

  for (const b of blocks) {
    if (b?.lyric_raw === '\n') {
      flush();
      continue;
    }
    const chord = String(b?.chord || '');
    const raw = String(b?.lyric_raw ?? '');
    const kr = String(b?.lyric_kr ?? '');
    if (chord) hasChord = true;
    cur.push({ chord, raw, kr });
  }
  if (cur.length) flush();
  return lines;
}

function printPretty(blocks, opt) {
  const totalBlocks = blocks.length;
  const totalChord = blocks.filter((b) => Boolean(b?.chord)).length;

  if (opt.format === 'flat') {
    console.dir(blocks, { depth: null, maxArrayLength: 200 });
    return;
  }

  const lines = blocksToLines(blocks, opt.maxCols);
  const onlyTags = String(opt.onlyTags || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const search = String(opt.search || '').trim();

  let filtered = lines;
  if (onlyTags.length) {
    filtered = filtered.filter((l) => onlyTags.every((t) => l.tags.includes(t)));
  }
  if (search) {
    filtered = filtered.filter((l) => (l.rawLine || '').includes(search));
  }
  const startIdx = Math.max(0, Number(opt.fromLine || 1) - 1);
  filtered = filtered.slice(startIdx);

  const shown = filtered.slice(0, opt.maxLines);

  const summary = {
    totalBlocks,
    totalLines: lines.length,
    filteredLines: filtered.length,
    chordBlocks: totalChord,
    shownLines: shown.length,
    maxLines: opt.maxLines,
    maxCols: opt.maxCols
  };

  console.log('');
  console.log('--- SUMMARY ---');
  console.dir(summary, { depth: null });
  console.log('');
  console.log('--- LINES (JSON) ---');
  console.dir(shown, {
    depth: null,
    maxArrayLength: opt.maxCols,
    breakLength: 180,
    compact: false
  });

  if (filtered.length > opt.maxLines) {
    console.log('');
    console.log(`(출력 생략) ${filtered.length}줄 중 ${opt.maxLines}줄만 표시했습니다.`);
    console.log(`전체를 보려면: node test-parser.js --rawFile=... --maxLines=${filtered.length}`);
  }
}

function printFriendlyError(err, opt) {
  const msg = String(err?.message || err);
  logErr(msg);
  console.error('');
  console.error('--- 해결 가이드 ---');

  if (msg.startsWith('BOT_PROTECTION_PAGE')) {
    console.error('- 대상 사이트에서 보안 검증 페이지가 감지되었습니다.');
    console.error('- 본 Phase 1 스크립트는 우회하지 않으며, 다음 중 하나로 진행하세요:');
    console.error('  1) 사람이 브라우저에서 인증/검증 통과 후 원문 텍스트를 파일로 저장 → --rawFile로 파서 검증');
    console.error('  2) Phase 2에서 계획한 "유저 참여형 DOM 전달" 구조로 최종 DOM/텍스트만 백엔드 파서에 전달');
    return;
  }

  if (msg.startsWith('PUPPETEER_NOT_INSTALLED')) {
    console.error('- puppeteer(또는 puppeteer-core)가 설치되어 있지 않습니다.');
    console.error('  권장: npm i --no-save puppeteer-core');
    console.error('  또는: npm i --no-save puppeteer');
    return;
  }

  if (msg.startsWith('CHROME_NOT_FOUND')) {
    console.error('- puppeteer-core를 사용하는 경우 Chrome 실행 파일 경로가 필요합니다.');
    console.error('  - Chrome 설치 확인 또는 환경변수 PUPPETEER_EXECUTABLE_PATH 지정');
    return;
  }

  if (msg.startsWith('RAWFILE_READ_FAILED')) {
    console.error('- rawFile 경로를 확인하세요(상대경로는 실행 디렉토리 기준입니다).');
    console.error(`  예: node test-parser.js --rawFile=roki.txt`);
    return;
  }

  if (msg.startsWith('EXTRACT_FAILED')) {
    console.error('- 본문 추출 규칙이 아직 부족합니다.');
    console.error('- 우선은 --rawFile로 파서/정렬/독음 알고리즘을 검증하고,');
    console.error('  이후 사이트별 extractor를 보강하세요.');
    return;
  }

  console.error('- 위 메시지를 참고해 입력(URL/파일) 또는 옵션을 조정해 다시 실행해 주세요.');
  console.error(`  현재 옵션: engine=${opt.engine}, timeoutMs=${opt.timeoutMs}, lang=${opt.lang}`);
}

// ---- Main ------------------------------------------------------------------------
async function main() {
  const opt = parseArgs(process.argv);
  const url = opt.url;
  if (!opt.rawFile && (!url || !assertUrl(url))) {
    usage();
    process.exit(url ? 2 : 0);
  }

  log('Phase1 start (sandbox only):', opt.rawFile ? `rawFile=${opt.rawFile}` : url);
  log(`engine=${opt.engine} timeoutMs=${opt.timeoutMs} lang=${opt.lang}`);

  try {
    const blocks = await parseAndTranslateJpop(url, opt);
    log(`OK: blocks=${blocks.length}`);
    printPretty(blocks, opt);
  } catch (e) {
    logErr('FAILED:');
    printFriendlyError(e, opt);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// Allow requiring this file from other sandbox scripts (no side effects).
module.exports = {
  parseAndTranslateJpop,
  parseToLogBlocks
};
