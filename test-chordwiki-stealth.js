// chordwiki.jp 접근 테스트 (puppeteer + stealth)
// 사용:
//   node test-chordwiki-stealth.js
//   TARGET_URL="https://chordwiki.jp/..." node test-chordwiki-stealth.js
//   node test-chordwiki-stealth.js "https://chordwiki.jp/..."
//
// 참고:
// - puppeteer-core만 쓰는 환경이면 PUPPETEER_EXECUTABLE_PATH가 필요할 수 있음
// - Cloudflare 챌린지가 일정 시간 내 자동 해제되지 않으면 타임아웃 에러가 납니다.

const { fetchRenderedHtml } = require('./src/services/puppeteerFetch');

async function main() {
  const cli = process.argv[2];
  const url = cli || process.env.TARGET_URL || 'https://chordwiki.jp/';
  const timeoutMs = Number(process.env.TIMEOUT_MS || 90_000);
  const mode = String(process.env.OUTPUT || 'html'); // 'html' | 'text'

  const r = await fetchRenderedHtml(url, { timeoutMs, lang: 'ja-JP,ja;q=0.9' });
  console.error(`[ok] finalUrl=${r.finalUrl} elapsedMs=${r.elapsedMs}`);

  if (mode === 'text' && r.extractedText) {
    console.log(r.extractedText);
    return;
  }
  console.log(r.html);
}

main().catch((e) => {
  console.error('[error]', e?.message || e);
  if (e?.hint) console.error('[hint]', e.hint);
  process.exitCode = 1;
});

