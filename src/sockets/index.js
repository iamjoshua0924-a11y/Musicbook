const ViewerAnnoSnapshot = require('../models/ViewerAnnoSnapshot');
const Request = require('../models/Request');
const { SessionStore } = require('./sessionStore');
const { verifySocketMetaToken } = require('../services/socketMeta');

const store = new SessionStore();

// Presence (main page) - in-memory only
const presence = new Map(); // socketId -> { nickname, role, displayName, profilePhoto, ts }

// Whiteboard rate-limit (per socket, best-effort)
const wbRate = new Map(); // socketId -> { ts, count }
function wbAllow(socketId) {
  const now = Date.now();
  const w = wbRate.get(socketId) || { ts: now, count: 0 };
  // rolling 1s bucket
  if (now - w.ts > 1000) {
    w.ts = now;
    w.count = 0;
  }
  w.count += 1;
  wbRate.set(socketId, w);
  // allow up to 20 updates/sec per socket
  return w.count <= 20;
}

function emitPresence(io) {
  const items = Array.from(presence.entries()).map(([socketId, p]) => ({
    socketId,
    nickname: p.nickname,
    role: p.role,
    displayName: p.displayName,
    profilePhoto: p.profilePhoto,
    ts: p.ts
  }));
  io.to('room:main').emit('presence:list', { items });
  io.to('room:main').emit('main:onlineCount', { count: items.length });
}

function toSessionRoomName(roomCode) {
  return `room:session:${roomCode}`;
}

function buildParticipantsPayload(room) {
  const members = Array.from(room.members.entries()).map(([socketId, m]) => ({
    socketId,
    nickname: m.nickname,
    role: m.role,
    displayName: m.displayName,
    profilePhoto: m.profilePhoto,
    isPageTurner: socketId === room.pageTurnerSocketId
  }));
  return { roomCode: room.roomCode, members };
}

function emitRoomState(io, room) {
  io.to(toSessionRoomName(room.roomCode)).emit('session:pageTurner:state', {
    roomCode: room.roomCode,
    pageTurnerSocketId: room.pageTurnerSocketId,
    pageTurnerName: room.pageTurnerSocketId ? room.members.get(room.pageTurnerSocketId)?.nickname : null
  });
  io.to(toSessionRoomName(room.roomCode)).emit('session:participants', buildParticipantsPayload(room));
  io.to(toSessionRoomName(room.roomCode)).emit('session:state', {
    roomCode: room.roomCode,
    currentFileId: room.currentFileId,
    currentPageNo: room.currentPageNo
  });
}

async function loadSnapshot(roomCode, fileId) {
  const doc = await ViewerAnnoSnapshot.findOne({ roomCode, fileId }).lean();
  if (!doc) return null;
  return doc.snapshot;
}

async function saveSnapshotOnce(roomCode, fileId, snapshot) {
  const now = new Date();
  const expireAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await ViewerAnnoSnapshot.updateOne(
    { roomCode, fileId },
    { $set: { roomCode, fileId, snapshot, updatedAt: now, expireAt } },
    { upsert: true }
  );
}

