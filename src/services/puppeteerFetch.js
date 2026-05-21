// Puppeteer 기반 렌더링 fetch (Phase 2 확장)
//
// 목적:
// - 서버 fetch(plain HTTP)로 403/봇 검증 페이지가 뜨는 사이트를 "브라우저와 유사한 컨텍스트"로 렌더링 후 HTML/텍스트를 수집
// - 불필요한 트래픽(이미지/폰트/미디어)을 차단하여 Fair Use를 지키면서 안정적으로 본문만 확보
//
// 배포 주의:
// - puppeteer-core는 Chromium을 포함하지 않음
// - Render 등 배포 환경에서는 Chrome/Chromium 바이너리 경로를 환경변수 PUPPETEER_EXECUTABLE_PATH로 지정하는 것을 권장

const path = require('node:path');

/** @type {import('puppeteer-extra') | null} */
let puppeteer = null;
let browserPromise = null;

function getDefaultUA() {
  // "너무 최신/너무 특이"하지 않은 안정적인 Chrome UA
  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/123.0.0.0 Safari/537.36'
  );
}

function resolveExecutablePath() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && String(env).trim()) return String(env).trim();

  // Render/Linux에서 흔한 후보들
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line global-require
      const fs = require('node:fs');
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return '';
}

function buildLaunchOptions(executablePath) {
  const opt = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote']
  };
  // puppeteer-core를 쓰는 환경에서는 executablePath가 필수이고,
  // puppeteer(Chromium 번들) 환경에서는 없어도 동작하므로 "있을 때만" 넣는다.
  if (executablePath) opt.executablePath = executablePath;
  return opt;
}

async function waitForCloudflare(page, timeoutMs) {
  // Cloudflare/Turnstile 챌린지가 풀릴 때까지 대기 (자동 해결 가능한 케이스만)
  // - "Just a moment..." / "Checking your browser" 등의 중간 페이지
  // - challenge iframe / turnstile input 존재 여부로 판단
  const max = Math.max(5_000, Math.min(120_000, Number(timeoutMs || 60_000)));
  const started = Date.now();
  while (Date.now() - started < max) {
    const ok = await page
      .evaluate(() => {
        const t = String(document.title || '').toLowerCase();
        const badTitle =
          t.includes('just a moment') ||
          t.includes('checking your browser') ||
          t.includes('attention required') ||
          t.includes('verify you are human');
        const hasChallenge =
          Boolean(document.querySelector('form#challenge-form')) ||
          Boolean(document.querySelector('iframe[src*="challenge-platform"]')) ||
          Boolean(document.querySelector('script[src*="challenge-platform"]')) ||
          Boolean(document.querySelector('input[name="cf-turnstile-response"]')) ||
          Boolean(document.querySelector('[id*="cf-challenge"], [class*="cf-challenge"], [class*="challenge-platform"]'));
        return !(badTitle || hasChallenge);
      })
      .catch(() => false);

    if (ok) return;
    // 네트워크/JS 리다이렉트로 페이지가 바뀌는 경우가 있어 짧게 대기
    await page.waitForTimeout(900);
  }
  const err = new Error('CLOUDFLARE_CHALLENGE_TIMEOUT');
  err.hint = 'Cloudflare 챌린지가 일정 시간 내에 해제되지 않았습니다.';
  throw err;
}

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    // lazy require to avoid crash when dependency missing
    try {
      // puppeteer-extra는 설치된 puppeteer/puppeteer-core를 자동으로 사용한다.
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      puppeteer = require('puppeteer-extra');
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteer.use(StealthPlugin());
    } catch (e) {
      const err = new Error('PUPPETEER_NOT_INSTALLED');
      err.cause = e;
      throw err;
    }

    const executablePath = resolveExecutablePath();
    // puppeteer-core만 설치된 환경에서는 executablePath가 없으면 런치가 실패하므로 명시적으로 에러.
    // puppeteer(Chromium 번들) 환경에서는 없어도 가능하므로 "있으면 사용" 정책을 채택.
    const hasCoreOnly = (() => {
      try {
        // eslint-disable-next-line global-require
        require.resolve('puppeteer');
        return false;
      } catch {}
      try {
        // eslint-disable-next-line global-require
        require.resolve('puppeteer-core');
        return true;
      } catch {}
      return false;
    })();
    if (hasCoreOnly && !executablePath) {
      const err = new Error('CHROME_NOT_FOUND');
      err.hint =
        'puppeteer-core 환경에서는 Chrome/Chromium 실행 파일이 필요합니다. ' +
        '환경변수 PUPPETEER_EXECUTABLE_PATH로 실행 파일 경로를 지정하세요.';
      throw err;
    }

    const browser = await puppeteer.launch(buildLaunchOptions(executablePath));
    return browser;
  })();
  return browserPromise;
}

