const express = require('express');
const User = require('../models/User');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

function clampText(v, max) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeItems(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const it of arr) {
    const googleFileId = String(it?.googleFileId || '').trim();
    const driveUrl = String(it?.driveUrl || '').trim();
    // 최소한 하나는 있어야 의미가 있음
    if (!googleFileId && !driveUrl) continue;
    const key = googleFileId || driveUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      googleFileId,
      driveUrl,
      title: clampText(it?.title, 120),
      artist: clampText(it?.artist, 120),
      tagText: clampText(it?.tagText, 60),
      done: Boolean(it?.done)
    });
    // 과도한 저장 방지
    if (out.length >= 300) break;
  }
  return out;
}

// Public: 개인 노래책 셋리스트 조회(스텔스/private만)
router.get('/setlist/:userId', async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  const user = await User.findOne({ userId, active: { $ne: false }, isPrivate: true }).lean();
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  res.json({ ok: true, items: Array.isArray(user.privateSetlistItems) ? user.privateSetlistItems : [] });
});

// Private: 셋리스트 저장(본인 private만)
router.patch('/setlist', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.user.id);
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  if (!user.isPrivate) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  // 셋리스트는 본인만 편집
  if (String(req.session.user.userId || '') !== String(user.userId || '')) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const items = normalizeItems(req.body?.items);
  user.privateSetlistItems = items;
  user.updatedAt = new Date();
  await user.save();

  res.json({ ok: true, items: Array.isArray(user.privateSetlistItems) ? user.privateSetlistItems : [] });
});

module.exports = router;

