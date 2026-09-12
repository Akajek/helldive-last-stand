/* Snapshot round-trip tests.
 *
 *   node test/net.mjs
 *
 * The host builds a real snapshot from a real world; the client consumes it and
 * rebuilds one. Then the two are compared. This is where multiplayer bugs
 * actually live -- a field renamed on one side, an index off by one, an entity
 * the client never hears about -- and none of it needs a browser or a socket.
 *
 * The two roles run sequentially in one process, because the world is a
 * singleton: capture what the host would have sent, tear it down, rebuild as the
 * client, feed it in. */

/* the client half touches the DOM in a couple of places; all of it is guarded,
   but `document` still has to exist for the lookup to return null */
globalThis.document = { getElementById: () => null, body: { classList: { add() {}, remove() {}, toggle() {} } } };
globalThis.location = { protocol: 'http:', host: 'localhost:8080' };

import { S, setRole, role } from '../src/state.js';
import { CFG, LOADOUT } from '../src/config.js';
import {
  MAPS, TROOP_IDS, TROOPS, STRATS, STRAT_BY_ID, OBJECTIVES, SENTRIES, NETCULL
} from '../src/data.js';
import { buildMap, mapSeed, G, gIndex, CELL } from '../src/world.js';
import { update, reset, NETIN, keys, mouse } from '../src/sim.js';
import { spawnEnemy } from '../src/enemies.js';
import { NET, LOBBY } from '../src/net.js';
import { OUT, post, postArr } from '../src/outbox.js';
import { netSnapshot, netSendCity, hostInput } from '../src/host.js';
import { clientCity, clientSnap, updateClient, clearMaps } from '../src/client.js';
import { placeSentry, dropPod, callIn } from '../src/strat.js';
import { fire, giveSupport } from '../src/diver.js';
import { explode } from '../src/combat.js';
import { GM, gmReset } from '../src/gm.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return true; }
  fail++; failures.push(name + (detail ? '  — ' + detail : ''));
  return false;
}
function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }
function line(t) { console.log('  ' + t); }

S.W = 1600; S.H = 900;
const DT = 1 / 60;
function run(sec) { for (let i = 0; i < Math.round(sec / DT); i++) update(DT); }

/* the wire, such as it is */
const sent = [];
NET.ws = { readyState: 1, send: str => sent.push({ bytes: str.length, msg: JSON.parse(str) }) };

/* ============================ set up a host world ============================ */
section('1. The host builds a world and a snapshot');
const SEED = 31337;
setRole('host');
NET.peers = [{ id: 1, name: 'BRAVO' }];
NET.roster = [
  { id: 0, name: 'ALPHA', load: LOADOUT.slots.slice() },
  { id: 1, name: 'BRAVO', load: LOADOUT.slots.slice() }
];
NETIN.roster = NET.roster;
NETIN.myId = 0;
S.gmMatch = false;
buildMap('megacity', SEED);
reset();
gmReset();
S.running = true;
S.pods.length = 0;
for (const P of S.players) { P.inPod = false; P.guard = 0; }
/* put the two Helldivers a long way apart, which is the case the old build got
   wrong: it culled around the whole squad, so everybody paid for everybody */
S.players[0].x = 0; S.players[0].y = 0;
S.players[1].x = 2600; S.players[1].y = 0;

/* something of everything in the world */
for (let i = 0; i < 90; i++)
  spawnEnemy(TROOP_IDS[i % TROOP_IDS.length], { x: -600 + (i % 12) * 90, y: -400 + ((i / 12) | 0) * 90 });
for (let i = 0; i < 40; i++)
  spawnEnemy('scavenger', { x: 2400 + (i % 8) * 40, y: -150 + ((i / 8) | 0) * 60 });
