/* Headless test harness.
 *
 *   node test/run.mjs
 *
 * Runs the actual simulation -- the same modules the browser loads -- with no
 * canvas, no audio and no DOM, so a full twenty-minute mission takes about a
 * second and a crash is a stack trace instead of a frozen tab.
 *
 * This exists because every testing round on the old build was fought against
 * the browser: a hidden tab stops calling requestAnimationFrame, which made
 * several "measurements" during development simply wrong. */

import { S, setRole, say, isSquad } from '../src/state.js';
import { CFG, LOADOUT } from '../src/config.js';
import { A } from '../src/audio.js';
import {
  MAPS, MAP_IDS, STRATS, STRAT_BY_ID, TROOPS, TROOP_IDS, FACTIONS, FACTION_IDS,
  SENTRIES, WEAPONS, OBJECTIVES, OBJ_IDS, armorScale
} from '../src/data.js';
import { buildMap, G, CELL, gIndex, solidAt, buildings, caveMouths } from '../src/world.js';
import { update, reset, NETIN, keys, mouse, endMission } from '../src/sim.js';
import { spawnEnemy, countSize } from '../src/enemies.js';
import { DIR, resetDirector, WAVE_LEN } from '../src/director.js';
import { OBJ, applyReward } from '../src/objectives.js';
import { throwStratagem, callIn, dropPod, superDestroyer, placeSentry } from '../src/strat.js';
import { explode, hurt, die, damageEnemy, arcChain } from '../src/combat.js';
import { giveSupport, fire, W_, A_, tryPickup, useStim, throwNade, meleeSwing } from '../src/diver.js';
import { GM, gmReset } from '../src/gm.js';

/* ------------------------------------------------------------------ harness */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return true; }
  fail++; failures.push(name + (detail ? '  — ' + detail : ''));
  return false;
}
function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }
function line(t) { console.log('  ' + t); }

/* deterministic-ish: seed Math.random so a failure can be reproduced */
let seed = 12345;
const realRandom = Math.random;
function seeded() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
Math.random = seeded;

/* The spawner places bodies just off the edge of the screen, so a headless run
   with a 0x0 viewport would drop the entire horde in the Helldiver's lap. Give
   it a normal monitor. */
S.W = 1600; S.H = 900;

const DT = 1 / 60;
function run(seconds, onFrame) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    update(DT);
    if (onFrame) onFrame(i);
  }
}
function newMission(mapId, opts) {
  opts = opts || {};
  /* matchRoster() only honours a roster in a network match, so a multi-diver
     test has to say it is the host -- which also exercises the host code path */
  setRole(opts.roster ? 'host' : 'solo');
  NETIN.roster = opts.roster || null;
  NETIN.myId = 0;
  S.gmMatch = !!opts.gm;
  buildMap(mapId, opts.seed === undefined ? 4242 : opts.seed);
  reset();
  gmReset();
  S.running = true;
  S.paused = false;
  for (const k in keys) keys[k] = false;
  mouse.down = false;
  /* Stand the squad up straight away and throw away the opening pods -- a pod
     still in the air lands later and teleports its Helldiver back to the drop
     zone, which quietly ruins any test that moved them somewhere. */
  if (!opts.keepPods) {
    S.pods.length = 0;
    for (const P of S.players) { P.inPod = false; P.guard = 0; }
  }
}

console.log('HELLDIVE: LAST STAND — headless simulation tests');

