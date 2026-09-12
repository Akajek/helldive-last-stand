/* The wave director.
 *
 * Every minute is a wave with a budget. The budget buys troops, and it grows.
 * What it buys is deliberately lumpy -- one wave is four hundred Scavengers and
 * the next is three Chargers and nothing else -- because a horde that arrives in
 * the same proportions every time stops being frightening by the fourth minute.
 *
 * When two factions draw in the same wave they come in from opposite sides, meet
 * in the middle, and stop being your problem for a while. */
'use strict';
import { rand, randi, clamp, TAU, pick, shuffle } from './util.js';
import { CFG, activeFactions } from './config.js';
import {
  S, say, squadMul, nearestDiver, anchorDist, sim, isHost, spark, falloff
} from './state.js';
import { SFX, sndAt } from './audio.js';
import { worldEv } from './events.js';
import { FACTIONS, FACTION_IDS, TROOPS, troopsOf, SIZE } from './data.js';
import { spawnEnemy, countSize, countTroop } from './enemies.js';
import { spawnPoint, solidAt, openSpot } from './world.js';

export const WAVE_LEN = 60;
export const ENEMY_CAP = 520;

/* what may appear at all, and how heavily, at this point in the mission */
function sizeWeights(wave) {
  if (wave <= 1) return { small: 1, medium: 0.10, large: 0 };
  if (wave <= 3) return { small: 1, medium: 0.42, large: 0.05 };
  if (wave <= 5) return { small: 1, medium: 0.70, large: 0.22 };
  if (wave <= 8) return { small: 1, medium: 0.85, large: 0.45 };
  return { small: 1, medium: 1, large: 0.75 };
}
/* the shape of the minute */
const SHAPES = [
  { id: 'swarm', w: 3, small: 1.0, medium: 0.08, large: 0, say: 'MASSED SIGNATURES — SWARM INBOUND' },
  { id: 'mixed', w: 4, small: 0.6, medium: 0.5, large: 0.2, say: null },
  { id: 'elite', w: 2, small: 0.15, medium: 0.8, large: 0.7, say: 'HEAVY SIGNATURES INBOUND' },
  { id: 'boss', w: 1, small: 0.3, medium: 0.2, large: 1.0, say: '*** TITAN-CLASS SIGNATURE ***', minWave: 5 },
  { id: 'ranged', w: 2, small: 0.7, medium: 0.6, large: 0.1, say: 'PATROL INBOUND' }
];
function pickShape(wave) {
  const pool = [];
  for (const s of SHAPES) {
    if (s.minWave && wave < s.minWave) continue;
    for (let i = 0; i < s.w; i++) pool.push(s);
  }
  return pick(pool);
}

export const DIR = {
  queue: [],        /* [{tid, at, side}] -- what is coming and when */
  waveT: 0,
  wave: 0,
  lastFacs: [],
  banner: ''
};

export function resetDirector() {
  DIR.queue.length = 0;
  DIR.waveT = 0; DIR.wave = 0; DIR.lastFacs = []; DIR.banner = '';
  S.wave = 0;
}

export function updateDirector(dt) {
  if (!sim() || S.gmMatch) return;
  DIR.waveT -= dt;
  if (DIR.waveT <= 0) {
    DIR.waveT = WAVE_LEN;
    planWave();
  }
  S.wave = DIR.wave;
  S.waveT = DIR.waveT;

  /* trickle the queue out */
  for (let i = DIR.queue.length - 1; i >= 0; i--) {
    const q = DIR.queue[i];
    q.at -= dt;
    if (q.at > 0) continue;
    DIR.queue.splice(i, 1);
    if (S.enemies.length >= ENEMY_CAP) continue;
    releaseOne(q);
  }
}

function planWave() {
  DIR.wave++;
  const wave = DIR.wave;
  const facs = activeFactions();
  const shape = pickShape(wave);
  const sw = sizeWeights(wave);

  /* how much this minute may spend */
  let budget = (26 + wave * 16 * (0.4 + CFG.wave)) * squadMul();
  budget *= rand(0.85, 1.2);

  /* one faction, or two on a collision course */
  let use = [];
  if (facs.length > 1 && CFG.infight > 0 && wave >= 2 && Math.random() < 0.42) {
    const sh = shuffle(facs.slice());
    use = [sh[0], sh[1]];
  } else use = [pick(facs)];
  DIR.lastFacs = use;

  const perFac = budget / use.length;
  const baseAngle = rand(0, TAU);

  for (let f = 0; f < use.length; f++) {
    const fac = use[f];
    /* two factions arrive from opposite sides so that they actually meet */
    const side = use.length > 1 ? baseAngle + f * Math.PI : undefined;
    spend(fac, perFac, shape, sw, side, wave);
  }

  const names = use.map(f => FACTIONS[f].name).join(' vs ');
  if (use.length > 1) {
    DIR.banner = names + ' — THEY ARE BOTH COMING';
    say('WAVE ' + wave + ' · ' + names, 4);
    worldEv('objNew', 0, 0);
  } else if (shape.say) {
    DIR.banner = shape.say;
    say('WAVE ' + wave + ' · ' + shape.say, 4);
  } else {
    DIR.banner = FACTIONS[use[0]].name;
    say('WAVE ' + wave + ' · ' + FACTIONS[use[0]].name, 3);
  }
}

