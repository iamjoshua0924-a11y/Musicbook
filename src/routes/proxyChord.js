const express = require('express');
const { z } = require('zod');
const { nanoid } = require('nanoid');

const { parseRawTextToBlocks } = require('../services/chordParser');
const { fetchRenderedHtml } = require('../services/puppeteerFetch');
const ChordDoc = require('../models/ChordDoc');
const { setTempDoc } = require('../services/chordDocTempStore');

const router = express.Router();

// 안전을 위해 allowlist로만 허용(SSRF 방지의 핵심)
const ALLOWED_HOSTS = new Set([
  'ja.chordwiki.org',
  'chordwiki.org',
  'www.chordwiki.org',
  'chordwiki.jp',
  'www.chordwiki.jp',
  'www.ultimate-guitar.com',
  'ultimate-guitar.com'
]);

const BOT_PATTERNS = [
  /performing security verification/i,
  /verify you are not a bot/i,
  /checking your browser/i,
  /cloudflare/i,
  // Cloudflare/Turnstile challenge common markers
  /just a moment/i,
  /attention required/i,
  /cf-browser-verification/i,
  /cf_chl_/i,
  /challenge-platform/i,
  /cdn-cgi\/challenge-platform/i,
  /turnstile/i,
  /cf-turnstile/i,
  /ray id/i,
  /please enable javascript/i,
  // JP/KR wording (일부 사이트)
  /ブラウザを確認しています/i,
  /しばらくお待ちください/i,
  /보안\s*확인/i
];

function looksLikeBotPage(html) {
  const s = String(html || '');
  return BOT_PATTERNS.some((re) => re.test(s));
}

function extractLargestPre(html) {
  const pres = [...String(html || '').matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((x) => x?.[1] || '');
  if (!pres.length) return '';
  return pres.sort((a, b) => b.length - a.length)[0];
}

function extractLargestTextarea(html) {
  const areas = [...String(html || '').matchAll(/<textarea[^>]*>([\s\S]*?)<\/textarea>/gi)].map((x) => x?.[1] || '');
  if (!areas.length) return '';
  return areas.sort((a, b) => b.length - a.length)[0];
}

function unescapeHtmlAttr(s) {
  // data-content 같은 attribute는 보통 HTML escape 상태
  return String(s || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function looksLikeChordText(s) {
  const t = String(s || '');
  if (!t.trim()) return false;
  // 코드 텍스트 가능성이 있는 힌트
  if (/\[ch\]/i.test(t)) return true; // Ultimate Guitar
  if (/\b[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?\b/.test(t) && t.includes('\n')) return true;
  return false;
}

function stripUgChordTags(s) {
  return String(s || '')
    .replace(/\[ch\]/gi, '')
    .replace(/\[\/ch\]/gi, '')
    .replace(/\[tab\]/gi, '')
    .replace(/\[\/tab\]/gi, '');
}

function findLongestStringDeep(obj, predicate) {
  const seen = new Set();
  let best = '';
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
      continue;
    }
    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (typeof v === 'string') {
        if (predicate(v) && v.length > best.length) best = v;
      } else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return best;
}

function extractUltimateGuitarText(html) {
  // UG는 본문이 <pre>가 아닌, data-content JSON이나 __NEXT_DATA__ 등에 들어있는 경우가 많다.
  const s = String(html || '');
  const m = s.match(/class="js-store"[^>]*data-content="([^"]+)"/i);
  if (m?.[1]) {
    try {
      const jsonStr = unescapeHtmlAttr(m[1]);
      const data = JSON.parse(jsonStr);
      const best = findLongestStringDeep(data, looksLikeChordText);
      if (best) return stripUgChordTags(best);
    } catch {}
  }

  const next = s.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (next?.[1]) {
    try {
      const data = JSON.parse(next[1]);
      const best = findLongestStringDeep(data, looksLikeChordText);
      if (best) return stripUgChordTags(best);
    } catch {}
  }
  return '';
}

function decodeHtml(s) {
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

function safeParseUrl(u) {
  const url = new URL(u);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('BAD_URL_PROTOCOL');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('HOST_NOT_ALLOWED');
  return url;
}

// in-memory tiny cache (TTL)
const cache = new Map(); // key -> { expireAt, value }
function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.expireAt) {
    cache.delete(key);
    return null;
  }
  return v.value;
}
function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expireAt: Date.now() + ttlMs });
}

function shouldCompactBlocks(blocks) {
  // Object-per-cell blocks는 Mongo 16MB 제한을 쉽게 초과한다.
  // 대략 5만 셀 이상이면 compact 저장을 우선 시도한다.
  return Array.isArray(blocks) && blocks.length > 50_000;
}

