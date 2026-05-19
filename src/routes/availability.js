const express = require('express');
const Availability = require('../models/Availability');
const { requireSessionOrAdmin } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// Public read (used by viewer filters later)
router.get('/availability', async (req, res) => {
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'USER_REQUIRED' });
  const items = await Availability.find({ userId }).lean();
  res.json({ ok: true, items });
});

// Public: list users selectable in "가능보컬" filter.
// NOTE: do NOT filter out admin; role 구분 없이 모두 선택 가능하게 유지.
router.get('/availability/users', async (_req, res) => {
  const users = await User.find({ active: { $ne: false }, role: { $in: ['admin', 'session'] } })
    .sort({ role: 1, displayName: 1, userId: 1 })
    .limit(500)
    .lean();
  const items = (users || []).map((u) => ({
    userId: u.userId,
    displayName: u.displayName || u.userId,
    profilePhoto: u.profilePhoto || ''
  }));
  res.json({ ok: true, items });
});

// Upsert single (session/admin)
router.put('/availability', requireSessionOrAdmin, async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const googleFileId = String(req.body?.googleFileId || '').trim();
  const available = Boolean(req.body?.available);
  if (!userId || !googleFileId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  await Availability.findOneAndUpdate(
    { userId, googleFileId },
    { $set: { userId, googleFileId, available, updatedAt: new Date() } },
    { upsert: true }
  );
  res.json({ ok: true });
});

// Bulk upsert (session/admin)
router.post('/availability/bulk', requireSessionOrAdmin, async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!userId || !items.length) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const ops = items
    .map((it) => ({
      userId,
      googleFileId: String(it.googleFileId || '').trim(),
      available: Boolean(it.available)
    }))
    .filter((it) => it.googleFileId);

  if (!ops.length) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const bulk = Availability.collection.initializeUnorderedBulkOp();
  const now = new Date();
  ops.forEach((it) => {
    bulk
      .find({ userId: it.userId, googleFileId: it.googleFileId })
      .upsert()
      .updateOne({ $set: { ...it, updatedAt: now } });
  });

  await bulk.execute();
  res.json({ ok: true, count: ops.length });
});

module.exports = router;
