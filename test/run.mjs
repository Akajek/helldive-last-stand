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

import {
  S, setRole, say, isSquad, updateWatch, watched, earX, earY, earshot
} from '../src/state.js';
import { CFG, LOADOUT } from '../src/config.js';
import { A } from '../src/audio.js';
import {
  MAPS, MAP_IDS, STRATS, STRAT_BY_ID, TROOPS, TROOP_IDS, FACTIONS, FACTION_IDS,
  SENTRIES, WEAPONS, OBJECTIVES, OBJ_IDS, armorScale
} from '../src/data.js';
import {
  buildMap, G, CELL, gIndex, solidAt, buildings, caveMouths, caveZones, caveDepth,
  inCave, openSpot
} from '../src/world.js';
import { update, reset, NETIN, keys, mouse, endMission } from '../src/sim.js';
import { spawnEnemy, countSize } from '../src/enemies.js';
import { DIR, resetDirector, WAVE_LEN } from '../src/director.js';
import { OBJ, applyReward } from '../src/objectives.js';
import {
  throwStratagem, callIn, dropPod, superDestroyer, placeSentry, jammedAt, reinforceAt
} from '../src/strat.js';
import { explode, hurt, die, damageEnemy, arcChain } from '../src/combat.js';
import {
  giveSupport, fire, W_, A_, tryPickup, useStim, throwNade, meleeSwing, atTerminal
} from '../src/diver.js';
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
  if (M.caves) {
    /* a map WITH cave sections, not a map that IS one: mostly open ground */
    ok('hollows: mostly open ground', frac < 0.25, `${(frac * 100).toFixed(1)}% solid`);
    ok('hollows: but not featureless', frac > 0.015, `${(frac * 100).toFixed(1)}% solid`);
    ok('hollows: dug the systems it was asked for',
       caveZones.length >= M.caves.count - 2 && caveZones.length <= M.caves.count,
       `${caveZones.length} of ${M.caves.count}`);
    ok('hollows: every system has mouths', caveMouths.length >= caveZones.length * 2,
       `${caveMouths.length} mouths for ${caveZones.length} systems`);
    ok('hollows: the drop zone is on the surface', !inCave(0, 0));
    let deepRock = 0, openIn = 0;
    for (const z of caveZones) {
      /* inside a system there has to be both rock and floor, or it is a hole in
         the ground rather than a cave */
      for (let k = 0; k < 400; k++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.r * 0.8;
        const x = z.x + Math.cos(a) * r, y = z.y + Math.sin(a) * r;
        if (solidAt(x, y)) deepRock++; else openIn++;
      }
    }
    ok('hollows: the systems are mostly rock', deepRock > openIn,
       `${deepRock} rock / ${openIn} floor`);
    ok('hollows: ...but with floor to walk on', openIn > deepRock * 0.12,
       `${deepRock} rock / ${openIn} floor`);
    ok('hollows: you are underground inside one', inCave(caveZones[0].x, caveZones[0].y));
    ok('hollows: and on the surface between them', !inCave(0, 0) && caveDepth(0, 0) === 0);
    ok('hollows: a mouth is walkable', caveMouths.some(m => !solidAt(m.x, m.y)));
  }
  if (M.city && !M.caves) ok(`${id}: has buildings`, buildings.length > 20, String(buildings.length));
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
  buildMap('hollows', 55);
  const d = G.solid.slice(0, 20000).join('');
  const zones = caveZones.map(z => Math.round(z.x) + ',' + Math.round(z.y)).join(';');
  buildMap('hollows', 55);
  ok('cave systems are reproducible too',
     d === G.solid.slice(0, 20000).join('') &&
     zones === caveZones.map(z => Math.round(z.x) + ',' + Math.round(z.y)).join(';'));
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
section('10. Underground is a place, not a map');
{
  newMission('hollows');
  const P = S.players[0];
  const orb = STRAT_BY_ID.orbprecision;
  const eagle = STRAT_BY_ID.eagle500;

  /* on the surface everything works normally */
  P.x = 0; P.y = 0;
  ok('surface: the squad starts above ground', !inCave(P.x, P.y));
  ok('surface: an orbital is fine', !jammedAt(P.x, P.y, orb));
  P.armed = orb; P.stt.fill(0);
  const b0 = S.balls.length;
  throwStratagem(P, P.x + 200, P.y);
  ok('surface: the beacon leaves your hand', S.balls.length > b0);

  /* walk into a cave and it stops */
  const z = caveZones[0];
  const spot = openSpot(z.x, z.y);
  P.x = spot.x; P.y = spot.y;
  ok('cave: standing inside one counts as underground', inCave(P.x, P.y));
  ok('cave: an orbital is refused', !!jammedAt(P.x, P.y, orb));
  ok('cave: an Eagle cannot fly through a hillside either', !!jammedAt(P.x, P.y, eagle));
  ok('cave: reinforcement is still allowed', !jammedAt(P.x, P.y, STRAT_BY_ID.reinforce));
  P.armed = orb; P.stt.fill(0);
  const b1 = S.balls.length;
  throwStratagem(P, P.x + 100, P.y);
  ok('cave: the beacon is kept, not spent', S.balls.length === b1);
  ok('cave: it is dark in here', caveDepth(P.x, P.y) > 0.2, String(caveDepth(P.x, P.y)));
  ok('cave: and not out there', caveDepth(0, 0) === 0);

  /* breaking a jammer buys a window, wherever you are standing */
  S.objectives.length = 0;
  S.objectives.push({ nid: 7, id: 'jammer', D: OBJECTIVES.jammer, kind: 'destroy',
    name: 'J', x: P.x + 300, y: P.y, hp: 0, max: 2400, field: 1300, radius: 26,
    col: '#f00', t: 0, prog: 0, have: 0, need: 0, armor: 2, done: false, timeout: 999 });
  run(0.5);
  ok('cave: a dead jammer opens the uplink', S.mod.uplink > 60, String(S.mod.uplink));
  ok('cave: and the call goes through', !jammedAt(P.x, P.y, orb));
  P.armed = orb; P.stt.fill(0);
  const b2 = S.balls.length;
  throwStratagem(P, P.x + 100, P.y);
  ok('cave: the beacon actually leaves your hand now', S.balls.length > b2);
  S.mod.uplink = 0;
  ok('cave: and the rock comes back when it expires', !!jammedAt(P.x, P.y, orb));

  /* a Helldiver called into a cave walks in rather than dropping */
  newMission('hollows');
  const Q = S.players[0];
  const deep = openSpot(caveZones[0].x, caveZones[0].y);
  S.livesLeft = 3;
  die(Q);
  const podsBefore = S.pods.length;
  reinforceAt(deep.x, deep.y, Q);
  ok('cave: no pod is dropped into a hillside', S.pods.length === podsBefore,
     `${podsBefore} -> ${S.pods.length}`);
  ok('cave: they are on their feet at a mouth', !Q.down && !Q.inPod);
  ok('cave: ...standing on floor, not inside rock', !solidAt(Q.x, Q.y));
  ok('cave: that cost a reinforcement', S.livesLeft === 2, String(S.livesLeft));

  /* on the surface it is still a pod */
  newMission('hollows');
  const Z = S.players[0];
  S.livesLeft = 3;
  die(Z);
  const pb = S.pods.length;
  reinforceAt(0, 0, Z);
  ok('surface: reinforcement still comes down on a pod', S.pods.length === pb + 1);

  /* a jammer above ground still blocks its own field */
  newMission('plains');
  const P2 = S.players[0];
  S.objectives.push({ nid: 1, id: 'jammer', D: OBJECTIVES.jammer, kind: 'destroy',
    name: 'J', x: P2.x + 100, y: P2.y, hp: 100, max: 100, field: 1300, radius: 26,
    col: '#f00', t: 0, prog: 0, have: 0, need: 0, armor: 2, done: false, timeout: 999 });
  P2.armed = STRAT_BY_ID.gatling; P2.stt.fill(0);
  const b3 = S.balls.length;
  throwStratagem(P2, P2.x + 200, P2.y);
  ok('a jammer refuses the call', S.balls.length === b3);
  S.objectives[0].hp = 0;
  run(0.5);
  P2.armed = STRAT_BY_ID.gatling; P2.stt.fill(0);
  throwStratagem(P2, P2.x + 200, P2.y);
  ok('destroying it restores the uplink', S.balls.length > b3);
}

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
  /* keep the horde off them: this is testing the redeploy, not the fight, and a
     Helldiver who lands and is immediately killed again reads the same as one
     who never came back */
  run(12, () => { S.enemies.length = 0; });
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

