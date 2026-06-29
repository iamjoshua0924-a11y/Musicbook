const http = require('node:http');
const { Server } = require('socket.io');

const { port, env } = require('./config/env');
const { connectMongo } = require('./db/mongoose');
const { createApp } = require('./app');
const { attachSockets } = require('./sockets');
const { chzzkIngestor } = require('./services/chzzkIngestor');

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
