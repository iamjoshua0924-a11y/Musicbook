const express = require('express');
const User = require('../models/User');

const router = express.Router();

function clampText(v, max) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeCardId(v) {
  return String(v || '').trim().slice(0, 120);
}

// Public: 합주후기 설정/목록 조회 (private 유저만)
router.get('/reviews/:userId', async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  const user = await User.findOne({ userId, active: { $ne: false }, isPrivate: true }).lean();
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  res.json({
    ok: true,
    enabled: Boolean(user.privateReviewEnabled),
    threads: Array.isArray(user.privateReviewThreads) ? user.privateReviewThreads : []
  });
});

// Public: 합주후기 코멘트 작성 (private 유저 + enabled=true 인 경우만)
router.post('/reviews/:userId', async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  const user = await User.findOne({ userId, active: { $ne: false }, isPrivate: true });
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  if (!user.privateReviewEnabled) return res.status(403).json({ ok: false, error: 'DISABLED' });

  const cardId = normalizeCardId(req.body?.cardId);
  const text = clampText(req.body?.text, 30);
  const title = clampText(req.body?.title, 120);
  const artist = clampText(req.body?.artist, 120);
  const tagText = clampText(req.body?.tagText, 60);
  if (!cardId || !text) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  if (!Array.isArray(user.privateReviewThreads)) user.privateReviewThreads = [];
  let thread = user.privateReviewThreads.find((t) => String(t.cardId || '') === cardId);
  if (!thread) {
    thread = { cardId, title, artist, tagText, comments: [] };
    user.privateReviewThreads.push(thread);
  } else {
    // best-effort 최신 카드 정보로 갱신
    if (title) thread.title = title;
    if (artist) thread.artist = artist;
    if (tagText) thread.tagText = tagText;
  }
  if (!Array.isArray(thread.comments)) thread.comments = [];
  thread.comments.push({ text, createdAt: new Date() });

  // limit: per song 50 comments, total 600 threads/comments (rough guard)
  if (thread.comments.length > 50) thread.comments = thread.comments.slice(-50);
  if (user.privateReviewThreads.length > 300) user.privateReviewThreads = user.privateReviewThreads.slice(-300);

  user.updatedAt = new Date();
  await user.save();

  res.json({ ok: true });
});

module.exports = router;

