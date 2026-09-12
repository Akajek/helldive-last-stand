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
import { MAPS, TROOP_IDS, TROOPS, STRATS, STRAT_BY_ID, OBJECTIVES, SENTRIES } from '../src/data.js';
import { buildMap, mapSeed, G, gIndex, CELL } from '../src/world.js';
import { update, reset, NETIN, keys, mouse } from '../src/sim.js';
import { spawnEnemy } from '../src/enemies.js';
import { NET, LOBBY } from '../src/net.js';
import { netSnapshot, netSendCity, hostInput } from '../src/host.js';
import { clientCity, clientSnap, updateClient, clearMaps } from '../src/client.js';
import { placeSentry, dropPod, placeSentry as _ps } from '../src/strat.js';
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

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m${fail} FAILED\x1b[0m, ${pass} passed\n`);
  for (const f of failures) console.log('  \x1b[31m✗\x1b[0m ' + f);
  process.exit(1);
} else {
  console.log(`\x1b[32mall ${pass} checks passed\x1b[0m`);
}
