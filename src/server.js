const http = require('node:http');
const { Server } = require('socket.io');

const { port } = require('./config/env');
const { connectMongo } = require('./db/mongoose');
const { createApp } = require('./app');
const { attachSockets } = require('./sockets');

async function main() {
  await connectMongo();

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: true, credentials: true }
  });

  attachSockets(io);
  // Expose io to routes for broadcasting (MVP).
  app.locals.io = io;

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
