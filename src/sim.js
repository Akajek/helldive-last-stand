/* One frame of the world, on the machine that owns it. */
'use strict';
import { TAU, ease } from './util.js';
import { CFG, LOADOUT } from './config.js';
import { S, say, livingDiver, isSquad, amGM, sim, stepTimers, role } from './state.js';
import { SFX, MUS } from './audio.js';
import { worldEv, capeInit } from './events.js';
import { clearOut } from './outbox.js';
import {
  updateCollapses, updateRebuild, startRebuild, REBUILD_EVERY, netCK, netCA
} from './world.js';
import { makeDiver, updateDiver } from './diver.js';
import {
  updateBullets, updateEBullets, updateBeams, updateStatus, hurt
} from './combat.js';
import { updateEnemies } from './enemies.js';
import {
  updateBalls, updatePods, updateNades, updateSentries, updateDrones, updateBeamRuns,
  updateWreck, dropPod, reinforceAt
} from './strat.js';
import { updateDirector, resetDirector, seedOpening } from './director.js';
import { updateObjectives, resetObjectives } from './objectives.js';

export const NETIN = { roster: null, mapId: 'megacity', seed: 1, myId: -1 };
export const keys = {};
export const mouse = { x: 0, y: 0, down: false, wx: 0, wy: 0 };

export function matchRoster() {
  if (role() === 'solo' || !NETIN.roster || !NETIN.roster.length)
    return [{ id: 0, name: 'HELLDIVER', load: LOADOUT.slots.slice() }];
  return NETIN.roster;
}

/* ============================ RESET ============================ */
export function reset() {
  const RS = matchRoster();
  S.players = []; S.me = null;
  for (const r of RS) {
    const D = makeDiver(r.id, r.name, r.load);
    S.players.push(D);
    if (role() === 'solo' || D.id === NETIN.myId) S.me = D;
  }
  if (!S.players.length) S.players.push(makeDiver(0, 'HELLDIVER'));
  S.livesLeft = CFG.lives;
  S.camKick.x = 0; S.camKick.y = 0;
  S.bullets = []; S.ebullets = []; S.enemies = []; S.pickups = []; S.sentries = [];
  S.balls = []; S.pods = []; S.blasts = []; S.particles = []; S.corpses = [];
  S.nades = []; S.junk = []; S.beams = []; S.drones = []; S.timers = []; S.decals = [];
  S.beamRuns = []; S.objectives = [];
  S.wreck = null; S.shipTarget = null; S.shipFx = null; S.flashWhite = 0;
  S.time = 0; S.kills = 0; S.deaths = 0; S.shake = 0; S.hordeLv = 1;
  S.gameOver = false; S.wipeT = 0; S.wave = 0; S.waveT = 0;
  S.enemyId = 0; S.netId = 0;
  S.nextRebuild = REBUILD_EVERY; S.rebuildQ = null;
  S.mod = { confuse: 0, radar: 0, noSpawn: null, spore: 0, jam: [], barrage: 0, uplink: 0 };
  netCK.length = 0; netCA.length = 0;
  clearOut();
  resetDirector();
  resetObjectives();
  for (const P of S.players) capeInit(P);

  if (!sim()) { snapCamera(); return; }   /* a client waits to be told where everything is */

  if (!S.gmMatch) seedOpening();
  /* every dive starts the only way it can: strapped into a hellpod -- and a squad
     spreads out so four pods do not land in the same crater. Underground there is
     nothing to drop through, so the squad simply walks out of the entry chamber. */
  const ring = S.players.length > 1 ? 95 : 0;
  for (let i = 0; i < S.players.length; i++) {
    const a = (i / S.players.length) * TAU;
    dropPod(Math.cos(a) * ring, Math.sin(a) * ring, { kind: 'player', pid: S.players[i].id });
  }
  /* the camera is placed AFTER the squad is, or it spends the first two seconds
     easing across the map from wherever the roster happened to be built */
  snapCamera();
}
/* put the eye exactly where it belongs, with no travel */
export function snapCamera() {
  const eye = S.me || S.players[0];
  if (!eye) return;
  S.cam.x = eye.x; S.cam.y = eye.y;
  S.camKick.x = 0; S.camKick.y = 0;
}

