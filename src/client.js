/* The joining Helldiver's half of the wire.
 *
 * The host owns what is true. This runs prediction for my own body so walking
 * and shooting feel instant, interpolates everything else toward the host's last
 * word, and replays the effect channels so the world sounds and looks the same
 * here as it does there. */
'use strict';
import { rand, clamp, TAU, ease, angLerp, el } from './util.js';
import { CFG, LOADOUT } from './config.js';
import {
  S, setRole, nid, say, spark, blast, decal, diverById, livingDiver, earDist, falloff,
  addShake, stepTimers
} from './state.js';
import { SFX, sndAt, A } from './audio.js';
import { evPlay, capeInit, capeUpdate } from './events.js';
import { NET, netSend, LOBBY } from './net.js';
import {
  STRATS, STRAT_BY_ID, TROOPS, TROOP_IDS, SIZE, SLOTW, SENTRIES, PROJ, OBJECTIVES,
  ANG8, NETCULL, NETNEAR
} from './data.js';
import { buildMap, killCell, restoreCell, resolveCircle } from './world.js';
import { makeDiver, W_, A_ } from './diver.js';
import { playDeath } from './enemies.js';
import {
  updateBullets, updateEBullets, updateBeams, BULLETCOL, PROJIDX, playerHitFx, stimFx
} from './combat.js';
import { updateSentries, updateDrones, updateBeamRuns, updateWreck } from './strat.js';
import { reset, NETIN, keys, mouse, fxStep, myPod } from './sim.js';
import { PICKIDX, WEPIDX, SENIDX, OBJIDX } from './host.js';
import { CODE } from './hud.js';

/* ============================ INTERPOLATION ============================
   The host speaks twelve times a second; these carry a body from where it was
   drawn to where the host says it is, arriving exactly as the next word lands.
   An exponential chase never arrives at all -- it trails by a fraction of the
   gap forever, which is what makes networked movement look syrupy. */
export function lerpTo(o, x, y, z) {
  o.ix = o.x; o.iy = o.y; o.iz = o.z || 0;
  o.tx = x; o.ty = y; o.tz = (z === undefined ? o.z || 0 : z);
  o.lt = 0;
}
export function lerpAt(o, x, y, z) {
  o.x = o.ix = o.tx = x; o.y = o.iy = o.ty = y;
  o.z = o.iz = o.tz = (z === undefined ? 0 : z);
  o.lt = 0;
}
export function lerpStep(o, dt) {
  if (o.lt === undefined) return;
  o.lt += dt;
  const a = NET.snapGap > 0.001 ? clamp(o.lt / NET.snapGap, 0, 1) : 1;
  o.x = o.ix + (o.tx - o.ix) * a;
  o.y = o.iy + (o.ty - o.iy) * a;
  if (o.tz !== undefined) o.z = o.iz + (o.tz - o.iz) * a;
}
/* Match a flat snapshot array against the objects we already have, by id: build
   what is new, update what we know, drop what the host no longer mentions. */
function netKeep(list, map, arr, stride, make, update) {
  const seen = {};
  for (let i = 0; i < arr.length; i += stride) {
    const id = arr[i];
    seen[id] = 1;
    let o = map[id];
    if (!o) { o = make(arr, i); map[id] = o; list.push(o); }
    else update(o, arr, i);
  }
  for (let j = list.length - 1; j >= 0; j--)
    if (!seen[list[j].nid]) { delete map[list[j].nid]; list.splice(j, 1); }
}
const M = { st: {}, pd: {}, bl: {}, nd: {}, dr: {}, pk: {}, ob: {}, en: {} };
export function clearMaps() { for (const k in M) M[k] = {}; }

