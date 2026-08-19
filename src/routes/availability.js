const express = require('express');
const Availability = require('../models/Availability');
const { requireSessionOrAdmin } = require('../middleware/auth');
const User = require('../models/User');
const { bulkUpsertAvailability } = require('../services/availabilityBulk');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();
const clampProficiency = (v) => Math.max(0, Math.min(3, Number(v || 0) || 0));

// PB-2(2차 감사): 쓰기 API가 body의 userId를 그대로 신뢰해 session 롤 멤버가
// 타인의 가능곡/숙련도를 조작할 수 있었다. session 롤은 본인 userId만 허용하고,
// admin은 대리 편집 워크플로 보존을 위해 임의 userId를 유지한다.
// (프론트는 본인 편집 시 항상 자기 userId를 보내므로 기존 UI 흐름은 전부 통과한다.)
function resolveWritableUserId(req, bodyUserId) {
  const su = req.session?.user;
  const requested = String(bodyUserId || '').trim();
  if (!su) return '';
  if (su.role === 'admin') return requested;
  const own = String(su.userId || '').trim();
  if (!requested || requested === own) return own;
  return null; // session 롤이 타인 userId를 지정 — 거부
}

// Public read (used by viewer filters later)
router.get('/availability', asyncHandler(async (req, res) => {
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'USER_REQUIRED' });
  const items = await Availability.find({ userId }).lean();
  res.json({ ok: true, items });
}));

// Public: list users selectable in "가능보컬" filter.
// - Only users who have at least one available=true are included.
// - Do NOT filter out admin; role 구분 없이 모두 선택 가능하게 유지.
router.get('/availability/users', asyncHandler(async (_req, res) => {
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
}));

// Upsert single (session/admin)
router.put('/availability', requireSessionOrAdmin, asyncHandler(async (req, res) => {
  const userId = resolveWritableUserId(req, req.body?.userId);
  if (userId === null) return res.status(403).json({ ok: false, error: 'FORBIDDEN_OTHER_USER' });
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
}));

// Bulk upsert (session/admin)
router.post('/availability/bulk', requireSessionOrAdmin, asyncHandler(async (req, res) => {
  const userId = resolveWritableUserId(req, req.body?.userId);
  if (userId === null) return res.status(403).json({ ok: false, error: 'FORBIDDEN_OTHER_USER' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!userId || !items.length) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const { count } = await bulkUpsertAvailability(userId, items);
  if (!count) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  res.json({ ok: true, count });
}));

module.exports = router;