/* ============================ 1. MAPS ============================ */
section('1. Maps build and are walkable');
for (const id of MAP_IDS) {
  buildMap(id, 777);
  const M = MAPS[id];
  let solid = 0, total = 0;
  const n = Math.floor(S.world / CELL);
  for (let cy = -n; cy <= n; cy += 3)
    for (let cx = -n; cx <= n; cx += 3) {
      total++;
      const i = gIndex(cx, cy);
      if (i >= 0 && G.solid[i]) solid++;
    }
  const frac = solid / total;
  line(`${id.padEnd(9)} world ${S.world}  solid ${(frac * 100).toFixed(1)}%  buildings ${buildings.length}`);
  ok(`${id}: grid allocated`, G.solid && G.solid.length > 0);
  ok(`${id}: drop zone is clear`, !solidAt(0, 0));
  if (M.cave) {
    ok('cave: mostly rock', frac > 0.5, `${(frac * 100).toFixed(1)}%`);
    ok('cave: but not all rock', frac < 0.93, `${(frac * 100).toFixed(1)}%`);
    ok('cave: has entrances', caveMouths.length > 0, String(caveMouths.length));
  }
  if (M.city && !M.cave) ok(`${id}: has buildings`, buildings.length > 20, String(buildings.length));
  if (!M.city) ok('plains: nothing solid', frac === 0);
}
/* the same seed must build the same world on both machines, or the client is
   walking through walls the host can see */
{
  buildMap('megacity', 99);
  const a = G.solid.slice(0, 20000).join('');
  const ba = buildings.length;
  buildMap('megacity', 99);
  const b = G.solid.slice(0, 20000).join('');
  ok('seeded generation is reproducible', a === b && ba === buildings.length);
  buildMap('megacity', 100);
  const c = G.solid.slice(0, 20000).join('');
  ok('a different seed builds a different city', a !== c);
  buildMap('cave', 55);
  const d = G.solid.slice(0, 20000).join('');
  buildMap('cave', 55);
  ok('caves are reproducible too', d === G.solid.slice(0, 20000).join(''));
}

/* ============================ 2. TROOP DATA ============================ */
section('2. Troop tables are complete');
for (const fac of FACTION_IDS) {
  const t = TROOP_IDS.map(k => TROOPS[k]).filter(T => T.fac === fac);
  const sizes = { small: 0, medium: 0, large: 0 };
  for (const T of t) sizes[T.size]++;
  line(`${FACTIONS[fac].name.padEnd(11)} ${t.length} troops  S${sizes.small} M${sizes.medium} L${sizes.large}`);
  ok(`${fac}: has small`, sizes.small >= 2);
  ok(`${fac}: has medium`, sizes.medium >= 2);
  ok(`${fac}: has large`, sizes.large >= 2);
}
for (const k of TROOP_IDS) {
  const T = TROOPS[k];
  ok(`${k}: sane stats`,
    T.hp > 0 && T.spd > 0 && T.r > 0 && T.cost > 0 && T.armor >= 0 && T.armor <= 4,
    JSON.stringify({ hp: T.hp, spd: T.spd, r: T.r, cost: T.cost, armor: T.armor }));
  ok(`${k}: does something`, !!(T.melee || T.ranged || T.beam || T.spotter || T.spawner),
    'has no way to act');
}
/* armour has to actually stop small arms, or it is decoration */
ok('pen 1 vs armour 0 is full', armorScale(1, 0) === 1);
ok('pen 1 vs armour 3 is a ricochet', armorScale(1, 3) < 0.1);
ok('pen 4 vs armour 4 is full', armorScale(4, 4) === 1);
ok('pen 3 vs armour 4 is reduced', armorScale(3, 4) > 0.1 && armorScale(3, 4) < 1);

/* ============================ 3. A LONG MISSION ============================ */
section('3. Twenty minutes on each map, solo, all three factions');
for (const id of MAP_IDS) {
  newMission(id);
  let maxEnemies = 0, maxParticles = 0, waves = 0, objSeen = 0;
  const facsSeen = new Set();
  let err = null;
  try {
    run(20 * 60, i => {
      if (i % 60 === 0) {
        maxEnemies = Math.max(maxEnemies, S.enemies.length);
        maxParticles = Math.max(maxParticles, S.particles.length);
        for (const e of S.enemies) facsSeen.add(e.fac);
        if (S.objectives.length) objSeen++;
        /* keep the diver alive so the mission does not end early */
        for (const P of S.players) { P.hp = P.maxhp; P.down = false; P.dead = false; }
        S.livesLeft = 9;
      }
    });
  } catch (e) { err = e; }
  waves = DIR.wave;
  ok(`${id}: 20 minutes without throwing`, !err, err && (err.message + '\n' + err.stack));
  line(`${id.padEnd(9)} waves ${waves}  peak enemies ${maxEnemies}  peak particles ${maxParticles}  ` +
       `objective-seconds ${objSeen}  kills ${S.kills}`);
  ok(`${id}: waves actually ran`, waves >= 15, String(waves));
  ok(`${id}: the horde arrived`, maxEnemies > 40, String(maxEnemies));
  ok(`${id}: enemy count stayed bounded`, maxEnemies <= 560, String(maxEnemies));
  ok(`${id}: particles stayed bounded`, maxParticles <= 2200, String(maxParticles));
  ok(`${id}: objectives appeared`, objSeen > 0, String(objSeen));
  ok(`${id}: more than one faction turned up`, facsSeen.size >= 2, [...facsSeen].join(','));
  ok(`${id}: no NaN in the world`, S.players.every(P => Number.isFinite(P.x) && Number.isFinite(P.y)));
  ok(`${id}: no NaN enemies`, S.enemies.every(e => Number.isFinite(e.x) && Number.isFinite(e.y)));
}

