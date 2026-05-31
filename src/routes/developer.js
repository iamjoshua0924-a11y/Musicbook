const express = require('express');
const { z } = require('zod');

const { requireDev } = require('../middleware/devAuth');
const { getJson, KEYS } = require('../services/syncStatus');
const { getTrafficMetrics, resetTrafficMetrics } = require('../services/trafficMetrics');
const { listErrors, clearErrors } = require('../services/errorLog');
const { store } = require('../sockets');
const Setting = require('../models/Setting');
const Song = require('../models/Song');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const Availability = require('../models/Availability');
const { buildPrivateArchivePath, getPrivateArchivePrefix } = require('../services/privateArchive');
const { getDriveRootFolderId, restartDriveSync, stopDriveSync } = require('../services/driveSyncRunner');
const { getFileMetadata, renameFile } = require('../services/drive');
const { getNowCount, getSeries } = require('../services/connectionHistory');

const router = express.Router();

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((err) => next(err));

// DEV_TOKEN is optional in env.js (we read raw process.env here as well)
function getDevToken() {
  // support both DEV_TOKEN and MUSICBOOK_DEV_TOKEN
  return String(process.env.DEV_TOKEN || process.env.MUSICBOOK_DEV_TOKEN || '').trim();
}

// POST /api/dev/auth  {token}
router.post(
  '/auth',
  asyncHandler(async (req, res) => {
    const schema = z.object({ token: z.string().min(1).max(200) }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    const token = String(parsed.data.token || '').trim();
    const expected = getDevToken();
    if (!expected) return res.status(500).json({ ok: false, error: 'DEV_TOKEN_NOT_CONFIGURED' });
    if (token !== expected) return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });
    req.session.devAuthed = true;
    req.session.devAuthedAt = Date.now();
    return res.json({ ok: true });
  })
);

// POST /api/dev/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    try {
      req.session.destroy(() => {});
    } catch {}
    res.json({ ok: true });
  })
);

// GET /api/dev/me
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, authed: Boolean(req.session?.devAuthed), authedAt: req.session?.devAuthedAt || null });
  })
);

// GET /api/dev/sessions  (T-12: live session snapshot)
router.get(
  '/sessions',
  requireDev,
  asyncHandler(async (_req, res) => {
    const rooms = [];
    try {
      for (const [roomCode, room] of store.rooms.entries()) {
        rooms.push({
          roomCode,
          memberCount: room.members?.size || 0,
          pageTurnerSocketId: room.pageTurnerSocketId || null,
          currentFileId: room.currentFileId || '',
          currentPageNo: room.currentPageNo || 1,
          rehearsalActive: Boolean(room.rehearsalActive),
          ageMs: room.createdAt ? Date.now() - Number(room.createdAt || 0) : null
        });
      }
    } catch {}
    rooms.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
    res.json({ ok: true, rooms });
  })
);

// GET /api/dev/sessions/stats (summary metrics)
router.get(
  '/sessions/stats',
  requireDev,
  asyncHandler(async (_req, res) => {
    let roomsCount = 0;
    let totalMembers = 0;
    let pageTurnerCount = 0;
    let rehearsalActiveCount = 0;
    let toolAuthorizedCount = 0;
    let toolRequestedCount = 0;
    let rehearsalEligibleCount = 0;
    let rehearsalReadyCount = 0;
    /** @type {Set<string>} */
    const uniqueMemberIds = new Set();

    try {
      for (const room of store.rooms.values()) {
        roomsCount += 1;
        totalMembers += room.members?.size || 0;
        if (room.pageTurnerSocketId) pageTurnerCount += 1;
        if (room.rehearsalActive) rehearsalActiveCount += 1;
        toolAuthorizedCount += room.toolAuthorizedSocketIds?.size || 0;
        toolRequestedCount += room.toolRequestSocketIds?.size || 0;
        rehearsalEligibleCount += room.rehearsalEligibleMemberIds?.size || 0;
        rehearsalReadyCount += room.rehearsalReadyMemberIds?.size || 0;
        try {
          for (const m of room.members?.values?.() || []) {
            const id = String(m?.memberId || '').trim();
            if (id) uniqueMemberIds.add(id);
          }
        } catch {}
      }
    } catch {}

    res.json({
      ok: true,
      stats: {
        roomsCount,
        totalMembers,
        uniqueMemberIds: uniqueMemberIds.size,
        pageTurnerCount,
        rehearsalActiveCount,
        toolAuthorizedCount,
        toolRequestedCount,
        rehearsalEligibleCount,
        rehearsalReadyCount
      }
    });
  })
);

