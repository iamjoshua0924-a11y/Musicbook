// Socket connection count history (in-memory, 1-minute buckets, 24h retention)
// Used by Developer console. Ephemeral by design.

const BUCKET_MS = 60_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** @type {Map<number, number>} */
const buckets = new Map(); // bucketStartMs -> maxCountInBucket
let lastCount = 0;

function floorToBucket(ts) {
  return Math.floor(Number(ts || 0) / BUCKET_MS) * BUCKET_MS;
}

function prune(nowTs) {
  const minTs = Number(nowTs || Date.now()) - RETENTION_MS - BUCKET_MS;
  for (const k of buckets.keys()) {
    if (k < minTs) buckets.delete(k);
  }
}

function recordConnectionCount(count, ts = Date.now()) {
  const t = Number(ts || Date.now());
  const c = Math.max(0, Number(count || 0));
  lastCount = c;
  const key = floorToBucket(t);
  const prev = buckets.get(key) ?? 0;
  buckets.set(key, Math.max(prev, c)); // "분당 최대값" 방식
  prune(t);
}

function getNowCount() {
  return lastCount;
}

function getSeries({ nowTs = Date.now(), windowMs = RETENTION_MS } = {}) {
  const now = Number(nowTs || Date.now());
  const start = now - Math.max(BUCKET_MS, Number(windowMs || RETENTION_MS));
  const startKey = floorToBucket(start);
  const endKey = floorToBucket(now);

  /** @type {Array<{t:number,c:number}>} */
  const out = [];
  let carry = 0;
  for (let k = startKey; k <= endKey; k += BUCKET_MS) {
    if (buckets.has(k)) carry = Number(buckets.get(k) || 0);
    out.push({ t: k, c: carry });
  }
  return out;
}

module.exports = { recordConnectionCount, getNowCount, getSeries, BUCKET_MS, RETENTION_MS };