/* ============================ ARRIVING ============================ */
export function clientCity(m) {
  setRole('client');
  if (m.cfg) for (const k in CFG) if (typeof m.cfg[k] === 'number') CFG[k] = m.cfg[k];
  S.gmMatch = !!m.gm;
  NETIN.roster = (m.rs && m.rs.length) ? m.rs : [{ id: LOBBY.myId, name: 'HELLDIVER', load: LOADOUT.slots.slice() }];
  NETIN.myId = LOBBY.myId;
  NETIN.mapId = m.map; NETIN.seed = m.seed;
  if (CITYHOOK.cfg) CITYHOOK.cfg();
  /* the host sent a seed, not a city: we build the identical one from it */
  buildMap(m.map, m.seed);
  clearMaps();
  reset();
  /* the host owns the pods, so we start standing and let the first snapshot put
     everybody where they actually are */
  for (const P of S.players) P.inPod = false;
  S.hordeLv = m.lv || 1;
  S.livesLeft = m.lives === undefined ? CFG.lives : m.lives;
  if (CITYHOOK.start) CITYHOOK.start();
}
export const CITYHOOK = { cfg: null, start: null };

function clientEnemy(id, tidIdx) {
  const tid = TROOP_IDS[tidIdx] || 'voteless';
  const T = TROOPS[tid];
  const e = {
    id, tid, T, fac: T.fac, size: T.size, x: 0, y: 0, vx: 1, vy: 0, r: T.r,
    mass: T.mass || SIZE[T.size].mass,
    hp: 1, max: 100, face: 0, aim: 0, t: rand(0, 9), wob: rand(0, TAU),
    hit: 0, atk: 0, stun: 0, burn: 0, clang: 0, spd: T.spd,
    wind: 0, cw: 0, chg: 0, rec: 0, cdir: 0, beamT: 0, beamWind: 0,
    z: 0, bob: rand(0, TAU), footT: rand(0, 1), idleT: rand(0.5, 6), moved: 0
  };
  if (T.lumps) {
    e.lumps = [];
    for (let i = 0; i < 7; i++)
      e.lumps.push({ a: rand(0, TAU), d: rand(6, 20), s: rand(9, 16), ph: rand(0, TAU) });
  }
  return e;
}