// GET /api/dev/sessions/:roomCode  (detail)
router.get(
  '/sessions/:roomCode',
  requireDev,
  asyncHandler(async (req, res) => {
    const roomCode = String(req.params.roomCode || '').trim().toUpperCase();
    if (!roomCode) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    const room = store.rooms.get(roomCode);
    if (!room) return res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND' });

    const members = [];
    try {
      for (const [socketId, m] of room.members.entries()) {
        const memberId = String(m?.memberId || '');
        members.push({
          socketId,
          memberId,
          nickname: m?.nickname || '',
          displayName: m?.displayName || '',
          role: m?.role || '',
          profilePhoto: m?.profilePhoto || '',
          isPageTurner: String(room.pageTurnerSocketId || '') === String(socketId),
          isToolAuthorized: room.toolAuthorizedSocketIds?.has?.(socketId) || false,
          toolRequested: room.toolRequestSocketIds?.has?.(socketId) || false,
          isRehearsalEligible: memberId ? room.rehearsalEligibleMemberIds?.has?.(memberId) || false : false,
          isRehearsalReady: memberId ? room.rehearsalReadyMemberIds?.has?.(memberId) || false : false
        });
      }
    } catch {}
    members.sort((a, b) => (b.isPageTurner ? 1 : 0) - (a.isPageTurner ? 1 : 0));

    const files = [];
    try {
      for (const [fileId, anno] of room.annotationsByFile.entries()) {
        const pages = anno?.pages || {};
        const pageCount = Object.keys(pages || {}).length;
        files.push({ fileId: String(fileId), pageCount, updatedAt: anno?.updatedAt || null });
      }
    } catch {}

    res.json({
      ok: true,
      room: {
        roomCode,
        createdAt: room.createdAt || null,
        ageMs: room.createdAt ? Date.now() - Number(room.createdAt || 0) : null,
        memberCount: room.members?.size || 0,
        pageTurnerSocketId: room.pageTurnerSocketId || null,
        currentFileId: room.currentFileId || '',
        currentOriginalLink: room.currentOriginalLink || '',
        currentPageNo: room.currentPageNo || 1,
        currentScrollRatio: room.currentScrollRatio || 0,
        rehearsalActive: Boolean(room.rehearsalActive),
        viewerSettings: room.viewerSettings || null,
        toolAuthorizedCount: room.toolAuthorizedSocketIds?.size || 0,
        toolRequestedCount: room.toolRequestSocketIds?.size || 0,
        annotationsFiles: files
      },
      members
    });
  })
);

// GET /api/dev/metrics/traffic  (T-15)
router.get(
  '/metrics/traffic',
  requireDev,
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, data: getTrafficMetrics() });
  })
);
router.post(
  '/metrics/traffic/reset',
  requireDev,
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, data: resetTrafficMetrics() });
  })
);

// GET /api/dev/sync/status  (T-16: diff summary)
router.get(
  '/sync/status',
  requireDev,
  asyncHandler(async (_req, res) => {
    const status = await getJson(KEYS.driveSyncStatus, null);
    res.json({ ok: true, status });
  })
);