placeSentry(120, 60, 'gatling', 0);
placeSentry(160, 90, 'autocannon', 0);
dropPod(300, 300, { kind: 'supply' });
S.pickups.push({ nid: 9001, kind: 'weapon', wep: 'recoilless', x: 90, y: 20, bob: 0, ammo: 1, mags: 5 });
S.pickups.push({ nid: 9002, kind: 'shield', x: -90, y: 20, bob: 0 });
S.objectives.push({
  nid: 9100, id: 'jammer', D: OBJECTIVES.jammer, kind: 'destroy', name: OBJECTIVES.jammer.name,
  x: 700, y: -300, t: 0, prog: 0, done: false, radius: 26, col: OBJECTIVES.jammer.col,
  field: 1300, hp: 1800, max: 2400, armor: 2, need: 0, have: 0, spin: 0, active: 0, timeout: 999
});
S.players[0].armed = STRAT_BY_ID.gatling;
S.balls.push({ nid: 9200, who: 0, x: 200, y: 100, vx: 0, vy: 0, z: 0, vz: 0, spin: 0,
               landed: true, call: 1.5, strat: STRAT_BY_ID.gatling, dir: 0 });
S.nades.push({ nid: 9300, who: 0, sx: 0, sy: 0, x: 60, y: 60, tx: 120, ty: 120,
               t: 0, dur: 0.5, z: 20, fuse: 1.2, spin: 0 });
S.drones.push({ nid: 9400, owner: 0, x: 40, y: 40, ang: 1, orbit: 0, cool: 0 });
S.mod.confuse = 12; S.mod.radar = 30; S.mod.uplink = 0;
S.mod.noSpawn = { x: 500, y: 500, r: 1400 };
S.livesLeft = 4;
S.wreck = { x: -900, y: 900, a: 0.5, t: 0 };
/* fire a round and blow something up so the one-shot channels have traffic */
giveSupport(S.players[0], 'mg43', 150, 3);
S.players[0].ang = 0; S.players[0].cool = 0;
fire(S.players[0]);
explode(400, 400, 200, 300, 20, '#ffb347', true, 0, 4);

run(0.2);
ok('the host world is populated', S.enemies.length > 100, String(S.enemies.length));

sent.length = 0;
netSnapshot();
ok('a snapshot was sent to each listener', sent.length === NET.peers.length, String(sent.length));
const snapMsg = sent[0].msg;
line(`snapshot to diver ${snapMsg.to}: ${sent[0].bytes} bytes ` +
     `(${(sent[0].bytes * 12 / 1024).toFixed(1)} KB/s at 12Hz)`);
ok('it is addressed to the client', snapMsg.to === 1, String(snapMsg.to));
ok('it carries both divers', snapMsg.ps.length === 2, String(snapMsg.ps.length));

/* ---- the point of per-client culling ---- */
const near1 = S.enemies.filter(e => Math.hypot(e.x - 2600, e.y) < 1500).length;
const near0 = S.enemies.filter(e => Math.hypot(e.x, e.y) < 1500).length;
const sentCount = snapMsg.e.length / 7;
line(`host has ${S.enemies.length} bodies; ${near0} near ALPHA, ${near1} near BRAVO; ` +
     `${sentCount} sent to BRAVO`);
ok('the horde is culled around the RECIPIENT, not the squad',
   sentCount < S.enemies.length * 0.7, `${sentCount} of ${S.enemies.length}`);
ok('...but BRAVO still gets what is next to them',
   sentCount >= near1 * 0.8, `${sentCount} vs ${near1} nearby`);

/* ---- the one-shot channels ---- */
ok('rounds are sent as birth events', !!snapMsg.bs && snapMsg.bs.length >= 7);
ok('explosions are sent', !!snapMsg.fx && snapMsg.fx.length >= 1);
ok('gunfire is sent', !!snapMsg.sp && snapMsg.sp.length >= 4);
ok('no per-frame bullet list', snapMsg.bu === undefined);

