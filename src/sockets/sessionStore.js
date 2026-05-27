const { nanoid } = require('nanoid');

/**
 * In-memory session room store.
 * NOTE: Render free may restart -> state is ephemeral by design.
 * Minimal backup only persists final annotations snapshot when room empties.
 */
class SessionStore {
  constructor() {
    /** @type {Map<string, any>} */
    this.rooms = new Map(); // roomCode -> roomState
  }

  createRoom() {
    const roomCode = nanoid(6).toUpperCase(); // e.g. ABCD12
    this.rooms.set(roomCode, {
      roomCode,
      createdAt: Date.now(),
      pageTurnerSocketId: null,
      currentFileId: null,
      currentFileRev: 0,
      currentOriginalLink: '',
      currentScrollRatio: 0,
      viewerSettings: null,
      currentPageNo: 1,
      members: new Map(), // socketId -> { nickname, role, displayName, profilePhoto }
      toolAuthorizedSocketIds: new Set(), // socketIds allowed to use tools (besides pageTurner)
      toolRequestSocketIds: new Set(), // pending requests
      // annotations: Map<fileId, { pages: { [pageNo]: {json,w,h}}, updatedAt }>
      annotationsByFile: new Map()
    });
    return roomCode;
  }

  getOrCreateRoom(roomCode) {
    if (!this.rooms.has(roomCode)) {
      this.rooms.set(roomCode, {
        roomCode,
        createdAt: Date.now(),
        pageTurnerSocketId: null,
        currentFileId: null,
        currentFileRev: 0,
        currentOriginalLink: '',
        currentScrollRatio: 0,
        viewerSettings: null,
        currentPageNo: 1,
        members: new Map(),
        toolAuthorizedSocketIds: new Set(),
        toolRequestSocketIds: new Set(),
        annotationsByFile: new Map()
      });
    }
    return this.rooms.get(roomCode);
  }

  deleteRoom(roomCode) {
    this.rooms.delete(roomCode);
  }
}

module.exports = { SessionStore };
