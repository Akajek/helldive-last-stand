/* Transport and lobby.
 *
 * Host-authoritative: the host's machine runs the whole simulation, clients send
 * input and receive snapshots. The relay in server.js never looks inside a
 * message -- it pairs sockets by room code and forwards bytes. */
'use strict';
import { el } from './util.js';
import { CFG, LOADOUT, myName, setStoredName } from './config.js';
import { S, setRole, role, say } from './state.js';

export const NET = {
  ws: null, room: '', hosting: false, peer: false,
  myId: -1, ping: 0, pingAt: 0,
  acc: 0, rate: 1 / 12, inAcc: 0, inRate: 1 / 20, actions: [],
  lastSnap: 0, snapGap: 0.083, tick: 0,
  mapId: 'megacity', seed: 1, roster: null, hostPaused: false,
  peers: []                    /* [{id, name}] -- who the host is talking to */
};
export const LOBBY = { mode: 'gm', slots: [], myId: -1 };

export const NETHOOK = {
  city: null, snap: null, over: null, input: null,
  toMenu: null, start: null
};

export function netURL() {
  const f = el('relayurl'), v = f ? f.value.trim() : '';
  if (v) return v;
  if (location.protocol === 'http:' || location.protocol === 'https:')
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  return 'ws://localhost:8080';
}
export function netStatus(txt, bad) {
  for (const id of ['netstatus', 'netstatus2']) {
    const e = el(id);
    if (e) { e.textContent = txt; e.style.color = bad ? '#ff6b6b' : '#ffd21e'; }
  }
}
export function netSend(o) {
  if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(o));
}
export function netAct(a) { if (NET.actions.length < 24) NET.actions.push(a); }

export function netOpen(mode, code, mapId) {
  if (NET.ws) { try { NET.ws.close(); } catch (e) {} NET.ws = null; }
  const url = netURL();
  netStatus('connecting to ' + url + ' ...');
  let ws;
  try { ws = new WebSocket(url); }
  catch (e) { netStatus('bad relay address: ' + e.message, true); return; }
  NET.ws = ws;
  NET.mapId = mapId || NET.mapId;
  ws.onopen = () => {
    if (mode === 'host') netSend({ t: 'host', name: myName() });
    else netSend({ t: 'join', room: String(code || '').toUpperCase(), name: myName() });
  };
  ws.onerror = () => netStatus('could not reach the relay — is server.js running?', true);
  ws.onclose = () => {
    if (role() !== 'solo') {
      netStatus('connection lost', true);
      if (NETHOOK.toMenu) NETHOOK.toMenu('CONNECTION LOST', 'The link to your squad dropped.');
    } else netStatus('disconnected', true);
  };
  ws.onmessage = ev => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    try { netHandle(m); }
    catch (err) { console.error('net', m && m.t, err); }
    /* An arriving message is the one heartbeat a browser will not throttle. A
       host with three Helldivers gets woken sixty times a second by their input
       even with the window buried, which is what keeps the mission running at
       real speed for everyone else while somebody alt-tabs. */
    if (NETWAKE.fn) NETWAKE.fn();
  };
}

function netHandle(m) {
  switch (m.t) {
    case 'hosted':
      NET.room = m.room; NET.hosting = true;
      LOBBY.myId = 0; NET.myId = 0;
      LOBBY.slots = [{ id: 0, name: myName(), role: lobbyDefaultRole(0), load: LOADOUT.slots.slice() }];
      netStatus('room ' + m.room + ' — share the code');
      el('roomcode').textContent = m.room;
      el('roombox').style.display = 'block';
      lobbyOpen();
      break;
    case 'joined':
      NET.room = m.room; LOBBY.myId = m.id; NET.myId = m.id;
      netStatus('joined ' + m.room + ' — waiting for the host to start');
      netSend({ t: 'load', slots: LOADOUT.slots });
      lobbyOpen();
      break;
    case 'peer':
      NET.peer = true;
      NET.peers.push({ id: m.id, name: m.name });
      LOBBY.slots.push({ id: m.id, name: m.name || ('DIVER ' + m.id), role: 'diver',
                         load: LOADOUT.slots.slice() });
      netStatus((m.name || 'A player') + ' joined — set the roster, then start');
      lobbyBroadcast();
      break;
    case 'lobby':
      LOBBY.mode = m.mode; LOBBY.slots = m.slots || [];
      if (m.cfg) for (const k in CFG) if (typeof m.cfg[k] === 'number') CFG[k] = m.cfg[k];
      if (CFGHOOK.apply) CFGHOOK.apply();
      lobbyRender();
      break;
    case 'want': lobbyHostWant(m.from, m.role); break;
    case 'name':
      if (NET.hosting) {
        const NS = lobbySlot(m.from);
        if (NS) { NS.name = String(m.name || '').slice(0, 14) || NS.name; lobbyBroadcast(); }
      }
      break;
    case 'load':
      if (NET.hosting) {
        const LS = lobbySlot(m.from);
        if (LS && Array.isArray(m.slots) && m.slots.length === 4) {
          LS.load = m.slots.map(String);
          lobbyBroadcast();
        }
      }
      break;
    case 'error': netStatus(m.why || 'refused', true); break;
    case 'peerleft':
      if (m.host || !NET.hosting) {
        if (NETHOOK.toMenu) NETHOOK.toMenu('LOBBY CLOSED', 'The host ended the session.');
        break;
      }
      for (let i = LOBBY.slots.length - 1; i >= 0; i--)
        if (LOBBY.slots[i].id === m.id) LOBBY.slots.splice(i, 1);
      for (let i = NET.peers.length - 1; i >= 0; i--)
        if (NET.peers[i].id === m.id) NET.peers.splice(i, 1);
      NET.peer = LOBBY.slots.length > 1;
      netStatus('a player left the lobby');
      lobbyBroadcast();
      if (S.running && !S.gameOver) say('A PLAYER DISCONNECTED', 3);
      break;
    case 'city': if (NETHOOK.city) NETHOOK.city(m); break;
    case 'snap': if (NETHOOK.snap) NETHOOK.snap(m); break;
    case 'over': if (NETHOOK.over) NETHOOK.over(m); break;
    case 'in': if (NETHOOK.input) NETHOOK.input(m); break;
    case 'pp': netSend({ t: 'pq', s: m.s }); break;
    case 'pq': NET.ping = Math.round(performance.now() - m.s); S.ping = NET.ping; break;
  }
}
export const CFGHOOK = { apply: null };
/* main.js hangs the loop's catch-up here; see THE LOOP. */
export const NETWAKE = { fn: null };