/* ============================ 4. EVERY STRATAGEM ============================ */
section('4. Every stratagem fires without throwing');
for (const s of STRATS) {
  newMission('megacity');
  const P = S.players[0];
  P.x = 0; P.y = 0;
  S.livesLeft = 5;
  for (let i = 0; i < 12; i++) spawnEnemy('scavenger', { x: 260 + i * 12, y: 40 });
  spawnEnemy('charger', { x: 300, y: -120 });
  spawnEnemy('biletitan', { x: -380, y: 200 });
  if (s.kind === 'reinforce') { P.down = true; P.inPod = true; P.downAt = 1; }
  let err = null;
  try {
    callIn({ x: 240, y: 0, strat: s, who: P.id, dir: 0 });
    run(14);
  } catch (e) { err = e; }
  ok(`${s.id}: fires cleanly`, !err, err && (err.message + ' @ ' + (err.stack || '').split('\n')[1]));
}

/* the one that used to take the whole game down */
section('5. The Liberty / pod-landing crash is gone');
{
  newMission('megacity');
  const P = S.players[0];
  let err = null;
  try {
    dropPod(200, 0, { kind: 'liberty', who: P.id });
    run(6);
  } catch (e) { err = e; }
  ok('liberty pod lands without a ReferenceError', !err, err && err.message);
  ok('the pod was removed from the list', S.pods.length === 0, String(S.pods.length));
  /* and a payload that DOES throw must still not wedge the loop */
  newMission('megacity');
  S.pods.push({ nid: 1, x: 0, y: 0, z: 1, vz: 900, t: 0, col: '#fff',
                payload: { get kind() { throw new Error('deliberate'); } } });
  let err2 = null;
  try { run(1); } catch (e) { err2 = e; }
  ok('a throwing payload does not escape the frame', !err2, err2 && err2.message);
  ok('...and the pod is gone rather than retried forever', S.pods.length === 0, String(S.pods.length));
}

/* ============================ 6. THE SUPER DESTROYER ============================ */
section('6. The Super Destroyer');
{
  newMission('megacity');
  S.enemies.length = 0;               /* the opening horde would eat the subject first */
  const marked = [];
  for (let i = 0; i < 60; i++)
    marked.push(spawnEnemy('scavenger', { x: rnd(-900, 900), y: rnd(-900, 900) }));
  const standing = countSolid();
  const P = S.players[0];
  ok('the Helldiver starts the test standing', !P.down && !P.inPod);
  let err = null;
  /* the hull hits at 6.4s; check the damage before the solo redeploy clock
     (8s) has a chance to put them back on their feet and confuse the result */
  try { superDestroyer(0, 0, 0); run(7.4); } catch (e) { err = e; }
  ok('the ship comes down without throwing', !err, err && (err.message + '\n' + err.stack));
  const left = marked.filter(e => S.enemies.includes(e)).length;
  ok('it cleared the area', left < 6, `${60 - left}/60 killed`);
  ok('it left a wreck', !!S.wreck);
  ok('it flattened the city', countSolid() < standing * 0.8,
     `${standing} -> ${countSolid()}`);
  ok('it killed the Helldiver standing under it', P.down || P.dead,
     `down=${P.down} dead=${P.dead} hp=${P.hp.toFixed(0)} inPod=${P.inPod}`);
  run(20);
  ok('the wreck stays', !!S.wreck);
}
function countSolid() {
  let n = 0;
  const k = Math.floor(1600 / CELL);
  for (let cy = -k; cy <= k; cy++) for (let cx = -k; cx <= k; cx++) {
    const i = gIndex(cx, cy);
    if (i >= 0 && G.solid[i]) n++;
  }
  return n;
}
function rnd(a, b) { return a + Math.random() * (b - a); }

