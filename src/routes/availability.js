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

// Public: list "available vocal" users (only users who have at least one available=true)
router.get('/availability/users', async (_req, res) => {
  const rows = await Availability.aggregate([
    { $match: { available: true } },
    { $group: { _id: '$userId', c: { $sum: 1 } } },
    { $sort: { c: -1 } },
    { $limit: 200 }
  ]);
  const userIds = rows.map((r) => String(r._id || '')).filter(Boolean);
  const users = await User.find({ userId: { $in: userIds }, role: { $ne: 'admin' }, active: { $ne: false } }).lean();
  const map = new Map(users.map((u) => [String(u.userId), u]));
  const items = userIds
    .map((id) => {
      const u = map.get(id);
      return u ? { userId: u.userId, displayName: u.displayName || u.userId, profilePhoto: u.profilePhoto || '' } : null;
    })
    .filter(Boolean);
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