function rleEncodeSpaces(str) {
  const s = String(str || '');
  /** @type {Array<[0,number] | [1,string]>} */
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') {
      let j = i + 1;
      while (j < s.length && s[j] === ' ') j += 1;
      out.push([0, j - i]);
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < s.length && s[j] !== ' ') j += 1;
    out.push([1, s.slice(i, j)]);
    i = j;
  }
  return out;
}

function compactBlocksV2(blocks) {
  /** @type {Array<{rawRle:any[], krRle:any[], chords:Array<{col:number, token:string}>}>} */
  const lines = [];
  let raw = '';
  let kr = '';
  /** @type {Array<{col:number, token:string}>} */
  let chords = [];
  let col = 0;

  const flush = () => {
    if (raw.length || kr.length || chords.length) {
      lines.push({ rawRle: rleEncodeSpaces(raw), krRle: rleEncodeSpaces(kr), chords });
    }
    raw = '';
    kr = '';
    chords = [];
    col = 0;
  };

  for (const b of blocks || []) {
    if (b?.lyric_raw === '\n') {
      flush();
      continue;
    }
    const r = String(b?.lyric_raw ?? ' ');
    const k = String(b?.lyric_kr ?? b?.lyric_raw ?? ' ');
    raw += r.length ? r[0] : ' ';
    kr += k.length ? k[0] : ' ';
    const c = String(b?.chord || '');
    if (c) chords.push({ col, token: c });
    col += 1;
  }
  flush();

  return { format: 'mb_chord_compact_v2', lines };
}

async function createChordDoc({ blocks, meta }) {
  const docId = `chord:${nanoid(12)}`;
  let toStore = blocks || [];
  if (shouldCompactBlocks(toStore)) toStore = compactBlocksV2(toStore);

  try {
    // DB write timeout: 너무 오래 걸리면 Render가 502를 띄울 수 있으므로 빠르게 fallback 한다.
    const writePromise = ChordDoc.create({
      _id: docId,
      meta: meta || {},
      blocks: toStore
    });
    await Promise.race([
      writePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('MONGO_WRITE_TIMEOUT')), 2500))
    ]);
  } catch (e) {
    // Mongo 16MB 제한 등으로 실패하면 compact로 한 번 더 시도
    try {
      if (Array.isArray(toStore)) {
        const writePromise = ChordDoc.create({
          _id: docId,
          meta: meta || {},
          blocks: compactBlocksV2(toStore)
        });
        await Promise.race([
          writePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('MONGO_WRITE_TIMEOUT')), 2500))
        ]);
      } else {
        throw e;
      }
    } catch (e2) {
      // 최후 fallback: 메모리 저장으로라도 docId를 발급한다.
      const tempId = `chordtmp:${nanoid(12)}`;
      setTempDoc(tempId, { meta: meta || {}, blocks: toStore }, 2 * 60 * 60 * 1000); // 2h
      // eslint-disable-next-line no-console
      console.error('[proxy-chord] fallback to temp store', {
        tempId,
        name: e2?.name,
        message: e2?.message,
        code: e2?.code
      });
      return tempId;
    }
  }
  return docId;
}

