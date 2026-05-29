// Simple in-memory ring buffer for server errors (dev diagnostics).
// NOTE: Ephemeral by design (Render free restarts).

const MAX = 200;
/** @type {Array<any>} */
let items = [];

function pushError(entry) {
  const v = { ts: new Date().toISOString(), ...(entry || {}) };
  items.push(v);
  if (items.length > MAX) items = items.slice(items.length - MAX);
  return v;
}

function listErrors() {
  return items.slice().reverse(); // newest first
}

function clearErrors() {
  items = [];
  return { ok: true };
}

module.exports = { pushError, listErrors, clearErrors, MAX };

