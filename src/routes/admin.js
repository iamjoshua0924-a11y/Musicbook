const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const User = require('../models/User');
const { requireLogin, requireAdmin, requireSessionOrAdmin } = require('../middleware/auth');
const { driveRootFolderId, adminBootstrapToken } = require('../config/env');
const { syncDriveFolderTree } = require('../services/driveSync');
const { KEYS, setJson, getJson } = require('../services/syncStatus');
const { importLegacyBundle } = require('../services/legacyCsvImport');

const router = express.Router();

function isAdminSession(req) {
  return Boolean(req.session?.user && req.session.user.role === 'admin');
}

async function allowBootstrap(req) {
  if (!adminBootstrapToken) return false;
  const token = String(req.body?.token || req.query?.token || '');
  if (!token || token !== adminBootstrapToken) return false;
  // Allow only when there is no active admin yet
  const existingAdmin = await User.findOne({ role: 'admin', active: { $ne: false } }).lean();
  return !existingAdmin;
}

// One-time bootstrap admin creation (for fresh DB).
router.post('/admin/bootstrap', async (req, res) => {
  if (!adminBootstrapToken) return res.status(404).json({ ok: false, error: 'DISABLED' });
  const token = String(req.body?.token || '');
  if (token !== adminBootstrapToken) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const existingAdmin = await User.findOne({ role: 'admin', active: { $ne: false } }).lean();
  if (existingAdmin) return res.status(409).json({ ok: false, error: 'ALREADY_EXISTS' });

  const userId = String(req.body?.userId || '').trim();
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.displayName || userId).trim();
  if (!userId || !password) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const passwordHash = await bcrypt.hash(password, 10);
  const doc = await User.create({ userId, passwordHash, role: 'admin', displayName, active: true });
  res.json({ ok: true, item: doc.toObject() });
});

// Legacy CSV import bundle (MainPage/Songs/Users/Availability/Settings).
// Admin-only, but allow bootstrap token ONLY when no admin exists (fresh DB).
router.post('/admin/import/legacy', async (req, res) => {
  const okByAdmin = isAdminSession(req);
  const okByBootstrap = okByAdmin ? false : await allowBootstrap(req);
  if (!okByAdmin && !okByBootstrap) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const bundle = {
    mainPageCsv: String(req.body?.mainPageCsv || ''),
    songsCsv: String(req.body?.songsCsv || ''),
    usersCsv: String(req.body?.usersCsv || ''),
    availabilityCsv: String(req.body?.availabilityCsv || ''),
    settingsCsv: String(req.body?.settingsCsv || '')
  };

  try {
    const result = await importLegacyBundle(bundle);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || 'IMPORT_FAILED') });
  }
});

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

  let ok = false;
  try {
    ok = await bcrypt.compare(password, user.passwordHash);
  } catch {
    ok = false;
  }

  // Migration fallback: legacy SHA-256 hash (from GAS sheet) -> auto-upgrade to bcrypt.
  if (!ok && user.legacyPasswordHash) {
    const sha = crypto.createHash('sha256').update(password).digest('hex');
    if (sha === user.legacyPasswordHash) {
      ok = true;
      // Upgrade bcrypt hash in background
      const passwordHash = await bcrypt.hash(password, 10);
      await User.updateOne({ _id: user._id }, { $set: { passwordHash } });
    }
  }

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
  const rootFolderId = String(req.body?.rootFolderId || driveRootFolderId || '').trim();
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

module.exports = router;