/* ---- switching maps must not leave the last one's caves behind ---- */
{
  buildMap('hollows', 3);
  const hadZones = caveZones.length;
  buildMap('plains', 3);
  ok('a map with no caves has no caves', caveZones.length === 0,
     `${hadZones} -> ${caveZones.length}`);
  ok('...so open ground is not secretly underground', !inCave(2500, 2500));
  buildMap('megacity', 3);
  ok('nor does the city', caveZones.length === 0);
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

/* ============================ 19. THE COOP ROUND ============================
   Everything in this section is something that went wrong in a real match. */
section('19. What the squad reported');
{
  /* ---- the horde forgot about the Helldivers entirely ---- */
  newMission('plains');
  S.enemies.length = 0;
  const P0 = S.players[0];
  P0.x = 0; P0.y = 0; P0.hp = 1e6; P0.maxhp = 1e6;
  for (let i = 0; i < 40; i++) spawnEnemy('scavenger', { x: 300 + (i % 8) * 30, y: -200 + ((i / 8) | 0) * 40 });
  for (let i = 0; i < 40; i++) spawnEnemy('trooper', { x: 500 + (i % 8) * 30, y: -200 + ((i / 8) | 0) * 40 });
  run(3);
  let onDiver = 0, onFoe = 0;
  for (const e of S.enemies) {
    if (!e.tgt) continue;
    if (e.tgt.kind === 'diver') onDiver++;
    else if (e.tgt.kind === 'enemy') onFoe++;
  }
  line(`  with two factions on the field: ${onDiver} hunting the squad, ${onFoe} brawling`);
  ok('the horde still comes for the Helldivers', onDiver > S.enemies.length * 0.3,
     `${onDiver}/${S.enemies.length}`);
  ok('...and some of them still fight each other', onFoe > 4, String(onFoe));

  /* ---- a Helldiver standing right there outranks the brawl ---- */
  S.enemies.length = 0;
  const near = spawnEnemy('scavenger', { x: 200, y: 0 });
  spawnEnemy('trooper', { x: 260, y: 0 });      /* a foe closer than the diver */
  near.brawl = 1;                               /* the worst case: it wants to brawl */
  run(1);
  ok('a Helldiver within arm’s reach is the priority',
     near.tgt && near.tgt.kind === 'diver', near.tgt && near.tgt.kind);
}
{
  /* ---- one faction per wave, when the point was to watch them meet ---- */
  newMission('plains');
  const seen = {};
  let multi = 0, waves = 0;
  for (let w = 0; w < 24; w++) {
    DIR.waveT = 0;
    run(0.1);
    waves++;
    if (S.waveFacs.length > 1) multi++;
    for (const f of S.waveFacs) seen[f] = 1;
    S.enemies.length = 0;
    DIR.queue.length = 0;
  }
  line(`  ${multi}/${waves} waves drew more than one faction`);
  ok('most waves are a collision, not a queue', multi > waves * 0.6, `${multi}/${waves}`);
  ok('all three factions turn up', Object.keys(seen).length === 3, Object.keys(seen).join(','));
}
{
  /* ---- the orbital laser drew circles in an empty street ---- */
  newMission('plains');
  S.enemies.length = 0;
  const mob = [];
  for (let i = 0; i < 8; i++)
    mob.push(spawnEnemy('warrior', { x: 260 + (i % 4) * 40, y: 180 + ((i / 4) | 0) * 40 }));
  callIn({ strat: STRAT_BY_ID.orblaser, x: 0, y: 0, who: 0 });
  ok('the laser is on the field', S.beamRuns.length === 1);
  const B = S.beamRuns[0];
  ok('it has a net id, so a joining Helldiver can be told about it', B.nid > 0);
  run(0.45);
  /* the head should be on its way to the pack, not orbiting the beacon it was
     thrown at -- which is exactly what it used to do while the horde watched */
  const fromBeacon = Math.hypot(B.px - B.x, B.py - B.y);
  const aim = Math.atan2(B.py, B.px), toPack = Math.atan2(220, 320);
  const off = Math.abs(((aim - toPack + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  line(`  after 0.45s the head is ${Math.round(fromBeacon)} units from the beacon, ` +
       `${Math.round(off * 57.3)} deg off the pack`);
  ok('it leaves the beacon', fromBeacon > 80, String(Math.round(fromBeacon)));
  ok('and it goes towards the horde', off < 0.6, String(Math.round(off * 57.3)) + ' deg');
  run(2);
  ok('it killed what it walked to', mob.filter(e => S.enemies.includes(e)).length === 0,
     String(mob.filter(e => S.enemies.includes(e)).length));
  run(7);
  ok('and it ends', S.beamRuns.length === 0);
}
{
  /* ---- dying with a Guard Dog and coming back with it ---- */
  newMission('plains');
  S.enemies.length = 0;
  const P = S.players[0];
  S.drones.push({ nid: 999, owner: P.id, x: P.x, y: P.y, ang: 0, orbit: 0, cool: 0 });
  P.shieldMax = 240; P.shield = 240;
  die(P);
  ok('the dog does not follow you into the crater', S.drones.length === 0, String(S.drones.length));
  ok('the pack is lying where you fell',
     S.pickups.some(p => p.kind === 'dog') && S.pickups.some(p => p.kind === 'shield'));
  ok('and the shield is gone with it', P.shieldMax === 0);
  S.livesLeft = 3;
  reinforceAt(P.x, P.y, P);
  run(3);
  const mine = S.drones.filter(d => d.owner === P.id).length;
  ok('you come back without it', mine === 0, String(mine));
}
{
  /* ---- the Requisition terminal was a screen on the host's monitor ---- */
  newMission('plains');
  const P = S.players[0];
  ok('no terminal, no screen', !atTerminal(P));
  S.pickups.push({ nid: 1, kind: 'requisition', x: P.x + 40, y: P.y, bob: 0 });
  ok('standing at one is recognised', atTerminal(P));
  S.pickups[S.pickups.length - 1].x = P.x + 400;
  ok('four hundred units away is not', !atTerminal(P));
}
{
  /* ---- a Helldiver whose link dropped is not lunch ---- */
  newMission('plains', { roster: [
    { id: 0, name: 'ALPHA', load: LOADOUT.slots.slice() },
    { id: 1, name: 'BRAVO', load: LOADOUT.slots.slice() }
  ] });
  S.enemies.length = 0;
  const A0 = S.players[0], B0 = S.players[1];
  A0.x = 4000; A0.y = 4000;
  B0.x = 0; B0.y = 0;
  B0.linkDown = 1;
  const e = spawnEnemy('scavenger', { x: 150, y: 0 });
  run(1.5);
  ok('nothing hunts a body whose player dropped off the wire',
     !(e.tgt && e.tgt.kind === 'diver' && e.tgt.ref === B0), e.tgt && e.tgt.kind);
  B0.linkDown = 0;
  run(1.5);
  ok('...and it is a target again the moment they are back',
     !!(e.tgt && e.tgt.kind === 'diver' && e.tgt.ref === B0), e.tgt && e.tgt.kind);
}
{
  /* ---- they all looked the same ---- */
  const arts = {};
  let missing = 0;
  for (const id of TROOP_IDS) {
    const a = TROOPS[id].art;
    if (!a) { missing++; continue; }
    arts[a] = (arts[a] || 0) + 1;
  }
  ok('every troop names its own drawing', missing === 0, String(missing));
  ok('and no two share one', Object.keys(arts).length === TROOP_IDS.length,
     `${Object.keys(arts).length} of ${TROOP_IDS.length}`);
}

/* ============================ 20. SPECTATING ============================
   Being down used to mean three machines disagreeing about where you were: the
   camera on a squadmate, the tactical map on your corpse, and the ears on your
   corpse as well -- so you watched a silent firefight beside a map of an empty
   street. All three read S.watch now. */
section('20. Lying on your back, watching somebody else');
{
  newMission('plains', { roster: [
    { id: 0, name: 'ALPHA', load: LOADOUT.slots.slice() },
    { id: 1, name: 'BRAVO', load: LOADOUT.slots.slice() },
    { id: 2, name: 'CHARLIE', load: LOADOUT.slots.slice() }
  ] });
  S.enemies.length = 0;
  const A = S.players[0], B = S.players[1], C = S.players[2];
  A.x = 0; A.y = 0;
  B.x = 2600; B.y = 0;
  C.x = 2600; C.y = 900;
  S.me = A;
  S.livesLeft = 3;

  updateWatch();
  ok('on my feet, I am watching myself', watched() === A, watched() && watched().name);
  ok('...and the ears are on me', Math.round(earX()) === 0, String(Math.round(earX())));

  die(A);
  A.waiting = 0;                      /* in a squad somebody else makes the call */
  updateWatch();
  const first = watched();
  ok('down, the screen follows somebody who is standing',
     first === B || first === C, first && first.name);
  ok('...and so do the ears', Math.round(earX()) === Math.round(first.x),
     String(Math.round(earX())));
  ok('...so their rifle is audible', earshot(first) === 1, String(earshot(first)));
  ok('...and my own corpse is not the loudest thing on the map', earshot(A) < 1,
     String(earshot(A)));

  /* the camera actually goes there, rather than sitting on the body */
  run(2.5);
  ok('the camera travelled to them', Math.abs(S.cam.x - first.x) < 500,
     String(Math.round(S.cam.x)));

  /* it must not flap between two squadmates every time they cross */
  const other = first === B ? C : B;
  let flips = 0, prev = watched();
  for (let i = 0; i < 240; i++) {
    /* walk the other one straight through them, which is where a
       nearest-body rule hands the camera over and then takes it back */
    other.x = first.x + Math.cos(i / 12) * 700;
    other.y = first.y + Math.sin(i / 12) * 200;
    updateWatch();
    if (watched() !== prev) { flips++; prev = watched(); }
  }
  ok('the camera does not flap between squadmates', flips === 0, String(flips) + ' handovers');

  /* ...but it does hand over when the one it is watching goes down */
  die(first);
  updateWatch();
  ok('when they fall, it moves to the next one standing', watched() === other,
     watched() && watched().name);

  /* on my own drop site, the screen is mine: picking where to land is my job */
  A.waiting = 8;
  updateWatch();
  ok('choosing my own drop site, the screen comes back to me', watched() === A,
     watched() && watched().name);
  A.waiting = 0;

  /* back on my feet */
  S.livesLeft = 3;
  reinforceAt(A.x, A.y, A);
  A.inPod = false;
  updateWatch();
  ok('called back in, the screen is mine again', watched() === A, watched() && watched().name);
}
{
  /* the Game Master has no body; the ears belong to the camera */
  newMission('plains', { gm: true });
  S.me = null;
  S.cam.x = 1234; S.cam.y = -99;
  updateWatch();
  ok('with no Helldiver, the ears are the camera', Math.round(earX()) === 1234 &&
     Math.round(earY()) === -99, Math.round(earX()) + ',' + Math.round(earY()));
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