// Drive root folder config (dev)
router.get(
  '/drive-root',
  requireDev,
  asyncHandler(async (_req, res) => {
    const value = await getDriveRootFolderId();
    res.json({ ok: true, rootFolderId: value });
  })
);
router.patch(
  '/drive-root',
  requireDev,
  asyncHandler(async (req, res) => {
    const schema = z.object({ rootFolderId: z.string().max(300).optional().default('') }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    const value = String(parsed.data.rootFolderId || '').trim();
    await Setting.findOneAndUpdate({ key: 'driveRootFolderId' }, { $set: { key: 'driveRootFolderId', value } }, { upsert: true });
    res.json({ ok: true, rootFolderId: value });
  })
);

// Private archive prefix config (dev)
router.get(
  '/private-archive',
  requireDev,
  asyncHandler(async (_req, res) => {
    const prefix = await getPrivateArchivePrefix();
    res.json({ ok: true, prefix });
  })
);

// Users list (dev) - includes private flag & archive url
router.get(
  '/users',
  requireDev,
  asyncHandler(async (_req, res) => {
    const items = await User.find({}).sort({ lastSeenAt: -1, userId: 1 }).limit(800).lean();
    const withArchive = await Promise.all(
      items.map(async (u) => ({
        userId: u.userId,
        role: u.role,
        displayName: u.displayName || u.userId,
        active: u.active !== false,
        isPrivate: Boolean(u.isPrivate),
        lastSeenAt: u.lastSeenAt || null,
        createdAt: u.createdAt || null,
        archivePath: u.isPrivate ? await buildPrivateArchivePath(u.userId) : ''
      }))
    );
    res.json({ ok: true, items: withArchive });
  })
);

// Create private user (dev) - password fixed 1234
router.post(
  '/users/private',
  requireDev,
  asyncHandler(async (req, res) => {
    const schema = z
      .object({
        userId: z.string().min(1).max(80),
        displayName: z.string().max(80).optional().default('')
      })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    const userId = String(parsed.data.userId || '').trim();
    const displayName = String(parsed.data.displayName || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

    const passwordHash = await bcrypt.hash('1234', 10);
    const doc = await User.findOneAndUpdate(
      { userId },
      { $set: { userId, passwordHash, role: 'session', displayName, active: true, isPrivate: true, mustChangePassword: false } },
      { upsert: true, new: true }
    ).lean();

    const archivePath = await buildPrivateArchivePath(userId);
    res.json({
      ok: true,
      user: {
        userId: doc.userId,
        role: doc.role,
        displayName: doc.displayName || doc.userId,
        active: doc.active !== false,
        isPrivate: Boolean(doc.isPrivate),
        archivePath
      },
      password: '1234'
    });
  })
);

// Delete private user (dev only)
router.delete(
  '/users/private/:userId',
  requireDev,
  asyncHandler(async (req, res) => {
    const userId = String(req.params?.userId || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    const existed = await User.findOne({ userId }).lean();
    if (!existed) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    if (!existed.isPrivate) return res.status(400).json({ ok: false, error: 'NOT_PRIVATE' });
    await Availability.deleteMany({ userId });
    await User.deleteOne({ userId });
    res.json({ ok: true });
  })
);

// Drive sync controls (dev)
router.post(
  '/sync/drive',
  requireDev,
  asyncHandler(async (req, res) => {
    const latestDays = Number(req.body?.latestDays || 1);
    const limit = Number(req.body?.limit || 5000);
    const pruneMissing = req.body?.pruneMissing !== undefined ? Boolean(req.body.pruneMissing) : true;
    const incremental = Boolean(req.body?.incremental);
    const rootFolderId = String(req.body?.rootFolderId || '').trim();
    const r = await restartDriveSync({ latestDays, limit, pruneMissing, incremental, rootFolderId });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error || 'SYNC_FAILED' });
    res.json({ ok: true, ...r });
  })
);
router.post(
  '/sync/stop',
  requireDev,
  asyncHandler(async (_req, res) => {
    const r = stopDriveSync();
    res.json({ ok: true, ...r });
  })
);

// Parse errors list (dev)
router.get(
  '/songs/parse-errors',
  requireDev,
  asyncHandler(async (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 100)));
    const items = await Song.find({ parseError: { $ne: '' } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    const withDriveName = [];
    const conc = 8;
    for (let i = 0; i < items.length; i += conc) {
      const chunk = items.slice(i, i + conc);
      // eslint-disable-next-line no-await-in-loop
      const metas = await Promise.all(
        chunk.map(async (s) => {
          try {
            const meta = await getFileMetadata(String(s.googleFileId || '').trim());
            return meta?.name || '';
          } catch {
            return '';
          }
        })
      );
      chunk.forEach((s, idx) => withDriveName.push({ ...s, driveName: metas[idx] || '' }));
    }

    res.json({
      ok: true,
      items: withDriveName.map((s) => ({
        _id: String(s._id),
        googleFileId: s.googleFileId,
        driveName: s.driveName || '',
        title: s.title,
        displayTitle: s.displayTitle,
        artist: s.artist,
        key: s.key,
        driveUrl: s.driveUrl,
        folderPath: s.folderPath,
        parseError: s.parseError
      }))
    });
  })
);