/* ============================ 7. ARMOUR ============================ */
section('7. Armour actually stops things');
{
  newMission('plains');
  const soft = spawnEnemy('scavenger', { x: 300, y: 0 });
  const heavy = spawnEnemy('charger', { x: 400, y: 0 });
  const softBefore = soft.hp, heavyBefore = heavy.hp;
  damageEnemy(soft, 100, 1, soft.x, soft.y, true);
  damageEnemy(heavy, 100, 1, heavy.x, heavy.y, true);
  ok('a rifle round hurts a Scavenger', softBefore - soft.hp === 100);
  ok('a rifle round rings off a Charger', heavyBefore - heavy.hp < 10,
     String(heavyBefore - heavy.hp));
  const h2 = heavy.hp;
  damageEnemy(heavy, 100, 4, heavy.x, heavy.y, true);
  ok('an anti-tank round goes through it', h2 - heavy.hp === 100);
}

/* ============================ 8. INFIGHTING ============================ */
section('8. Two factions left alone will fight');
{
  const battle = (infight) => {
    const was = CFG.infight;
    CFG.infight = infight;
    newMission('plains');
    S.enemies.length = 0;
    /* the squad is nowhere near: whatever happens, happens because they want it */
    S.players[0].x = 9000; S.players[0].y = 9000;
    const marked = [];
    for (let i = 0; i < 18; i++) marked.push(spawnEnemy('warrior', { x: -300 + i * 12, y: 0 }));
    for (let i = 0; i < 18; i++) marked.push(spawnEnemy('devastator', { x: 300 + i * 12, y: 0 }));
    run(40);
    CFG.infight = was;
    return marked.filter(e => S.enemies.includes(e)).length;
  };
  const dead = 36 - battle(1);
  line(`  infighting on:  ${dead}/36 dead after 40s with no Helldiver in sight`);
  ok('they killed each other unprompted', dead > 4, `${dead}/36`);
  const deadTruce = 36 - battle(0);
  line(`  infighting off: ${deadTruce}/36 dead`);
  ok('a truce is honoured', deadTruce < dead, `${deadTruce} vs ${dead}`);
}

/* ============================ 9. OBJECTIVES ============================ */
section('9. Every objective type completes and pays out');
for (const id of OBJ_IDS) {
  newMission('plains');
  const D = OBJECTIVES[id];
  S.objectives.length = 0;
  const o = {
    nid: 900, id, D, kind: D.kind, name: D.name, x: 400, y: 0, t: 0, prog: 0,
    done: false, radius: D.radius || 30, col: D.col, field: D.field || 0,
    hp: D.hp || 0, max: D.hp || 0, armor: D.armor || 0,
    need: D.count || 0, have: 0, spin: 0, active: 0, timeout: 999
  };
  S.objectives.push(o);
  const livesBefore = S.livesLeft;
  let err = null;
  try {
    if (D.kind === 'hold') {
      /* an uplink takes the better part of a minute, and a Helldiver standing
         still for a minute in an open field is a dead Helldiver -- which would
         be testing the horde, not the objective */
      S.enemies.length = 0;
      S.players[0].x = 400; S.players[0].y = 0;
      run(D.time + 3, () => {
        S.enemies.length = 0;
        S.players[0].hp = S.players[0].maxhp;
      });
    } else if (D.kind === 'destroy') {
      o.hp = 0;
      run(1);
    } else {
      o.have = o.need;
      run(1);
    }
  } catch (e) { err = e; }
  ok(`${id}: completes without throwing`, !err, err && err.message);
  ok(`${id}: was removed once complete`, !S.objectives.some(x => x.nid === 900));
  if (D.reward === 'life') ok('upload paid a reinforcement', S.livesLeft === livesBefore + 1);
  if (D.reward === 'confuse') ok('broadcast turned them on each other', S.mod.confuse > 0);
  if (D.reward === 'radar') ok('radar blocked deployment', !!S.mod.noSpawn && S.mod.radar > 0);
  if (D.reward === 'barrage') ok('artillery is loaded', S.mod.barrage > 0);
}

