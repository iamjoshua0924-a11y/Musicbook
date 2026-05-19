const { setJson, getJson } = require('./syncStatus');
const { parseCsv, boolFromLegacy, driveToThumb } = require('./legacyCsvImport');
const Song = require('../models/Song');
const User = require('../models/User');
const Availability = require('../models/Availability');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const running = new Map(); // kind -> boolean

function keyFor(kind) {
  return `csvImportStatus:${String(kind || '').trim().toLowerCase()}`;
}

async function setStatus(kind, status) {
  await setJson(keyFor(kind), status);
}

async function getStatus(kind) {
  return getJson(keyFor(kind), null);
}

function makeUpdater(kind) {
  let lastWrite = 0;
  let last = null;
  return async (patch, force = false) => {
    const now = Date.now();
    last = { ...(last || {}), ...(patch || {}) };
    if (!force && now - lastWrite < 800) return;
    lastWrite = now;
    await setStatus(kind, last);
  };
}

async function runImportSongs(kind, csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const totalRows = Math.max(0, rows.length - 1);
  const idx = (name) => header.findIndex((h) => String(h || '').includes(name));
  const col = {
    legacySongId: idx('곡 ID'),
    title: idx('곡 제목'),
    displayTitle: idx('표시'),
    key: idx('키'),
    artist: idx('아티스트'),
    genre: idx('장르'),
    mood: idx('분위기'),
    vocal: idx('보컬'),
    googleFileId: idx('드라이브 파일 ID'),
    driveUrl: idx('드라이브 링크'),
    folderPath: idx('폴더 경로'),
    searchText: idx('검색 인덱스'),
    parseError: idx('파싱 오류'),
    hidden: idx('숨김')
  };

  const update = makeUpdater(kind);
  const startedAt = new Date().toISOString();
  await update({ ok: true, kind: 'songs', running: true, startedAt, totalRows, processedRows: 0, created: 0, updated: 0, skippedSame: 0 }, true);

  let created = 0;
  let updated = 0;
  let skippedSame = 0;
  let processedRows = 0;
  const seen = new Set();

  for (const r of rows.slice(1)) {
    processedRows += 1;
    const googleFileId = String(r[col.googleFileId] || '').trim();
    if (!googleFileId || seen.has(googleFileId)) {
      await update({ processedRows, lastUpdatedAt: new Date().toISOString() });
      // yield
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setImmediate(res));
      continue;
    }
    seen.add(googleFileId);
    const doc = {
      legacySongId: String(r[col.legacySongId] || '').trim(),
      title: String(r[col.title] || '').trim(),
      displayTitle: String(r[col.displayTitle] || r[col.title] || '').trim(),
      key: String(r[col.key] || '').trim(),
      artist: String(r[col.artist] || '').trim(),
      genre: String(r[col.genre] || '').trim(),
      mood: String(r[col.mood] || '').trim(),
      vocal: String(r[col.vocal] || '').trim(),
      googleFileId,
      driveUrl: String(r[col.driveUrl] || '').trim(),
      folderPath: String(r[col.folderPath] || '').trim(),
      searchText: (String(r[col.searchText] || `${r[col.displayTitle] || ''} ${r[col.artist] || ''}`).trim()).toLowerCase(),
      parseError: String(r[col.parseError] || '').trim(),
      hidden: boolFromLegacy(r[col.hidden])
    };

    // eslint-disable-next-line no-await-in-loop
    const prev = await Song.findOne({ googleFileId }).lean();
    if (!prev) {
      // eslint-disable-next-line no-await-in-loop
      await Song.create({ ...doc });
      created += 1;
    } else {
      const keys = ['legacySongId', 'title', 'displayTitle', 'key', 'artist', 'genre', 'mood', 'vocal', 'driveUrl', 'folderPath', 'searchText', 'parseError', 'hidden'];
      const changed = {};
      keys.forEach((k) => {
        const pv = prev[k];
        const nv = doc[k];
        const eq = typeof nv === 'boolean' ? Boolean(pv) === Boolean(nv) : String(pv ?? '').trim() === String(nv ?? '').trim();
        if (!eq) changed[k] = nv;
      });
      if (!Object.keys(changed).length) skippedSame += 1;
      else {
        // eslint-disable-next-line no-await-in-loop
        await Song.updateOne({ googleFileId }, { $set: { ...changed, updatedAt: new Date() } });
        updated += 1;
      }
    }

    await update({ processedRows, created, updated, skippedSame, lastRow: processedRows, lastId: googleFileId, lastUpdatedAt: new Date().toISOString() });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setImmediate(res));
  }

  const endedAt = new Date().toISOString();
  await update({ running: false, endedAt, created, updated, skippedSame, processedRows, lastUpdatedAt: endedAt }, true);
  return { ok: true, created, updated, skippedSame, processedRows, totalRows };
}

