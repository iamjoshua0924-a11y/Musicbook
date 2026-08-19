const http = require('node:http');
const { Server } = require('socket.io');

const { port, env } = require('./config/env');
const { connectMongo } = require('./db/mongoose');
const { createApp } = require('./app');
const { attachSockets } = require('./sockets');
const { chzzkIngestor } = require('./services/chzzkIngestor');
const { pushError } = require('./services/errorLog');

// ---------------------------------------------------------------------------
// Process-level safety net (2차 감사 P0-1)
// ---------------------------------------------------------------------------
// 라우트 핸들러는 asyncHandler로 감싸 rejection을 Express 에러 핸들러로 보낸다.
// 그러나 라우트 밖(소켓 핸들러, fire-and-forget, driveSync onProgress 등,
// 2차 감사 DS-02)에서 발생하는 unhandledRejection은 여전히 Node 기본 정책으로
// 프로세스를 종료시킨다. 여기서 그것을 잡아 로깅만 하고 프로세스를 살려 둔다.
//
// 이 리스너 자체가 다시 던지지 않는 한 Node는 프로세스를 죽이지 않는다.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', err?.message || err, String(err?.stack || '').split('\n').slice(0, 6).join('\n'));
  try {
    pushError({
      method: 'PROCESS',
      path: 'unhandledRejection',
      message: err?.message || String(err),
      code: err?.code || '',
      status: 0,
      stack: String(err?.stack || '').split('\n').slice(0, 10).join('\n')
    });
  } catch {}
});

// uncaughtException은 상태 오염 가능성이 있어 일반적으로 종료가 권장되나,
// 이 앱은 in-memory 세션룸/주석을 갖고 있어 한 번의 예외로 전원을 끊는 비용이
// 크다. 로깅 후 생존시키되(백스톱), 심각한 케이스는 로그로 추적한다.
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[uncaughtException]', err?.message || err, String(err?.stack || '').split('\n').slice(0, 6).join('\n'));
  try {
    pushError({
      method: 'PROCESS',
      path: 'uncaughtException',
      message: err?.message || String(err),
      code: err?.code || '',
      status: 0,
      stack: String(err?.stack || '').split('\n').slice(0, 10).join('\n')
    });
  } catch {}
});

// DS-03b(2차 감사): sync 도중 프로세스가 재시작(배포/크래시)되면 DB의
// driveSyncStatus에 running:true가 남는다. in-memory lock은 리셋되지만
// UI(/dev·musicbook 관리자 메뉴)는 DB status를 보고 영구 '동기화 중'으로
// 잠긴다. 부팅 시 1회 정리한다(best-effort — 실패해도 부팅은 계속).
async function cleanupStaleSyncStatus() {
  try {
    const { KEYS, getJson, setJson } = require('./services/syncStatus');
    const s = await getJson(KEYS.driveSyncStatus, null);
    if (s && s.running === true) {
      await setJson(KEYS.driveSyncStatus, {
        ...s,
        running: false,
        ok: false,
        error: s.error || 'INTERRUPTED_BY_RESTART',
        endedAt: s.endedAt || new Date().toISOString()
      });
      // eslint-disable-next-line no-console
      console.log('[musicbook-server] cleared stale driveSyncStatus.running (process restarted during sync)');
    }
  } catch {}
}

async function main() {
  // In dev, allow the server to start even if MongoDB is not reachable
  // (e.g., Atlas IP whitelist not configured). Routes that require DB may fail
  // until a connection is established.
  if (env === 'development') {
    connectMongo()
      .then(() => cleanupStaleSyncStatus())
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[musicbook-server] MongoDB connection failed:', err?.message || err);
      });
  } else {
    await connectMongo();
    cleanupStaleSyncStatus().catch(() => {});
  }

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: true, credentials: true }
  });

  attachSockets(io);
  // Expose io to routes for broadcasting (MVP).
  app.locals.io = io;
  // Expose io to chzzk ingestor for request broadcasting
  chzzkIngestor.attachIO(io);

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[musicbook-server] listening on :${port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