/* ============================ 10. JAMMING ============================ */
section('10. Underground, and under a jammer');
{
  newMission('cave');
  const P = S.players[0];
  ok('cave: the squad is standing, not in pods', !P.inPod);
  ok('cave: the squad is on open floor', !solidAt(P.x, P.y));
  const orb = STRAT_BY_ID.orbprecision;
  P.armed = orb;
  P.stt.fill(0);
  const ballsBefore = S.balls.length;
  throwStratagem(P, P.x + 200, P.y);
  ok('cave: an orbital call is refused', S.balls.length === ballsBefore);
  const rein = STRAT_BY_ID.reinforce;
  ok('cave: reinforcement is still allowed', !jammedCheck(rein));
  ok('cave: an Eagle cannot fly through rock either',
     !!jammedCheck(STRAT_BY_ID.eagle500));
  /* breaking a jammer down here buys a window rather than nothing */
  S.objectives.length = 0;
  S.objectives.push({ nid: 7, id: 'jammer', D: OBJECTIVES.jammer, kind: 'destroy',
    name: 'J', x: P.x + 300, y: P.y, hp: 0, max: 2400, field: 1300, radius: 26,
    col: '#f00', t: 0, prog: 0, have: 0, need: 0, armor: 2, done: false, timeout: 999 });
  run(0.5);
  ok('cave: a dead jammer opens the uplink', S.mod.uplink > 60, String(S.mod.uplink));
  ok('cave: and the call goes through', !jammedCheck(orb));
  P.armed = orb; P.stt.fill(0);
  const bc = S.balls.length;
  throwStratagem(P, P.x + 200, P.y);
  ok('cave: the beacon actually leaves your hand', S.balls.length > bc);
  S.mod.uplink = 0;
  ok('cave: and the rock comes back when it expires', !!jammedCheck(orb));

  /* a jammer above ground blocks everything in its field */
  newMission('plains');
  const P2 = S.players[0];
  S.objectives.push({ nid: 1, id: 'jammer', D: OBJECTIVES.jammer, kind: 'destroy',
    name: 'J', x: P2.x + 100, y: P2.y, hp: 100, max: 100, field: 1300, radius: 26,
    col: '#f00', t: 0, prog: 0, have: 0, need: 0, armor: 2, done: false, timeout: 999 });
  P2.armed = STRAT_BY_ID.gatling;
  P2.stt.fill(0);
  const b2 = S.balls.length;
  throwStratagem(P2, P2.x + 200, P2.y);
  ok('a jammer refuses the call', S.balls.length === b2);
  S.objectives[0].hp = 0;
  run(0.5);
  P2.armed = STRAT_BY_ID.gatling;
  P2.stt.fill(0);
  throwStratagem(P2, P2.x + 200, P2.y);
  ok('destroying it restores the uplink', S.balls.length > b2);
}
import { jammedAt } from '../src/strat.js';
function jammedCheck(s) {
  const P = S.players[0];
  return jammedAt(P.x, P.y, s);
}

/* ============================ 11. THE SQUAD ============================ */
section('11. Four Helldivers, reinforcement and the wipe');
{
  newMission('megacity', {
    roster: [
      { id: 0, name: 'ALPHA', load: LOADOUT.slots.slice() },
      { id: 1, name: 'BRAVO', load: LOADOUT.slots.slice() },
      { id: 2, name: 'CHARLIE', load: LOADOUT.slots.slice() },
      { id: 3, name: 'DELTA', load: LOADOUT.slots.slice() }
    ]
  });
  ok('four divers on the roster', S.players.length === 4, String(S.players.length));
  ok('isSquad() agrees', isSquad());
  S.livesLeft = 4;
  /* put three of them on the ground; the fourth must survive and be able to call */
  for (let i = 1; i < 4; i++) die(S.players[i]);
  run(2);
  ok('the standing diver stops the emergency clock', S.wipeT === 0);
  ok('nobody was reinforced without a call', S.livesLeft === 4, String(S.livesLeft));
  /* now drop the last one: the ship should make the call itself */
  die(S.players[0]);
  run(0.2);
  ok('the emergency clock started', S.wipeT > 0, String(S.wipeT));
  run(12);
  const up = S.players.filter(P => !P.down && !P.dead && !P.inPod).length;
  ok('the ship brought the squad back', up === 4,
     `${up} standing; ` + S.players.map(P =>
       `${P.name}:${P.dead ? 'dead' : P.down ? 'down' : P.inPod ? 'pod' : 'up'}`).join(' '));
  ok('it cost four reinforcements', S.livesLeft === 0, String(S.livesLeft));
  /* with nothing left, the next wipe ends it */
  for (const P of S.players) die(P);
  run(1);
  ok('no budget left ends the mission', S.gameOver);
}
{
  /* solo must NOT be hijacked by the squad wipe path */
  newMission('plains');
  S.livesLeft = 3;
  const P = S.players[0];
  die(P);
  ok('solo gets its own countdown', P.waiting > 5, String(P.waiting));
  run(1);
  ok('solo does not start the emergency clock', S.wipeT === 0, String(S.wipeT));
  const lives = S.livesLeft;
  run(12);
  ok('solo redeployed by itself', !P.down && !P.inPod,
     `down=${P.down} inPod=${P.inPod} waiting=${P.waiting.toFixed(1)} pods=${S.pods.length}`);
  ok('it cost exactly one reinforcement', S.livesLeft === lives - 1,
     `${lives} -> ${S.livesLeft}`);
}

