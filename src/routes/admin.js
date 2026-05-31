const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const User = require('../models/User');
const Availability = require('../models/Availability');
const Setting = require('../models/Setting');
const Song = require('../models/Song');
const { requireLogin, requireAdmin, requireSessionOrAdmin } = require('../middleware/auth');
const { restartDriveSync, stopDriveSync, getDriveRootFolderId } = require('../services/driveSyncRunner');
const { KEYS, getJson } = require('../services/syncStatus');
const { start: startCsvImport, getStatus: getCsvImportStatus } = require('../services/csvImportRunner');
const { getFileMetadata, renameFile } = require('../services/drive');
const { chzzkIngestor } = require('../services/chzzkIngestor');
const { getTrafficMetrics, resetTrafficMetrics } = require('../services/trafficMetrics');

const { driveToThumb } = require('../services/legacyCsvImport');
const { buildPrivateArchivePath } = require('../services/privateArchive');

const router = express.Router();

router.get('/admin/me', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.user.id).lean();
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  // keep session user in sync (private flag might be added later)
  try {
    req.session.user.isPrivate = Boolean(user.isPrivate);
  } catch {}
  const privateArchivePath = user.isPrivate ? await buildPrivateArchivePath(user.userId) : '';
  res.json({
    ok: true,
    user: {
      id: String(user._id),
      userId: user.userId,
      role: user.role,
      displayName: user.displayName || user.userId,
      profilePhoto: user.profilePhoto || '',
      mustChangePassword: Boolean(user.mustChangePassword),
      isPrivate: Boolean(user.isPrivate),
      privateArchivePath
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
    mustChangePassword: Boolean(user.mustChangePassword),
    isPrivate: Boolean(user.isPrivate)
  };
  // T-18: last seen 기록 (로그인 성공 시)
  try {
    await User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date() } });
  } catch {}
  const privateArchivePath = user.isPrivate ? await buildPrivateArchivePath(user.userId) : '';
  res.json({ ok: true, user: { ...req.session.user, privateArchivePath } });
});

router.patch('/admin/profile', requireLogin, async (req, res) => {
  const displayName = String(req.body?.displayName || '').trim();
  const profilePhoto = String(req.body?.profilePhoto || '').trim();

  const user = await User.findById(req.session.user.id);
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

  if (displayName) user.displayName = displayName;
  // Accept Drive share links (/view) and store as thumbnail URL so <img> can render
  user.profilePhoto = profilePhoto ? driveToThumb(profilePhoto, 240) : '';
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
  const isPrivate = Boolean(req.body?.isPrivate);
  if (!userId || !['admin', 'session'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  }

  // 초기 비밀번호는 기본값 1234로 통일(원하면 요청에서 password로 override 가능)
  const password = passwordInput || '1234';
  const passwordHash = await bcrypt.hash(password, 10);
  const doc = await User.findOneAndUpdate(
    { userId },
    { $set: { userId, passwordHash, role, displayName, active: true, isPrivate } },
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
    mustChangePassword: u.mustChangePassword,
    isPrivate: Boolean(u.isPrivate)
  }));
  res.json({ ok: true, items: safe });
});

// Admin only: update user fields / reset password / deactivate
router.patch('/admin/users/:userId', requireAdmin, async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const role = req.body?.role !== undefined ? String(req.body.role || '').trim() : undefined;
  const displayName = req.body?.displayName !== undefined ? String(req.body.displayName || '').trim() : undefined;
  const active = req.body?.active !== undefined ? Boolean(req.body.active) : undefined;
  const password = req.body?.password !== undefined ? String(req.body.password || '') : undefined;

  if (role !== undefined && !['admin', 'session'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  }
  if (password !== undefined && password.length < 4) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  }

  /** @type {Record<string, any>} */
  const $set = {};
  if (role !== undefined) $set.role = role;
  if (displayName !== undefined) $set.displayName = displayName;
  if (active !== undefined) $set.active = active;
  if (password !== undefined) $set.passwordHash = await bcrypt.hash(password, 10);

  const doc = await User.findOneAndUpdate({ userId }, { $set }, { new: true }).lean();
  if (!doc) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  res.json({
    ok: true,
    item: {
      _id: String(doc._id),
      userId: doc.userId,
      role: doc.role,
      displayName: doc.displayName,
      active: doc.active,
      profilePhoto: doc.profilePhoto,
      mustChangePassword: doc.mustChangePassword
    }
  });
});

// Admin only: delete user (hard delete; also removes related availability docs)
router.delete('/admin/users/:userId', requireAdmin, async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  // Safety: don't let admin delete self by mistake
  if (String(req.session?.user?.userId || '') === userId) {
    return res.status(400).json({ ok: false, error: 'CANNOT_DELETE_SELF' });
  }

  const existed = await User.findOne({ userId }).lean();
  if (!existed) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  await Availability.deleteMany({ userId });
  await User.deleteOne({ userId });
  res.json({ ok: true });
});

