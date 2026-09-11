/* HELLDIVE: LAST STAND -- relay + static host.
 *
 *   node server.js            (then open http://localhost:8080)
 *   node server.js 3000       (custom port)
 *
 * No dependencies: the WebSocket handshake and framing are implemented below, so
 * there is nothing to npm install. The relay never looks at game messages -- it
 * pairs two sockets by room code and forwards bytes between them.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.argv[2], 10) || process.env.PORT || 8080;
const ROOT = __dirname;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* ------------------------------------------------------------------ statics */
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
              '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav',
              '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon'};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                        'Cache-Control': 'no-cache'});
    res.end(buf);
  });
});

/* ------------------------------------------------------- websocket plumbing */
let nextId = 1;
const sockets = new Map();          // id -> conn
const rooms = new Map();            // code -> {host, clients:[], nextId}
const MAX_CLIENTS = 3;              // plus the host = 4 people in a room

function makeConn(sock) {
  const conn = {id: nextId++, sock, buf: Buffer.alloc(0), room: null, role: null,
                pid: -1, name: '', alive: true, frag: null, fragOp: 0};
  sockets.set(conn.id, conn);
  return conn;
}

function wsSend(conn, str) {
  if (!conn.alive) return;
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2); head[0] = 0x81; head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127;
    head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6);
  }
  try { conn.sock.write(Buffer.concat([head, payload])); } catch (e) { /* gone */ }
}

function wsClose(conn) {
  if (!conn.alive) return;
  conn.alive = false;
  try { conn.sock.end(); } catch (e) {}
  sockets.delete(conn.id);
  const room = conn.room && rooms.get(conn.room);
  if (room) {
    if (room.host === conn) {
      /* host left: the room dies with it */
      for (const c of room.clients) {
        wsSend(c, JSON.stringify({t: 'peerleft', id: 0, host: true}));
        c.room = null;
      }
      rooms.delete(conn.room);
      log(`room ${conn.room} closed (host left)`);
    } else {
      const i = room.clients.indexOf(conn);
      if (i >= 0) room.clients.splice(i, 1);
      const gone = JSON.stringify({t: 'peerleft', id: conn.pid});
      wsSend(room.host, gone);
      for (const c of room.clients) wsSend(c, gone);
      log(`room ${conn.room}: ${conn.name || 'player'} (${conn.pid}) left`);
    }
  }
}

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no look-alike characters
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)]; }
  while (rooms.has(c));
  return c;
}

/* the relay only understands three things; everything else is forwarded blind */
function onMessage(conn, str) {
  let msg = null;
  if (str.charCodeAt(0) === 123 /* { */) {
    try { msg = JSON.parse(str); } catch (e) { msg = null; }
  }
  if (msg && msg.t === 'host') {
    if (conn.room) return;
    const code = roomCode();
    rooms.set(code, {host: conn, clients: [], nextId: 1});
    conn.room = code; conn.role = 'host'; conn.pid = 0;
    conn.name = String(msg.name || 'HOST').slice(0, 14);
    wsSend(conn, JSON.stringify({t: 'hosted', room: code, id: 0}));
    log(`room ${code} opened by ${conn.name}`);
    return;
  }
  if (msg && msg.t === 'join') {
    const code = String(msg.room || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) { wsSend(conn, JSON.stringify({t: 'error', why: 'No game with that code.'})); return; }
    if (room.clients.length >= MAX_CLIENTS) {
      wsSend(conn, JSON.stringify({t: 'error', why: 'That game is full.'})); return;
    }
    conn.pid = room.nextId++;
    conn.name = String(msg.name || ('DIVER ' + conn.pid)).slice(0, 14);
    room.clients.push(conn);
    conn.room = code; conn.role = 'client';
    wsSend(conn, JSON.stringify({t: 'joined', room: code, id: conn.pid}));
    wsSend(room.host, JSON.stringify({t: 'peer', id: conn.pid, name: conn.name}));
    log(`room ${code}: ${conn.name} joined as ${conn.pid} (${room.clients.length}/${MAX_CLIENTS})`);
    return;
  }
  if (msg && msg.t === 'ping') { wsSend(conn, JSON.stringify({t: 'pong', s: msg.s})); return; }

  const room = conn.room && rooms.get(conn.room);
  if (!room) return;

  if (room.host === conn) {
    /* host -> one named client, or everybody */
    if (msg && typeof msg.to === 'number') {
      for (const c of room.clients) if (c.pid === msg.to) { wsSend(c, str); return; }
      return;
    }
    for (const c of room.clients) wsSend(c, str);
    return;
  }
  /* client -> host, tagged so the host knows who it came from */
  if (msg && typeof msg === 'object') {
    msg.from = conn.pid;
    wsSend(room.host, JSON.stringify(msg));
  } else {
    wsSend(room.host, str);
  }
}

function pump(conn) {
  for (;;) {
    const b = conn.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (b.length < off + 2) return; len = b.readUInt16BE(off); off += 2; }
    else if (len === 127) {
      if (b.length < off + 8) return;
      const hi = b.readUInt32BE(off), lo = b.readUInt32BE(off + 4);
      if (hi !== 0) { wsClose(conn); return; }               // >4GB frame: nope
      len = lo; off += 8;
    }
    let mask = null;
    if (masked) { if (b.length < off + 4) return; mask = b.slice(off, off + 4); off += 4; }
    if (b.length < off + len) return;                        // frame still arriving
    let data = b.slice(off, off + len);
    if (masked) {
      data = Buffer.from(data);
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    }
    conn.buf = b.slice(off + len);

    if (op === 8) { wsClose(conn); return; }
    if (op === 9) {                                          // ping -> pong
      const head = Buffer.alloc(2); head[0] = 0x8a; head[1] = data.length;
      try { conn.sock.write(Buffer.concat([head, data])); } catch (e) {}
      continue;
    }
    if (op === 10) continue;                                 // pong

    if (op === 0) {                                          // continuation
      if (!conn.frag) continue;
      conn.frag = Buffer.concat([conn.frag, data]);
    } else {
      if (!fin) { conn.frag = Buffer.from(data); conn.fragOp = op; continue; }
      if (op !== 1) continue;                                // text only
      onMessage(conn, data.toString('utf8'));
      continue;
    }
    if (fin && conn.frag) {
      const whole = conn.frag; conn.frag = null;
      if (conn.fragOp === 1) onMessage(conn, whole.toString('utf8'));
    }
  }
}

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\n' +
             'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
             'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const conn = makeConn(sock);
  sock.on('data', (chunk) => {
    conn.buf = conn.buf.length ? Buffer.concat([conn.buf, chunk]) : chunk;
    if (conn.buf.length > 8 * 1024 * 1024) { wsClose(conn); return; }   // runaway guard
    try { pump(conn); } catch (e) { log('frame error: ' + e.message); wsClose(conn); }
  });
  sock.on('close', () => wsClose(conn));
  sock.on('error', () => wsClose(conn));
});

server.listen(PORT, () => {
  console.log('');
  console.log('  HELLDIVE: LAST STAND -- server up');
  console.log('  ---------------------------------');
  console.log('  Play here:      http://localhost:' + PORT);
  console.log('  Relay endpoint: ws://localhost:' + PORT);
  console.log('');
  console.log('  To play with someone over the internet, put this on a host they can');
  console.log('  reach (Fly.io / Render / Railway free tier), or expose it with a');
  console.log('  tunnel, e.g.:   npx localtunnel --port ' + PORT);
  console.log('');
});