/* ============================ 12. WEAPONS ============================ */
section('12. Every weapon fires');
for (const id of Object.keys(WEAPONS)) {
  newMission('plains');
  const P = S.players[0];
  giveSupport(P, id, WEAPONS[id].mag, WEAPONS[id].mags);
  P.wep = id;
  S.enemies.length = 0;
  /* the Incinerator is a short-range weapon by design, so stand where it can
     reach rather than measuring it from across the street and calling it broken */
  const range = id === 'flamer' ? 90 : 200;
  const target = spawnEnemy('warrior', { x: P.x + range, y: P.y });
  let err = null;
  const before = target.hp;
  try {
    for (let i = 0; i < 60; i++) {
      /* update() rewrites the diver's aim from this browser's mouse every frame,
         so the aim has to be re-asserted rather than set once */
      P.ang = 0; P.inp.ax = P.x + 5000; P.inp.ay = P.y;
      P.cool = 0;
      fire(P);
      update(DT);
    }
    run(2);
  } catch (e) { err = e; }
  ok(`${id}: fires without throwing`, !err, err && err.message);
  const dealt = before - (S.enemies.includes(target) ? target.hp : -999);
  ok(`${id}: does damage`, dealt > 0, `dealt ${dealt.toFixed(0)}`);
  line(`  ${id.padEnd(12)} dealt ${Math.min(dealt, before).toFixed(0)} of ${before.toFixed(0)} ` +
       `in 1s  (knocked back ${(target.x - (P.x + range)).toFixed(0)}u)`);
}
/* the bug that probe found: weight comes off the size table, not the troop */
{
  newMission('plains');
  const small = spawnEnemy('scavenger', { x: 200, y: 0 });
  const med = spawnEnemy('warrior', { x: 300, y: 0 });
  const big = spawnEnemy('biletitan', { x: 500, y: 0 });
  ok('a Scavenger is light', small.mass === 1, String(small.mass));
  ok('a Warrior is not', med.mass > 1, String(med.mass));
  ok('a Titan is heavy', big.mass > med.mass, String(big.mass));
  ok('every enemy has a real mass',
     S.enemies.every(e => Number.isFinite(e.mass) && e.mass >= 1));
}

/* ============================ 13. SENTRIES ============================ */
section('13. Every sentry engages');
for (const type of Object.keys(SENTRIES)) {
  newMission('plains');
  const P = S.players[0];
  P.x = -600; P.y = -600;
  placeSentry(0, 0, type, P.id);
  /* count only the ones this test put there: the director keeps adding more,
     and comparing totals just measures the director */
  const marked = [];
  for (let i = 0; i < 10; i++) marked.push(spawnEnemy('scavenger', { x: 180 + i * 14, y: 0 }));
  let err = null;
  try { run(12); } catch (e) { err = e; }
  ok(`${type}: runs without throwing`, !err, err && err.message);
  const left = marked.filter(e => S.enemies.includes(e)).length;
  ok(`${type}: killed what it was pointed at`, left < 10, `${10 - left}/10 killed`);
  line(`  ${type.padEnd(11)} killed ${10 - left}/10 in 12s`);
}