/* ---- remember what the host had, before the world is torn down ---- */
const HOST = {
  enemies: snapMsg.e.length / 7,
  sentries: S.sentries.map(s => ({ nid: s.nid, type: s.type, x: Math.round(s.x), y: Math.round(s.y) })),
  pickups: S.pickups.map(p => ({ nid: p.nid, kind: p.kind, wep: p.wep, x: Math.round(p.x) })),
  pods: S.pods.length,
  balls: S.balls.map(b => ({ nid: b.nid, id: b.strat.id, call: b.call })),
  nades: S.nades.length,
  drones: S.drones.length,
  objectives: S.objectives.map(o => ({ nid: o.nid, id: o.id, hp: o.hp, x: Math.round(o.x) })),
  divers: S.players.map(P => ({
    id: P.id, x: Math.round(P.x), y: Math.round(P.y), hp: Math.round(P.hp),
    wep: P.wep, support: P.support, name: P.name
  })),
  mod: { ...S.mod, noSpawn: { ...S.mod.noSpawn } },
  lives: S.livesLeft,
  kills: S.kills,
  wreck: { x: S.wreck.x, y: S.wreck.y },
  grid: G.solid.slice(0, 40000).join(''),
  buildingCount: 0,
  troopOf: {}
};
for (let i = 0; i < snapMsg.e.length; i += 7) HOST.troopOf[snapMsg.e[i]] = snapMsg.e[i + 1];
const cityMsg = { t: 'city', map: 'megacity', seed: SEED, lv: S.hordeLv, cfg: CFG,
                  rs: NET.roster, gm: 0, lives: S.livesLeft };

/* ============================ become the client ============================ */
section('2. The client rebuilds it from the wire');
LOBBY.myId = 1;
clientCity(cityMsg);
ok('the client is a client', role() === 'client');
ok('the client built the same city from the seed alone',
   G.solid.slice(0, 40000).join('') === HOST.grid);
ok('the client knows both divers', S.players.length === 2, String(S.players.length));
ok('the client knows which one it is', S.me && S.me.id === 1, S.me ? String(S.me.id) : 'none');
ok('the client adopted the host rules', S.livesLeft === HOST.lives, String(S.livesLeft));

clientSnap(snapMsg);

section('3. The two worlds agree');
ok('every body the host sent arrived', S.enemies.length === HOST.enemies,
   `${S.enemies.length} vs ${HOST.enemies}`);
let wrongTroop = 0;
for (const e of S.enemies)
  if (TROOP_IDS.indexOf(e.tid) !== HOST.troopOf[e.id]) wrongTroop++;
ok('every body is the right troop', wrongTroop === 0, `${wrongTroop} wrong`);
ok('the client knows a Charger from a Scavenger',
   S.enemies.some(e => e.size === 'large') && S.enemies.some(e => e.size === 'small'));
ok('armour came across', S.enemies.every(e => e.T && e.T.armor !== undefined));
ok('mass came across', S.enemies.every(e => e.mass >= 1));

ok('sentries arrived', S.sentries.length === HOST.sentries.length,
   `${S.sentries.length} vs ${HOST.sentries.length}`);
ok('sentry types survived the wire',
   S.sentries.map(s => s.type).sort().join() === HOST.sentries.map(s => s.type).sort().join(),
   S.sentries.map(s => s.type).join() + ' vs ' + HOST.sentries.map(s => s.type).join());
ok('sentry positions survived',
   S.sentries.every(s => HOST.sentries.some(h => h.nid === s.nid &&
     Math.abs(h.x - s.x) < 2 && Math.abs(h.y - s.y) < 2)));

ok('pickups arrived', S.pickups.length === HOST.pickups.length,
   `${S.pickups.length} vs ${HOST.pickups.length}`);
ok('a dropped weapon is still that weapon',
   S.pickups.some(p => p.kind === 'weapon' && p.wep === 'recoilless'),
   S.pickups.map(p => p.kind + ':' + (p.wep || '')).join(' '));
ok('a shield pack is still a shield pack', S.pickups.some(p => p.kind === 'shield'));