export function netQuit() {
  if (NET.ws) { try { NET.ws.close(); } catch (e) {} NET.ws = null; }
  setRole('solo');
  NET.peer = false; NET.room = ''; NET.hostPaused = false; NET.hosting = false;
  NET.roster = null; NET.peers = [];
  S.gmMatch = false;
  LOBBY.slots = []; LOBBY.myId = -1; NET.myId = -1;
  lobbyClose();
  const cb = el('cfgbox'); if (cb) cb.className = '';
  el('pausedbanner').style.display = 'none';
  document.body.classList.remove('gm');
  el('roombox').style.display = 'none';
  netStatus('offline');
}

/* ============================ THE LOBBY ============================
   The host owns this outright: mode, settings and every slot's role. Clients ask
   for a role and render whatever the host last broadcast. */
export function lobbySlot(id) {
  for (const s of LOBBY.slots) if (s.id === id) return s;
  return null;
}
export function lobbyCount(r) {
  let n = 0;
  for (const s of LOBBY.slots) if (s.role === r) n++;
  return n;
}
/* In GM mode the lobby creator IS the Game Master -- not by choice, by wiring.
   The simulation lives on their machine and snapshots are culled around the
   squad, so an off-host GM would be looking at a map with holes in it. */
export function lobbyDefaultRole(id) { return (LOBBY.mode === 'gm' && id === 0) ? 'gm' : 'diver'; }
export function lobbyLocked(id) { return LOBBY.mode === 'gm' && id === 0; }
export function lobbyBroadcast() {
  if (!NET.hosting) return;
  netSend({ t: 'lobby', mode: LOBBY.mode, slots: LOBBY.slots, cfg: CFG });
  lobbyRender();
}
export function lobbySetMode(m) {
  if (!NET.hosting) return;
  LOBBY.mode = m;
  for (const s of LOBBY.slots) {
    if (s.role === 'gm') s.role = 'diver';
    if (m === 'gm' && s.id === 0) s.role = 'gm';
  }
  lobbyBroadcast();
}
export function lobbyWant(r) {
  if (NET.hosting) lobbyHostWant(0, r);
  else netSend({ t: 'want', role: r });
}
function lobbyHostWant(from, r) {
  if (!NET.hosting) return;
  const s = lobbySlot(from);
  if (!s) return;
  if (r === 'gm') return;              /* the GM badge is not up for grabs */
  if (lobbyLocked(s.id)) return;       /* and the host cannot put it down */
  s.role = r;
  lobbyBroadcast();
}

export const LOBBYUI = { render: null, open: null, close: null };
export function lobbyOpen() { if (LOBBYUI.open) LOBBYUI.open(); }
export function lobbyClose() { if (LOBBYUI.close) LOBBYUI.close(); }
export function lobbyRender() { if (LOBBYUI.render) LOBBYUI.render(); }

export function sendMyLoadout() {
  if (NET.hosting) {
    const s = lobbySlot(0);
    if (s) { s.load = LOADOUT.slots.slice(); lobbyBroadcast(); }
  } else if (NET.ws && LOBBY.myId >= 0) netSend({ t: 'load', slots: LOADOUT.slots });
}
export function setMyName(v) {
  v = String(v || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 14);
  if (!v) return;
  setStoredName(v);
  if (NET.hosting) {
    const s = lobbySlot(0);
    if (s) { s.name = v; lobbyBroadcast(); }
  } else if (NET.ws && LOBBY.myId >= 0) netSend({ t: 'name', name: v });
  if (S.running && S.me) say('NAME APPLIES NEXT ROUND', 2.5);
}