export function clientSnap(m) {
  /* a snapshot arrives between frames and carries a burst of world events, so it
     gets its own allowance rather than whatever this frame has left */
  A.budget = Math.max(A.budget, 24);
  const now = performance.now();
  NET.snapGap = clamp((now - NET.lastSnap) / 1000, 0.03, 0.4);
  NET.lastSnap = now;

  S.time = m.tm / 10; S.hordeLv = m.lv; S.kills = m.ki; S.nextRebuild = m.rb;
  S.wave = m.wv || 0; S.waveT = m.wt || 0;
  S.livesLeft = m.rf;
  if (m.md) {
    S.mod.confuse = m.md[0]; S.mod.radar = m.md[1];
    S.mod.spore = m.md[2]; S.mod.barrage = m.md[3];
    S.mod.noSpawn = m.md[6] ? { x: m.md[4], y: m.md[5], r: m.md[6] } : null;
    S.mod.uplink = m.md[7] || 0;
  }
  S.wreck = m.wr ? { x: m.wr[0], y: m.wr[1], a: m.wr[2] / 100, t: S.time } : S.wreck;

  /* ---- the squad ---- */
  for (const P of m.ps) {
    let D = diverById(P.i);
    if (!D) {
      D = makeDiver(P.i, 'HELLDIVER');
      D.x = P.x; D.y = P.y; capeInit(D); S.players.push(D);
    }
    D.sx = P.x; D.sy = P.y;
    if (D === S.me) {
      /* only hard-set my own position when I am not predicting, or when the host
         and I have diverged so far that easing back would look worse than a jump */
      if (D.inPod || D.down || S.gameOver || Math.hypot(D.x - P.x, D.y - P.y) > 140) {
        D.x = P.x; D.y = P.y;
      }
    } else {
      if (Math.hypot(D.x - P.x, D.y - P.y) > 450) lerpAt(D, P.x, P.y);
      else lerpTo(D, P.x, P.y);
      D.aim = P.a / 100; D.kick = P.ki / 1000; D.sprint = P.sr;
    }
    const wasDown = D.down;
    D.hp = P.hp; D.wep = P.w;
    if (!D.arsenal[P.w]) D.arsenal[P.w] = { ammo: 0, mags: 0, owned: true };
    D.arsenal[P.w].ammo = P.am; D.arsenal[P.w].mags = P.mg; D.arsenal[P.w].owned = true;
    D.support = P.su || null;
    if (P.su) {
      if (!D.arsenal[P.su]) D.arsenal[P.su] = { ammo: 0, mags: 0, owned: true };
      D.arsenal[P.su].owned = true; D.arsenal[P.su].ammo = P.sa; D.arsenal[P.su].mags = P.sm2;
    }
    D.grenades = P.gr; D.stims = P.sm;
    D.reloading = P.rl / 100; D.guard = P.gd / 100;
    D.waiting = P.wt / 10; D.down = !!P.dn; D.inPod = !!P.ip; D.dead = !!P.dd;
    D.stimT = P.st / 10;
    D.shield = P.sh; D.shieldMax = P.sx;
    D.carrying = P.cy ? 'shell' : null;
    D.burn = P.bu ? 0.5 : 0;
    if (P.ml > 0 && D.melee <= 0) D.melee = P.ml / 100;
    D.uses = P.us || D.uses;
    /* the host owns the deaths, so the news of them arrives with the snapshot */
    if (!wasDown && D.down) {
      if (D === S.me) {
        SFX.siren();
        say(S.livesLeft > 0 ? 'YOU ARE DOWN — WAIT FOR A REINFORCEMENT'
                            : 'YOU ARE DOWN — NO REINFORCEMENTS LEFT', 4);
      } else say((D.name || 'A HELLDIVER') +
        (S.livesLeft > 0 ? ' IS DOWN — CALL THEM IN  ↑↓→←↑' : ' IS DOWN — AND THAT IS THE LAST OF THEM'), 4);
    } else if (wasDown && !D.down && D !== S.me) {
      say((D.name || 'A HELLDIVER') + ' IS COMING BACK', 2.5);
    }
    for (let i = 0; i < P.cd.length && i < D.stt.length; i++) D.stt[i] = P.cd[i] / 10;
    D.armed = P.ar ? STRAT_BY_ID[P.ar] : null;
  }

  /* ---- the horde ---- */
  if (m.e) {
    const seen = {};
    for (let i = 0; i < m.e.length; i += 7) {
      const id = m.e[i];
      seen[id] = 1;
      let e = M.en[id];
      if (!e) {
        e = clientEnemy(id, m.e[i + 1]);
        lerpAt(e, m.e[i + 2], m.e[i + 3]);
        e.face = m.e[i + 4] / ANG8; e.aim = e.face;
        M.en[id] = e; S.enemies.push(e);
      }
      lerpTo(e, m.e[i + 2], m.e[i + 3]);
      e.face = m.e[i + 4] / ANG8;
      e.cdir = e.face;
      e.max = 100; e.hp = m.e[i + 5];
      const w = m.e[i + 6], fl = w & 255;
      e.hit = (fl & 1) ? 0.1 : 0; e.wind = (fl & 2) ? 0.4 : 0; e.cw = (fl & 4) ? 0.4 : 0;
      e.chg = (fl & 8) ? 0.4 : 0; e.rec = (fl & 16) ? 0.4 : 0; e.burn = (fl & 32) ? 0.5 : 0;
      e.beamT = (fl & 64) ? 0.3 : 0; e.beamWind = (fl & 128) ? 0.3 : 0;
      e.zT = ((w >> 8) & 63) * 2;
      e.seenAt = S.time;
    }
    /* Silence from the host means "dead" only for a body it was obliged to
       mention. Past NETNEAR it refreshes the small and medium classes every
       third word, and past the cull radius it stops mentioning them at all --
       so anything out there is dropped on a timer instead, or the edge of the
       screen flickers with things blinking in and out. */
    for (let j = S.enemies.length - 1; j >= 0; j--) {
      const e = S.enemies[j];
      if (seen[e.id]) continue;
      const d = earDist(e.x, e.y);
      const owed = e.size === 'large' ? d < NETCULL.large : d < NETNEAR;
      const stale = S.time - (e.seenAt || 0) > 1.6;
      if (owed || stale) { delete M.en[e.id]; S.enemies.splice(j, 1); }
    }
  }

  /* ---- everything else the host places ---- */
  if (m.s) netKeep(S.sentries, M.st, m.s, 8, (a, i) => {
    const type = SENIDX[a[i + 7]] || 'gatling';
    const o = { nid: a[i], type, D: SENTRIES[type], x: a[i + 1], y: a[i + 2],
                ang: a[i + 3] / 57.2958, aim: a[i + 3] / 57.2958, hp: a[i + 4], max: 100,
                ammo: a[i + 5], maxAmmo: 100, dying: a[i + 6] ? 1 : 0, warm: 0, cool: 0 };
    return o;
  }, (o, a, i) => {
    lerpTo(o, a[i + 1], a[i + 2]);
    o.aim = a[i + 3] / 57.2958;
    o.hp = a[i + 4]; o.ammo = a[i + 5]; o.dying = a[i + 6] ? 1 : 0;
  });

  if (m.pk) netKeep(S.pickups, M.pk, m.pk, 5, (a, i) => ({
    nid: a[i], kind: PICKIDX[a[i + 1]] || 'supply', x: a[i + 2], y: a[i + 3],
    wep: WEPIDX[a[i + 4]] || 'mg43', bob: S.time * 3
  }), (o, a, i) => { o.x = a[i + 2]; o.y = a[i + 3]; });

  if (m.pd) netKeep(S.pods, M.pd, m.pd, 6, (a, i) => {
    const o = { nid: a[i], col: a[i + 4], t: S.time, vz: 0, payload: { kind: 'net', pid: a[i + 5] } };
    lerpAt(o, a[i + 1], a[i + 2], a[i + 3]);
    return o;
  }, (o, a, i) => { lerpTo(o, a[i + 1], a[i + 2], a[i + 3]); o.col = a[i + 4]; });

  if (m.bl) netKeep(S.balls, M.bl, m.bl, 7, (a, i) => {
    const o = { nid: a[i], strat: STRATS[a[i + 4]], landed: !!a[i + 5], call: a[i + 6] / 10,
                spin: 0, vx: 0, vy: 0, vz: 0 };
    lerpAt(o, a[i + 1], a[i + 2], a[i + 3]);
    return o;
  }, (o, a, i) => {
    lerpTo(o, a[i + 1], a[i + 2], a[i + 3]);
    o.strat = STRATS[a[i + 4]]; o.landed = !!a[i + 5]; o.call = a[i + 6] / 10;
  });

  if (m.nd) netKeep(S.nades, M.nd, m.nd, 6, (a, i) => {
    const o = { nid: a[i], fuse: a[i + 4] / 10, spin: 0, sx: 0, sy: 0, tx: 0, ty: 0,
                t: 0, dur: 0.5, mortar: a[i + 5] };
    lerpAt(o, a[i + 1], a[i + 2], a[i + 3]);
    return o;
  }, (o, a, i) => { lerpTo(o, a[i + 1], a[i + 2], a[i + 3]); o.fuse = a[i + 4] / 10; });

  if (m.dr) netKeep(S.drones, M.dr, m.dr, 5, (a, i) => ({
    nid: a[i], x: a[i + 1], y: a[i + 2], ang: a[i + 3] / 57.2958, owner: a[i + 4],
    orbit: 0, cool: 0
  }), (o, a, i) => { lerpTo(o, a[i + 1], a[i + 2]); o.ang = a[i + 3] / 57.2958; });

  if (m.ob) netKeep(S.objectives, M.ob, m.ob, 8, (a, i) => {
    const id = OBJIDX[a[i + 1]] || 'upload';
    const D = OBJECTIVES[id];
    return { nid: a[i], id, D, kind: D.kind, name: D.name, x: a[i + 2], y: a[i + 3],
             prog: a[i + 4] / 10, hp: a[i + 5], max: D.hp || 1, have: a[i + 6],
             need: D.count || 0, active: a[i + 7], radius: D.radius || 30, col: D.col,
             field: D.field || 0, t: 0, spin: 0, armor: D.armor || 0, done: false };
  }, (o, a, i) => {
    o.x = a[i + 2]; o.y = a[i + 3];
    o.prog = a[i + 4] / 10; o.hp = a[i + 5]; o.have = a[i + 6]; o.active = a[i + 7];
  });

  /* ---- the destructible world ---- */
  if (m.ck) for (let i = 0; i < m.ck.length; i += 2) killCell(m.ck[i], m.ck[i + 1], 0, 0, true);
  if (m.ca) for (let i = 0; i < m.ca.length; i += 4)
    restoreCell(m.ca[i], m.ca[i + 1], m.ca[i + 2], m.ca[i + 3]);

  /* ---- the effect channels ---- */
  if (m.ev) for (const EV of m.ev) {
    if (S.me && EV[3] === S.me.id) continue;      /* our own machine already played it */
    evPlay(EV[0], EV[1], EV[2], EV[4]);
  }
  if (m.bs) for (let i = 0; i < m.bs.length; i += 7) {
    S.bullets.push({
      nid: nid(), x: m.bs[i], y: m.bs[i + 1], px: m.bs[i], py: m.bs[i + 1],
      vx: m.bs[i + 2], vy: m.bs[i + 3], life: m.bs[i + 4] / 100, dmg: 0, pen: 1,
      color: BULLETCOL[m.bs[i + 5]] || BULLETCOL[0], size: m.bs[i + 6] / 2, src: null
    });
  }
  if (m.eb) for (let i = 0; i < m.eb.length; i += 6) {
    const p = PROJ[PROJIDX[m.eb[i + 5]]] || PROJ.bolt;
    S.ebullets.push({
      nid: nid(), x: m.eb[i], y: m.eb[i + 1], px: m.eb[i], py: m.eb[i + 1],
      vx: m.eb[i + 2], vy: m.eb[i + 3], life: m.eb[i + 4] / 100, dmg: 0,
      col: p.col, size: p.size, fade: p.fade || 0, pen: p.pen
    });
  }
  if (m.bm) for (const B of m.bm)
    S.beams.push({ x1: B[0], y1: B[1], x2: B[2], y2: B[3], col: B[4],
                   life: B[5] / 100, max: B[5] / 100, jag: B[6], w: B[7] });
  if (m.mk) for (let i = 0; i < m.mk.length; i += 4) {
    S.blasts.push({ x: m.mk[i], y: m.mk[i + 1], r: 0, max: m.mk[i + 2], t: 0,
                    life: 1.6, marker: true, col: m.mk[i + 3] });
    sndAt(falloff(m.mk[i], m.mk[i + 1], 2400), SFX.siren);
  }
  /* on-screen feedback only fires for the body it happened to */
  if (m.pf) for (const PF of m.pf) {
    if (!S.me || (PF[2] !== undefined && PF[2] !== S.me.id)) continue;
    if (PF[0] === 'h') playerHitFx(PF[1]);
    else if (PF[0] === 's') { stimFx(); SFX.stim(); }
    else if (PF[0] === 'm') { say(PF[1], PF[3]); SFX.fail(); }
  }
  /* squadmates' guns, at the volume their distance deserves */
  if (m.sp) for (let i = 0; i < m.sp.length; i += 4) {
    if (S.me && m.sp[i + 3] === S.me.id) continue;   /* I already heard my own */
    const idx = m.sp[i + 2];
    const att = falloff(m.sp[i], m.sp[i + 1], idx === 4 ? 2200 : 1400);
    if (att <= 0.04) continue;
    const W = SLOTW[idx];
    if (W) sndAt(att, SFX.shot, W);
    else if (idx === 8) sndAt(att, SFX.cannon);
    else sndAt(att, SFX.sentry);
  }
  if (m.fx) for (const F of m.fx) {
    blast(F[0], F[1], F[2], F[3], 0.6);
    const fall = clamp(1 - (earDist(F[0], F[1]) - F[2]) / (F[4] ? 3200 : 2000), 0, 1);
    addShake(F[5] * fall);
    sndAt(fall, SFX.boom, F[4] === 1);
    decal(F[0], F[1], F[2] * 0.55, 'rgba(20,14,8,0.45)');
    const n = Math.round(40 * S.quality);
    for (let q = 0; q < n; q++) {
      const aa = rand(0, TAU), sp = rand(60, F[2] * 3);
      spark(F[0], F[1], Math.cos(aa) * sp, Math.sin(aa) * sp, rand(0.25, 0.9),
            q % 3 ? '#ff9d3d' : '#ffe9a8', rand(2, 6));
    }
  }
  if (m.kl) for (let i = 0; i < m.kl.length; i += 3) playDeath(m.kl[i], m.kl[i + 1], m.kl[i + 2]);
  if (m.ob === undefined && S.objectives.length) S.objectives.length = 0;

  if (m.gm) { GMSHADOW.credits = m.gm.c; GMSHADOW.score = m.gm.s; }
  const hadWipe = S.wipeT;
  S.wipeT = m.wp ? m.wp / 10 : 0;
  if (S.wipeT > 0 && hadWipe <= 0) { SFX.siren(); say('SQUAD DOWN — EMERGENCY REDEPLOY', 4); }
  NET.hostPaused = !!m.pz;
  const pb = el('pausedbanner');
  if (pb) pb.style.display = NET.hostPaused ? 'block' : 'none';
}
export const GMSHADOW = { credits: 0, score: 0 };

