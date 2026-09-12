/* Things to actually go and do.
 *
 * An endless horde with nothing to push against is a countdown with extra steps.
 * These pay out -- reinforcements, cooldowns, artillery -- and three of them are
 * aimed squarely at the Game Master: a radar array shuts their deployments out of
 * a whole district, a silenced broadcast turns the horde on itself, and every
 * completion takes credits out of their pocket. */
'use strict';
import { rand, clamp, TAU, pick } from './util.js';
import { CFG } from './config.js';
import {
  S, nid, say, spark, blast, eachDiver, anchorDist, sim, falloff, later
} from './state.js';
import { SFX, sndAt } from './audio.js';
import { worldEv } from './events.js';
import './outbox.js';
import { OBJECTIVES, OBJ_IDS, REWARD_TEXT, STRATS } from './data.js';
import { spawnPoint, solidAt, openSpot } from './world.js';
import { explode } from './combat.js';
import { INTERACT, PICKHOOK } from './diver.js';

export const OBJ = { nextAt: 0, done: 0, failed: 0, hook: null };

export function resetObjectives() {
  S.objectives.length = 0;
  OBJ.nextAt = 55; OBJ.done = 0; OBJ.failed = 0;
  S.mod.confuse = 0; S.mod.radar = 0; S.mod.noSpawn = null;
  S.mod.spore = 0; S.mod.barrage = 0; S.mod.uplink = 0;
}

/* ============================ SPAWNING ONE ============================ */
export function updateObjectives(dt) {
  /* modifiers tick down on every machine so the HUD agrees with the world */
  if (S.mod.confuse > 0) S.mod.confuse -= dt;
  if (S.mod.radar > 0) {
    S.mod.radar -= dt;
    if (S.mod.radar <= 0) S.mod.noSpawn = null;
  }
  if (S.mod.spore > 0) S.mod.spore -= dt;
  if (S.mod.uplink > 0) {
    S.mod.uplink -= dt;
    if (S.mod.uplink <= 0 && S.map.cave) say('UPLINK LOST — THE ROCK IS BACK', 3);
  }

  for (const o of S.objectives) {
    o.t += dt;
    if (o.kind === 'destroy' && o.spin !== undefined) o.spin += dt * 0.6;
  }
  if (!sim() || !CFG.objectives) return;

  OBJ.nextAt -= dt;
  if (OBJ.nextAt <= 0 && S.objectives.length < (S.wave >= 5 ? 2 : 1)) {
    OBJ.nextAt = rand(75, 115);
    spawnObjective();
  }
  for (let i = S.objectives.length - 1; i >= 0; i--) {
    const o = S.objectives[i];
    stepObjective(o, dt, i);
  }
}

function spawnObjective(forceId) {
  const anchor = S.players.length ? S.players[(Math.random() * S.players.length) | 0] : { x: 0, y: 0 };
  let id = forceId;
  if (!id) {
    /* a jammer is only interesting where stratagems matter, and in a cave it is
       the whole point -- so it is much more likely down there */
    const pool = OBJ_IDS.filter(k => {
      if (k === 'jammer') return true;
      if (k === 'spore') return !S.map.cave;
      return true;
    });
    if (S.map.cave && Math.random() < 0.55) id = 'jammer';
    else id = pick(pool);
  }
  const D = OBJECTIVES[id];
  if (!D) return;
  /* far enough to be a trip, near enough to be worth making */
  let spot = null;
  for (let i = 0; i < 40; i++) {
    const p = spawnPoint(anchor.x, anchor.y, 1100, 2500);
    if (solidAt(p.x, p.y)) continue;
    spot = p; break;
  }
  if (!spot) spot = openSpot(anchor.x, anchor.y);

  const o = {
    nid: nid(), id, D, kind: D.kind, name: D.name,
    x: spot.x, y: spot.y, t: 0, prog: 0, done: false,
    radius: D.radius || 30, col: D.col, field: D.field || 0,
    hp: D.hp || 0, max: D.hp || 0, armor: D.armor || 0,
    need: D.count || 0, have: 0, spin: 0, active: 0, timeout: 240
  };
  S.objectives.push(o);
  if (D.kind === 'collect') scatterPickups(o, 'sample');
  if (D.kind === 'carry') scatterPickups(o, 'shell');
  worldEv('objNew', o.x, o.y);
  say('NEW OBJECTIVE — ' + D.name, 4);
}
function scatterPickups(o, kind) {
  const D = o.D;
  for (let i = 0; i < D.count; i++) {
    const a = (i / D.count) * TAU + rand(-0.4, 0.4);
    const d = rand(D.spread * 0.35, D.spread);
    let p = { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d };
    if (solidAt(p.x, p.y)) p = openSpot(p.x, p.y, 16);
    S.pickups.push({ nid: nid(), kind, x: clamp(p.x, -S.world + 40, S.world - 40),
                     y: clamp(p.y, -S.world + 40, S.world - 40), bob: rand(0, 6), obj: o.nid });
  }
}

