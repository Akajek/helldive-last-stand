/* The world, in one place.
 *
 * Everything mutable lives on `S`. Modules import `S` and read through it rather
 * than holding their own copies, because an imported binding cannot be reassigned
 * and a stale copy of `players` is exactly the sort of thing that goes wrong at
 * two in the morning.
 *
 * There is deliberately no ambient "current player" alias any more. Every
 * function that acts on a Helldiver takes that Helldiver as its first argument.
 * The old alias was convenient and it cost us a whole afternoon of effects
 * landing on the wrong person. */
'use strict';
import { clamp, TAU, rand } from './util.js';
import { CFG } from './config.js';
import { STRATS, MAPS } from './data.js';

export const S = {
  /* ---- canvas + view ---- */
  W: 0, H: 0, cam: { x: 0, y: 0 }, camKick: { x: 0, y: 0 }, shake: 0,
  /* ---- clock ---- */
  time: 0, dt: 0.016, running: false, paused: false, gameOver: false,
  hordeLv: 1, wave: 0, waveT: 0, kills: 0, deaths: 0, waveFacs: [],
  /* ---- map ---- */
  map: MAPS.plains, world: 6000,
  /* ---- roster ---- */
  players: [], me: null, livesLeft: 5, wipeT: 0, gmMatch: false,
  /* Who this screen is FOLLOWING, which is not always who I am: lying in the
     street waiting for a reinforcement, it is whoever is still standing. The
     camera, the tactical map, this browser's ears and the slice of the world the
     host sends me all read it, because when they disagreed the result was a view
     of one fight, a map of another, and silence over both. */
  watch: null, watchId: -1,
  /* ---- things ---- */
  enemies: [], bullets: [], ebullets: [], pickups: [], sentries: [], balls: [],
  pods: [], blasts: [], particles: [], corpses: [], nades: [], junk: [],
  beams: [], objectives: [], drones: [], timers: [], decals: [], beamRuns: [],
  /* ---- set piece state ---- */
  wreck: null, shipTarget: null, shipFx: null, flashWhite: 0,
  radar: null, radarAt: 0,
  nextRebuild: 75, rebuildQ: null, caveRooms: null, ping: 0,
  /* ---- world modifiers set by objectives ---- */
  mod: { confuse: 0, radar: 0, noSpawn: null, spore: 0, barrage: 0, uplink: 0 },
  /* ---- toast line ---- */
  toast: { t: 0, max: 3, txt: '' },
  /* ---- ids ---- */
  enemyId: 0, netId: 0,
  /* ---- quality, dropped automatically on a machine that cannot keep up ---- */
  quality: 1, fps: 60, particleCap: 1400
};

export function nid() { return ++S.netId; }

/* ============================ ROSTER ============================ */
export function amGM() { return NETROLE.role === 'host' && !S.me; }
export function isSquad() { return S.players.length > 1; }

export function diverById(id) {
  for (const P of S.players) if (P.id === id) return P;
  return null;
}
/* live divers only -- a body waiting on reinforcement is not a target */
export function eachDiver(fn) {
  for (const P of S.players) { if (P.inPod || P.dead) continue; fn(P); }
}
/* A Helldiver whose player has dropped off the wire is still standing there, but
   nothing hunts them and nothing shoots at them: the relay is holding the seat
   and they cannot run. Being eaten while your router reboots is not a fight. */
export function nearestDiver(x, y) {
  let best = null, bd = Infinity;
  for (const P of S.players) {
    if (P.inPod || P.dead || P.linkDown) continue;
    const d = Math.hypot(P.x - x, P.y - y);
    if (d < bd) { bd = d; best = P; }
  }
  return best ? { p: best, d: bd } : null;
}
export function diverDist(x, y) { const n = nearestDiver(x, y); return n ? n.d : Infinity; }
/* Same question, but it always has an answer: a squad still in its pods, or flat
   on its back, is still somewhere, and culling the world around nobody empties it. */
export function anchorDist(x, y) {
  const n = nearestDiver(x, y);
  if (n) return n.d;
  let bd = Infinity;
  for (const P of S.players) {
    const d = Math.hypot(P.x - x, P.y - y);
    if (d < bd) bd = d;
  }
  return bd === Infinity ? 0 : bd;
}
export function anyDown() {
  for (const P of S.players) if (P.down && !P.dead) return true;
  return false;
}
/* the nearest Helldiver still on their feet -- who a downed player watches, and
   who the horde is actually a problem for */
export function livingDiver(not) {
  let best = null, bd = Infinity;
  for (const P of S.players) {
    if (P === not || P.dead || P.down || P.inPod) continue;
    const d = not ? Math.hypot(P.x - not.x, P.y - not.y) : 0;
    if (d < bd) { bd = d; best = P; }
  }
  return best;
}
export function liveCount() {
  let n = 0;
  for (const P of S.players) if (!P.dead) n++;
  return n;
}
export function squadMul() { return 1 + Math.max(0, liveCount() - 1) * 0.35 * CFG.squad; }

