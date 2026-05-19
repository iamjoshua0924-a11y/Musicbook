const express = require('express');
const Request = require('../models/Request');
const { requireSessionOrAdmin, requireAdmin } = require('../middleware/auth');
const { ensureRequesterSession } = require('../middleware/requesterSession');

const router = express.Router();

// Public read
router.get('/requests', async (req, res) => {
  const items = await Request.find({}).sort({ createdAt: -1 }).limit(500).lean();
  res.json({ ok: true, items });
});

// Create (anonymous)
router.post('/requests', ensureRequesterSession, async (req, res) => {
  const requesterName = String(req.body?.requesterName || '').trim() || '익명';
  const songTitle = String(req.body?.songTitle || '').trim();
  const artist = String(req.body?.artist || '').trim();
  const targetSinger = String(req.body?.targetSinger || '').trim();
  const memo = String(req.body?.memo || '').trim();

  if (!songTitle) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const doc = await Request.create({
    requesterSessionId: req.requesterSessionId,
    requesterName,
    songTitle,
    artist,
    targetSinger,
    memo
  });

  req.app.locals.io?.broadcastRequests?.().catch?.(() => {});
  res.json({ ok: true, item: doc.toObject() });
});

// Update (admin or requester)
router.patch('/requests/:id', ensureRequesterSession, async (req, res) => {
  const id = req.params.id;
  const doc = await Request.findById(id);
  if (!doc) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const isAdmin = req.session?.user?.role === 'admin';
  const isOwner = doc.requesterSessionId === req.requesterSessionId;
  if (!isAdmin && !isOwner) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  if (req.body?.memo !== undefined) doc.memo = String(req.body.memo || '');
  if (req.body?.targetSinger !== undefined) doc.targetSinger = String(req.body.targetSinger || '');

  // status change: only session/admin
  if (req.body?.status !== undefined) {
    const canChangeStatus = isAdmin || req.session?.user?.role === 'session';
    if (!canChangeStatus) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    doc.status = String(req.body.status);
  }

  await doc.save();
  req.app.locals.io?.broadcastRequests?.().catch?.(() => {});
  res.json({ ok: true, item: doc.toObject() });
});

// Delete (admin or requester)
router.delete('/requests/:id', ensureRequesterSession, async (req, res) => {
  const id = req.params.id;
  const doc = await Request.findById(id);
  if (!doc) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const isAdmin = req.session?.user?.role === 'admin';
  const isOwner = doc.requesterSessionId === req.requesterSessionId;
  if (!isAdmin && !isOwner) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  await Request.deleteOne({ _id: id });
  req.app.locals.io?.broadcastRequests?.().catch?.(() => {});
  res.json({ ok: true });
});

// Admin-only: clear all
router.post('/requests/clear', requireAdmin, async (req, res) => {
  await Request.deleteMany({});
  req.app.locals.io?.broadcastRequests?.().catch?.(() => {});
  res.json({ ok: true });
});

module.exports = router;