/* ============================ RUNNING ONE ============================ */
function stepObjective(o, dt, idx) {
  if (o.done) return;
  o.timeout -= dt;

  switch (o.kind) {
    case 'hold': {
      let inside = 0;
      eachDiver(P => { if (Math.hypot(P.x - o.x, P.y - o.y) < o.radius) inside++; });
      o.active = inside;
      if (inside > 0) {
        /* it goes faster with more boots on it, but never instantly */
        o.prog += dt * (1 + (inside - 1) * 0.5);
        if (Math.random() < dt * 4) sndAt(falloff(o.x, o.y, 700), SFX.uploading);
      } else if (o.prog > 0) {
        o.prog = Math.max(0, o.prog - dt * 0.35);   /* it slips back when you leave */
      }
      if (o.prog >= o.D.time) finish(o, idx);
      break;
    }
    case 'destroy':
      if (o.hp <= 0) finish(o, idx);
      break;
    case 'collect':
      if (o.have >= o.need) finish(o, idx);
      break;
    case 'carry': {
      /* a shell is carried to the gun; the gun is the objective itself */
      eachDiver(P => {
        if (P.carrying !== 'shell') return;
        if (Math.hypot(P.x - o.x, P.y - o.y) > o.radius + 30) return;
        P.carrying = null;
        o.have++;
        worldEv('terminal', o.x, o.y);
        say('SHELL LOADED  ' + o.have + '/' + o.need, 2);
      });
      if (o.have >= o.need) finish(o, idx);
      break;
    }
  }
  if (o.timeout <= 0) {
    o.done = true;
    OBJ.failed++;
    worldEv('objFail', o.x, o.y);
    say('OBJECTIVE LOST — ' + o.name, 3.5);
    cleanup(o);
    S.objectives.splice(idx, 1);
  }
}

function finish(o, idx) {
  o.done = true;
  OBJ.done++;
  worldEv('objDone', o.x, o.y);
  applyReward(o.D.reward, o);
  say(o.name + ' COMPLETE — ' + (REWARD_TEXT[o.D.reward] || ''), 4.5);
  cleanup(o);
  S.objectives.splice(idx, 1);
  if (OBJ.hook) OBJ.hook(o);
  for (let i = 0; i < 30; i++) {
    const a = rand(0, TAU);
    spark(o.x, o.y, Math.cos(a) * rand(60, 260), Math.sin(a) * rand(60, 260),
          rand(0.4, 1.1), i % 2 ? '#ffd21e' : o.col, rand(2, 5));
  }
  blast(o.x, o.y, 160, o.col, 0.6);
}
function cleanup(o) {
  for (let i = S.pickups.length - 1; i >= 0; i--)
    if (S.pickups[i].obj === o.nid) S.pickups.splice(i, 1);
}

/* ============================ PAYING OUT ============================ */
export function applyReward(kind, o) {
  switch (kind) {
    case 'life':
      S.livesLeft++;
      break;
    case 'cooldown':
      for (const P of S.players)
        for (let i = 0; i < P.stt.length; i++) if (!STRATS[i].hidden) P.stt[i] = 0;
      break;
    case 'unjam':
      /* Above ground the field died with the structure and that is the whole
         reward. Underground there is no sky at all, so breaking one punches a
         temporary hole in the interference -- two minutes to spend everything
         you have been saving. */
      if (S.map.cave) {
        S.mod.uplink = 120;
        say('UPLINK OPEN — 120 SECONDS', 4);
      }
      break;
    case 'vision':
      S.mod.spore = 0;
      break;
    case 'radar':
      S.mod.radar = 100;
      S.mod.noSpawn = { x: o ? o.x : 0, y: o ? o.y : 0, r: 1400 };
      break;
    case 'confuse':
      S.mod.confuse = 50;
      break;
    case 'barrage':
      S.mod.barrage = 3;
      break;
  }
  /* every objective completed costs the Game Master. That is the point of them. */
  if (GMPENALTY.fn) GMPENALTY.fn(kind);
}
export const GMPENALTY = { fn: null };

/* a spore tower being alive is what makes the map murky */
export function sporeLevel() {
  for (const o of S.objectives)
    if (o.id === 'spore' && o.hp > 0) {
      const d = anchorDist(o.x, o.y);
      if (d < o.field) return clamp(1 - d / o.field, 0, 1);
    }
  return 0;
}
/* is this point inside a live jammer? used by the HUD as well as the call check */
export function jammerNear(x, y) {
  for (const o of S.objectives)
    if (o.field && o.hp > 0 && Math.hypot(o.x - x, o.y - y) < o.field) return o;
  return null;
}

/* ============================ THE PLAYER'S END ============================ */
PICKHOOK.sample = function (P, p) {
  for (const o of S.objectives)
    if (o.nid === p.obj) { o.have++; say('SAMPLE ' + o.have + '/' + o.need, 1.6); }
};
/* pressing E with nothing under your feet: look for a terminal */
INTERACT.fn = function (P) {
  for (const o of S.objectives) {
    if (o.kind !== 'hold') continue;
    if (Math.hypot(P.x - o.x, P.y - o.y) > o.radius) continue;
    worldEv('terminal', o.x, o.y);
    say(o.name + ' — HOLD POSITION', 2);
    return;
  }
  if (S.mod.barrage > 0) {
    say('SEAF ARTILLERY READY — CALL IT WITH  →→↓←→↓', 3);
  }
};

/* the SEAF gun the artillery objective earns you */
export function seafBarrage(x, y) {
  if (S.mod.barrage <= 0) return false;
  S.mod.barrage--;
  say('SEAF ARTILLERY FIRING', 3);
  for (let i = 0; i < 14; i++) {
    const a = rand(0, TAU), d = rand(0, 360);
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    later(0.6 + i * 0.4, () => explode(px, py, 190, 520, 20, '#ff8a3d', true, undefined, 4));
  }
  return true;
}
