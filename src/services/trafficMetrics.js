const { PassThrough } = require('node:stream');

/**
 * Very small in-memory traffic metrics collector (admin diagnostics only).
 * - Not persisted across restarts
 * - Designed to answer "what endpoint/fileId is burning bandwidth?"
 */

function nowIso() {
  return new Date().toISOString();
}

/** @typedef {{count:number, bytes:number, ranges:number, lastAt?:string, topFileIds: Record<string, {count:number, bytes:number}>}} Metric */

/** @type {{startedAt:string, http: Record<string, Metric>, ws: Record<string, Metric>}} */
let state = {
  startedAt: nowIso(),
  http: {},
  ws: {}
};

function ensure(bucket, key) {
  const m = bucket[key];
  if (m) return m;
  bucket[key] = { count: 0, bytes: 0, ranges: 0, topFileIds: {} };
  return bucket[key];
}

function bumpTopFileId(m, fileId, bytes) {
  const fid = String(fileId || '').trim();
  if (!fid) return;
  const t = m.topFileIds[fid] || { count: 0, bytes: 0 };
  t.count += 1;
  t.bytes += Math.max(0, Number(bytes || 0));
  m.topFileIds[fid] = t;
}

function recordHttp({ name, fileId = '', bytes = 0, range = '' } = {}) {
  const key = String(name || 'unknown').trim() || 'unknown';
  const m = ensure(state.http, key);
  m.count += 1;
  m.bytes += Math.max(0, Number(bytes || 0));
  if (range) m.ranges += 1;
  m.lastAt = nowIso();
  bumpTopFileId(m, fileId, bytes);
}

function recordWs({ name, fileId = '', bytes = 0 } = {}) {
  const key = String(name || 'unknown').trim() || 'unknown';
  const m = ensure(state.ws, key);
  m.count += 1;
  m.bytes += Math.max(0, Number(bytes || 0));
  m.lastAt = nowIso();
  bumpTopFileId(m, fileId, bytes);
}

/**
 * Creates a passthrough stream that counts bytes flowing through it.
 * Call `onDone(bytes)` in pipeline completion.
 */
function makeByteCounterStream(onDone) {
  const pt = new PassThrough();
  let n = 0;
  pt.on('data', (chunk) => {
    try {
      n += chunk?.length || 0;
    } catch {}
  });
  pt.on('end', () => {
    try {
      onDone?.(n);
    } catch {}
  });
  pt.on('close', () => {
    // In aborted connections, 'end' may not fire; still report best-effort.
    try {
      onDone?.(n);
    } catch {}
  });
  return pt;
}

function getTrafficMetrics() {
  return state;
}

function resetTrafficMetrics() {
  state = { startedAt: nowIso(), http: {}, ws: {} };
  return state;
}

module.exports = {
  recordHttp,
  recordWs,
  makeByteCounterStream,
  getTrafficMetrics,
  resetTrafficMetrics
};