ok('pods arrived', S.pods.length === HOST.pods, `${S.pods.length} vs ${HOST.pods}`);
ok('grenades arrived', S.nades.length === HOST.nades);
ok('guard dogs arrived', S.drones.length === HOST.drones);
ok('the beacon arrived', S.balls.length === HOST.balls.length);
ok('and it is the right stratagem',
   S.balls[0] && S.balls[0].strat.id === HOST.balls[0].id,
   S.balls[0] ? S.balls[0].strat.id : 'none');

ok('the objective arrived', S.objectives.length === HOST.objectives.length);
ok('the objective is the right one and the right shape',
   S.objectives[0] && S.objectives[0].id === 'jammer' &&
   S.objectives[0].hp === HOST.objectives[0].hp &&
   S.objectives[0].field === 1300,
   S.objectives[0] ? JSON.stringify({ id: S.objectives[0].id, hp: S.objectives[0].hp,
                                      field: S.objectives[0].field }) : 'none');

for (const h of HOST.divers) {
  const D = S.players.find(P => P.id === h.id);
  ok(`diver ${h.id}: exists`, !!D);
  if (!D) continue;
  ok(`diver ${h.id}: position within a pixel`,
     Math.abs(D.sx - h.x) <= 1 && Math.abs(D.sy - h.y) <= 1,
     `${D.sx},${D.sy} vs ${h.x},${h.y}`);
  ok(`diver ${h.id}: health`, Math.round(D.hp) === h.hp, `${D.hp} vs ${h.hp}`);
  ok(`diver ${h.id}: weapon`, D.wep === h.wep, `${D.wep} vs ${h.wep}`);
  ok(`diver ${h.id}: support weapon`, (D.support || null) === (h.support || null),
     `${D.support} vs ${h.support}`);
}
ok('world modifiers arrived',
   Math.round(S.mod.confuse) === Math.round(HOST.mod.confuse) &&
   Math.round(S.mod.radar) === Math.round(HOST.mod.radar) &&
   !!S.mod.noSpawn && S.mod.noSpawn.r === HOST.mod.noSpawn.r,
   JSON.stringify(S.mod));
ok('the reinforcement budget arrived', S.livesLeft === HOST.lives);
ok('the kill count arrived', S.kills === HOST.kills);
ok('the wreck arrived', !!S.wreck && Math.abs(S.wreck.x - HOST.wreck.x) < 2);

/* the one-shot channels have to land as things, not as nothing */
ok('the round became a tracer', S.bullets.length >= 1, String(S.bullets.length));
ok('the explosion became a blast', S.blasts.length >= 1, String(S.blasts.length));

section('4. The client can run a frame on it');
let err = null;
try {
  mouse.x = 800; mouse.y = 450;
  for (let i = 0; i < 240; i++) updateClient(DT);
} catch (e) { err = e; }
ok('four seconds of client frames without throwing', !err, err && (err.message + '\n' + err.stack));
ok('bodies interpolated rather than vanishing', S.enemies.length > 0, String(S.enemies.length));
ok('no NaN crept in', S.enemies.every(e => Number.isFinite(e.x) && Number.isFinite(e.y)));
ok('the client sent input upstream', sent.some(s => s.msg.t === 'in'));

section('5. Input travels back the other way');
{
  /* back to the host, and feed it what the client just said */
  const inMsg = sent.filter(s => s.msg.t === 'in').pop().msg;
  inMsg.from = 1;
  setRole('host');
  NETIN.myId = 0;
  buildMap('megacity', SEED);
  reset();
  S.running = true;
  S.pods.length = 0;
  for (const P of S.players) { P.inPod = false; P.guard = 0; }
  const B = S.players.find(P => P.id === 1);
  const before = { x: B.x, y: B.y };
  inMsg.k = 8;                        /* hold 'D' */
  inMsg.a = ['q'];                    /* and stim */
  const stims = B.stims;
  hostInput(inMsg);
  run(0.5);
  ok('the client\'s movement moved the client\'s diver', B.x > before.x + 10,
     `${before.x} -> ${B.x.toFixed(0)}`);
  ok('the client\'s action ran on the client\'s diver', B.stims === stims - 1,
     `${stims} -> ${B.stims}`);
  ok('...and not on the host\'s', S.players.find(P => P.id === 0).stims === 4);
  /* a spectator's keyboard addresses nobody */
  const ghost = { from: 99, ax: 0, ay: 0, k: 15, a: ['q'] };
  let err2 = null;
  try { hostInput(ghost); } catch (e) { err2 = e; }
  ok('input from a diverless player is ignored, not a crash', !err2, err2 && err2.message);
}