async function fetchWithTimeout(url, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

function shouldTryPuppeteer({ status, text, errorCode }) {
  // 403/429 또는 bot page로 보이면 puppeteer로 재시도
  if (errorCode === 'BOT_PROTECTION_PAGE') return true;
  if (status === 403 || status === 429) return true;
  if (looksLikeBotPage(text)) return true;
  return false;
}

router.get('/proxy-chord', async (req, res) => {
  const schema = z.object({ url: z.string().url() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  let urlObj;
  try {
    urlObj = safeParseUrl(parsed.data.url);
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message || e) });
  }

  const key = `url:${urlObj.toString()}`;
  const cached = cacheGet(key);
  if (cached) return res.json({ ok: true, ...cached, cached: true });

  // 1) plain fetch (가벼움)
  const r = await fetchWithTimeout(urlObj.toString(), 15_000);
  let html = r.text;
  let finalUrl = urlObj.toString();
  let source = 'fetch+pre';
  let puppeteerMeta = null;
  let extractedTextFromPuppeteer = '';

  // 2) bot/403이면 puppeteer로 자동 폴백
  if (!r.ok || looksLikeBotPage(r.text)) {
    if (shouldTryPuppeteer({ status: r.status, text: r.text })) {
      try {
        const rendered = await fetchRenderedHtml(urlObj.toString(), { timeoutMs: 25_000, lang: 'ja-JP,ja;q=0.9' });
        html = rendered.html;
        finalUrl = rendered.finalUrl || finalUrl;
        source = 'puppeteer+content';
        puppeteerMeta = { ua: rendered.ua, elapsedMs: rendered.elapsedMs };
        extractedTextFromPuppeteer = String(rendered.extractedText || '');
      } catch (e) {
        // puppeteer 실패는 별도 코드로 내려서 원인 파악을 쉽게 한다.
        const code = String(e?.message || e);
        return res.status(502).json({
          ok: false,
          error: 'PUPPETEER_FAILED',
          detail: {
            host: urlObj.hostname,
            plainStatus: Number(r.status || 0),
            finalUrl,
            puppeteerError: code
          }
        });
      }
    } else {
      return res.status(502).json({ ok: false, error: `FETCH_FAILED_${r.status}` });
    }
  }

  // 3) 본문 추출
  const host = urlObj.hostname;
  let extracted = extractedTextFromPuppeteer;

  // 3-1) chordwiki 계열은 pre/textarea 우선
  if (!extracted) extracted = extractLargestPre(html);
  if (!extracted) extracted = extractLargestTextarea(html);

  // 3-2) ultimate-guitar 폴백
  if (!extracted && host.includes('ultimate-guitar.com')) {
    extracted = extractUltimateGuitarText(html);
  }

  if (!extracted) {
    // HTML 자체가 챌린지(봇/보안검증)로 보이면 extractor 실패가 아니라 bot으로 분류한다.
    if (looksLikeBotPage(html)) {
      return res.status(403).json({
        ok: false,
        error: 'BOT_PROTECTION_PAGE',
        detail: { host, finalUrl }
      });
    }
    // 디버깅을 위해 "찾은 힌트"를 detail로 내려준다.
    const preCount = [...String(html || '').matchAll(/<pre[^>]*>/gi)].length;
    const taCount = [...String(html || '').matchAll(/<textarea[^>]*>/gi)].length;
    const hasJsStore = /class="js-store"[^>]*data-content="/i.test(String(html || ''));
    return res.status(422).json({
      ok: false,
      error: 'EXTRACT_FAILED',
      detail: { host, preCount, textareaCount: taCount, hasJsStore, finalUrl }
    });
  }

  const rawText = decodeHtml(extracted);
  const blocks = await parseRawTextToBlocks(rawText);

  const value = {
    meta: {
      source,
      finalUrl,
      plainStatus: Number(r.status || 0),
      ...(puppeteerMeta ? { puppeteer: puppeteerMeta } : {})
    },
    blocks
  };
  try {
    value.docId = await createChordDoc({ blocks, meta: value.meta });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'DOC_STORE_FAILED' });
  }
  cacheSet(key, value, 2 * 60 * 1000);
  return res.json({ ok: true, ...value });
});

router.post('/proxy-chord', async (req, res) => {
  const schema = z
    .union([
      z.object({
        rawText: z.string().min(1).max(500_000),
        sourceUrl: z.union([z.string().url(), z.literal('')]).optional()
      }),
      z.object({
        // blocks는 배열(legacy) 또는 compact object(v1/v2) 둘 다 허용
        blocks: z.union([
          z.array(z.any()).min(1).max(800_000),
          z
            .object({
              format: z.string().min(1).max(80),
              lines: z.array(z.any()).min(1).max(300_000)
            })
            .passthrough()
        ]),
        sourceUrl: z.union([z.string().url(), z.literal('')]).optional()
      })
    ])
    .strict();

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  let blocks = [];
  let meta = {};
  if ('rawText' in parsed.data) {
    blocks = await parseRawTextToBlocks(parsed.data.rawText);
    meta = { source: 'clientRawText', sourceUrl: parsed.data.sourceUrl || '' };
  } else {
    blocks = parsed.data.blocks || [];
    meta = { source: 'clientBlocks', sourceUrl: parsed.data.sourceUrl || '' };
  }
  let docId = '';
  try {
    docId = await createChordDoc({ blocks, meta });
  } catch (e) {
    // Render 로그에 원인 남기기
    // eslint-disable-next-line no-console
    console.error('[proxy-chord] DOC_STORE_FAILED', {
      name: e?.name,
      message: e?.message,
      code: e?.code,
      stack: String(e?.stack || '').split('\n').slice(0, 4).join('\n'),
      original: e?._mb_original ? { name: e._mb_original?.name, message: e._mb_original?.message } : null,
      blocksCount: Array.isArray(blocks) ? blocks.length : -1
    });
    return res.status(502).json({
      ok: false,
      error: 'DOC_STORE_FAILED',
      detail: {
        name: String(e?.name || ''),
        message: String(e?.message || ''),
        code: String(e?.code || ''),
        stack: String(e?.stack || '').split('\n')[0] || '',
        blocksCount: Array.isArray(blocks) ? blocks.length : 0
      }
    });
  }
  // blocks는 크기가 매우 커질 수 있으므로, 뷰어는 docId로 /api/chord-doc 를 다시 호출한다.
  return res.json({ ok: true, docId, meta, blocksCount: Array.isArray(blocks) ? blocks.length : 0 });
});

module.exports = router;
