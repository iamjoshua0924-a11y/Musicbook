const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const User = require('../models/User');
const Setting = require('../models/Setting');
const { requireLogin, requireAdmin, requireSessionOrAdmin } = require('../middleware/auth');
const { driveRootFolderId } = require('../config/env');
const { syncDriveFolderTree } = require('../services/driveSync');
const { KEYS, setJson, getJson } = require('../services/syncStatus');

const router = express.Router();

async function getDriveRootFolderId() {
  const s = await Setting.findOne({ key: 'driveRootFolderId' }).lean();
  return String(s?.value || driveRootFolderId || '').trim();
}

router.get('/admin/me', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.user.id).lean();
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  res.json({
    ok: true,
    user: {
      id: String(user._id),
      userId: user.userId,
      role: user.role,
      displayName: user.displayName || user.userId,
      profilePhoto: user.profilePhoto || '',
      mustChangePassword: Boolean(user.mustChangePassword)
    }
  });
});

router.post('/admin/login', async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const password = String(req.body?.password || '');
  if (!userId || !password) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const user = await User.findOne({ userId, active: { $ne: false } }).lean();
  if (!user) return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });

  let ok = false;
  const sha = crypto.createHash('sha256').update(password).digest('hex');
  const stored = String(user.passwordHash || '');
  const looksBcrypt = stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$');

  if (looksBcrypt) {
    try {
      ok = await bcrypt.compare(password, stored);
    } catch {
      ok = false;
    }
  } else {
    // Some old imports might have stored legacy hash into passwordHash.
    ok = Boolean(stored && stored === sha);
  }

  // Migration fallback: legacy SHA-256 hash (from GAS sheet) -> auto-upgrade to bcrypt.
  if (!ok && user.legacyPasswordHash) ok = sha === user.legacyPasswordHash;

  if (ok && !looksBcrypt) {
    // Upgrade bcrypt hash in background
    const passwordHash = await bcrypt.hash(password, 10);
    await User.updateOne({ _id: user._id }, { $set: { passwordHash } });
  }

  if (!ok) return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });

  req.session.user = {
    id: String(user._id),
    userId: user.userId,
    role: user.role,
    displayName: user.displayName || user.userId,
    profilePhoto: user.profilePhoto || '',
    mustChangePassword: Boolean(user.mustChangePassword)
  };
  res.json({ ok: true, user: req.session.user });
});

router.patch('/admin/profile', requireLogin, async (req, res) => {
  const displayName = String(req.body?.displayName || '').trim();
  const profilePhoto = String(req.body?.profilePhoto || '').trim();

  const user = await User.findById(req.session.user.id);
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

  if (displayName) user.displayName = displayName;
  user.profilePhoto = profilePhoto;
  user.updatedAt = new Date();
  await user.save();

  req.session.user.displayName = user.displayName || user.userId;
  req.session.user.profilePhoto = user.profilePhoto || '';
  res.json({ ok: true, profilePhoto: user.profilePhoto || '', displayName: req.session.user.displayName });
});

router.post('/admin/password/change', requireLogin, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || !newPassword || newPassword.length < 4) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  }

  const user = await User.findById(req.session.user.id);
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

  const sha = crypto.createHash('sha256').update(currentPassword).digest('hex');
  const stored = String(user.passwordHash || '');
  const looksBcrypt = stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$');

  let ok = false;
  if (looksBcrypt) ok = await bcrypt.compare(currentPassword, stored);
  else ok = Boolean(stored && stored === sha);
  if (!ok && user.legacyPasswordHash) ok = sha === user.legacyPasswordHash;
  if (!ok) return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  user.updatedAt = new Date();
  await user.save();

  req.session.user.mustChangePassword = false;
  res.json({ ok: true });
});

router.post('/admin/logout', requireLogin, async (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.post('/admin/users', requireAdmin, async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const passwordInput = String(req.body?.password || '');
  const role = String(req.body?.role || '').trim();
  const displayName = String(req.body?.displayName || '').trim();
  if (!userId || !['admin', 'session'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  }

  const password = passwordInput || crypto.randomBytes(6).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 10);
  const doc = await User.findOneAndUpdate(
    { userId },
    { $set: { userId, passwordHash, role, displayName, active: true } },
    { upsert: true, new: true }
  );
  res.json({ ok: true, item: doc.toObject(), password });
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  const items = await User.find({}).sort({ role: 1, userId: 1 }).lean();
  const safe = items.map((u) => ({
    _id: String(u._id),
    userId: u.userId,
    role: u.role,
    displayName: u.displayName,
    active: u.active,
    profilePhoto: u.profilePhoto,
    mustChangePassword: u.mustChangePassword
  }));
  res.json({ ok: true, items: safe });
});

// Drive sync (admin/session only; for now admin only)
router.get('/admin/sync/status', requireSessionOrAdmin, async (req, res) => {
  const status = await getJson(KEYS.driveSyncStatus, null);
  res.json({ ok: true, status });
});

router.post('/admin/sync/drive', requireAdmin, async (req, res) => {
  const rootFolderId = String(req.body?.rootFolderId || (await getDriveRootFolderId()) || '').trim();
  try {
    const latestDays = Number(req.body?.latestDays || 30);
    const limit = Number(req.body?.limit || 5000);
    const pruneMissing = req.body?.pruneMissing !== undefined ? Boolean(req.body.pruneMissing) : true;
    const incremental = Boolean(req.body?.incremental);
    const prev = await getJson(KEYS.driveSyncStatus, null);
    const incrementalSince = incremental ? prev?.endedAt || prev?.startedAt || null : null;

    const startedAt = new Date().toISOString();
    await setJson(KEYS.driveSyncStatus, { startedAt, running: true, rootFolderId, latestDays, limit, pruneMissing, incremental });

    const result = await syncDriveFolderTree({ rootFolderId, latestDays, limit, incrementalSince, pruneMissing });
    const endedAt = new Date().toISOString();
    const status = {
      startedAt,
      endedAt,
      running: false,
      rootFolderId,
      latestDays,
      limit,
      pruneMissing,
      incremental,
      processed: result.processed,
      skipped: result.skipped,
      hiddenCount: result.hiddenCount,
      reachedLimit: result.reachedLimit
    };
    await setJson(KEYS.driveSyncStatus, status);
    res.json({ ok: true, ...status });
  } catch (e) {
    const endedAt = new Date().toISOString();
    await setJson(KEYS.driveSyncStatus, { endedAt, running: false, ok: false, error: String(e.message || 'SYNC_FAILED') });
    res.status(400).json({ ok: false, error: String(e.message || 'SYNC_FAILED') });
  }
});

// Drive sync root folder config (stored in DB)
router.get('/admin/drive-root', requireAdmin, async (_req, res) => {
  const value = await getDriveRootFolderId();
  res.json({ ok: true, rootFolderId: value });
});

router.patch('/admin/drive-root', requireAdmin, async (req, res) => {
  const value = String(req.body?.rootFolderId || '').trim();
  await Setting.findOneAndUpdate({ key: 'driveRootFolderId' }, { $set: { key: 'driveRootFolderId', value } }, { upsert: true });
  res.json({ ok: true, rootFolderId: value });
});

module.exports = router;