section('6. Bandwidth at full tilt');
{
  setRole('host');
  NET.peers = [{ id: 1 }];
  buildMap('megacity', SEED);
  reset();
  S.running = true;
  S.pods.length = 0;
  for (const P of S.players) { P.inPod = false; P.guard = 0; }
  for (let i = 0; i < 500; i++)
    spawnEnemy(TROOP_IDS[i % TROOP_IDS.length],
               { x: -1500 + (i % 25) * 120, y: -1400 + ((i / 25) | 0) * 140 });
  run(1);
  let total = 0, n = 0;
  for (let t = 0; t < 12; t++) {
    sent.length = 0;
    netSnapshot();
    for (const s of sent) { total += s.bytes; n++; }
    run(1 / 12);
  }
  const perSec = total;              /* twelve snapshots is one second */
  line(`${S.enemies.length} bodies alive, one client: ${(perSec / 1024).toFixed(1)} KB/s down`);
  ok('a worst-case second stays under 120 KB', perSec < 120 * 1024,
     `${(perSec / 1024).toFixed(1)} KB/s`);
}

section('7. Outbox channels do not collide with world keys');
{
  /* This is the shape of a bug that was live: OUT.ob (objective announcements)
     and the snapshot's own `ob` (the objective LIST) shared a key, and the
     Object.assign in netSnapshot let the announcements win. The client then
     parsed an array of strings as a list of numbers and built an objective at
     NaN. Nothing about it was visible until an objective happened to appear on
     the same tick as a snapshot went out. */
  setRole('host');
  NET.peers = [{ id: 1 }];
  NETIN.roster = NET.roster; NETIN.myId = 0;
  buildMap('plains', 7);
  reset();
  S.running = true;
  S.pods.length = 0;
  for (const P of S.players) { P.inPod = false; P.guard = 0; }
  S.objectives.push({
    nid: 77, id: 'radar', D: OBJECTIVES.radar, kind: 'hold', name: OBJECTIVES.radar.name,
    x: 260, y: -120, t: 0, prog: 5, done: false, radius: 130, col: OBJECTIVES.radar.col,
    field: 0, hp: 0, max: 1, armor: 0, need: 0, have: 0, spin: 0, active: 1, timeout: 999
  });
  /* stuff every channel, so any future collision shows up here too */
  for (const ch of Object.keys(OUT)) {
    if (ch === 'ev' || ch === 'fx' || ch === 'pf' || ch === 'bm') postArr(ch, ['x', 1, 2, 3, 4]);
    else post(ch, 1, 2, 3, 4, 5, 6, 7);
  }
  sent.length = 0;
  netSnapshot();
  const snap = sent[0].msg;
  const worldKeys = ['ps', 's', 'pk', 'pd', 'bl', 'nd', 'dr', 'ob', 'e', 'md', 'gm'];
  const clash = Object.keys(OUT).filter(k => worldKeys.includes(k));
  ok('no outbox channel shares a name with a world key', clash.length === 0, clash.join());
  ok('the objective list is still a list of numbers',
     Array.isArray(snap.ob) && snap.ob.every(v => typeof v === 'number'),
     JSON.stringify(snap.ob && snap.ob.slice(0, 4)));

  LOBBY.myId = 1;
  clientCity({ t: 'city', map: 'plains', seed: 7, lv: 1, cfg: CFG, rs: NET.roster, gm: 0, lives: 5 });
  clientSnap(snap);
  const o = S.objectives[0];
  ok('the client rebuilt exactly one objective', S.objectives.length === 1, String(S.objectives.length));
  ok('...at real coordinates, not NaN',
     !!o && Number.isFinite(o.x) && Number.isFinite(o.y) && Math.abs(o.x - 260) < 2,
     o ? `${o.x},${o.y}` : 'none');
  ok('...and it is the right objective', !!o && o.id === 'radar', o ? o.id : 'none');
}