/* ============================ THE CLIENT FRAME ============================ */
export function updateClient(dt) {
  S.time += dt;
  S.dt = dt;
  if (!S.me && S.players.length) { /* a spectator rides the squad */ }

  /* interpolation */
  for (const e of S.enemies) {
    lerpStep(e, dt);
    if (e.zT !== undefined) e.z += (e.zT - e.z) * ease(8, dt);
    if (e.face !== undefined) {
      e.aim = angLerp(e.aim === undefined ? e.face : e.aim, e.face, ease(11, dt));
      e.vx = Math.cos(e.aim) * 40; e.vy = Math.sin(e.aim) * 40;
      e.cdir = e.aim;
    }
    e.t += dt; e.hit -= dt; e.clang -= dt;
  }
  for (const p of S.pods) lerpStep(p, dt);
  for (const b of S.balls) { lerpStep(b, dt); b.spin += dt * 3; }
  for (const n of S.nades) { lerpStep(n, dt); n.spin += dt * 14; }
  for (const d of S.drones) lerpStep(d, dt);
  updateSentries(dt);
  updateDrones(dt);
  updateBullets(dt);
  updateEBullets(dt);
  updateBeams(dt);
  updateBeamRuns(dt);
  updateWreck(dt);
  stepTimers(dt);

  /* squadmates are the host's to place: carry them to the last word we had */
  for (const SP of S.players) {
    if (SP === S.me) continue;
    lerpStep(SP, dt);
    if (SP.aim !== undefined) SP.ang = angLerp(SP.ang, SP.aim, ease(16, dt));
    if (SP.melee > 0) SP.melee -= dt;
    SP.kick -= SP.kick * ease(9, dt);
    SP.punch -= SP.punch * ease(14, dt);
    capeUpdate(SP, dt);
  }

  mouse.wx = mouse.x - S.W / 2 + S.cam.x;
  mouse.wy = mouse.y - S.H / 2 + S.cam.y;

  /* ---- local prediction for my own body ---- */
  const me = S.me;
  if (me) {
    if (!me.inPod && !me.down && !S.gameOver) {
      let ix = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
      let iy = (keys['s'] ? 1 : 0) - (keys['w'] ? 1 : 0);
      const m2 = Math.hypot(ix, iy) || 1; ix /= m2; iy /= m2;
      const sprint = keys['shift'] && (ix || iy) && !me.carrying;
      const spd = (sprint ? 360 : 230) * (me.stimT > 0 ? 1.25 : 1) * (me.carrying ? 0.62 : 1);
      me.vx += (ix * spd - me.vx) * ease(12, dt);
      me.vy += (iy * spd - me.vy) * ease(12, dt);
      me.x = clamp(me.x + me.vx * dt, -S.world, S.world);
      me.y = clamp(me.y + me.vy * dt, -S.world, S.world);
      resolveCircle(me, me.r);
      /* ease back toward what the host says, rather than obeying it on arrival */
      me.x += (me.sx - me.x) * ease(3.5, dt);
      me.y += (me.sy - me.y) * ease(3.5, dt);
      me.sprint = sprint ? 1 : 0;
    } else { me.vx = 0; me.vy = 0; }
    if (!me.inPod) me.ang = Math.atan2(mouse.wy - me.y, mouse.wx - me.x);

    /* Instant muzzle feedback. The round itself is the host's to create -- this
       is only the flash, the report and the recoil, so the gun does not feel
       like it fires late. */
    me.fxCool -= dt;
    if (mouse.down && !me.inPod && !me.down && !S.gameOver && me.reloading <= 0 && me.fxCool <= 0) {
      const w = W_(me), a = A_(me);
      if (a && (w.infinite || a.ammo > 0) && (w.auto || !me.fireLatch)) {
        me.fxCool = 60 / w.rpm;
        me.fireLatch = true;
        if (w.chain) SFX.arc(); else SFX.shot(w);
        me.kick = clamp(me.kick + (Math.random() < 0.5 ? -1 : 1) * w.kick * rand(0.5, 1.5),
                        -w.kickMax, w.kickMax);
        me.punch = w.punch;
        const fa = me.ang + me.kick;
        S.camKick.x -= Math.cos(fa) * w.punch * 1.5;
        S.camKick.y -= Math.sin(fa) * w.punch * 1.5;
        addShake(w.recoil);
        const fmx = me.x + Math.cos(fa) * 20, fmy = me.y + Math.sin(fa) * 20;
        for (let q = 0; q < 2; q++)
          spark(fmx, fmy, Math.cos(fa) * rand(60, 260) + rand(-70, 70),
                Math.sin(fa) * rand(60, 260) + rand(-70, 70), rand(0.05, 0.14), '#ffe9a8', 2);
      }
    }
    if (!mouse.down) me.fireLatch = false;
    capeUpdate(me, dt);
    if (me.melee > 0) me.melee -= dt;
    me.kick -= me.kick * ease(9, dt);
    me.punch -= me.punch * ease(14, dt);
  }

  /* camera */
  const eye = me || S.players[0];
  if (eye) {
    const lean = eye.down ? 0.6 : 0.16;
    let tx = eye.x + (mouse.wx - eye.x) * lean, ty = eye.y + (mouse.wy - eye.y) * lean;
    if (me && me.inPod) { const p = myPod(); if (p) { tx = p.x; ty = p.y; } }
    if (me && me.down && me.waiting <= 0) {
      const w = livingDiver(me);
      if (w) { tx = w.x; ty = w.y; }
    }
    S.cam.x += (tx - S.cam.x) * ease(6, dt);
    S.cam.y += (ty - S.cam.y) * ease(6, dt);
  }
  S.camKick.x -= S.camKick.x * ease(11, dt);
  S.camKick.y -= S.camKick.y * ease(11, dt);

  for (const b of buildingsFading()) b.collapse = Math.max(0, b.collapse - dt);
  fxStep(dt);

  /* ---- input upstream ---- */
  NET.inAcc += dt;
  if (NET.inAcc >= NET.inRate && me) {
    NET.inAcc = 0;
    const kb = (keys['w'] ? 1 : 0) | (keys['s'] ? 2 : 0) | (keys['a'] ? 4 : 0) |
               (keys['d'] ? 8 : 0) | (keys['shift'] ? 16 : 0) | (mouse.down ? 32 : 0);
    netSend({ t: 'in', ax: Math.round(mouse.wx), ay: Math.round(mouse.wy), k: kb,
              a: NET.actions.length ? NET.actions : undefined });
    NET.actions = [];
  }
  NET.pingAt += dt;
  if (NET.pingAt > 2) { NET.pingAt = 0; netSend({ t: 'pp', s: performance.now() }); }
}
import { buildings } from './world.js';
function buildingsFading() { return buildings.filter(b => b.collapse > 0); }

/* ---- what a client does with its own keyboard ---- */
export function clientCode(key, list) {
  CODE.typed.push(key);
  const t = CODE.typed.join('');
  const pre = [];
  for (const s of list)
    if (s.code.join('').indexOf(t) === 0) pre.push(s);
  if (!pre.length) { CODE.typed = []; SFX.fail(); return; }
  SFX.beep(CODE.typed.length);
  for (const s of pre) {
    if (s.code.length === CODE.typed.length) {
      if (S.me && S.me.stt[STRATS.indexOf(s)] <= 0) {
        S.me.armed = s; SFX.arm();
        netSend({ t: 'in', ax: Math.round(mouse.wx), ay: Math.round(mouse.wy), k: 0, a: ['S:' + s.id] });
      } else SFX.fail();
      CODE.typed = []; CODE.active = false;
      return;
    }
  }
}