// Patch song for parse-error fixing (dev)
router.patch(
  '/songs/:id',
  requireDev,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').trim();
    const title = req.body?.title !== undefined ? String(req.body.title || '').trim() : undefined;
    const displayTitle = req.body?.displayTitle !== undefined ? String(req.body.displayTitle || '').trim() : undefined;
    const artist = req.body?.artist !== undefined ? String(req.body.artist || '').trim() : undefined;
    const key = req.body?.key !== undefined ? String(req.body.key || '').trim() : undefined;
    const renameDriveName = req.body?.renameDriveName !== undefined ? Boolean(req.body.renameDriveName) : false;
    if (!id) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

    const update = {};
    if (title !== undefined) update.title = title;
    if (displayTitle !== undefined) update.displayTitle = displayTitle;
    if (artist !== undefined) update.artist = artist;
    if (key !== undefined) update.key = key;
    update.parseError = '';
    update.updatedAt = new Date();

    const before = await Song.findById(id).lean();
    if (!before) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    const merged = {
      title: update.title ?? before.title ?? '',
      displayTitle: update.displayTitle ?? before.displayTitle ?? '',
      artist: update.artist ?? before.artist ?? '',
      key: update.key ?? before.key ?? ''
    };
    update.searchText = `${merged.displayTitle} ${merged.title} ${merged.artist} ${merged.key}`.toLowerCase().trim();

    const buildDriveName = (merged2, existingName) => {
      const extM = String(existingName || '').match(/\.[^.]+$/);
      const ext = extM ? extM[0] : '.pdf';
      const t0 = String(merged2.displayTitle || merged2.title || '').trim() || '제목없음';
      const k0 = String(merged2.key || '').trim();
      const a0 = String(merged2.artist || '').trim();
      const safe = (s) => String(s || '').replace(/[\\\\/]/g, '_').trim();
      const t = safe(t0);
      const k = safe(k0);
      const a = safe(a0);
      const base = `${t}${k ? `(${k})` : ''}${a ? `-${a}` : ''}`;
      return `${base}${ext}`;
    };

    let renameError = '';
    const doc = await Song.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

    if (renameDriveName) {
      try {
        const fileId = String(before.googleFileId || '').trim();
        if (fileId) {
          const meta = await getFileMetadata(fileId);
          const desired = buildDriveName(merged, meta?.name || '');
          await renameFile(fileId, desired);
        }
      } catch (e) {
        renameError = String(e?.message || e || 'DRIVE_RENAME_FAILED');
      }
    }

    res.json({
      ok: true,
      renameError: renameError || undefined,
      item: { _id: String(doc._id), title: doc.title, displayTitle: doc.displayTitle, artist: doc.artist, key: doc.key, parseError: doc.parseError }
    });
  })
);

// GET /api/dev/errors (T-14)
router.get(
  '/errors',
  requireDev,
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, items: listErrors() });
  })
);
router.post(
  '/errors/clear',
  requireDev,
  asyncHandler(async (_req, res) => {
    clearErrors();
    res.json({ ok: true });
  })
);

// GET /api/dev/users (T-18)
router.get(
  '/users',
  requireDev,
  asyncHandler(async (_req, res) => {
    const users = await User.find({}, { userId: 1, role: 1, displayName: 1, active: 1, lastSeenAt: 1, createdAt: 1 })
      .sort({ userId: 1 })
      .lean();
    res.json({
      ok: true,
      items: (users || []).map((u) => ({
        userId: u.userId,
        role: u.role,
        displayName: u.displayName || '',
        active: u.active !== false,
        lastSeenAt: u.lastSeenAt || null,
        createdAt: u.createdAt || null
      }))
    });
  })
);

// GET /api/dev/connections (T-19)
router.get(
  '/connections',
  requireDev,
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, nowCount: getNowCount(), points: getSeries({}) });
  })
);

module.exports = router;