section('8. A far body the host skipped this tick is not deleted');
{
  /* Past NETNEAR the host refreshes the small and medium classes every third
     word. If the client treats silence as death out there, the edge of the
     screen flickers with bodies blinking in and out. */
  setRole('host');
  NET.peers = [{ id: 1 }];
  NETIN.roster = NET.roster; NETIN.myId = 0;
  buildMap('plains', 8);
  reset();
  S.running = true;
  S.pods.length = 0;
  for (const P of S.players) { P.inPod = false; P.guard = 0; }
  S.enemies.length = 0;
  const B = S.players.find(P => P.id === 1);
  B.x = 0; B.y = 0;
  S.players.find(P => P.id === 0).x = 0;
  const far = spawnEnemy('warrior', { x: 1400, y: 0 });
  const near = spawnEnemy('warrior', { x: 200, y: 0 });
  const idsOf = m => { const a = []; for (let i = 0; i < m.e.length; i += 7) a.push(m.e[i]); return a; };
  const snaps = [];
  for (let i = 0; i < 4; i++) { sent.length = 0; netSnapshot(); snaps.push(sent[0].msg); }
  const has = snaps.map(m => ({ far: idsOf(m).includes(far.id), near: idsOf(m).includes(near.id) }));
  ok('the near body is in every word', has.every(h => h.near), JSON.stringify(has));
  ok('the far body is in some but not all', has.some(h => h.far) && !has.every(h => h.far),
     JSON.stringify(has.map(h => h.far)));

  const withFar = snaps.find(m => idsOf(m).includes(far.id));
  const withoutFar = snaps.find(m => !idsOf(m).includes(far.id));
  LOBBY.myId = 1;
  clientCity({ t: 'city', map: 'plains', seed: 8, lv: 1, cfg: CFG, rs: NET.roster, gm: 0, lives: 5 });
  clientSnap(withFar);
  ok('the client received the far body', S.enemies.some(e => e.id === far.id));
  clientSnap(withoutFar);
  ok('...and keeps it when the next word skips it',
     S.enemies.some(e => e.id === far.id), 'it was deleted');
  /* a NEAR body going silent really does mean it died, though */
  const noNear = JSON.parse(JSON.stringify(withFar));
  const kept = [];
  for (let i = 0; i < noNear.e.length; i += 7)
    if (noNear.e[i] !== near.id) kept.push(...noNear.e.slice(i, i + 7));
  noNear.e = kept;
  clientSnap(noNear);
  ok('a near body going silent is treated as dead',
     !S.enemies.some(e => e.id === near.id), 'it survived');
}