async function runImportUsers(kind, csvText, { updatePasswordExisting = false } = {}) {
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const totalRows = Math.max(0, rows.length - 1);
  const idx = (name) => header.findIndex((h) => String(h || '').includes(name));
  const col = {
    userId: idx('유저 ID'),
    role: idx('역할'),
    displayName: idx('표시'),
    active: idx('활성'),
    currentPassword: idx('현재 비밀번호'),
    profilePhoto: idx('프로필사진')
  };

  const update = makeUpdater(kind);
  const startedAt = new Date().toISOString();
  await update({ ok: true, kind: 'users', running: true, startedAt, totalRows, processedRows: 0, created: 0, updated: 0, skippedSame: 0, generated: [] }, true);

  let created = 0;
  let updated = 0;
  let skippedSame = 0;
  let processedRows = 0;
  const generated = [];

  for (const r of rows.slice(1)) {
    processedRows += 1;
    const userId = String(r[col.userId] || '').trim();
    if (!userId) {
      await update({ processedRows });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setImmediate(res));
      continue;
    }
    const role = String(r[col.role] || 'session').trim().toLowerCase() === 'admin' ? 'admin' : 'session';
    const displayName = String(r[col.displayName] || userId).trim();
    const active = col.active >= 0 ? boolFromLegacy(r[col.active]) : true;
    const profilePhoto = driveToThumb(r[col.profilePhoto] || '', 240);
    const plain = String(r[col.currentPassword] || '').trim();

    // eslint-disable-next-line no-await-in-loop
    const prev = await User.findOne({ userId }).lean();
    if (!prev) {
      let finalPlain = plain;
      let mustChangePassword = false;
      if (!finalPlain) {
        finalPlain = crypto.randomBytes(6).toString('base64url');
        mustChangePassword = true;
        generated.push({ userId, password: finalPlain });
      }
      // eslint-disable-next-line no-await-in-loop
      const passwordHash = await bcrypt.hash(finalPlain, 10);
      // eslint-disable-next-line no-await-in-loop
      await User.create({ userId, role, displayName, active, mustChangePassword, passwordHash, profilePhoto });
      created += 1;
    } else {
      const changed = {};
      if (String(prev.role || '').trim() !== String(role)) changed.role = role;
      if (String(prev.displayName || '').trim() !== String(displayName)) changed.displayName = displayName;
      if (Boolean(prev.active) !== Boolean(active)) changed.active = active;
      if (String(prev.profilePhoto || '').trim() !== String(profilePhoto || '').trim()) changed.profilePhoto = profilePhoto;
      if (updatePasswordExisting && plain) {
        // eslint-disable-next-line no-await-in-loop
        changed.passwordHash = await bcrypt.hash(plain, 10);
        changed.mustChangePassword = false;
      }
      if (!Object.keys(changed).length) skippedSame += 1;
      else {
        // eslint-disable-next-line no-await-in-loop
        await User.updateOne({ userId }, { $set: { ...changed, updatedAt: new Date() } });
        updated += 1;
      }
    }

    await update({
      processedRows,
      created,
      updated,
      skippedSame,
      generated: generated.slice(0, 50),
      lastId: userId,
      lastUpdatedAt: new Date().toISOString()
    });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setImmediate(res));
  }

  const endedAt = new Date().toISOString();
  await update({ running: false, endedAt, created, updated, skippedSame, processedRows, generated: generated.slice(0, 50), lastUpdatedAt: endedAt }, true);
  return { ok: true, created, updated, skippedSame, processedRows, totalRows, generated };
}