/* ============================ WHO I AM WATCHING ============================
   Normally me. Flat on my back with nothing to do but wait, whoever is still
   on their feet -- and it STAYS them until they go down too, rather than
   switching to whoever happens to be nearest this frame, which is a camera that
   jumps between two people every time they cross. */
export function updateWatch() {
  const me = S.me;
  if (!me) { S.watch = null; S.watchId = -1; return null; }
  /* your own drop site is your business: stay on your own body while choosing it */
  if (!me.down || me.waiting > 0) { S.watch = me; S.watchId = -1; return me; }
  let w = S.watchId >= 0 ? diverById(S.watchId) : null;
  if (!w || w.dead || w.down || w.inPod) {
    w = livingDiver(me);
    S.watchId = w ? w.id : -1;
  }
  S.watch = w || me;
  return S.watch;
}
export function watched() { return S.watch || S.me; }

/* ============================ THE LISTENER ============================
   Where this browser is hearing from: the body it is following, or the camera
   when it is following nobody (the Game Master, or somebody watching). */
export function earX() { const w = S.watch || S.me; return w ? w.x : S.cam.x; }
export function earY() { const w = S.watch || S.me; return w ? w.y : S.cam.y; }
export function earDist(x, y) { return Math.hypot(x - earX(), y - earY()); }
/* How hard a thing at (x,y) lands on THIS screen, and how loud it should be.
   `reach` lets a Bile Titan be heard from four times as far as a Scavenger. */
export function falloff(x, y, reach) {
  return clamp(1 - earDist(x, y) / (reach || 1500), 0, 1);
}
export function shakeAt(x, y, amt, radius, reach) {
  const fall = clamp(1 - (earDist(x, y) - (radius || 0)) / (reach || 1500), 0, 1);
  if (fall > 0) S.shake = Math.max(S.shake, amt * fall);
  return fall;
}
export function addShake(v) { S.shake = Math.max(S.shake, v); }

/* Hearing is local: a rifle two blocks away should not be as loud as mine.
   "Mine" is the body I am watching -- spectating a squadmate and hearing my own
   corpse at full volume, while their firefight is inaudible, is the wrong way
   round. */
export function earshot(P, reach) {
  if (P === (S.watch || S.me)) return 1;
  return falloff(P.x, P.y, reach || 1500);
}

export function say(txt, secs) {
  S.toast.txt = txt; S.toast.t = S.toast.max = secs || 3;
}

/* ============================ TIMERS ============================
   Delayed gameplay used to run on setTimeout, which kept ticking through a
   pause, survived a mission ending, and fired into a world that no longer
   existed. These run on the simulation clock and are wiped by reset(). */
export function later(secs, fn) { S.timers.push({ t: secs, fn: fn }); }
export function stepTimers(dt) {
  for (let i = S.timers.length - 1; i >= 0; i--) {
    const T = S.timers[i];
    T.t -= dt;
    if (T.t <= 0) {
      S.timers.splice(i, 1);
      try { T.fn(); } catch (e) { console.error('timer', e); }
    }
  }
}

/* ============================ PARTICLES ============================
   One door for every spark in the game, so a slow machine can turn the tap down
   instead of drowning. `prio` 1 survives a cull, 0 is decoration. */
export function spark(x, y, vx, vy, life, col, size, prio) {
  if (S.particles.length >= S.particleCap && !prio) return;
  S.particles.push({ x, y, vx, vy, life, max: life, c: col, s: size });
}
export function puff(x, y, col, n) {
  n = Math.round((n || 24) * S.quality);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(40, 200);
    spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5, col, 3);
  }
}
export function blast(x, y, max, col, life) {
  S.blasts.push({ x, y, r: 0, max, t: 0, life: life || 0.6, col: col || '#ffb347' });
}
export function decal(x, y, r, col, life) {
  if (S.decals.length > 260) S.decals.shift();
  S.decals.push({ x, y, r, col, life: life || 26, max: life || 26 });
}

/* The network role lives here so `amGM()` can see it without importing net.js
   (which imports half the game). net.js writes to it on every transition. */
export const NETROLE = { role: 'solo' };
export function setRole(r) { NETROLE.role = r; }
export function role() { return NETROLE.role; }
export function isHost() { return NETROLE.role === 'host'; }
export function isClient() { return NETROLE.role === 'client'; }
export function isSolo() { return NETROLE.role === 'solo'; }
/* the machine that decides what is true: host in a network match, me when solo */
export function sim() { return NETROLE.role !== 'client'; }

export function stratCount() { return STRATS.length; }
