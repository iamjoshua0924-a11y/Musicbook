/* 실행: node tests/integration/annotation-sync.test.js
 * 필요: devDependencies(socket.io-client). DB 불필요(무DB로 서버 spawn — 소켓 레이어는 in-memory).
 * 검증 대상(2차 감사 VA-03/VA-04 + wb 파이프라인 regression):
 *  - join/follow/wb:page:update 전파, wb:sync:request(memory)
 *  - VA-04: 신규/재연결 join push가 메모리 우선(즉시 도착)
 *  - VA-04b: 곡 복귀 시 방 전체에 라이브 메모리 스냅샷 push
 *  - VA-03: 전원 이탈 시 다곡 백업 루프에서 서버 생존
 * production/외부 시스템 접근 없음.
 */
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 3173;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOM = 'VATEST';

const results = [];
const check = (name, ok, extra = '') => { results.push([name, !!ok]); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? ` (${extra})` : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (nick) => io(BASE, { transports: ['websocket'], auth: { nickname: nick } });
function once(sock, ev, pred, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TIMEOUT waiting ${label || ev} (${timeoutMs}ms)`)), timeoutMs);
    const h = (p) => { if (!pred || pred(p)) { clearTimeout(t); sock.off(ev, h); resolve(p); } };
    sock.on(ev, h);
  });
}
// ack 타임아웃: DB 미연결 환경에서 일부 핸들러의 DB fallback await가 reject되어 ack가
// 유실될 수 있다(브로드캐스트는 ack 이전에 나가므로 수신 기반으로 검증).
const emitAck = (sock, ev, payload, ms = 4000) => new Promise((r) => {
  const t = setTimeout(() => r({ __ackTimeout: true }), ms);
  sock.emit(ev, payload, (a) => { clearTimeout(t); r(a); });
});

setTimeout(() => { console.error('GLOBAL TIMEOUT'); process.exit(3); }, 120000);

(async () => {
  const FAKE_SA = Buffer.from(JSON.stringify({ type: 'service_account', token_uri: 'https://x' })).toString('base64');
  const srv = spawn('node', ['src/server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      MONGODB_URI: 'mongodb://127.0.0.1:1/anno_test?serverSelectionTimeoutMS=1500&connectTimeoutMS=1500',
      SESSION_SECRET: 'test_secret',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: FAKE_SA
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let srvLog = '';
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });

  let up = false;
  for (let i = 0; i < 30; i++) {
    await wait(500);
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) { up = true; break; } } catch {}
  }
  check('서버 부팅(health 200)', up);
  if (!up) { console.log(srvLog.slice(-1000)); srv.kill(); process.exit(1); }

  const A = mk('turnerA'); const B = mk('memberB');
  await Promise.all([once(A, 'connect', null, 5000, 'A connect'), once(B, 'connect', null, 5000, 'B connect')]);

  const ja = await emitAck(A, 'session:join', { roomCode: ROOM, nickname: 'turnerA' });
  const jb = await emitAck(B, 'session:join', { roomCode: ROOM, nickname: 'memberB' });
  check('A/B join ok', ja?.ok === true && jb?.ok === true);

  const bFollow = once(B, 'session:follow:file', (p) => p?.fileId === 'F1', 4000, 'B follow F1');
  emitAck(A, 'session:follow:file', { roomCode: ROOM, fileId: 'F1' }, 1500);
  const bf = await bFollow.catch((e) => e);
  check('A(터너) follow:file F1 브로드캐스트', !(bf instanceof Error));

  const snapF1 = { json: { objects: [{ type: 'path', id: 'stroke-F1' }] }, w: 100, h: 100 };
  const bRecv = once(B, 'wb:page:update', (p) => p?.fileId === 'F1' && String(p.pageNo) === '1', 4000, 'B recv update');
  const up1 = await emitAck(A, 'wb:page:update', { roomCode: ROOM, fileId: 'F1', pageNo: '1', pageSnapshot: snapF1 });
  check('wb:page:update ack ok', up1?.ok === true);
  const bp = await bRecv.catch((e) => e);
  check('B가 update 수신 (전파 regression)', !(bp instanceof Error));

  const sync1 = once(B, 'wb:sync', (p) => p?.fileId === 'F1', 4000, 'B wb:sync');
  const rq = await emitAck(B, 'wb:sync:request', { roomCode: ROOM, fileId: 'F1' });
  check('sync:request source=memory', rq?.source === 'memory');
  const s1 = await sync1.catch((e) => e);
  check('B가 wb:sync(F1) 수신', !(s1 instanceof Error) && !!s1?.snapshot?.['1']);

  // VA-04: 신규 join push가 메모리 우선(즉시)
  const C = mk('lateC');
  await once(C, 'connect', null, 5000, 'C connect');
  const t0 = Date.now();
  const cSync = once(C, 'wb:sync', (p) => p?.fileId === 'F1', 3000, 'C join push (memory-first)');
  await emitAck(C, 'session:join', { roomCode: ROOM, nickname: 'lateC' });
  const cs = await cSync.catch((e) => e);
  check('VA-04 join push memory-first(<3s)', !(cs instanceof Error) && !!cs?.snapshot?.['1'], `${Date.now() - t0}ms`);

  // VA-04b: F2로 갔다가 F1 복귀 → 방 전체가 라이브 메모리 스냅샷 수신
  const bFollow2 = once(B, 'session:follow:file', (p) => p?.fileId === 'F2', 4000, 'B follow F2');
  emitAck(A, 'session:follow:file', { roomCode: ROOM, fileId: 'F2' }, 1500);
  await bFollow2;
  await emitAck(A, 'wb:page:update', { roomCode: ROOM, fileId: 'F2', pageNo: '1', pageSnapshot: { json: { objects: [{ id: 'stroke-F2' }] }, w: 100, h: 100 } });
  const backSync = once(B, 'wb:sync', (p) => p?.fileId === 'F1', 3000, 'F1 복귀 room sync');
  emitAck(A, 'session:follow:file', { roomCode: ROOM, fileId: 'F1' }, 1500);
  const bs = await backSync.catch((e) => e);
  check('VA-04b F1 복귀 시 라이브 스냅샷 push', !(bs instanceof Error) && bs?.snapshot?.['1']?.json?.objects?.[0]?.id === 'stroke-F1');

  // VA-03: 전원 이탈 → 다곡 백업 루프(DB down이면 reject→catch) → 서버 생존
  A.disconnect(); B.disconnect(); C.disconnect();
  await wait(1000);
  let alive = false;
  try { const r = await fetch(`${BASE}/api/health`); alive = r.ok; } catch {}
  check('VA-03 전원 이탈(다곡 백업 루프) 후 서버 생존', alive);

  srv.kill();
  const fails = results.filter(([, ok]) => !ok);
  console.log(`\n== ${results.length - fails.length}/${results.length} PASS ==`);
  if (fails.length) { console.log('server log tail:\n' + srvLog.slice(-1500)); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('TEST ERROR:', e); process.exit(2); });
