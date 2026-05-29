const express = require('express');
const { z } = require('zod');

const { requireDev } = require('../middleware/devAuth');
const { getJson, KEYS } = require('../services/syncStatus');
const { getTrafficMetrics, resetTrafficMetrics } = require('../services/trafficMetrics');
const { listErrors, clearErrors } = require('../services/errorLog');
const { store } = require('../sockets');

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

module.exports = router;
