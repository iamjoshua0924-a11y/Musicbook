const express = require('express');
const Availability = require('../models/Availability');
const { requireSessionOrAdmin } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();
const clampProficiency = (v) => Math.max(0, Math.min(3, Number(v || 0) || 0));

// Public read (used by viewer filters later)
router.get('/availability', async (req, res) => {
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'USER_REQUIRED' });
  const items = await Availability.find({ userId }).lean();
  res.json({ ok: true, items });
});

// Public: list users selectable in "가능보컬" filter.
// - Only users who have at least one available=true are included.
// - Do NOT filter out admin; role 구분 없이 모두 선택 가능하게 유지.
router.get('/availability/users', async (_req, res) => {
  const rows = await Availability.aggregate([
    { $match: { available: true } },
    { $group: { _id: '$userId', c: { $sum: 1 } } },
    { $sort: { c: -1 } },
    { $limit: 500 }
  ]);
  const userIds = rows.map((r) => String(r._id || '')).filter(Boolean);
  if (!userIds.length) return res.json({ ok: true, items: [] });

  // private 계정은 필터 선택지에서 아예 숨김
  const users = await User.find({
    userId: { $in: userIds },
    active: { $ne: false },
    role: { $in: ['admin', 'session'] },
    isPrivate: { $ne: true }
  }).lean();
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
  const hasAvailable = req.body?.available !== undefined;
  const hasProficiency = req.body?.proficiency !== undefined;
  const available = Boolean(req.body?.available);
  const proficiency = clampProficiency(req.body?.proficiency);
  if (!userId || !googleFileId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  if (!hasAvailable && !hasProficiency) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  /** @type {Record<string, any>} */
  const $set = { userId, googleFileId, updatedAt: new Date() };
  if (hasAvailable) $set.available = available;
  if (hasProficiency) $set.proficiency = proficiency;
  await Availability.findOneAndUpdate(
    { userId, googleFileId },
    { $set },
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
    .map((it) => {
      const hasAvailable = it?.available !== undefined;
      const hasProficiency = it?.proficiency !== undefined;
      return {
        userId,
        googleFileId: String(it?.googleFileId || '').trim(),
        hasAvailable,
        hasProficiency,
        available: Boolean(it?.available),
        proficiency: clampProficiency(it?.proficiency)
      };
    })
    .filter((it) => it.googleFileId && (it.hasAvailable || it.hasProficiency));

  if (!ops.length) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const bulk = Availability.collection.initializeUnorderedBulkOp();
  const now = new Date();
  ops.forEach((it) => {
    /** @type {Record<string, any>} */
    const $set = { userId: it.userId, googleFileId: it.googleFileId, updatedAt: now };
    if (it.hasAvailable) $set.available = it.available;
    if (it.hasProficiency) $set.proficiency = it.proficiency;
    bulk
      .find({ userId: it.userId, googleFileId: it.googleFileId })
      .upsert()
      .updateOne({ $set });
  });

  await bulk.execute();
  res.json({ ok: true, count: ops.length });
});

module.exports = router;
