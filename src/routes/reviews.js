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

// Private: 오너(또는 admin)만 코멘트 삭제
router.delete('/reviews/:userId/:cardId/:commentId', requireLogin, async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  const cardId = normalizeCardId(req.params?.cardId);
  const commentId = String(req.params?.commentId || '').trim();
  if (!userId || !cardId || !commentId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const user = await User.findOne({ userId, active: { $ne: false }, isPrivate: true });
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const sessionUserId = String(req.session?.user?.userId || '');
  const role = String(req.session?.user?.role || '');
  const isOwner = sessionUserId && sessionUserId === String(user.userId || '');
  const canDelete = isOwner || role === 'admin';
  if (!canDelete) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const threads = Array.isArray(user.privateReviewThreads) ? user.privateReviewThreads : [];
  const thread = threads.find((t) => String(t.cardId || '') === cardId);
  if (!thread || !Array.isArray(thread.comments)) return res.json({ ok: true });

  // mongoose subdoc id() 지원 + fallback filter
  try {
    const sub = typeof thread.comments.id === 'function' ? thread.comments.id(commentId) : null;
    if (sub && typeof sub.deleteOne === 'function') sub.deleteOne();
    else thread.comments = thread.comments.filter((c) => String(c?._id || '') !== commentId);
  } catch {
    thread.comments = (thread.comments || []).filter((c) => String(c?._id || '') !== commentId);
  }

  user.updatedAt = new Date();
  await user.save();
  res.json({ ok: true });
});

module.exports = router;