/* ============================ 14. GM MODE ============================ */
section('14. Game Master mode');
{
  newMission('megacity', { gm: true });
  ok('a GM match runs no director', DIR.queue.length === 0);
  const before = S.enemies.length;
  run(30);
  ok('a GM match spawns nothing on its own', S.enemies.length === before,
     `${before} -> ${S.enemies.length}`);
  /* the GM is paid for a takedown */
  GM.credits = 10; GM.score = 0;
  die(S.players[0]);
  ok('the GM is paid for a Helldiver', GM.credits > 10 && GM.score === 1,
     `credits ${GM.credits} score ${GM.score}`);
  /* ...and charged for an objective */
  const c = GM.credits;
  applyReward('confuse', { x: 0, y: 0 });
  ok('the GM is charged for a lost objective', GM.credits < c,
     `${c} -> ${GM.credits}`);
}

/* ============================ 15. STRESS ============================ */
section('15. Stress: five hundred bodies, all three factions, one minute');
{
  newMission('megacity');
  const all = TROOP_IDS;
  for (let i = 0; i < 500; i++)
    spawnEnemy(all[i % all.length], { x: rnd(-2200, 2200), y: rnd(-2200, 2200) });
  line(`  spawned ${S.enemies.length}`);
  const t0 = Date.now();
  let err = null;
  try {
    run(60, i => {
      if (i % 60 === 0) for (const P of S.players) { P.hp = P.maxhp; P.down = false; P.dead = false; }
    });
  } catch (e) { err = e; }
  const ms = Date.now() - t0;
  ok('no throw under load', !err, err && (err.message + '\n' + err.stack));
  line(`  3600 frames in ${ms}ms  (${(ms / 3600).toFixed(2)}ms/frame simulated)`);
  ok('a simulated frame stays under 6ms', ms / 3600 < 6, `${(ms / 3600).toFixed(2)}ms`);
  ok('the cap held', S.enemies.length <= 560, String(S.enemies.length));
}

/* ============================ 16. PAYLOAD SIZE ============================ */
section('16. Snapshot size');
{
  /* build a realistic snapshot and see what it weighs on the wire */
  newMission('megacity');
  for (let i = 0; i < 260; i++)
    spawnEnemy(TROOP_IDS[i % TROOP_IDS.length], { x: rnd(-1400, 1400), y: rnd(-1400, 1400) });
  run(3);
  const R = Math.round;
  const e = [];
  for (const en of S.enemies) {
    const d = Math.hypot(en.x - S.players[0].x, en.y - S.players[0].y);
    if (d > (en.size === 'large' ? 3000 : en.size === 'medium' ? 1900 : 1500)) continue;
    e.push(en.id, TROOP_IDS.indexOf(en.tid), R(en.x), R(en.y), R(en.face * 57.3),
           R(100 * en.hp / en.max), 0, 0);
  }
  const bytes = JSON.stringify({ t: 'snap', e }).length;
  line(`  ${e.length / 8} bodies in view -> ${bytes} bytes/snapshot ` +
       `-> ${(bytes * 12 / 1024).toFixed(0)} KB/s at 12Hz`);
  ok('a busy snapshot stays under 40KB', bytes < 40000, String(bytes));
}

