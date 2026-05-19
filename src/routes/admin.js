const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { driveRootFolderId } = require('../config/env');
const { syncDriveFolderTree } = require('../services/driveSync');

const router = express.Router();

router.get('/admin/me', requireLogin, async (req, res) => {
  res.json({ ok: true, user: req.session.user });
});

router.post('/admin/logout', requireLogin, async (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.post('/admin/login', async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const password = String(req.body?.password || '');
  if (!userId || !password) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const user = await User.findOne({ userId, active: { $ne: false } }).lean();
  if (!user) return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });

  req.session.user = { id: String(user._id), userId: user.userId, role: user.role, displayName: user.displayName };
  res.json({ ok: true, user: req.session.user });
});

router.post('/admin/users', requireAdmin, async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || '').trim();
  const displayName = String(req.body?.displayName || '').trim();
  if (!userId || !password || !['admin', 'session'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const doc = await User.findOneAndUpdate(
    { userId },
    { $set: { userId, passwordHash, role, displayName, active: true } },
    { upsert: true, new: true }
  );
  res.json({ ok: true, item: doc.toObject() });
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  const items = await User.find({}).sort({ role: 1, userId: 1 }).lean();
  res.json({ ok: true, items });
});

// Drive sync (admin/session only; for now admin only)
router.post('/admin/sync/drive', requireAdmin, async (req, res) => {
  const rootFolderId = String(req.body?.rootFolderId || driveRootFolderId || '').trim();
  try {
    const result = await syncDriveFolderTree({ rootFolderId });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || 'SYNC_FAILED') });
  }
});

module.exports = router;