section('9. The orbital laser, and bodies that actually move');
{
  /* Two things a joining Helldiver was never told. The laser was host-only
     state, so their screen showed the siren and then nothing at all while
     something cut the street in half. And every remote body arrived with a
     velocity of "forty units, that way", so nothing walked: no footfalls, no
     dust, a Bile Titan crossing the road in silence. */
  setRole('host');
  NET.peers = [{ id: 1 }];
  NETIN.roster = NET.roster; NETIN.myId = 0;
  buildMap('plains', 11);
  reset();
  S.running = true;
  S.pods.length = 0;
  for (const P of S.players) { P.inPod = false; P.guard = 0; }
  S.enemies.length = 0;
  S.players.find(P => P.id === 0).x = 0;
  const B9 = S.players.find(P => P.id === 1);
  B9.x = 0; B9.y = 0;

  const walker = spawnEnemy('warrior', { x: 300, y: 0 });
  /* the beacon goes down a long way from the walker: a laser that reaches it
     simply deletes it, and then there is nothing left to measure */
  callIn({ strat: STRAT_BY_ID.orblaser, x: 1500, y: -1200, who: 0 });
  run(0.6);
  const hostRun = S.beamRuns[0];
  ok('the host has a laser running', !!hostRun);

  sent.length = 0;
  netSnapshot();
  const m1 = sent[0].msg;
  ok('the laser is on the wire', !!m1.br && m1.br.length === 8, m1.br ? String(m1.br.length) : 'absent');
  ok('...with the cutting head, not just the beacon',
     Math.abs(m1.br[3] - Math.round(hostRun.px)) <= 1 &&
     Math.abs(m1.br[4] - Math.round(hostRun.py)) <= 1,
     JSON.stringify(m1.br.slice(1, 5)));

  /* let the walker cover one snapshot's worth of ground, and catch the word
     that describes it */
  run(1 / 12);
  sent.length = 0;
  netSnapshot();
  const m2 = sent[0].msg;
  const hostSpeed = Math.hypot(walker.vx, walker.vy);

  LOBBY.myId = 1;
  clientCity({ t: 'city', map: 'plains', seed: 11, lv: 1, cfg: CFG, rs: NET.roster, gm: 0, lives: 5 });
  clientSnap(m1);
  ok('the client built the laser', S.beamRuns.length === 1, String(S.beamRuns.length));
  const cRun = S.beamRuns[0];
  ok('and it is burning the ground the word described',
     Math.hypot(cRun.px - m1.br[3], cRun.py - m1.br[4]) < 2,
     String(Math.round(Math.hypot(cRun.px - m1.br[3], cRun.py - m1.br[4]))));

  /* the client works speed out from how long the hop was given, which is the
     gap between words arriving -- so the test has to space them like the wire */
  NET.lastSnap = performance.now() - 1000 / 12;
  clientSnap(m2);
  const cWalk = S.enemies.find(e => e.id === walker.id);
  ok('the client has the walking body', !!cWalk);
  /* one frame of the client's own loop is what turns two snapshots into motion */
  updateClient(1 / 60);
  const speed = cWalk ? Math.hypot(cWalk.vx, cWalk.vy) : 0;
  line('  remote body speed on the client: ' + Math.round(speed) + ' u/s (host: ' +
       Math.round(hostSpeed) + ' u/s)');
  ok('a remote body moves at something like its real speed',
     speed > hostSpeed * 0.5 && speed < hostSpeed * 2,
     Math.round(speed) + ' vs ' + Math.round(hostSpeed));

  /* the host ends it; the client must let it go too */
  const gone = JSON.parse(JSON.stringify(m2));
  gone.br = [];
  clientSnap(gone);
  ok('when the host is done with it, so is the client', S.beamRuns.length === 0,
     String(S.beamRuns.length));
}


