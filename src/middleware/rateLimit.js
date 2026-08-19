/**
 * 소형 in-memory rate limiter (2차 감사 CHORD-3).
 *
 * GET/POST /api/proxy-chord와 POST /api/chord/upload는 인증 없이 외부 fetch·
 * puppeteer(headless chrome) 기동·kuromoji 파싱 같은 고비용 작업을 유발할 수
 * 있는데 어떤 한도도 없었다 — 소수 요청만으로 CPU/메모리 고갈(DoS)이 가능했다.
 *
 * sockets/index.js의 wbAllow/cursorAllow와 동일한 rolling-bucket 패턴을
 * 미들웨어로 일반화한 것. 단일 프로세스 전제(이 앱의 기존 전제)의 in-memory.
 * 키는 req.ip (app.js의 trust proxy 1 설정으로 Render 프록시 뒤에서도 실제
 * 클라이언트 IP가 잡힌다).
 */
function createRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  /** @type {Map<string, { ts: number, count: number }>} */
  const hits = new Map();

  function sweepIfLarge(now) {
    // 만료 엔트리가 무한히 쌓이지 않도록 크기 기준으로만 정리(주기 타이머 없음)
    if (hits.size < 5000) return;
    for (const [k, v] of hits) {
      if (now - v.ts > windowMs) hits.delete(k);
    }
  }

  return function rateLimit(req, res, next) {
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    sweepIfLarge(now);
    const w = hits.get(key) || { ts: now, count: 0 };
    if (now - w.ts > windowMs) {
      w.ts = now;
      w.count = 0;
    }
    w.count += 1;
    hits.set(key, w);
    if (w.count > max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
