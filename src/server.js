const http = require('node:http');
const { Server } = require('socket.io');

const { port, env, autoDriveSync, autoDriveSyncIntervalMin } = require('./config/env');
const { connectMongo } = require('./db/mongoose');
const { createApp } = require('./app');
const { attachSockets } = require('./sockets');
const { runDriveSync } = require('./services/driveSyncRunner');

async function main() {
  // In dev, allow the server to start even if MongoDB is not reachable
  // (e.g., Atlas IP whitelist not configured). Routes that require DB may fail
  // until a connection is established.
  if (env === 'development') {
    connectMongo().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[musicbook-server] MongoDB connection failed:', err?.message || err);
    });
  } else {
    await connectMongo();
  }

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: true, credentials: true }
  });

  attachSockets(io);
  // Expose io to routes for broadcasting (MVP).
  app.locals.io = io;

  if (env === 'production' && autoDriveSync) {
    const intervalMs = Math.max(10, Number(autoDriveSyncIntervalMin || 10)) * 60 * 1000;
    // eslint-disable-next-line no-console
    console.log(`[musicbook-server] auto drive sync enabled (every ${Math.round(intervalMs / 60000)}m)`);
    // first run shortly after boot (avoid blocking start)
    setTimeout(() => runDriveSync({ incremental: true }).catch(() => {}), 10_000);
    setInterval(() => runDriveSync({ incremental: true }).catch(() => {}), intervalMs);
  }

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
