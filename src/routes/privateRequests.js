const express = require('express');
const User = require('../models/User');
const Availability = require('../models/Availability');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

function clampText(v, max) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeRequest(raw) {
  return {
    googleFileId: clampText(raw?.googleFileId, 120),
    driveUrl: clampText(raw?.driveUrl, 600),
    title: clampText(raw?.title, 120),
    artist: clampText(raw?.artist, 120),
    key: clampText(raw?.key, 24),
    memo: clampText(raw?.memo, 60),
    status: String(raw?.status || 'pending') === 'practicing' ? 'practicing' : 'pending',
    createdAt: raw?.createdAt ? new Date(raw.createdAt) : new Date()
  };
}

function isOwnerOrAdmin(req, user) {
  const role = String(req.session?.user?.role || '');
  const sessionUserId = String(req.session?.user?.userId || '');
  return role === 'admin' || (sessionUserId && sessionUserId === String(user?.userId || ''));
}

// Public: 신청곡 목록 조회(개인 노래책)
router.get('/private-requests/:userId', async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  const user = await User.findOne({ userId, active: { $ne: false }, isPrivate: true }).lean();
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  res.json({ ok: true, items: Array.isArray(user.privateSongRequests) ? user.privateSongRequests : [] });
});

// Public: 신청곡 생성(뷰어 포함)
router.post('/private-requests/:userId', async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  const user = await User.findOne({ userId, active: { $ne: false }, isPrivate: true });
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const r = normalizeRequest(req.body || {});
  if (!r.googleFileId || !r.title) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  if (!Array.isArray(user.privateSongRequests)) user.privateSongRequests = [];
  const exists = user.privateSongRequests.some((x) => String(x.googleFileId || '') === r.googleFileId);
  if (exists) return res.json({ ok: true, items: user.privateSongRequests });

  user.privateSongRequests.unshift({ ...r, createdAt: new Date() });
  // limit 200
  if (user.privateSongRequests.length > 200) user.privateSongRequests = user.privateSongRequests.slice(0, 200);
  user.updatedAt = new Date();
  await user.save();

  res.json({ ok: true, items: user.privateSongRequests });
});

// Private: 상태 변경/삭제/승격 (오너 or admin)
router.patch('/private-requests/:userId/:googleFileId', requireLogin, async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  const googleFileId = String(req.params?.googleFileId || '').trim();
  if (!userId || !googleFileId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  const user = await User.findOne({ userId, active: { $ne: false }, isPrivate: true });
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  if (!isOwnerOrAdmin(req, user)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const action = String(req.body?.action || '').trim();
  if (!Array.isArray(user.privateSongRequests)) user.privateSongRequests = [];
  const idx = user.privateSongRequests.findIndex((x) => String(x.googleFileId || '') === googleFileId);
  if (idx < 0) return res.json({ ok: true, items: user.privateSongRequests });
  const cur = user.privateSongRequests[idx];

  if (action === 'accept') cur.status = 'practicing';
  else if (action === 'delete') user.privateSongRequests.splice(idx, 1);
  else if (action === 'promote') {
    // 가능곡으로 승격: Availability에 추가 후 요청 제거
    await Availability.updateOne(
      { userId: user.userId, googleFileId },
      { $set: { userId: user.userId, googleFileId, available: true } },
      { upsert: true }
    );
    user.privateSongRequests.splice(idx, 1);
  }

  user.updatedAt = new Date();
  await user.save();

  res.json({ ok: true, items: user.privateSongRequests });
});

module.exports = router;

