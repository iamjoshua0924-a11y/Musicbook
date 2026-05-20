const express = require('express');
const { z } = require('zod');

const { parseRawTextToBlocks } = require('../services/chordParser');

const router = express.Router();

// 안전을 위해 allowlist로만 허용(SSRF 방지의 핵심)
const ALLOWED_HOSTS = new Set(['ja.chordwiki.org', 'chordwiki.org', 'www.ultimate-guitar.com', 'ultimate-guitar.com']);

const BOT_PATTERNS = [
  /performing security verification/i,
  /verify you are not a bot/i,
  /checking your browser/i,
  /cloudflare/i
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

  const r = await fetchWithTimeout(urlObj.toString(), 15_000);
  if (!r.ok) return res.status(502).json({ ok: false, error: `FETCH_FAILED_${r.status}` });
  if (looksLikeBotPage(r.text)) {
    return res.status(403).json({
      ok: false,
      error: 'BOT_PROTECTION_PAGE',
      hint: '이 서버는 우회하지 않습니다. 사용자가 브라우저에서 본문 텍스트를 추출해 POST /api/proxy-chord(rawText)로 보내는 방식(유저 참여형)을 사용하세요.'
    });
  }

  const pre = extractLargestPre(r.text);
  if (!pre) return res.status(422).json({ ok: false, error: 'EXTRACT_FAILED' });
  const rawText = decodeHtml(pre);
  const blocks = await parseRawTextToBlocks(rawText);

  const value = { meta: { source: 'fetch+pre', finalUrl: urlObj.toString() }, blocks };
  cacheSet(key, value, 2 * 60 * 1000);
  return res.json({ ok: true, ...value });
});

router.post('/proxy-chord', async (req, res) => {
  const schema = z.object({
    rawText: z.string().min(1).max(500_000),
    sourceUrl: z.union([z.string().url(), z.literal('')]).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const blocks = await parseRawTextToBlocks(parsed.data.rawText);
  return res.json({
    ok: true,
    meta: { source: 'clientRawText', sourceUrl: parsed.data.sourceUrl || '' },
    blocks
  });
});

module.exports = router;
