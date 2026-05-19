/**
 * Minimal API smoke test (M7)
 *
 * Usage:
 *   node smoke-test.mjs http://localhost:3000
 *   node smoke-test.mjs https://<render-app>.onrender.com
 */

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

async function jget(path) {
  const res = await fetch(`${base}${path}`, { redirect: 'follow' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log(`Smoke test base = ${base}`);

  const health = await jget('/api/health');
  assert(health.ok, `health failed: ${health.status}`);
  assert(health.json?.ok === true, `health json invalid: ${health.text}`);
  console.log('✓ /api/health');

  const songs = await jget('/api/songs?limit=1');
  assert(songs.ok, `songs failed: ${songs.status}`);
  assert(Array.isArray(songs.json?.items), `songs json invalid: ${songs.text}`);
  console.log('✓ /api/songs');

  const requests = await jget('/api/requests?limit=1');
  assert(requests.ok, `requests failed: ${requests.status}`);
  assert(Array.isArray(requests.json?.items), `requests json invalid: ${requests.text}`);
  console.log('✓ /api/requests');

  console.log('ALL OK');
}

main().catch((e) => {
  console.error('SMOKE TEST FAILED');
  console.error(e?.stack || String(e));
  process.exit(1);
});

