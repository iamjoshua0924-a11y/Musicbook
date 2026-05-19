const Setting = require('../models/Setting');
const { driveRootFolderId } = require('../config/env');
const { syncDriveFolderTree } = require('./driveSync');
const { KEYS, setJson, getJson } = require('./syncStatus');

let running = false;

async function getDriveRootFolderId() {
  const s = await Setting.findOne({ key: 'driveRootFolderId' }).lean();
  return String(s?.value || driveRootFolderId || '').trim();
}

async function runDriveSync({ latestDays = 30, limit = 5000, pruneMissing = true, incremental = true, rootFolderId = '' } = {}) {
  if (running) return { ok: false, error: 'ALREADY_RUNNING' };
  running = true;
  try {
    const finalRoot = String(rootFolderId || (await getDriveRootFolderId()) || '').trim();
    if (!finalRoot) return { ok: false, error: 'ROOT_FOLDER_ID_REQUIRED' };

    const prev = await getJson(KEYS.driveSyncStatus, null);
    const incrementalSince = incremental ? prev?.endedAt || prev?.startedAt || null : null;

    const startedAt = new Date().toISOString();
    await setJson(KEYS.driveSyncStatus, { startedAt, running: true, rootFolderId: finalRoot, latestDays, limit, pruneMissing, incremental });

    const result = await syncDriveFolderTree({ rootFolderId: finalRoot, latestDays, limit, incrementalSince, pruneMissing });
    const endedAt = new Date().toISOString();

    const status = {
      ok: true,
      startedAt,
      endedAt,
      running: false,
      rootFolderId: finalRoot,
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
    await setJson(KEYS.driveSyncLastAt, { endedAt });
    return status;
  } catch (e) {
    const endedAt = new Date().toISOString();
    await setJson(KEYS.driveSyncStatus, { ok: false, endedAt, running: false, error: String(e.message || 'SYNC_FAILED') });
    return { ok: false, error: String(e.message || 'SYNC_FAILED') };
  } finally {
    running = false;
  }
}

module.exports = { runDriveSync, getDriveRootFolderId };