/* ============================ 17. PICKUPS ============================ */
section('17. Everything a pod can leave on the ground actually does something');
{
  const cases = [
    ['supply', P => { P.grenades = 0; P.stims = 0; }, P => P.grenades > 0 && P.stims > 0],
    ['weapon', () => {}, P => P.support === 'mg43' && P.wep === 'mg43'],
    ['shield', () => {}, P => P.shieldMax > 0 && P.shield > 0],
    ['dog', () => {}, () => S.drones.length === 1],
    ['sample', () => {}, P => P.samples === 1],
    ['shell', () => {}, P => P.carrying === 'shell']
  ];
  for (const [kind, setup, check] of cases) {
    newMission('plains');
    const P = S.players[0];
    setup(P);
    S.pickups.push({ nid: 1, kind, wep: 'mg43', x: P.x + 10, y: P.y, bob: 0,
                     ammo: 150, mags: 3 });
    tryPickup(P);
    ok(`${kind}: is picked up correctly`, check(P),
       `support=${P.support} shield=${P.shieldMax} drones=${S.drones.length} ` +
       `samples=${P.samples} carrying=${P.carrying} nades=${P.grenades}`);
    if (kind !== 'requisition')
      ok(`${kind}: is consumed`, S.pickups.length === 0, String(S.pickups.length));
  }
  /* the shield has to actually soak a hit */
  newMission('plains');
  const P = S.players[0];
  P.shieldMax = 240; P.shield = 240;
  hurt(100, P);
  ok('a shield takes the hit instead of the Helldiver', P.hp === P.maxhp && P.shield === 140,
     `hp=${P.hp} shield=${P.shield}`);
  hurt(200, P);
  ok('and the overflow gets through', P.hp < P.maxhp && P.shield === 0,
     `hp=${P.hp} shield=${P.shield}`);
  /* ...then knit itself back together */
  P.shieldCd = 0;
  run(6);
  ok('the shield recharges', P.shield > 100, String(Math.round(P.shield)));
  /* a guard dog shoots for you */
  newMission('plains');
  S.enemies.length = 0;
  const Q = S.players[0];
  S.drones.push({ nid: 1, owner: Q.id, x: Q.x, y: Q.y, ang: 0, orbit: 0, cool: 0 });
  const prey = spawnEnemy('scavenger', { x: Q.x + 240, y: Q.y });
  run(8);
  ok('the guard dog killed something', !S.enemies.includes(prey));
}

/* ============================ 18. NO LEAKS ============================ */
section('18. Nothing grows without bound over a long mission');
{
  newMission('megacity');
  const peak = {};
  const watch = ['bullets', 'ebullets', 'particles', 'corpses', 'decals', 'beams',
                 'blasts', 'timers', 'nades', 'balls', 'pods', 'pickups', 'junk',
                 'drones', 'objectives', 'beamRuns'];
  /* an actual firefight, not a man standing still: hold the trigger down, keep
     the magazines full, and call something in every few seconds */
  const P0 = S.players[0];
  mouse.down = true;
  const strats = STRATS.filter(s => !s.hidden);
  let si = 0;
  run(15 * 60, i => {
    const near = S.enemies.length
      ? S.enemies.reduce((a, b) =>
          Math.hypot(b.x - P0.x, b.y - P0.y) < Math.hypot(a.x - P0.x, a.y - P0.y) ? b : a)
      : null;
    if (near) { mouse.x = near.x - S.cam.x + S.W / 2; mouse.y = near.y - S.cam.y + S.H / 2; }
    if (i % 30 === 0) {
      for (const k in P0.arsenal) { P0.arsenal[k].ammo = 999; P0.arsenal[k].mags = 9; }
      P0.grenades = 6; P0.stims = 6;
    }
    if (i % 180 === 0) {
      P0.stt.fill(0);
      P0.armed = strats[si++ % strats.length];
      throwStratagem(P0, P0.x + 300, P0.y + 60);
      throwNade(P0);
      meleeSwing(P0);
    }
    if (i % 120) return;
    for (const k of watch) peak[k] = Math.max(peak[k] || 0, S[k].length);
    for (const P of S.players) { P.hp = P.maxhp; P.down = false; P.dead = false; P.inPod = false; }
    S.livesLeft = 9;
  });
  mouse.down = false;
  line(`  kills in 15 minutes of continuous fire: ${S.kills}`);
  for (const k of watch) line(`  ${k.padEnd(12)} peak ${peak[k]}`);
  ok('bullets bounded', peak.bullets < 400, String(peak.bullets));
  ok('particles bounded', peak.particles < 2200, String(peak.particles));
  ok('corpses bounded', peak.corpses < 900, String(peak.corpses));
  ok('decals bounded', peak.decals <= 300, String(peak.decals));
  ok('beams bounded', peak.beams < 200, String(peak.beams));
  ok('timers bounded', peak.timers < 200, String(peak.timers));
  ok('pickups bounded', peak.pickups < 200, String(peak.pickups));
  ok('objectives bounded', peak.objectives <= 2, String(peak.objectives));
}

/* ============================ RESULT ============================ */
Math.random = realRandom;
console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m${fail} FAILED\x1b[0m, ${pass} passed\n`);
  for (const f of failures) console.log('  \x1b[31m✗\x1b[0m ' + f);
  process.exit(1);
} else {
  console.log(`\x1b[32mall ${pass} checks passed\x1b[0m`);
}