function spend(fac, budget, shape, sw, side, wave) {
  const bySize = {
    small: troopsOf(fac, 'small'),
    medium: troopsOf(fac, 'medium'),
    large: troopsOf(fac, 'large')
  };
  /* build a weighted bag once, then draw from it until the money is gone */
  const bag = [];
  for (const size of ['small', 'medium', 'large']) {
    const w = sw[size] * (shape[size] || 0);
    if (w <= 0) continue;
    for (const T of bySize[size]) {
      if (T.boss && wave < 6) continue;
      const n = Math.max(1, Math.round(w * 10));
      for (let i = 0; i < n; i++) bag.push(T);
    }
  }
  if (!bag.length) bag.push(bySize.small[0]);

  /* things arrive in groups, not as a queue of individuals */
  let spent = 0, guard = 0;
  const packs = [];
  while (spent < budget && guard++ < 400) {
    const T = pick(bag);
    if (spent + T.cost > budget * 1.08) {
      if (T.cost > budget * 0.5) continue;
      break;
    }
    const packSize = T.size === 'small' ? randi(4, 10) : T.size === 'medium' ? randi(1, 3) : 1;
    const n = Math.min(packSize, Math.max(1, Math.floor((budget - spent) / T.cost)));
    spent += T.cost * n;
    packs.push({ tid: T.id, n });
  }
  shuffle(packs);
  /* spread them across the minute, front-loaded so the wave has a shape */
  let t = 0.5;
  for (const p of packs) {
    const a = side === undefined ? rand(0, TAU) : side + rand(-0.55, 0.55);
    for (let i = 0; i < p.n; i++)
      DIR.queue.push({ tid: p.tid, at: t + i * 0.09, side: a, fac });
    t += rand(0.6, WAVE_LEN / Math.max(3, packs.length));
    if (t > WAVE_LEN * 0.92) t = rand(1, WAVE_LEN * 0.9);
  }
}

/* where a body may appear: off-screen, not on top of anybody, and not inside a
   radar exclusion the squad paid for */
function releaseOne(q) {
  const anchor = S.players.length
    ? S.players[(Math.random() * S.players.length) | 0] : { x: 0, y: 0 };
  const near = Math.max(S.W, S.H) * 0.6 + 120;
  const far = near + 520;
  let x, y, ok = false;
  for (let i = 0; i < 12; i++) {
    const a = q.side === undefined ? rand(0, TAU) : q.side + rand(-0.6, 0.6);
    const d = rand(near, far);
    x = clamp(anchor.x + Math.cos(a) * d, -S.world + 60, S.world - 60);
    y = clamp(anchor.y + Math.sin(a) * d, -S.world + 60, S.world - 60);
    if (blockedSpawn(x, y)) continue;
    if (solidAt(x, y)) {
      if (!S.map.cave) continue;
      const o = openSpot(x, y, 12);
      x = o.x; y = o.y;
      if (blockedSpawn(x, y)) continue;
    }
    ok = true; break;
  }
  if (!ok) return;
  const e = spawnEnemy(q.tid, { x, y });
  if (e && S.map.cave) worldEv('warp', x, y);
}
export function blockedSpawn(x, y) {
  const NS = S.mod.noSpawn;
  if (NS && Math.hypot(NS.x - x, NS.y - y) < NS.r) return true;
  return false;
}

/* ---- a hand-placed opening for the very start of a mission ----
   Close enough to find on the way to the first objective, far enough that the
   pods are not landing in a fight. The world is a lot bigger than it used to be,
   so "anywhere" would scatter forty bodies across nine square kilometres and the
   opening minute would be a walk. */
export function seedOpening() {
  if (!sim() || S.gmMatch) return;
  const facs = activeFactions();
  const fac = pick(facs);
  const small = troopsOf(fac, 'small');
  const med = troopsOf(fac, 'medium');
  for (let i = 0; i < 44; i++) {
    const a = rand(0, TAU), d = rand(700, 2100);
    const p = spawnPoint(Math.cos(a) * d, Math.sin(a) * d, 0, 220);
    spawnEnemy(pick(small).id, { x: p.x, y: p.y });
  }
  for (let i = 0; i < 3; i++) {
    const a = rand(0, TAU), d = rand(1300, 2400);
    const p = spawnPoint(Math.cos(a) * d, Math.sin(a) * d, 0, 220);
    if (med.length) spawnEnemy(pick(med).id, { x: p.x, y: p.y });
  }
  DIR.waveT = 14;                 /* the first real wave lands soon, not in a minute */
}