async function runImportAvailability(kind, csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const totalRows = Math.max(0, rows.length - 1);
  const idx = (name) => header.findIndex((h) => String(h || '').includes(name));
  const col = {
    legacySongId: idx('곡 ID'),
    googleFileId: idx('드라이브 파일 ID'),
    userId: idx('유저 ID'),
    available: idx('가능 여부')
  };

  // mapping by legacySongId if needed
  let legacyToFile = new Map();
  if (col.googleFileId < 0 && col.legacySongId >= 0) {
    const legacyIds = Array.from(new Set(rows.slice(1).map((r) => String(r[col.legacySongId] || '').trim()).filter(Boolean)));
    const songs = await Song.find({ legacySongId: { $in: legacyIds } }, { legacySongId: 1, googleFileId: 1 }).lean();
    legacyToFile = new Map((songs || []).map((s) => [String(s.legacySongId), String(s.googleFileId)]));
  }

  const update = makeUpdater(kind);
  const startedAt = new Date().toISOString();
  await update({ ok: true, kind: 'availability', running: true, startedAt, totalRows, processedRows: 0, created: 0, updated: 0, skippedSame: 0, missingSongs: 0 }, true);

  let created = 0;
  let updated = 0;
  let skippedSame = 0;
  let missingSongs = 0;
  let processedRows = 0;

  const bulk = Availability.collection.initializeUnorderedBulkOp();
  let bulkCount = 0;
  const now = new Date();

  for (const r of rows.slice(1)) {
    processedRows += 1;
    const userId = String(r[col.userId] || '').trim();
    if (!userId) continue;
    let googleFileId = col.googleFileId >= 0 ? String(r[col.googleFileId] || '').trim() : '';
    if (!googleFileId && col.legacySongId >= 0) {
      const legacySongId = String(r[col.legacySongId] || '').trim();
      googleFileId = legacyToFile.get(legacySongId) || '';
      if (!googleFileId) {
        if (legacySongId) missingSongs += 1;
        continue;
      }
    }
    if (!googleFileId) continue;
    const available = boolFromLegacy(r[col.available >= 0 ? col.available : r.length - 1]);

    // eslint-disable-next-line no-await-in-loop
    const prev = await Availability.findOne({ userId, googleFileId }).lean();
    if (!prev) {
      bulk.find({ userId, googleFileId }).upsert().updateOne({ $set: { userId, googleFileId, available, updatedAt: now } });
      bulkCount += 1;
      created += 1;
    } else if (Boolean(prev.available) === Boolean(available)) {
      skippedSame += 1;
    } else {
      bulk.find({ userId, googleFileId }).updateOne({ $set: { available, updatedAt: now } });
      bulkCount += 1;
      updated += 1;
    }

    if (processedRows % 20 === 0) {
      await update({ processedRows, created, updated, skippedSame, missingSongs, lastUpdatedAt: new Date().toISOString() });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setImmediate(res));
    }
  }

  if (bulkCount) await bulk.execute();
  const endedAt = new Date().toISOString();
  await update({ running: false, endedAt, processedRows, created, updated, skippedSame, missingSongs, lastUpdatedAt: endedAt }, true);
  return { ok: true, created, updated, skippedSame, missingSongs, processedRows, totalRows };
}

async function start(kind, csvText, options) {
  const k = String(kind || '').trim().toLowerCase();
  if (running.get(k)) return { ok: false, error: 'ALREADY_RUNNING' };
  running.set(k, true);
  const startedAt = new Date().toISOString();
  await setStatus(k, { ok: true, running: true, startedAt, lastUpdatedAt: startedAt });

  setTimeout(() => {
    (async () => {
      try {
        if (k === 'songs') await runImportSongs(k, csvText);
        else if (k === 'users') await runImportUsers(k, csvText, options || {});
        else if (k === 'availability') await runImportAvailability(k, csvText);
        else await setStatus(k, { ok: false, running: false, endedAt: new Date().toISOString(), error: 'UNKNOWN_KIND' });
      } catch (e) {
        await setStatus(k, { ok: false, running: false, endedAt: new Date().toISOString(), error: String(e.message || 'IMPORT_FAILED') });
      } finally {
        running.set(k, false);
      }
    })().catch(() => {});
  }, 0);

  return { ok: true, running: true, startedAt };
}

module.exports = { start, getStatus };

