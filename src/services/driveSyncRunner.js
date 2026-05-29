const Setting = require('../models/Setting');
const { driveRootFolderId } = require('../config/env');
const { syncDriveFolderTree } = require('./driveSync');
const { KEYS, setJson, getJson } = require('./syncStatus');

let running = false;
let abortRequested = false;

function isDriveSyncRunning() {
  return running;
}

async function waitForDriveSyncStop(timeoutMs = 60_000) {
  const started = Date.now();
  while (running) {
    if (Date.now() - started > timeoutMs) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 300));
  }
  return true;
}

async function getDriveRootFolderId() {
  const s = await Setting.findOne({ key: 'driveRootFolderId' }).lean();
  return String(s?.value || driveRootFolderId || '').trim();
}

async function runDriveSync({ latestDays = 1, limit = 5000, pruneMissing = true, incremental = true, rootFolderId = '' } = {}) {
  if (running) return { ok: false, error: 'ALREADY_RUNNING' };
  running = true;
  abortRequested = false;
  try {
    const finalRoot = String(rootFolderId || (await getDriveRootFolderId()) || '').trim();
    if (!finalRoot) return { ok: false, error: 'ROOT_FOLDER_ID_REQUIRED' };

    const prev = await getJson(KEYS.driveSyncStatus, null);
    const incrementalSince = incremental ? prev?.endedAt || prev?.startedAt || null : null;

    const startedAt = new Date().toISOString();
    await setJson(KEYS.driveSyncStatus, {
      startedAt,
      running: true,
      rootFolderId: finalRoot,
      latestDays,
      limit,
      pruneMissing,
      incremental,
      processed: 0,
      skipped: 0,
      currentPath: '',
      currentFile: '',
      lastUpdatedAt: startedAt
    });

    // Throttled progress writer (avoid excessive DB writes)
    let lastWriteTs = 0;
    const onProgress = async (p) => {
      const now = Date.now();
      if (now - lastWriteTs < 1200) return;
      lastWriteTs = now;
      const prevStatus = await getJson(KEYS.driveSyncStatus, null);
      const patch = {
        running: true,
        processed: Number(p?.processed ?? prevStatus?.processed ?? 0),
        skipped: Number(p?.skipped ?? prevStatus?.skipped ?? 0),
        currentPath: String(p?.currentPath ?? prevStatus?.currentPath ?? ''),
        currentFile: String(p?.fileName ?? prevStatus?.currentFile ?? ''),
        lastUpdatedAt: new Date().toISOString()
      };
      await setJson(KEYS.driveSyncStatus, { ...(prevStatus || {}), ...patch });
    };

    const result = await syncDriveFolderTree({
      rootFolderId: finalRoot,
      latestDays,
      limit,
      incrementalSince,
      pruneMissing,
      shouldAbort: () => abortRequested,
      onProgress
    });
    const endedAt = new Date().toISOString();

    if (result?.aborted) {
      const status = {
        ok: false,
        aborted: true,
        startedAt,
        endedAt,
        running: false,
        rootFolderId: finalRoot,
        latestDays,
        limit,
        pruneMissing,
        incremental,
        processed: result.processed ?? 0,
        skipped: result.skipped ?? 0,
        hiddenCount: result.hiddenCount ?? 0,
        diff: result.diff || null
      };
      await setJson(KEYS.driveSyncStatus, status);
      return status;
    }

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
      reachedLimit: result.reachedLimit,
      diff: result.diff || null
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
    abortRequested = false;
  }
}

function stopDriveSync() {
  abortRequested = true;
  return { ok: true };
}

async function restartDriveSync(opts = {}) {
  if (!running) return runDriveSync(opts);
  // request abort and wait until the runner actually stops, then start a new run.
  stopDriveSync();
  const ok = await waitForDriveSyncStop(60_000);
  if (!ok) return { ok: false, error: 'STOP_TIMEOUT' };
  return runDriveSync(opts);
}

module.exports = {
  runDriveSync,
  restartDriveSync,
  stopDriveSync,
  isDriveSyncRunning,
  waitForDriveSyncStop,
  getDriveRootFolderId
};