function looksLikeScoreText(s) {
  const t = String(s || '');
  if (!t.trim()) return false;
  // 대략적인 코드/악보 텍스트 힌트 (과도한 오탐 방지)
  if (/\[ch\]/i.test(t)) return true;
  if (/\bKey\s*:\s*[A-G]/i.test(t)) return true;
  if (/\b[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?\b/.test(t) && t.includes('\n')) return true;
  return false;
}

function pickBestTextCandidate(list) {
  const arr = Array.isArray(list) ? list : [];
  let best = '';
  for (const x of arr) {
    const s = String(x || '');
    if (!looksLikeScoreText(s)) continue;
    if (s.length > best.length) best = s;
  }
  return best;
}

/**
 * @param {string} url
 * @param {{timeoutMs?:number, lang?:string}} [opt]
 * @returns {Promise<{html:string, finalUrl:string, ua:string, elapsedMs:number, extractedText?:string}>}
 */
async function fetchRenderedHtml(url, opt = {}) {
  const t0 = Date.now();
  const timeoutMs = Math.max(5_000, Math.min(120_000, Number(opt.timeoutMs || 60_000)));
  const lang = String(opt.lang || 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7');
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    const ua = getDefaultUA();
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({
      'accept-language': lang,
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'upgrade-insecure-requests': '1'
    });
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

    // Fair Use: 리소스 차단
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'media' || type === 'font') return req.abort();
      // 스타일시트도 대부분 불필요하지만, 사이트에 따라 본문 로딩에 영향을 주는 경우가 있어 허용
      return req.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Cloudflare 챌린지/리다이렉트가 끝날 때까지 기다린다.
    await waitForCloudflare(page, timeoutMs);
    // 최종 렌더/동적 로딩까지 한 번 더 안정화
    await page.waitForNetworkIdle({ idleTime: 800, timeout: timeoutMs }).catch(() => {});
    const finalUrl = page.url();
    const html = await page.content();

    // DOM에서 직접 텍스트 후보를 뽑는다(동적 렌더링/textarea.value/innerText 차이 보완)
    let extractedText = '';
    try {
      const candidates = await page.evaluate(() => {
        const toText = (el) => {
          try {
            if (!el) return '';
            if (el.tagName === 'TEXTAREA') return el.value || el.textContent || '';
            return el.innerText || el.textContent || '';
          } catch {
            return '';
          }
        };
        const pres = Array.from(document.querySelectorAll('pre')).map(toText);
        const textareas = Array.from(document.querySelectorAll('textarea')).map(toText);
        const codes = Array.from(document.querySelectorAll('code')).map(toText);
        const mains = Array.from(document.querySelectorAll('main, article, #content, #main')).map(toText);
        return { pres, textareas, codes, mains };
      });
      extractedText =
        pickBestTextCandidate(candidates?.pres) ||
        pickBestTextCandidate(candidates?.textareas) ||
        pickBestTextCandidate(candidates?.codes) ||
        pickBestTextCandidate(candidates?.mains);
    } catch {}

    return { html, finalUrl, ua, elapsedMs: Date.now() - t0, ...(extractedText ? { extractedText } : {}) };
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

module.exports = {
  fetchRenderedHtml
};