/* ============================ THE WIPE ============================
   Nobody standing means nobody can make the call, so the ship makes it: as many
   Helldivers as there are reinforcements left, last to fall first back up, all
   landing on the ground the last one lost. When there is no budget either, that
   is the mission. */
export function squadCheck(dt) {
  if (S.gameOver || !S.players.length) return;
  let standing = false;
  const downs = [];
  for (const P of S.players) {
    if (P.dead) continue;
    if (P.down) downs.push(P); else standing = true;
  }
  if (standing || !downs.length) { S.wipeT = 0; return; }
  if (S.livesLeft <= 0) {
    for (const P of downs) { P.dead = true; P.hp = 0; }
    endMission();
    return;
  }
  /* On your own there is no emergency: you have your own countdown and your own
     choice of drop site, and this must not reach in and take it from you. */
  if (!isSquad()) { S.wipeT = 0; return; }
  if (S.wipeT <= 0) {
    S.wipeT = 6;
    SFX.siren();
    say('SQUAD DOWN — EMERGENCY REDEPLOY', 4);
  }
  S.wipeT -= dt;
  if (S.wipeT > 0) return;
  S.wipeT = 0;
  downs.sort((a, b) => b.downAt - a.downAt);       /* last to fall, first back */
  const ax = downs[0].x, ay = downs[0].y;
  for (let k = 0; k < downs.length && S.livesLeft > 0; k++) {
    const an = (k / downs.length) * TAU;
    reinforceAt(ax + Math.cos(an) * 70, ay + Math.sin(an) * 70, downs[k]);
  }
}

export const ENDHOOK = { fn: null };
export function endMission() {
  if (S.gameOver) return;
  S.gameOver = true; S.running = false;
  SFX.boom(true);
  if (ENDHOOK.fn) ENDHOOK.fn();
}

/* ============================ UPDATE ============================ */
export function update(dt) {
  S.time += dt;
  S.dt = dt;
  S.hordeLv = CFG.ramp > 0 ? 1 + Math.floor(S.time / CFG.ramp) : 1;
  MUS.intensity = S.hordeLv >= 9 ? 4 : S.hordeLv >= 6 ? 3 : S.hordeLv >= 3 ? 2 : 1;

  mouse.wx = mouse.x - S.W / 2 + S.cam.x;
  mouse.wy = mouse.y - S.H / 2 + S.cam.y;
  /* my keyboard fills my own diver's input block and nobody else's */
  if (S.me) {
    const MI = S.me.inp;
    MI.U = keys['w'] ? 1 : 0; MI.D = keys['s'] ? 1 : 0;
    MI.L = keys['a'] ? 1 : 0; MI.R = keys['d'] ? 1 : 0;
    MI.sprint = !!keys['shift']; MI.fire = !!mouse.down;
    MI.ax = mouse.wx; MI.ay = mouse.wy;
  }

  /* Every diver is simulated the same way; their own sounds are scaled by how
     far away they are from this browser's ears. */
  for (const P of S.players) updateDiver(P, dt);

  camera(dt);
  squadCheck(dt);
  stepTimers(dt);

  if (S.gmMatch) { if (GMTICK.fn && amGM()) GMTICK.fn(dt); }
  else updateDirector(dt);
  updateObjectives(dt);

  updateBullets(dt);
  updateEBullets(dt);
  updateEnemies(dt);
  updateSentries(dt);
  updateDrones(dt);
  updateBalls(dt);
  updatePods(dt);
  updateNades(dt);
  updateBeamRuns(dt);
  updateBeams(dt);
  updateStatus(dt);
  updateWreck(dt);

  if (S.map.city && !S.map.caves) {
    if (S.time >= S.nextRebuild) {
      S.nextRebuild += REBUILD_EVERY;
      if (startRebuild()) worldEv('rebuild', 0, 0);
    }
    updateCollapses(dt, hurt);
    updateRebuild(dt);
  }
  fxStep(dt);
}
export const GMTICK = { fn: null };