// Drive sync (admin/session only; for now admin only)
router.get('/admin/sync/status', requireSessionOrAdmin, async (req, res) => {
  const status = await getJson(KEYS.driveSyncStatus, null);
  res.json({ ok: true, status });
});

router.post('/admin/sync/drive', requireAdmin, async (req, res) => {
  try {
    const latestDays = Number(req.body?.latestDays || 1);
    const limit = Number(req.body?.limit || 5000);
    const pruneMissing = req.body?.pruneMissing !== undefined ? Boolean(req.body.pruneMissing) : true;
    const incremental = Boolean(req.body?.incremental);
    const rootFolderId = String(req.body?.rootFolderId || '').trim();
    // If a sync is already running, stop it first then start the new one (best-effort).
    const r = await restartDriveSync({ latestDays, limit, pruneMissing, incremental, rootFolderId });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error || 'SYNC_FAILED' });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || 'SYNC_FAILED') });
  }
});

// Drive sync stop (best-effort)
router.post('/admin/sync/stop', requireAdmin, async (_req, res) => {
  const r = stopDriveSync();
  res.json({ ok: true, ...r });
});

// ---- Traffic metrics (admin diagnostics) ------------------------------------------
router.get('/admin/metrics/traffic', requireAdmin, async (_req, res) => {
  res.json({ ok: true, data: getTrafficMetrics() });
});

router.post('/admin/metrics/traffic/reset', requireAdmin, async (_req, res) => {
  res.json({ ok: true, data: resetTrafficMetrics() });
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

// Parse error fixing (filename parse 실패 보정용)
router.get('/admin/songs/parse-errors', requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 100)));
  const items = await Song.find({ parseError: { $ne: '' } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  // enrich with Drive original file name (best-effort, limited concurrency)
  const withDriveName = [];
  const conc = 8;
  for (let i = 0; i < items.length; i += conc) {
    const chunk = items.slice(i, i + conc);
    // eslint-disable-next-line no-await-in-loop
    const metas = await Promise.all(
      chunk.map(async (s) => {
        try {
          const meta = await getFileMetadata(String(s.googleFileId || '').trim());
          return meta?.name || '';
        } catch {
          return '';
        }
      })
    );
    chunk.forEach((s, idx) => withDriveName.push({ ...s, driveName: metas[idx] || '' }));
  }

  res.json({
    ok: true,
    items: withDriveName.map((s) => ({
      _id: String(s._id),
      googleFileId: s.googleFileId,
      driveName: s.driveName || '',
      title: s.title,
      displayTitle: s.displayTitle,
      artist: s.artist,
      key: s.key,
      driveUrl: s.driveUrl,
      folderPath: s.folderPath,
      parseError: s.parseError
    }))
  });
});

router.patch('/admin/songs/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const title = req.body?.title !== undefined ? String(req.body.title || '').trim() : undefined;
  const displayTitle = req.body?.displayTitle !== undefined ? String(req.body.displayTitle || '').trim() : undefined;
  const artist = req.body?.artist !== undefined ? String(req.body.artist || '').trim() : undefined;
  const key = req.body?.key !== undefined ? String(req.body.key || '').trim() : undefined;
  const renameDriveName = req.body?.renameDriveName !== undefined ? Boolean(req.body.renameDriveName) : false;
  const genre = req.body?.genre !== undefined ? String(req.body.genre || '').trim() : undefined;
  const mood = req.body?.mood !== undefined ? String(req.body.mood || '').trim() : undefined;
  const vocal = req.body?.vocal !== undefined ? String(req.body.vocal || '').trim() : undefined;
  const hidden = req.body?.hidden !== undefined ? Boolean(req.body.hidden) : undefined;
  if (!id) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const update = {};
  if (title !== undefined) update.title = title;
  if (displayTitle !== undefined) update.displayTitle = displayTitle;
  if (artist !== undefined) update.artist = artist;
  if (key !== undefined) update.key = key;
  if (genre !== undefined) update.genre = genre;
  if (mood !== undefined) update.mood = mood;
  if (vocal !== undefined) update.vocal = vocal;
  if (hidden !== undefined) update.hidden = hidden;
  update.parseError = '';
  update.updatedAt = new Date();

  // keep search index fresh (title/artist/tag 기반)
  const before = await Song.findById(id).lean();
  if (!before) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  const merged = {
    title: update.title ?? before.title ?? '',
    displayTitle: update.displayTitle ?? before.displayTitle ?? '',
    artist: update.artist ?? before.artist ?? '',
    genre: update.genre ?? before.genre ?? '',
    mood: update.mood ?? before.mood ?? '',
    vocal: update.vocal ?? before.vocal ?? '',
    key: update.key ?? before.key ?? ''
  };
  update.searchText = `${merged.displayTitle} ${merged.title} ${merged.artist} ${merged.genre} ${merged.mood} ${merged.vocal} ${merged.key}`
    .toLowerCase()
    .trim();

  const buildDriveName = (merged2, existingName) => {
    const extM = String(existingName || '').match(/\.[^.]+$/);
    const ext = extM ? extM[0] : '.pdf';
    const t0 = String(merged2.displayTitle || merged2.title || '').trim() || '제목없음';
    const k0 = String(merged2.key || '').trim();
    const a0 = String(merged2.artist || '').trim();
    const safe = (s) => String(s || '').replace(/[\\/]/g, '_').trim();
    const t = safe(t0);
    const k = safe(k0);
    const a = safe(a0);
    const base = `${t}${k ? `(${k})` : ''}${a ? `-${a}` : ''}`;
    return `${base}${ext}`;
  };

  /** @type {string} */
  let renameError = '';
  const doc = await Song.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!doc) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  // Optional: rename original Drive file name
  if (renameDriveName) {
    try {
      const fileId = String(before.googleFileId || '').trim();
      if (fileId) {
        const meta = await getFileMetadata(fileId);
        const desired = buildDriveName(merged, meta?.name || '');
        await renameFile(fileId, desired);
      }
    } catch (e) {
      renameError = String(e?.message || e || 'DRIVE_RENAME_FAILED');
    }
  }
  res.json({
    ok: true,
    renameError: renameError || undefined,
    item: {
      _id: String(doc._id),
      title: doc.title,
      displayTitle: doc.displayTitle,
      artist: doc.artist,
      key: doc.key,
      genre: doc.genre,
      mood: doc.mood,
      vocal: doc.vocal,
      hidden: Boolean(doc.hidden),
      searchText: doc.searchText,
      parseError: doc.parseError
    }
  });
});

