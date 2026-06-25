const express = require('express');
const GuestbookEntry = require('../models/GuestbookEntry');
const User = require('../models/User');

const router = express.Router();

function clampText(v, max) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function resolvePrivateBook(bookUserId) {
  const uid = String(bookUserId || '').trim();
  if (!uid) return null;
  return User.findOne({ userId: uid, isPrivate: true, active: { $ne: false } }).lean();
}

router.get('/guestbook/:bookUserId', async (req, res) => {
  const bookUserId = String(req.params.bookUserId || '').trim();
  const owner = await resolvePrivateBook(bookUserId);
  if (!owner) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  const items = await GuestbookEntry.find({ bookUserId }).sort({ createdAt: -1 }).limit(120).lean();
  res.json({ ok: true, items });
});

router.post('/guestbook/:bookUserId', async (req, res) => {
  const bookUserId = String(req.params.bookUserId || '').trim();
  const owner = await resolvePrivateBook(bookUserId);
  if (!owner) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const nickname = clampText(req.body?.nickname, 40);
  const content = clampText(req.body?.content, 500);
  if (!nickname || !content) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const doc = await GuestbookEntry.create({
    bookUserId,
    nickname,
    content,
    authorUserId: String(req.session?.user?.userId || '').trim()
  });
  res.json({ ok: true, item: doc.toObject() });
});

router.delete('/guestbook/:entryId', async (req, res) => {
  const role = String(req.session?.user?.role || '');
  const userId = String(req.session?.user?.userId || '').trim();
  const entryId = String(req.params.entryId || '').trim();
  if (!entryId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const entry = await GuestbookEntry.findById(entryId).lean();
  if (!entry) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  const owner = await resolvePrivateBook(entry.bookUserId);
  const isOwner = owner && userId && String(owner.userId) === userId;
  const isAdmin = role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  await GuestbookEntry.deleteOne({ _id: entry._id });
  res.json({ ok: true });
});

module.exports = router;
