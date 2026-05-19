const bcrypt = require('bcrypt');
const crypto = require('crypto');

const Setting = require('../models/Setting');
const Song = require('../models/Song');
const User = require('../models/User');
const Availability = require('../models/Availability');

function parseCsv(text) {
  // Minimal CSV parser supporting quotes + newlines inside quotes.
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;

  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const next = s[i + 1];
    if (inQ) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        cell = '';
        if (row.some((x) => String(x || '').trim() !== '')) rows.push(row);
        row = [];
      } else if (ch === '\r') {
        // ignore
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((v) => String(v ?? '').trim()));
}

function boolFromLegacy(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'y' || s === 'yes';
}

function extractDriveFileId(str) {
  const s = String(str || '');
  const m1 = s.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  return '';
}

function driveToThumb(url, size = 320) {
  const id = extractDriveFileId(url);
  if (!id) return String(url || '');
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${size}`;
}

function normalizeMainPageFromCsv(csvText) {
  const rows = parseCsv(csvText);
  // header: 항목,내용
  const map = {};
  rows.slice(1).forEach((r) => {
    const k = r[0];
    const v = r.slice(1).join(',');
    if (!k) return;
    if (k.includes('배너')) map.bannerImage = v;
    else if (k.includes('타이틀')) map.titleImage = v;
    else if (k.includes('공지')) map.notice = v;
    else if (k.includes('디스코드')) map.discordUrl = v;
    else if (k.includes('유튜브')) map.youtubeUrl = v;
    else if (k.includes('치지직')) map.chzzkUrl = v;
  });
  return {
    titleImage: driveToThumb(map.titleImage || '', 800),
    bannerImage: driveToThumb(map.bannerImage || '', 1600),
    notice: map.notice || '',
    discordUrl: map.discordUrl || '',
    youtubeUrl: map.youtubeUrl || '',
    chzzkUrl: map.chzzkUrl || ''
  };
}

async function importMainPage(csvText) {
  if (!csvText) return { ok: true, imported: 0 };
  const d = normalizeMainPageFromCsv(csvText);
  const keys = Object.keys(d);
  for (const k of keys) {
    await Setting.findOneAndUpdate({ key: k }, { $set: { key: k, value: String(d[k] || '') } }, { upsert: true });
  }
  return { ok: true, imported: keys.length };
}

async function importSettings(csvText) {
  if (!csvText) return { ok: true, imported: 0 };
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const keyIdx = header.findIndex((h) => h.includes('설정') || h.toLowerCase().includes('key'));
  const valIdx = header.findIndex((h) => h.includes('값') || h.toLowerCase().includes('value'));
  let imported = 0;
  for (const r of rows.slice(1)) {
    const key = r[keyIdx >= 0 ? keyIdx : 0];
    const value = r[valIdx >= 0 ? valIdx : 1] ?? '';
    if (!key) continue;
    await Setting.findOneAndUpdate({ key }, { $set: { key, value: String(value) } }, { upsert: true });
    imported += 1;
  }
  return { ok: true, imported };
}

async function importSongs(csvText) {
  if (!csvText) return { ok: true, imported: 0 };
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const idx = (name) => header.findIndex((h) => h.includes(name));
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

  let imported = 0;
  for (const r of rows.slice(1)) {
    const googleFileId = r[col.googleFileId] || '';
    if (!googleFileId) continue;
    const doc = {
      legacySongId: r[col.legacySongId] || '',
      title: r[col.title] || '',
      displayTitle: r[col.displayTitle] || r[col.title] || '',
      key: r[col.key] || '',
      artist: r[col.artist] || '',
      genre: r[col.genre] || '',
      mood: r[col.mood] || '',
      vocal: r[col.vocal] || '',
      googleFileId,
      driveUrl: r[col.driveUrl] || '',
      folderPath: r[col.folderPath] || '',
      searchText: (r[col.searchText] || `${r[col.displayTitle] || ''} ${r[col.artist] || ''}`).toLowerCase(),
      parseError: r[col.parseError] || '',
      hidden: boolFromLegacy(r[col.hidden])
    };
    await Song.findOneAndUpdate({ googleFileId }, { $set: doc }, { upsert: true });
    imported += 1;
  }
  return { ok: true, imported };
}

async function importSongsSelective(csvText) {
  if (!csvText) return { ok: true, created: 0, updated: 0, skippedSame: 0, duplicatesSkipped: 0 };
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const idx = (name) => header.findIndex((h) => h.includes(name));
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

  const seen = new Set();
  let created = 0;
  let updated = 0;
  let skippedSame = 0;
  let duplicatesSkipped = 0;

  for (const r of rows.slice(1)) {
    const googleFileId = String(r[col.googleFileId] || '').trim();
    if (!googleFileId) continue;
    if (seen.has(googleFileId)) {
      duplicatesSkipped += 1;
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

    const prev = await Song.findOne({ googleFileId }).lean();
    if (!prev) {
      await Song.create({ ...doc });
      created += 1;
      continue;
    }

    const keys = [
      'legacySongId',
      'title',
      'displayTitle',
      'key',
      'artist',
      'genre',
      'mood',
      'vocal',
      'driveUrl',
      'folderPath',
      'searchText',
      'parseError',
      'hidden'
    ];
    const changed = {};
    keys.forEach((k) => {
      const pv = prev[k];
      const nv = doc[k];
      const eq = typeof nv === 'boolean' ? Boolean(pv) === Boolean(nv) : String(pv ?? '').trim() === String(nv ?? '').trim();
      if (!eq) changed[k] = nv;
    });
    if (!Object.keys(changed).length) {
      skippedSame += 1;
      continue;
    }
    await Song.updateOne({ googleFileId }, { $set: { ...changed, updatedAt: new Date() } });
    updated += 1;
  }

  return { ok: true, created, updated, skippedSame, duplicatesSkipped };
}

async function importUsers(csvText) {
  if (!csvText) return { ok: true, imported: 0, generated: [] };
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const idx = (name) => header.findIndex((h) => h.includes(name));
  const col = {
    userId: idx('유저 ID'),
    legacyPasswordHash: idx('비밀번호 해시'),
    role: idx('역할'),
    displayName: idx('표시'),
    active: idx('활성'),
    mustChangePassword: idx('비밀번호 변경 여부'),
    currentPassword: idx('현재 비밀번호'),
    profilePhoto: idx('프로필사진')
  };

  let imported = 0;
  const generated = [];

  for (const r of rows.slice(1)) {
    const userId = r[col.userId] || '';
    if (!userId) continue;
    const role = (r[col.role] || 'session').toLowerCase() === 'admin' ? 'admin' : 'session';
    const displayName = r[col.displayName] || userId;
    const active = col.active >= 0 ? boolFromLegacy(r[col.active]) : true;
    const mustChangePassword = col.mustChangePassword >= 0 ? boolFromLegacy(r[col.mustChangePassword]) : false;
    const legacyPasswordHash = r[col.legacyPasswordHash] || '';
    const profilePhoto = driveToThumb(r[col.profilePhoto] || '', 240);

    let plain = String(r[col.currentPassword] || '').trim();
    let finalMustChange = mustChangePassword;
    if (!plain) {
      plain = crypto.randomBytes(6).toString('base64url');
      finalMustChange = true;
      generated.push({ userId, password: plain });
    }
    const passwordHash = await bcrypt.hash(plain, 10);

    await User.findOneAndUpdate(
      { userId },
      { $set: { userId, role, displayName, active, mustChangePassword: finalMustChange, passwordHash, legacyPasswordHash, profilePhoto } },
      { upsert: true }
    );
    imported += 1;
  }
  return { ok: true, imported, generated };
}

async function importUsersSelective(csvText, { updatePasswordExisting = false } = {}) {
  if (!csvText) return { ok: true, created: 0, updated: 0, skippedSame: 0, generated: [] };
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const idx = (name) => header.findIndex((h) => h.includes(name));
  const col = {
    userId: idx('유저 ID'),
    role: idx('역할'),
    displayName: idx('표시'),
    active: idx('활성'),
    currentPassword: idx('현재 비밀번호'),
    profilePhoto: idx('프로필사진')
  };

  let created = 0;
  let updated = 0;
  let skippedSame = 0;
  const generated = [];

  for (const r of rows.slice(1)) {
    const userId = String(r[col.userId] || '').trim();
    if (!userId) continue;
    const role = (String(r[col.role] || 'session').trim().toLowerCase() === 'admin' ? 'admin' : 'session');
    const displayName = String(r[col.displayName] || userId).trim();
    const active = col.active >= 0 ? boolFromLegacy(r[col.active]) : true;
    const profilePhoto = driveToThumb(r[col.profilePhoto] || '', 240);
    const plain = String(r[col.currentPassword] || '').trim();

    const prev = await User.findOne({ userId }).lean();
    if (!prev) {
      let finalPlain = plain;
      let mustChangePassword = false;
      if (!finalPlain) {
        finalPlain = crypto.randomBytes(6).toString('base64url');
        mustChangePassword = true;
        generated.push({ userId, password: finalPlain });
      }
      const passwordHash = await bcrypt.hash(finalPlain, 10);
      await User.create({ userId, role, displayName, active, mustChangePassword, passwordHash, profilePhoto });
      created += 1;
      continue;
    }

    const changed = {};
    if (String(prev.role || '').trim() !== String(role)) changed.role = role;
    if (String(prev.displayName || '').trim() !== String(displayName)) changed.displayName = displayName;
    if (Boolean(prev.active) !== Boolean(active)) changed.active = active;
    if (String(prev.profilePhoto || '').trim() !== String(profilePhoto || '').trim()) changed.profilePhoto = profilePhoto;

    if (updatePasswordExisting && plain) {
      changed.passwordHash = await bcrypt.hash(plain, 10);
      changed.mustChangePassword = false;
    }

    if (!Object.keys(changed).length) {
      skippedSame += 1;
      continue;
    }
    await User.updateOne({ userId }, { $set: { ...changed, updatedAt: new Date() } });
    updated += 1;
  }

  return { ok: true, created, updated, skippedSame, generated };
}

async function importAvailability(csvText) {
  if (!csvText) return { ok: true, imported: 0, missingSongs: 0 };
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const idx = (name) => header.findIndex((h) => h.includes(name));
  const col = {
    legacySongId: idx('곡 ID'),
    userId: idx('유저 ID'),
    available: idx('가능 여부')
  };
  let imported = 0;
  let missingSongs = 0;
  for (const r of rows.slice(1)) {
    const legacySongId = r[col.legacySongId] || '';
    const userId = r[col.userId] || '';
    if (!legacySongId || !userId) continue;
    const song = await Song.findOne({ legacySongId }).lean();
    if (!song?.googleFileId) {
      missingSongs += 1;
      continue;
    }
    const googleFileId = song.googleFileId;
    const available = boolFromLegacy(r[col.available]);
    await Availability.findOneAndUpdate(
      { userId, googleFileId },
      { $set: { userId, googleFileId, available, updatedAt: new Date() } },
      { upsert: true }
    );
    imported += 1;
  }
  return { ok: true, imported, missingSongs };
}

async function importAvailabilitySelective(csvText) {
  if (!csvText) return { ok: true, created: 0, updated: 0, skippedSame: 0, missingSongs: 0 };
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const idx = (name) => header.findIndex((h) => String(h || '').includes(name));

  const col = {
    legacySongId: idx('곡 ID'),
    googleFileId: header.findIndex((h) => String(h || '').includes('드라이브 파일 ID')) >= 0 ? header.findIndex((h) => String(h || '').includes('드라이브 파일 ID')) : -1,
    userId: idx('유저 ID'),
    available: header.findIndex((h) => String(h || '').includes('가능 여부')) >= 0 ? header.findIndex((h) => String(h || '').includes('가능 여부')) : -1
  };

  // songId mapping (legacySongId -> googleFileId) in one query
  let legacyToFile = new Map();
  if (col.googleFileId < 0 && col.legacySongId >= 0) {
    const legacyIds = Array.from(new Set(rows.slice(1).map((r) => String(r[col.legacySongId] || '').trim()).filter(Boolean)));
    const songs = await Song.find({ legacySongId: { $in: legacyIds } }, { legacySongId: 1, googleFileId: 1 }).lean();
    legacyToFile = new Map((songs || []).map((s) => [String(s.legacySongId), String(s.googleFileId)]));
  }

  let created = 0;
  let updated = 0;
  let skippedSame = 0;
  let missingSongs = 0;

  const bulk = Availability.collection.initializeUnorderedBulkOp();
  let bulkCount = 0;
  const now = new Date();

  for (const r of rows.slice(1)) {
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
    const available = boolFromLegacy(col.available >= 0 ? r[col.available] : r[r.length - 1]);

    // We can't efficiently diff without reading; do a best-effort diff by upserting with $set and later count.
    // To honor "동일값은 스킵", do a read for each pair (bounded by typical CSV size).
    // (Could be optimized later with aggregation, but this is clear and safe.)
    // eslint-disable-next-line no-await-in-loop
    const prev = await Availability.findOne({ userId, googleFileId }).lean();
    if (!prev) {
      bulk.find({ userId, googleFileId }).upsert().updateOne({ $set: { userId, googleFileId, available, updatedAt: now } });
      bulkCount += 1;
      created += 1;
      continue;
    }
    if (Boolean(prev.available) === Boolean(available)) {
      skippedSame += 1;
      continue;
    }
    bulk.find({ userId, googleFileId }).updateOne({ $set: { available, updatedAt: now } });
    bulkCount += 1;
    updated += 1;
  }

  if (bulkCount) await bulk.execute();
  return { ok: true, created, updated, skippedSame, missingSongs };
}

async function importLegacyBundle(bundle) {
  // Order matters
  const result = {};
  result.mainPage = await importMainPage(bundle.mainPageCsv);
  result.settings = await importSettings(bundle.settingsCsv);
  result.songs = await importSongs(bundle.songsCsv);
  result.users = await importUsers(bundle.usersCsv);
  result.availability = await importAvailability(bundle.availabilityCsv);
  return result;
}

module.exports = {
  parseCsv,
  boolFromLegacy,
  driveToThumb,
  importLegacyBundle,
  importSongsSelective,
  importUsersSelective,
  importAvailabilitySelective
};