section('10. The world is culled around what you are LOOKING at');
{
  /* Down and watching a squadmate, the host went on culling the world around
     the corpse -- so the camera was over a firefight with none of the bodies in
     it, and the tactical map was drawing a street nobody could see. */
  setRole('host');
  NETIN.roster = NET.roster; NETIN.myId = 0;
  buildMap('plains', 77);
  reset();
  S.running = true;
  S.pods.length = 0;
  for (const P of S.players) { P.inPod = false; P.guard = 0; }
  S.enemies.length = 0;
  const A10 = S.players.find(P => P.id === 0), B10 = S.players.find(P => P.id === 1);
  A10.x = 0; A10.y = 0;
  B10.x = 3400; B10.y = 0;
  /* a fight around ALPHA, and nothing at all where BRAVO is lying */
  for (let i = 0; i < 40; i++)
    spawnEnemy('scavenger', { x: (i % 8) * 40 - 160, y: ((i / 8) | 0) * 40 - 80 });

  NET.peers = [{ id: 1, name: 'BRAVO' }];
  sent.length = 0;
  hostInput({ t: 'in', from: 1, ax: 3400, ay: 0, k: 0 });
  netSnapshot();
  const own = sent.pop().msg;
  ok('on their feet they are sent their own surroundings', own.e.length === 0,
     String(own.e.length / 7) + ' bodies');

  /* now they are down, and their screen is on ALPHA */
  B10.down = true; B10.hp = 1;
  sent.length = 0;
  hostInput({ t: 'in', from: 1, ax: 3400, ay: 0, k: 0, w: 0 });
  netSnapshot();
  const watching = sent.pop().msg;
  line('  culled around their corpse: 0 bodies; around who they are watching: ' +
       (watching.e.length / 7));
  ok('spectating, they are sent the fight they are looking at',
     watching.e.length / 7 > 20, String(watching.e.length / 7));

  /* and a watch id that is not a real diver cannot move somebody else's view */
  sent.length = 0;
  hostInput({ t: 'in', from: 1, ax: 3400, ay: 0, k: 0, w: 99 });
  netSnapshot();
  ok('a watch id for nobody falls back to their own body',
     sent.pop().msg.e.length === 0);
}
section('11. The radar sweep reaches the people who earned it');
{
  /* The radar objective promises a sweep out to 3200 units. The host has every
     body already; a joining Helldiver only has what was culled to them at 1300,
     so the reward did nothing at all on their screen. */
  S.mod.radar = 0;
  NET.tick = 0;
  sent.length = 0;
  netSnapshot();
  ok('no sweep, no blips', sent.pop().msg.rd === undefined);

  S.mod.radar = 100;
  /* a pack out past the cull radius for its size class: 2600 units from the
     listener, where a snapshot would never mention it */
  for (let i = 0; i < 12; i++) spawnEnemy('warrior', { x: 800 + i * 20, y: 0 });
  let blips = null;
  for (let i = 0; i < 4 && !blips; i++) {
    sent.length = 0;
    netSnapshot();
    const m = sent.pop().msg;
    if (m.rd) blips = m.rd;
  }
  ok('the sweep is sent while it is up', !!blips, blips ? String(blips.length / 3) : 'never');
  if (blips) {
    /* the listener is BRAVO, lying at 3400 */
    let far = 0;
    for (let i = 0; i < blips.length; i += 3)
      if (Math.hypot(blips[i] * 16 - 3400, blips[i + 1] * 16) > NETCULL.medium) far++;
    line('  ' + (blips.length / 3) + ' contacts, ' + far +
         ' of them past the radius a snapshot would ever mention');
    ok('...and it carries contacts the snapshot never would', far > 0, String(far));
    ok('a contact is three numbers, not a body', blips.length % 3 === 0);
  }
  /* it is not sent on every word: it is a sweep, not a second snapshot */
  let sweeps = 0;
  for (let i = 0; i < 8; i++) {
    sent.length = 0;
    netSnapshot();
    if (sent.pop().msg.rd) sweeps++;
  }
  ok('the sweep is sent at a fraction of the snapshot rate', sweeps > 0 && sweeps <= 3,
     String(sweeps) + ' of 8');

  /* what it costs at its worst: a full sweep with the map packed */
  for (let i = 0; i < 500; i++)
    spawnEnemy('scavenger', { x: 3400 + Math.cos(i) * (i % 3000), y: Math.sin(i * 2) * 2800 });
  let worst = 0;
  for (let i = 0; i < 8; i++) {
    sent.length = 0;
    netSnapshot();
    const w = sent.pop();
    if (w.msg.rd) worst = Math.max(worst, JSON.stringify(w.msg.rd).length);
  }
  const kbs = worst * (12 / 4) / 1024;
  line('  worst sweep: ' + worst + ' bytes every fourth word -> ' + kbs.toFixed(1) + ' KB/s');
  ok('a sweep does not cost more than the snapshot it rides on', kbs < 20, kbs.toFixed(1));
  S.mod.radar = 0;
  NET.peers = [];
}

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m${fail} FAILED\x1b[0m, ${pass} passed\n`);
  for (const f of failures) console.log('  \x1b[31m✗\x1b[0m ' + f);
  process.exit(1);
} else {
  console.log(`\x1b[32mall ${pass} checks passed\x1b[0m`);
}
