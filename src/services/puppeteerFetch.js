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

/** @type {import('puppeteer-core') | null} */
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

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    // lazy require to avoid crash when dependency missing
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      puppeteer = require('puppeteer-core');
    } catch (e) {
      const err = new Error('PUPPETEER_NOT_INSTALLED');
      err.cause = e;
      throw err;
    }

    const executablePath = resolveExecutablePath();
    if (!executablePath) {
      const err = new Error('CHROME_NOT_FOUND');
      err.hint =
        '배포 환경에 Chrome/Chromium이 필요합니다. ' +
        '환경변수 PUPPETEER_EXECUTABLE_PATH로 실행 파일 경로를 지정하세요.';
      throw err;
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote'
      ]
    });
    return browser;
  })();
  return browserPromise;
}

/**
 * @param {string} url
 * @param {{timeoutMs?:number, lang?:string}} [opt]
 * @returns {Promise<{html:string, finalUrl:string, ua:string, elapsedMs:number}>}
 */
async function fetchRenderedHtml(url, opt = {}) {
  const t0 = Date.now();
  const timeoutMs = Math.max(5_000, Math.min(60_000, Number(opt.timeoutMs || 25_000)));
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

    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    const finalUrl = page.url();
    const html = await page.content();
    return { html, finalUrl, ua, elapsedMs: Date.now() - t0 };
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

module.exports = {
  fetchRenderedHtml
};