// 카드(=title+artist 묶음) 단위 태그 편집: 조성/장르/분위기/보컬은 키 변형별로 동일하게 유지
router.patch('/admin/song-cards', requireAdmin, async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const artist = String(req.body?.artist || '').trim();
  if (!title) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const update = {
    key: req.body?.key !== undefined ? String(req.body.key || '').trim() : undefined,
    genre: req.body?.genre !== undefined ? String(req.body.genre || '').trim() : undefined,
    mood: req.body?.mood !== undefined ? String(req.body.mood || '').trim() : undefined,
    vocal: req.body?.vocal !== undefined ? String(req.body.vocal || '').trim() : undefined
  };

  const $set = {};
  Object.entries(update).forEach(([k, v]) => {
    if (v !== undefined) $set[k] = v;
  });
  if (!$set || !Object.keys($set).length) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  $set.updatedAt = new Date();
  // searchText는 title/artist/tag 기반으로 통일 갱신
  $set.searchText = `${title} ${artist} ${$set.genre ?? ''} ${$set.mood ?? ''} ${$set.vocal ?? ''} ${$set.key ?? ''}`.toLowerCase().trim();

  const r = await Song.updateMany(
    { artist, $or: [{ title }, { displayTitle: title }] },
    { $set }
  );
  res.json({ ok: true, matched: r.matchedCount ?? r.n ?? 0, modified: r.modifiedCount ?? r.nModified ?? 0 });
});

// CSV 업로드(곡) 임포트: 동일값은 스킵, 변경/비일치 항목만 CSV 값으로 덮어쓰기
router.post('/admin/import/songs-csv', requireAdmin, async (req, res) => {
  const csvText = String(req.body?.csvText || '');
  if (!csvText.trim()) return res.status(400).json({ ok: false, error: 'CSV_REQUIRED' });
  const r = await startCsvImport('songs', csvText);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error || 'IMPORT_FAILED' });
  res.json({ ok: true, ...r });
});

router.post('/admin/import/users-csv', requireAdmin, async (req, res) => {
  const csvText = String(req.body?.csvText || '');
  const updatePasswordExisting = Boolean(req.body?.updatePasswordExisting);
  if (!csvText.trim()) return res.status(400).json({ ok: false, error: 'CSV_REQUIRED' });
  const r = await startCsvImport('users', csvText, { updatePasswordExisting });
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error || 'IMPORT_FAILED' });
  res.json({ ok: true, ...r });
});

router.post('/admin/import/availability-csv', requireAdmin, async (req, res) => {
  const csvText = String(req.body?.csvText || '');
  if (!csvText.trim()) return res.status(400).json({ ok: false, error: 'CSV_REQUIRED' });
  const r = await startCsvImport('availability', csvText);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error || 'IMPORT_FAILED' });
  res.json({ ok: true, ...r });
});

router.get('/admin/import/status', requireAdmin, async (req, res) => {
  const kind = String(req.query?.kind || '').trim().toLowerCase();
  const status = await getCsvImportStatus(kind);
  res.json({ ok: true, status });
});

// ---- CHZZK Chat Ingestor (PoC) ----------------------------------------------------
router.get('/admin/chzzk/status', requireAdmin, async (_req, res) => {
  res.json(chzzkIngestor.getStatus());
});

router.post('/admin/chzzk/start', requireAdmin, async (_req, res) => {
  const r = await chzzkIngestor.start();
  res.json(r);
});

router.post('/admin/chzzk/stop', requireAdmin, async (_req, res) => {
  const r = await chzzkIngestor.stop();
  res.json(r);
});

module.exports = router;
