/* The relay, for real.
 *
 *   node test/relay.mjs
 *
 * Starts server.js on a spare port and talks to it over actual sockets, because
 * the thing worth testing here is the seat-holding: a Helldiver whose connection
 * drops mid-mission must keep their place, their id and their body, and get the
 * world handed back when they walk in again. None of that is visible from inside
 * the game modules -- it lives in the relay and in the shape of the handshake.
 *
 * There is no WebSocket in this Node, so the client half is fifty lines of
 * framing near the top of the file. */
import { spawn } from 'child_process';
import net from 'net';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return true; }
  fail++; failures.push(name + (detail ? '  -- ' + detail : ''));
  return false;
}
function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PORT = 8099;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const srv = spawn(process.execPath, ['server.js', String(PORT)],
                  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const srvLog = [];
srv.stdout.on('data', d => srvLog.push(String(d)));
srv.stderr.on('data', d => srvLog.push('ERR ' + d));

/* ---------------------------------------------------------------- a client */
function connect() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    const C = { sock, inbox: [], open: false, buf: Buffer.alloc(0), closed: false };
    sock.on('error', reject);
    sock.on('close', () => { C.closed = true; });
    sock.on('connect', () => {
      sock.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n' +
                 'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key +
                 '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    sock.on('data', chunk => {
      C.buf = Buffer.concat([C.buf, chunk]);
      if (!C.open) {
        const i = C.buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        C.open = true;
        C.buf = C.buf.subarray(i + 4);
        resolve(C);
      }
      for (;;) {
        const b = C.buf;
        if (b.length < 2) return;
        let len = b[1] & 0x7f, off = 2;
        if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
        if (b.length < off + len) return;
        const data = b.subarray(off, off + len).toString('utf8');
        C.buf = b.subarray(off + len);
        if ((b[0] & 0x0f) === 1) { try { C.inbox.push(JSON.parse(data)); } catch (e) {} }
      }
    });
  });
}
function send(C, obj) {
  const p = Buffer.from(JSON.stringify(obj), 'utf8');
  const mask = crypto.randomBytes(4);
  let head;
  if (p.length < 126) { head = Buffer.alloc(2); head[1] = 0x80 | p.length; }
  else { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(p.length, 2); }
  head[0] = 0x81;
  const body = Buffer.from(p);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  C.sock.write(Buffer.concat([head, mask, body]));
}
async function waitFor(C, type, ms) {
  const until = Date.now() + (ms || 2500);
  for (;;) {
    for (let i = 0; i < C.inbox.length; i++)
      if (C.inbox[i].t === type) return C.inbox.splice(i, 1)[0];
    if (Date.now() > until) return null;
    await sleep(20);
  }
}

/* ============================ the run ============================ */
await sleep(700);

section('1. A room, a host and a joiner');
const host = await connect();
send(host, { t: 'host', name: 'ALPHA' });
const hosted = await waitFor(host, 'hosted');
ok('host gets a room code', !!hosted && /^[A-Z0-9]{4}$/.test(hosted.room), JSON.stringify(hosted));
const room = hosted ? hosted.room : '';

const bravo = await connect();
send(bravo, { t: 'join', room, name: 'BRAVO' });
const joined = await waitFor(bravo, 'joined');
ok('joiner is seated', !!joined && joined.id === 1, JSON.stringify(joined));
ok('joiner is given a resume token',
   !!joined && typeof joined.token === 'string' && joined.token.length > 8,
   joined && String(joined.token));
const peer = await waitFor(host, 'peer');
ok('host is told about them', !!peer && peer.id === 1 && peer.name === 'BRAVO', JSON.stringify(peer));

section('2. Messages go where they are addressed');
send(host, { t: 'snap', to: 1, hello: 'bravo' });
const got = await waitFor(bravo, 'snap');
ok('a snapshot addressed to one player reaches them', !!got && got.hello === 'bravo');
send(bravo, { t: 'in', k: 7 });
const inp = await waitFor(host, 'in');
ok('input reaches the host tagged with who sent it', !!inp && inp.k === 7 && inp.from === 1,
   JSON.stringify(inp));

section('3. A link drops mid-mission');
bravo.sock.destroy();
const goneMsg = await waitFor(host, 'peergone', 3000);
ok('the host is told the link dropped, not that they left', !!goneMsg && goneMsg.id === 1,
   JSON.stringify(goneMsg));
const left = await waitFor(host, 'peerleft', 600);
ok('the seat is NOT given up', !left, left ? JSON.stringify(left) : '');

section('4. ...and comes back');
const back = await connect();
send(back, { t: 'join', room, name: 'BRAVO', resume: joined ? joined.token : 'x' });
const rejoined = await waitFor(back, 'joined');
ok('they are let back in', !!rejoined && rejoined.resumed === 1, JSON.stringify(rejoined));
ok('with the same id, so the host finds the same body', !!rejoined && rejoined.id === 1,
   rejoined && String(rejoined.id));
const peer2 = await waitFor(host, 'peer');
ok('the host is told it is a rejoin', !!peer2 && peer2.id === 1 && peer2.resumed === 1,
   JSON.stringify(peer2));
send(host, { t: 'city', to: 1, map: 'hollows' });
const city = await waitFor(back, 'city');
ok('the world can be handed back to just them', !!city && city.map === 'hollows');

section('5. A stale token is not a way in');
const impostor = await connect();
send(impostor, { t: 'join', room, name: 'CHARLIE', resume: 'not-a-real-token' });
const fresh = await waitFor(impostor, 'joined');
ok('an unknown token falls back to a fresh seat', !!fresh && fresh.id === 2 && !fresh.resumed,
   JSON.stringify(fresh));
await waitFor(host, 'peer');

section('6. The room is still four people');
const delta = await connect();
send(delta, { t: 'join', room, name: 'DELTA' });
ok('the third joiner fits', !!(await waitFor(delta, 'joined')));
await waitFor(host, 'peer');
const echo = await connect();
send(echo, { t: 'join', room, name: 'ECHO' });
const err = await waitFor(echo, 'error');
ok('the fifth person is refused', !!err && /full/i.test(err.why || ''), JSON.stringify(err));

section('7. A held seat still counts against the room');
delta.sock.destroy();
await waitFor(host, 'peergone', 3000);
const echo2 = await connect();
send(echo2, { t: 'join', room, name: 'ECHO' });
const err2 = await waitFor(echo2, 'error', 1500);
ok('a dropped player is not replaced by a stranger', !!err2 && /full/i.test(err2.why || ''),
   err2 ? JSON.stringify(err2) : 'they were let in');

section('8. The host leaving still ends the room');
host.sock.destroy();
const dead = await waitFor(back, 'peerleft', 3000);
ok('everybody is told the session is over', !!dead && dead.host === true, JSON.stringify(dead));

/* ---------------------------------------------------------------- result */
srv.kill();
await sleep(150);
console.log('\n' + '-'.repeat(60));
if (failures.length) {
  console.log('\x1b[31m' + fail + ' FAILED\x1b[0m, ' + pass + ' passed\n');
  for (const f of failures) console.log('  \x1b[31mx\x1b[0m ' + f);
  console.log('\nrelay log:\n' + srvLog.join(''));
  process.exit(1);
} else {
  console.log('\x1b[32mall ' + pass + ' relay checks passed\x1b[0m');
  process.exit(0);
}