function attachSockets(io) {
  io.on('connection', (socket) => {
    const nickname = socket.handshake.auth?.nickname || '익명';
    const metaToken = socket.handshake.auth?.metaToken;
    const meta = verifySocketMetaToken(metaToken) || { role: 'viewer', displayName: nickname, userId: '' };

    socket.data.nickname = nickname;
    socket.data.role = meta.role || 'viewer';
    socket.data.displayName = meta.displayName || nickname;
    socket.data.userId = meta.userId || '';
    socket.data.joinedRooms = new Set(); // roomCode set

    // --- Main presence -------------------------------------------------------------
    socket.on('main:join', (payload, ack) => {
      const nn = String(payload?.nickname || socket.data.nickname || '익명').slice(0, 20);
      socket.data.nickname = nn;
      presence.set(socket.id, {
        nickname: nn,
        role: socket.data.role || 'viewer',
        displayName: socket.data.displayName || nn,
        profilePhoto: String(payload?.profilePhoto || ''),
        ts: Date.now()
      });
      socket.join('room:main');
      emitPresence(io);
      ack?.({ ok: true });
    });

    socket.on('main:leave', (_payload, ack) => {
      presence.delete(socket.id);
      socket.leave('room:main');
      emitPresence(io);
      ack?.({ ok: true });
    });

    socket.on('presence:refresh', () => {
      emitPresence(io);
    });

    // --- Session creation/join/leave -------------------------------------------------
    socket.on('session:create', async (_payload, ack) => {
      try {
        const roomCode = store.createRoom();
        if (ack) ack({ ok: true, roomCode });
      } catch (e) {
        if (ack) ack({ ok: false, error: 'CREATE_FAILED' });
      }
    });

    socket.on('session:join', async (payload, ack) => {
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
      const nickname = String(payload?.nickname || socket.data.nickname || '익명').slice(0, 20);
      const role = socket.data.role || 'viewer';
      const displayName = socket.data.displayName || nickname;
      const profilePhoto = String(payload?.profilePhoto || '');
      if (!roomCode) return ack?.({ ok: false, error: 'ROOM_REQUIRED' });

      const room = store.getOrCreateRoom(roomCode);

      socket.data.nickname = nickname;
      room.members.set(socket.id, { nickname, role, displayName, profilePhoto });
      socket.data.joinedRooms.add(roomCode);

      await socket.join(toSessionRoomName(roomCode));

      // First joiner becomes page turner automatically (requirement).
      if (!room.pageTurnerSocketId) room.pageTurnerSocketId = socket.id;

      emitRoomState(io, room);
      ack?.({ ok: true, roomCode, isPageTurner: socket.id === room.pageTurnerSocketId });

      // If room has a current file, auto-follow for late joiners.
      if (room.currentFileId) {
        socket.emit('session:follow:file', { fileId: room.currentFileId });
        socket.emit('viewer:page_change', { fileId: room.currentFileId, pageNo: room.currentPageNo });
      }

      // Lazy-load snapshot for (room,file) when first participant arrives after restart
      // (only when we already know fileId).
      if (room.currentFileId) {
        const snap = await loadSnapshot(roomCode, room.currentFileId);
        if (snap) socket.emit('wb:sync', { fileId: room.currentFileId, snapshot: snap });
      }
    });

    socket.on('session:participants:refresh', async (payload) => {
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
      const room = store.rooms.get(roomCode);
      if (!room) return;
      socket.emit('session:participants', buildParticipantsPayload(room));
      socket.emit('session:state', { roomCode, currentFileId: room.currentFileId, currentPageNo: room.currentPageNo });
    });

    socket.on('session:leave', async (payload, ack) => {
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
      if (!roomCode) return ack?.({ ok: false });

      const room = store.rooms.get(roomCode);
      socket.data.joinedRooms.delete(roomCode);
      await socket.leave(toSessionRoomName(roomCode));

      if (room) {
        room.members.delete(socket.id);
        if (room.pageTurnerSocketId === socket.id) room.pageTurnerSocketId = null;

        // If empty -> persist minimal snapshot ONCE.
        if (room.members.size === 0) {
          if (room.currentFileId) {
            const anno = room.annotationsByFile.get(room.currentFileId);
            if (anno?.pages) {
              saveSnapshotOnce(roomCode, room.currentFileId, anno.pages).catch(() => {});
            }
          }
          store.deleteRoom(roomCode);
        } else {
          // If turner left, auto-assign first remaining.
          if (!room.pageTurnerSocketId) {
            room.pageTurnerSocketId = room.members.keys().next().value || null;
          }
          emitRoomState(io, room);
        }
      }
      ack?.({ ok: true });
    });

    // --- Turner transfer & page change ----------------------------------------------
    socket.on('session:pageTurner:transfer', async (payload, ack) => {
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
      const targetSocketId = String(payload?.targetSocketId || '');
      const room = store.rooms.get(roomCode);
      if (!room) return ack?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      if (room.pageTurnerSocketId !== socket.id) return ack?.({ ok: false, error: 'FORBIDDEN' });
      if (!room.members.has(targetSocketId)) return ack?.({ ok: false, error: 'TARGET_NOT_IN_ROOM' });

      room.pageTurnerSocketId = targetSocketId;
      emitRoomState(io, room);
      ack?.({ ok: true });

      // MUST: immediate re-sync trigger.
      io.to(targetSocketId).emit('session:pageTurner:sync_request', {
        roomCode,
        fileId: room.currentFileId,
        pageNo: room.currentPageNo
      });
    });

    socket.on('viewer:page_change', async (payload, ack) => {
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
      const fileId = String(payload?.fileId || '').trim();
      const pageNo = Number(payload?.pageNo || 1);

      const room = store.rooms.get(roomCode);
      if (!room) return ack?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      if (room.pageTurnerSocketId !== socket.id) return ack?.({ ok: false, error: 'FORBIDDEN' });
      if (!fileId) return ack?.({ ok: false, error: 'FILE_REQUIRED' });

      room.currentFileId = fileId;
      room.currentPageNo = pageNo;

      io.to(toSessionRoomName(roomCode)).emit('viewer:page_change', { fileId, pageNo });
      io.to(toSessionRoomName(roomCode)).emit('session:state', { roomCode, currentFileId: fileId, currentPageNo: pageNo });
      ack?.({ ok: true });
    });

    // --- Follow file (song change sync) ---------------------------------------------
    socket.on('session:follow:file', async (payload, ack) => {
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
      const fileId = String(payload?.fileId || '').trim();
      const room = store.rooms.get(roomCode);
      if (!room) return ack?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      if (room.pageTurnerSocketId !== socket.id) return ack?.({ ok: false, error: 'FORBIDDEN' });
      if (!fileId) return ack?.({ ok: false, error: 'FILE_REQUIRED' });

      room.currentFileId = fileId;
      room.currentPageNo = 1;

      io.to(toSessionRoomName(roomCode)).emit('session:follow:file', { fileId });
      io.to(toSessionRoomName(roomCode)).emit('viewer:page_change', { fileId, pageNo: 1 });
      io.to(toSessionRoomName(roomCode)).emit('session:state', { roomCode, currentFileId: fileId, currentPageNo: 1 });

      // Lazy-load stored snapshot if exists (server restart case).
      const snap = await loadSnapshot(roomCode, fileId);
      if (snap) io.to(toSessionRoomName(roomCode)).emit('wb:sync', { fileId, snapshot: snap });

      ack?.({ ok: true });
    });

    // --- Whiteboard snapshot sync (page-based SSOT) --------------------------------
    socket.on('wb:page:update', async (payload, ack) => {
      // protect server from floods
      if (!wbAllow(socket.id)) return ack?.({ ok: false, error: 'RATE_LIMIT' });
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
      const fileId = String(payload?.fileId || '').trim();
      const pageNo = String(payload?.pageNo || '').trim();
      const pageSnapshot = payload?.pageSnapshot; // { json, w, h }

      const room = store.rooms.get(roomCode);
      if (!room) return ack?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      if (!fileId || !pageNo) return ack?.({ ok: false, error: 'BAD_REQUEST' });
      if (!pageSnapshot || typeof pageSnapshot !== 'object') return ack?.({ ok: false, error: 'BAD_REQUEST' });

      // size guard (very rough)
      try {
        const size = JSON.stringify(pageSnapshot?.json || {}).length;
        if (size > 300000) return ack?.({ ok: false, error: 'PAYLOAD_TOO_LARGE' });
      } catch {
        return ack?.({ ok: false, error: 'BAD_REQUEST' });
      }

      let fileAnno = room.annotationsByFile.get(fileId);
      if (!fileAnno) {
        fileAnno = { pages: {}, updatedAt: Date.now() };
        room.annotationsByFile.set(fileId, fileAnno);
      }

      fileAnno.pages[pageNo] = pageSnapshot;
      fileAnno.updatedAt = Date.now();

      io.to(toSessionRoomName(roomCode)).emit('wb:page:update', { fileId, pageNo, pageSnapshot });
      ack?.({ ok: true });
    });

    socket.on('wb:sync:request', async (payload, ack) => {
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
      const fileId = String(payload?.fileId || '').trim();
      const room = store.rooms.get(roomCode);
      if (!room) return ack?.({ ok: false, error: 'ROOM_NOT_FOUND' });

      const fileAnno = room.annotationsByFile.get(fileId);
      if (fileAnno?.pages) {
        socket.emit('wb:sync', { fileId, snapshot: fileAnno.pages });
        return ack?.({ ok: true, source: 'memory' });
      }

      const snap = await loadSnapshot(roomCode, fileId);
      if (snap) {
        socket.emit('wb:sync', { fileId, snapshot: snap });
        return ack?.({ ok: true, source: 'db' });
      }
      ack?.({ ok: true, source: 'empty' });
    });

    socket.on('disconnect', async () => {
      // remove from presence
      if (presence.has(socket.id)) {
        presence.delete(socket.id);
        emitPresence(io);
      }
      wbRate.delete(socket.id);
      // Remove from all joined session rooms.
      for (const roomCode of socket.data.joinedRooms || []) {
        const room = store.rooms.get(roomCode);
        if (!room) continue;
        room.members.delete(socket.id);
        if (room.pageTurnerSocketId === socket.id) room.pageTurnerSocketId = null;

        if (room.members.size === 0) {
          if (room.currentFileId) {
            const anno = room.annotationsByFile.get(room.currentFileId);
            if (anno?.pages) {
              saveSnapshotOnce(roomCode, room.currentFileId, anno.pages).catch(() => {});
            }
          }
          store.deleteRoom(roomCode);
        } else {
          if (!room.pageTurnerSocketId) {
            room.pageTurnerSocketId = room.members.keys().next().value || null;
          }
          emitRoomState(io, room);
        }
      }
    });
  });

  // Helper: broadcast current requests to all (simple MVP).
  const broadcastRequests = async () => {
    const items = await Request.find({}).sort({ createdAt: -1 }).limit(500).lean();
    io.emit('requests:updated', { items });
  };

  // Expose for routes to trigger later (hooked in app via io reference in next iteration).
  io.broadcastRequests = broadcastRequests;
}

module.exports = { attachSockets };