function camera(dt) {
  const eye = S.me || S.players[0];
  if (!eye) return;
  const eyePod = !!(S.me && S.me.inPod);
  const lean = eye.waiting > 0 ? 0.6 : 0.16;
  let tx = eye.x + (eye.inp.ax - eye.x) * lean;
  let ty = eye.y + (eye.inp.ay - eye.y) * lean;
  if (eyePod) {
    const mp = myPod();
    if (mp) { tx = mp.x; ty = mp.y; }
  }
  /* lying in the street is dull: ride a squadmate until somebody calls you in */
  if (S.me && S.me.down && S.me.waiting <= 0) {
    const wt = livingDiver(S.me);
    if (wt) { tx = wt.x; ty = wt.y; }
  }
  if (amGM() && GMCAM.get) { const g = GMCAM.get(); tx = g.x; ty = g.y; }
  const k = Math.min(1, dt * (eyePod ? 3 : 6));
  S.cam.x += (tx - S.cam.x) * k;
  S.cam.y += (ty - S.cam.y) * k;
  S.camKick.x -= S.camKick.x * ease(11, dt);
  S.camKick.y -= S.camKick.y * ease(11, dt);
}
export const GMCAM = { get: null };
export function myPod() {
  if (!S.me) return null;
  for (const p of S.pods)
    if (p.payload && p.payload.pid === S.me.id) return p;
  return null;
}

/* shared by both sides: everything that is only decoration */
export function fxStep(dt) {
  for (let i = S.blasts.length - 1; i >= 0; i--) {
    const b = S.blasts[i]; b.t += dt;
    b.r = b.max * Math.min(1, b.t / 0.22);
    if (b.t > b.life) S.blasts.splice(i, 1);
  }
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(0.08, dt); p.vy *= Math.pow(0.08, dt);
    p.life -= dt;
    if (p.life <= 0) S.particles.splice(i, 1);
  }
  for (let i = S.junk.length - 1; i >= 0; i--) {
    const j = S.junk[i];
    j.x += j.vx * dt; j.y += j.vy * dt; j.rot += j.spin * dt;
    j.vx *= Math.pow(0.02, dt); j.vy *= Math.pow(0.02, dt); j.spin *= Math.pow(0.05, dt);
    j.life -= dt;
    if (j.life <= 0) S.junk.splice(i, 1);
  }
  for (let i = S.corpses.length - 1; i >= 0; i--) {
    S.corpses[i].life -= dt;
    if (S.corpses[i].life <= 0) S.corpses.splice(i, 1);
  }
  for (let i = S.decals.length - 1; i >= 0; i--) {
    S.decals[i].life -= dt;
    if (S.decals[i].life <= 0) S.decals.splice(i, 1);
  }
  for (const p of S.pickups) p.bob += dt;
  if (S.toast.t > 0) S.toast.t -= dt;
  if (S.flashWhite > 0) S.flashWhite -= dt * 1.4;
  if (S.shipFx) S.shipFx.t += dt;
  S.shake = Math.max(0, S.shake - dt * 28);
}

/* Health slides to its new value and leaves a slower red ghost behind it, so a
   hit reads as an amount taken rather than a bar that was simply a different
   length the next time you looked at it. */
export function healthEase(dt) {
  for (const P of S.players) {
    const h = Math.max(0, P.hp);
    if (P.hpShow === undefined) { P.hpShow = h; P.hpGhost = h; }
    P.hpShow += (h - P.hpShow) * ease(15, dt);
    if (P.hpGhost < P.hpShow) P.hpGhost = P.hpShow;
    else P.hpGhost += (P.hpShow - P.hpGhost) * ease(2.6, dt);
    if (Math.abs(P.hpShow - h) < 0.35) P.hpShow = h;
  }
}
