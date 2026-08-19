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

async function runDriveSync({ latestDays = 1, limit = 7000, pruneMissing = true, incremental = true, rootFolderId = '' } = {}) {
  if (running) return { ok: false, error: 'ALREADY_RUNNING' };
  running = true;
  abortRequested = false;
  // DS-03a: 진행 상태 쓰기는 전부 이 체인을 통해 직렬화한다.
  // finalized 이후에 착지하는 늦은 progress 쓰기가 최종 상태(running:false)를
  // running:true로 되돌려 UI가 영구 "동기화 중"에 갇히는 레이스를 막는다.
  let finalized = false;
  let statusChain = Promise.resolve();
  const finalizeStatus = async (status) => {
    finalized = true;
    await statusChain.catch(() => {});
    await setJson(KEYS.driveSyncStatus, status);
  };
  try {
    const finalRoot = String(rootFolderId || (await getDriveRootFolderId()) || '').trim();
    if (!finalRoot) return { ok: false, error: 'ROOT_FOLDER_ID_REQUIRED' };

    const prev = await getJson(KEYS.driveSyncStatus, null);
    // IMPORTANT: 실패/중단된 회차의 endedAt을 기준으로 삼으면 안 된다.
    // 그 회차가 실제로는 못 본 파일까지 "그 시각 이후로 변경 없음"으로 취급되어
    // 갱신이 계속 밀린다. 정상 완료된 회차의 종료시각만 기준으로 쓴다.
    const prevCompletedOk = Boolean(prev?.ok) && !prev?.aborted && !prev?.reachedLimit && !prev?.pruneSkippedReason;
    // DS-04: 기준 시각은 endedAt이 아니라 startedAt이어야 한다.
    // endedAt 기준이면 이전 회차 실행 도중(startedAt~endedAt)에 수정된 파일이
    // "그 시각 이전 변경"으로 분류되어 영구 누락된다. startedAt 기준이면 그 구간
    // 파일이 다음 회차에서 다시 처리된다(중복 처리는 무해 — upsert).
    const incrementalSince = incremental && prevCompletedOk ? prev?.startedAt || prev?.endedAt || null : null;

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
    const onProgress = (p) => {
      const now = Date.now();
      if (finalized || now - lastWriteTs < 1200) return;
      lastWriteTs = now;
      statusChain = statusChain
        .then(async () => {
          if (finalized) return;
          const prevStatus = await getJson(KEYS.driveSyncStatus, null);
          if (finalized) return;
          const patch = {
            running: true,
            processed: Number(p?.processed ?? prevStatus?.processed ?? 0),
            skipped: Number(p?.skipped ?? prevStatus?.skipped ?? 0),
            currentPath: String(p?.currentPath ?? prevStatus?.currentPath ?? ''),
            currentFile: String(p?.fileName ?? prevStatus?.currentFile ?? ''),
            lastUpdatedAt: new Date().toISOString()
          };
          await setJson(KEYS.driveSyncStatus, { ...(prevStatus || {}), ...patch });
        })
        .catch(() => {});
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
        diff: result.diff || null,
        listFailureCount: result.listFailureCount ?? 0,
        listFailures: result.listFailures || [],
        skippedNonPdfCount: result.skippedNonPdfCount ?? 0,
        skippedNonPdf: result.skippedNonPdf || []
      };
      await finalizeStatus(status);
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
      diff: result.diff || null,
      // 진단: 곡 누락 추적용 (폴더 조회 실패 / PDF 아님으로 건너뜀 / 숨김처리 보류 사유)
      listFailureCount: result.listFailureCount ?? 0,
      listFailures: result.listFailures || [],
      skippedNonPdfCount: result.skippedNonPdfCount ?? 0,
      skippedNonPdf: result.skippedNonPdf || [],
      pruneSkippedReason: result.pruneSkippedReason || '',
      seenCount: result.seenCount ?? 0,
      prevCount: result.prevCount ?? 0,
      updateErrorCount: result.updateErrorCount ?? 0,
      updateErrors: result.updateErrors || []
    };
    await finalizeStatus(status);
    await setJson(KEYS.driveSyncLastAt, { endedAt });
    return status;
  } catch (e) {
    const endedAt = new Date().toISOString();
    await finalizeStatus({ ok: false, endedAt, running: false, error: String(e.message || 'SYNC_FAILED') }).catch(() => {});
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
