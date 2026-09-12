/* The horde: three factions, eighteen troops, and the fact that they hate each
 * other nearly as much as they hate you.
 *
 * Everything here runs on the simulating machine. A joining Helldiver gets the
 * bodies from snapshots and runs only the cosmetic half (the animation clock, the
 * idle noises, the footfalls) locally -- which costs no bandwidth at all and is
 * why a Bile Titan sounds the same on every screen. */
'use strict';
import { rand, randi, clamp, TAU, pick, dist, angLerp, angDiff, segHit } from './util.js';
import { CFG } from './config.js';
import {
  S, nid, spark, blast, puff, decal, eachDiver, nearestDiver, anchorDist,
  falloff, shakeAt, isHost, sim, say, earDist
} from './state.js';
import { SFX, sndAt, A } from './audio.js';
import { worldEv, capeBlast } from './events.js';
import { post } from './outbox.js';
import { TROOPS, TROOP_IDS, FACTIONS, SIZE, PROJ, armorScale } from './data.js';
import {
  resolveCircle, losClear, solidAt, smashCells, damageArea, spawnPoint, CELL, freeSpot
} from './world.js';
import {
  damageEnemy, explode, hurt, spawnEBullet, addBeam, arcChain, HOOKS
} from './combat.js';

/* ============================ SPAWNING ============================ */
export function spawnEnemy(troopId, opts) {
  const T = TROOPS[troopId];
  if (!T) return null;
  opts = opts || {};
  let x = opts.x, y = opts.y;
  if (x === undefined) {
    const anchor = S.players.length
      ? S.players[(Math.random() * S.players.length) | 0] : { x: 0, y: 0 };
    const near = opts.anywhere ? 900 : Math.max(S.W, S.H) * 0.62 + 60;
    const far = opts.anywhere ? S.world : Math.max(S.W, S.H) * 0.62 + 420;
    const p = spawnPoint(anchor.x, anchor.y, near, far);
    x = p.x; y = p.y;
  }
  if (!T.fly) {
    const spot = freeSpot(x, y, T.r);
    x = spot.x; y = spot.y;
  }
  x = clamp(x, -S.world + 30, S.world - 30);
  y = clamp(y, -S.world + 30, S.world - 30);

  const lvT = 1 + (S.hordeLv - 1) * CFG.tough;
  const e = {
    id: ++S.enemyId, tid: troopId, T, fac: T.fac, size: T.size,
    x, y, vx: 0, vy: 0, r: T.r,
    /* Weight lives on the size table, not on the troop -- so it is resolved once,
       here, and stored. Reading `T.mass` at the call site silently found nothing
       and used 1, which is how a Bile Warrior ended up being knocked three
       hundred units down the street by a Liberator. */
    mass: T.mass || SIZE[T.size].mass,
    hp: T.hp * (1 + (lvT - 1) * 0.55), max: T.hp * (1 + (lvT - 1) * 0.55),
    spd: T.spd * (1 + (lvT - 1) * 0.05) * rand(0.94, 1.06),
    face: rand(0, TAU), aim: 0, t: rand(0, 9), wob: rand(0, TAU),
    atk: 0, hit: 0, stun: 0, burn: 0, clang: 0,
    mad: null, madT: 0, tgt: null, retarget: rand(0, 0.35),
    rcd: rand(0.4, 2), shots: 0, burstT: 0,
    cw: 0, chg: 0, rec: 0, cdir: 0, slow: 0, chgCd: rand(2, 7),
    wind: 0, leapCd: rand(1, 4), leaping: 0,
    beamCd: rand(2, 5), beamT: 0, beamWind: 0,
    spawnT: rand(3, 7), spotT: rand(3, 8),
    z: T.fly ? 34 : 0, bob: rand(0, TAU), footT: rand(0, 1), idleT: rand(0.5, 6),
    moved: 0
  };
  e.aim = e.face;
  if (T.lumps) {
    e.lumps = [];
    for (let i = 0; i < 7; i++)
      e.lumps.push({ a: rand(0, TAU), d: rand(6, 20), s: rand(9, 16), ph: rand(0, TAU) });
  }
  S.enemies.push(e);
  return e;
}
export function countOf(pred) {
  let n = 0;
  for (const e of S.enemies) if (pred(e)) n++;
  return n;
}
export function countSize(size) { return countOf(e => e.size === size); }
export function countTroop(id) { return countOf(e => e.tid === id); }

/* ============================ THE GRID ============================
   Rebuilt once a frame. Without it, "which of the other four hundred bodies is
   closest to me" is a quarter of a million distance checks per frame, which is
   most of what made a busy fight drop frames. */
const GRIDSZ = 240;
const grid = new Map();
function gkey(x, y) { return ((x / GRIDSZ) | 0) + ':' + ((y / GRIDSZ) | 0); }
export function rebuildGrid() {
  grid.clear();
  for (const e of S.enemies) {
    if (e.hp <= 0) continue;
    const k = gkey(e.x, e.y);
    let a = grid.get(k);
    if (!a) { a = []; grid.set(k, a); }
    a.push(e);
  }
}
function nearby(x, y, r, fn) {
  const c0 = ((x - r) / GRIDSZ) | 0, c1 = ((x + r) / GRIDSZ) | 0;
  const d0 = ((y - r) / GRIDSZ) | 0, d1 = ((y + r) / GRIDSZ) | 0;
  for (let c = c0; c <= c1; c++) for (let d = d0; d <= d1; d++) {
    const a = grid.get(c + ':' + d);
    if (!a) continue;
    for (let i = 0; i < a.length; i++) fn(a[i]);
  }
}
/* the nearest body of a DIFFERENT faction -- the whole point of the war */
function nearestFoe(e, range) {
  let best = null, bd = range;
  nearby(e.x, e.y, range, o => {
    if (o === e || o.hp <= 0 || o.fac === e.fac) return;
    const d = Math.hypot(o.x - e.x, o.y - e.y);
    if (d < bd) { bd = d; best = o; }
  });
  return best;
}

/* ============================ TARGETING ============================ */
const INFIGHT_RANGE = 460;
function chooseTarget(e) {
  const T = e.T;
  /* something just shot it, and it has not forgotten */
  if (e.madT > 0) {
    const foe = nearestFoe(e, 900);
    if (foe && foe.fac === e.mad) return { x: foe.x, y: foe.y, ref: foe, kind: 'enemy' };
  }
  /* the broadcast is down: nobody remembers what they were here for */
  if (S.mod.confuse > 0) {
    const foe = nearestFoe(e, 1800);
    if (foe) return { x: foe.x, y: foe.y, ref: foe, kind: 'enemy' };
  }
  const nd = nearestDiver(e.x, e.y);
  let best = nd ? nd.d : Infinity;
  let out = nd ? { x: nd.p.x, y: nd.p.y, ref: nd.p, kind: 'diver' } : null;

  /* a turret chewing through them is a more pressing concern than a distant Helldiver */
  for (const s of S.sentries) {
    const d = dist(e, s);
    if (d < best * 0.7) { best = d; out = { x: s.x, y: s.y, ref: s, kind: 'sentry' }; }
  }
  /* and so is the thing from the other faction standing right there */
  if (CFG.infight > 0) {
    const range = INFIGHT_RANGE * (0.5 + CFG.infight);
    const foe = nearestFoe(e, Math.min(range, best));
    if (foe) {
      const d = Math.hypot(foe.x - e.x, foe.y - e.y);
      if (d < best * (0.55 + 0.45 * CFG.infight))
        out = { x: foe.x, y: foe.y, ref: foe, kind: 'enemy' };
    }
  }
  if (!out) {
    /* nothing to do: wander */
    e.wob += rand(-0.4, 0.4);
    out = { x: e.x + Math.cos(e.wob) * 200, y: e.y + Math.sin(e.wob) * 200, ref: null, kind: 'none' };
  }
  return out;
}
function targetAlive(t) {
  if (!t) return false;
  if (t.kind === 'none') return true;
  const r = t.ref;
  if (!r) return false;
  if (t.kind === 'diver') return !r.dead && !r.inPod;
  if (t.kind === 'enemy') return r.hp > 0;
  if (t.kind === 'sentry') return r.hp > 0 && S.sentries.indexOf(r) >= 0;
  return false;
}

/* ============================ DAMAGE OUT ============================ */
function meleeTarget(e, t, dmg, knock) {
  if (!t || !t.ref) return false;
  if (t.kind === 'diver') {
    const P = t.ref;
    if (dist(e, P) >= e.r + P.r + 6) return false;
    hurt(P.stimT > 0 ? dmg * 0.6 : dmg, P, true);
    const a = Math.atan2(P.y - e.y, P.x - e.x);
    P.vx += Math.cos(a) * (knock || 170); P.vy += Math.sin(a) * (knock || 170);
    if (knock > 400) capeBlast(P, e.x, e.y, 110);
    shakeAt(e.x, e.y, e.size === 'large' ? 9 : 6, 0, 1200);
    return true;
  }
  if (t.kind === 'enemy') {
    const o = t.ref;
    if (dist(e, o) >= e.r + o.r + 6) return false;
    damageEnemy(o, dmg * 1.4, (e.T.armor || 0) + 1, e.x, e.y);
    o.mad = e.fac; o.madT = 8;
    const a = Math.atan2(o.y - e.y, o.x - e.x);
    o.vx += Math.cos(a) * (knock || 170) * 0.6; o.vy += Math.sin(a) * (knock || 170) * 0.6;
    return true;
  }
  if (t.kind === 'sentry') {
    const s = t.ref;
    if (dist(e, s) >= e.r + 26) return false;
    s.hp -= dmg;
    return true;
  }
  return false;
}
function fireRanged(e, t) {
  const R = e.T.ranged;
  if (!R || !t) return;
  const tx = t.x, ty = t.y;
  const d = Math.hypot(tx - e.x, ty - e.y);
  if (d > R.range) return;
  if (!e.T.fly && !losClear(e.x, e.y, tx, ty)) return;
  if (e.burstT > 0) return;
  if (e.rcd > 0) return;
  /* lead the target a little, so a moving Helldiver is not automatically safe */
  const lead = t.ref && t.ref.vx !== undefined ? d / R.speed * 0.6 : 0;
  const ax = tx + (t.ref && t.ref.vx ? t.ref.vx * lead : 0);
  const ay = ty + (t.ref && t.ref.vy ? t.ref.vy * lead : 0);
  e.shots = R.burst;
  e.burstT = 0;
  e.aimShot = Math.atan2(ay - e.y, ax - e.x);
  e.rcd = R.cd * rand(0.85, 1.2);
}
function stepBurst(e, dt) {
  const R = e.T.ranged;
  if (!R || e.shots <= 0) return;
  e.burstT -= dt;
  if (e.burstT > 0) return;
  e.burstT = 60 / (R.rpm || 420);
  e.shots--;
  const a = e.aimShot + rand(-R.spread, R.spread);
  const mx = e.x + Math.cos(a) * (e.r + 4), my = e.y + Math.sin(a) * (e.r + 4);
  spawnEBullet({
    x: mx, y: my, vx: Math.cos(a) * R.speed, vy: Math.sin(a) * R.speed,
    dmg: R.dmg, proj: R.proj, fac: e.fac, pool: R.pool,
    life: R.proj === 'flame' ? 0.42 : Math.min(2.2, R.range / R.speed * 1.25)
  });
  e.face = a;
  sndAt(falloff(e.x, e.y, SIZE[e.size].hear), SFX[R.snd] || SFX.autoShot);
}

/* ============================ THE UPDATE ============================ */
export function updateEnemies(dt) {
  rebuildGrid();
  const simulate = sim();
  const infight = CFG.infight;

  for (let q = S.enemies.length - 1; q >= 0; q--) {
    const e = S.enemies[q];
    const T = e.T;
    e.t += dt;
    e.hit -= dt; e.atk -= dt; e.stun -= dt; e.clang -= dt;
    if (e.madT > 0) e.madT -= dt;
    if (T.fly) e.z = 30 + Math.sin(e.t * 2.2 + e.bob) * 7;

    if (!simulate) { cosmeticOnly(e, dt); continue; }

    /* ---- who am I dealing with ---- */
    e.retarget -= dt;
    if (e.retarget <= 0 || !targetAlive(e.tgt)) {
      e.tgt = chooseTarget(e);
      e.retarget = rand(0.3, 0.55);
    } else if (e.tgt.ref) { e.tgt.x = e.tgt.ref.x; e.tgt.y = e.tgt.ref.y; }
    const t = e.tgt;
    const tdist = Math.hypot(t.x - e.x, t.y - e.y);

    /* ---- cooldowns ---- */
    if (e.rcd > 0) e.rcd -= dt;
    if (e.leapCd > 0) e.leapCd -= dt;
    if (e.beamCd > 0) e.beamCd -= dt;
    stepBurst(e, dt);

    /* ---- movement ---- */
    let spd = e.spd;
    let ang = Math.atan2(t.y - e.y, t.x - e.x)
            + Math.sin(e.t * (e.size === 'large' ? 1.2 : 3.1) + e.wob) * (T.shamble ? 0.34 : 0.16);
    if (e.stun > 0) spd = 0;
    if (e.shots > 0 && T.ranged && !T.fly) spd *= 0.35;      /* it plants to shoot */
    if (T.sprint && tdist > 300) spd *= 1.25;

    /* ---- large-body specials ---- */
    if (T.charge) spd = stepCharge(e, t, tdist, dt, spd);
    if (T.slam) spd = stepSlam(e, t, tdist, dt, spd);
    if (T.leap) spd = stepLeap(e, t, tdist, dt, spd);
    if (T.beam) spd = stepBeam(e, t, tdist, dt, spd);
    if (T.spawner) stepSpawner(e, dt);
    if (T.spotter) stepSpotter(e, dt);
    if (e.chg > 0) ang = e.cdir;
    if (e.leaping > 0) ang = e.cdir;

    /* ---- close enough to stop walking into it ---- */
    const wantGap = (t.ref && t.ref.r ? t.ref.r : 12) + e.r;
    if (T.ranged && !T.melee && tdist < T.ranged.range * 0.55 && e.chg <= 0) spd *= 0.15;
    else if (tdist < wantGap && e.chg <= 0 && e.leaping <= 0) spd *= 0.2;

    const wasX = e.x, wasY = e.y;
    if (e.chg > 0 || e.leaping > 0) {
      e.vx = Math.cos(ang) * spd; e.vy = Math.sin(ang) * spd;
      e.x += e.vx * dt; e.y += e.vy * dt;
    } else {
      const k = Math.min(1, dt * (e.size === 'large' ? 1.8 : 3.2));
      e.vx += (Math.cos(ang) * spd - e.vx) * k;
      e.vy += (Math.sin(ang) * spd - e.vy) * k;
      e.x += e.vx * dt; e.y += e.vy * dt;
      const drag = e.stun > 0 ? 0.55 : 0.05;
      e.vx *= Math.pow(drag, dt); e.vy *= Math.pow(drag, dt);
    }
    e.x = clamp(e.x, -S.world, S.world);
    e.y = clamp(e.y, -S.world, S.world);
    if (!T.fly) resolveCircle(e, e.r);
    e.moved = Math.hypot(e.x - wasX, e.y - wasY);
    if (e.moved > 1 && e.chg <= 0 && e.leaping <= 0) e.face = Math.atan2(e.vy, e.vx);
    else if (e.chg > 0 || e.leaping > 0) e.face = e.cdir;
    else if (e.shots > 0) e.face = e.aimShot;

    /* ---- shooting ---- */
    if (T.ranged && e.stun <= 0 && e.chg <= 0) fireRanged(e, t);

    /* ---- something that big does not go around a wall ---- */
    if (T.smash && S.map.city && e.stun <= 0) {
      if (e.chg > 0) {
        if (smashCells(e.x, e.y, e.r + CELL * 0.72)) {
          e.slow = 0;
          shakeAt(e.x, e.y, 7, 0, 1400);
        }
      } else if (e.wind <= 0 && e.moved > 2) {
        damageArea(e.x, e.y, e.r + 16, (e.size === 'large' ? 320 : 210) * dt);
      }
    }

    /* ---- plain contact damage ---- */
    if (T.melee && e.atk <= 0 && e.stun <= 0 && e.wind <= 0 && e.chg <= 0) {
      const dmgNow = T.dmg * (1 + (S.hordeLv - 1) * 0.1 * CFG.tough);
      if (meleeTarget(e, t, dmgNow, T.saw ? 240 : (e.size === 'large' ? 700 : 170))) {
        e.atk = T.atkCd;
        if (T.saw) sndAt(falloff(e.x, e.y, 800), SFX.autoSaw);
      }
    }
    /* ...and the bystanders a charging mass runs over */
    if (e.chg > 0 || e.leaping > 0) trample(e, dt);

    /* ---- heavy footfalls, on the machine that owns them ---- */
    footsteps(e, dt);

    if (e.hp <= 0) { enemyDie(e, q); continue; }
  }

  separation(dt);
  ambience(dt);
}

/* a joining Helldiver runs only the parts you can see and hear */
function cosmeticOnly(e, dt) {
  footsteps(e, dt);
}

/* ---------------------------------------------------------------- specials */
function stepCharge(e, t, tdist, dt, spd) {
  const C = e.T.charge;
  if (e.rec > 0) { e.rec -= dt; return 0; }
  if (e.chg > 0) {
    e.chg -= dt;
    if (e.moved < spd * dt * 0.4) e.slow = (e.slow || 0) + dt; else e.slow = 0;
    if (e.slow > 0.5) { e.chg = 0; e.rec = 1.1; e.slow = 0; }
    if (e.chg <= 0 && e.rec <= 0) e.rec = 0.7;
    for (let d = 0; d < 2; d++)
      spark(e.x + rand(-e.r, e.r), e.y + rand(-e.r, e.r), rand(-60, 60), rand(-60, 60),
            0.3, FACTIONS[e.fac].col2, rand(3, 6));
    /* the hit that ends a charge */
    if (meleeTarget(e, t, e.T.dmg, 900)) {
      worldEv('slam', e.x, e.y);
      e.atk = 1.2; e.chg = 0; e.rec = 1.3;
    }
    return C.speed;
  }
  if (e.cw > 0) {
    e.cw -= dt;
    e.cdir = Math.atan2(t.y - e.y, t.x - e.x);
    if (e.cw <= 0) { e.chg = C.dur; worldEv('charge', e.x, e.y); }
    return 12;
  }
  e.chgCd -= dt;
  if (e.chgCd <= 0 && tdist > C.min && tdist < C.max && e.stun <= 0) {
    e.cw = C.wind; e.chgCd = rand(C.cd * 0.8, C.cd * 1.4);
    worldEv('roar', e.x, e.y);
    return 12;
  }
  return spd;
}
function stepSlam(e, t, tdist, dt, spd) {
  const SL = e.T.slam;
  if (e.wind > 0) {
    e.wind -= dt;
    if (e.wind <= 0) {
      eachDiver(P => {
        if (dist(e, P) >= SL.radius) return;
        hurt(P.stimT > 0 ? SL.dmg * 0.6 : SL.dmg, P, true);
        const a = Math.atan2(P.y - e.y, P.x - e.x);
        P.vx += Math.cos(a) * 640; P.vy += Math.sin(a) * 640;
        capeBlast(P, e.x, e.y, 70);
      });
      for (const s of S.sentries) if (dist(e, s) < SL.radius) s.hp -= 90;
      nearby(e.x, e.y, SL.radius, o => {
        if (o === e || o.fac === e.fac) return;
        if (dist(e, o) < SL.radius) damageEnemy(o, SL.dmg * 1.5, 3, e.x, e.y, true);
      });
      if (S.map.city) damageArea(e.x, e.y, SL.radius, 380);
      worldEv('bigslam', e.x, e.y);
      e.atk = 1.6;
    }
    return e.wind > 0.18 ? 10 : spd * 2.2;
  }
  if (e.chg <= 0 && e.cw <= 0 && e.atk <= 0 && e.stun <= 0 &&
      tdist < SL.radius * 0.75 && t.kind !== 'none') {
    e.wind = SL.wind;
    worldEv('roar', e.x, e.y);
    return 10;
  }
  return spd;
}
function stepLeap(e, t, tdist, dt, spd) {
  const L = e.T.leap;
  if (e.leaping > 0) {
    e.leaping -= dt;
    e.z = Math.max(0, Math.sin((1 - e.leaping / 0.42) * Math.PI) * 30);
    if (meleeTarget(e, t, e.T.dmg * 1.4, 260)) { e.leaping = 0; e.atk = e.T.atkCd; }
    if (e.leaping <= 0) e.z = 0;
    return L.speed;
  }
  if (e.leapCd <= 0 && tdist < L.range && tdist > 90 && e.stun <= 0 && t.kind !== 'none') {
    e.cdir = Math.atan2(t.y - e.y, t.x - e.x);
    e.leaping = 0.42;
    e.leapCd = rand(L.cd * 0.7, L.cd * 1.4);
    sndAt(falloff(e.x, e.y, 700), SFX.termIdleS);
    return L.speed;
  }
  return spd;
}
function stepBeam(e, t, tdist, dt, spd) {
  const B = e.T.beam;
  if (e.beamT > 0) {
    e.beamT -= dt;
    e.face = angLerp(e.face, Math.atan2(t.y - e.y, t.x - e.x), 1 - Math.exp(-2.2 * dt));
    const ex = e.x + Math.cos(e.face) * B.range, ey = e.y + Math.sin(e.face) * B.range;
    /* the beam stops at the first thing it cannot see through */
    let hx = ex, hy = ey;
    if (S.map.city) {
      const steps = 40;
      for (let i = 1; i <= steps; i++) {
        const px = e.x + (ex - e.x) * i / steps, py = e.y + (ey - e.y) * i / steps;
        if (solidAt(px, py)) { hx = px; hy = py; damageArea(px, py, 26, 600 * dt); break; }
      }
    }
    S.beams.push({ x1: e.x, y1: e.y, x2: hx, y2: hy, col: '#5fe0ff',
                   life: 0.06, max: 0.06, jag: 0, w: 6, live: 1 });
    eachDiver(P => {
      if (segHit(e.x, e.y, hx, hy, P.x, P.y, P.r + 6)) hurt(B.dps * dt, P, true);
    });
    nearby((e.x + hx) / 2, (e.y + hy) / 2, B.range, o => {
      if (o === e || o.fac === e.fac || o.hp <= 0) return;
      if (segHit(e.x, e.y, hx, hy, o.x, o.y, o.r)) damageEnemy(o, B.dps * dt, 3, o.x, o.y, true);
    });
    if (e.beamT <= 0) e.beamCd = rand(B.cd * 0.8, B.cd * 1.3);
    return 6;
  }
  if (e.beamWind > 0) {
    e.beamWind -= dt;
    if (e.beamWind <= 0) { e.beamT = B.dur; worldEv('laserhum', e.x, e.y); }
    return 8;
  }
  if (e.beamCd <= 0 && tdist < B.range && e.stun <= 0 && t.kind !== 'none' &&
      (e.T.fly || losClear(e.x, e.y, t.x, t.y))) {
    e.beamWind = B.wind;
    return 8;
  }
  return spd;
}
function stepSpawner(e, dt) {
  const SP = e.T.spawner;
  e.spawnT -= dt;
  if (e.spawnT > 0) return;
  e.spawnT = SP.every * rand(0.8, 1.3);
  if (S.enemies.length > 520) return;
  for (let i = 0; i < SP.n; i++) {
    const a = rand(0, TAU);
    const n = spawnEnemy(SP.id, { x: e.x + Math.cos(a) * (e.r + 22), y: e.y + Math.sin(a) * (e.r + 22) });
    if (n) { n.vx = Math.cos(a) * 180; n.vy = Math.sin(a) * 180; }
  }
  worldEv('deploy', e.x, e.y);
}
function stepSpotter(e, dt) {
  const SP = e.T.spotter;
  e.spotT -= dt;
  if (e.spotT > 0) return;
  e.spotT = SP.every * rand(0.8, 1.4);
  const nd = nearestDiver(e.x, e.y);
  if (!nd || nd.d > 900) return;
  if (S.enemies.length > 520) return;
  worldEv('warp', e.x, e.y);
  for (let i = 0; i < SP.n; i++) {
    const a = rand(0, TAU);
    spawnEnemy(SP.id, { x: e.x + Math.cos(a) * rand(30, 70), y: e.y + Math.sin(a) * rand(30, 70) });
  }
}
function trample(e, dt) {
  nearby(e.x, e.y, e.r + 40, o => {
    if (o === e || o.hp <= 0) return;
    if (SIZE[o.size].i >= SIZE[e.size].i) return;
    if (dist(o, e) > e.r + o.r + 4) return;
    const a = Math.atan2(o.y - e.y, o.x - e.x);
    o.vx += Math.cos(a) * 420; o.vy += Math.sin(a) * 420;
    o.stun = Math.max(o.stun, 0.4);
    damageEnemy(o, 34, 3, o.x, o.y, true);
  });
  /* a charging mass does not trade with a turret, it goes straight over it */
  for (let cs = S.sentries.length - 1; cs >= 0; cs--) {
    const st = S.sentries[cs];
    if (dist(e, st) < e.r + 30) {
      explode(st.x, st.y, 120, 80, 13, '#9ecbff', false, 'sentry');
      S.sentries.splice(cs, 1);
      worldEv('sentrygo', st.x, st.y);
      e.slow = 0;
    }
  }
}

/* ---- a mound this heavy shoulders the swarm aside ---- */
function separation(dt) {
  const list = S.enemies;
  for (let a = 0; a < list.length; a++) {
    const ea = list[a];
    if (ea.T.fly) continue;
    const lim = Math.min(list.length, a + 9);
    for (let b = a + 1; b < lim; b++) {
      const eb = list[b];
      if (eb.T.fly) continue;
      const dx = eb.x - ea.x, dy = eb.y - ea.y, dd = dx * dx + dy * dy, md = ea.r + eb.r;
      if (dd < md * md && dd > 0.01) {
        const dl = Math.sqrt(dd), p = (md - dl) / dl;
        const tot = ea.mass + eb.mass, wa = eb.mass / tot, wb = ea.mass / tot;
        ea.x -= dx * p * wa; ea.y -= dy * p * wa;
        eb.x += dx * p * wb; eb.y += dy * p * wb;
      }
    }
  }
}

/* ============================ NOISE ============================
   Idle chatter and footfalls are generated locally on every machine from the
   bodies it already has. They cost nothing over the wire, and because each
   machine measures the range from its own listener, a Titan four blocks away is
   a distant boom to you and a wall of sound to whoever is standing under it. */
function footsteps(e, dt) {
  if (!SIZE[e.size].foot) return;
  const moving = Math.hypot(e.vx, e.vy);
  if (moving < 20) return;
  e.footT -= dt * (moving / Math.max(40, e.spd));
  if (e.footT > 0) return;
  e.footT = e.T.fly ? 99 : rand(0.48, 0.62);
  const reach = SIZE[e.size].hear;
  if (earDist(e.x, e.y) > reach) return;
  const f = falloff(e.x, e.y, reach);
  sndAt(f, e.fac === 'automaton' ? SFX.autoStomp : SFX.footL);
  if (f > 0.25) shakeAt(e.x, e.y, 3, 0, reach);
  for (let i = 0; i < 4; i++)
    spark(e.x + rand(-e.r, e.r), e.y + e.r * 0.6 + rand(-6, 6),
          rand(-40, 40), rand(-50, -10), rand(0.25, 0.6), '#6a6152', rand(2, 5));
}
let ambT = 0;
function ambience(dt) {
  ambT -= dt;
  if (ambT > 0) return;
  ambT = 0.22;
  if (!S.enemies.length || A.budget < 6) return;
  /* sample a handful rather than walking the whole horde */
  for (let k = 0; k < 6; k++) {
    const e = S.enemies[(Math.random() * S.enemies.length) | 0];
    if (!e || e.hp <= 0) continue;
    const SZ = SIZE[e.size];
    const d = earDist(e.x, e.y);
    if (d > SZ.hear) continue;
    e.idleT -= 0.22 * 6;
    if (e.idleT > 0) continue;
    e.idleT = (e.size === 'large' ? rand(3.5, 8) : e.size === 'medium' ? rand(4, 11) : rand(6, 18));
    const snd = SFX[FACTIONS[e.fac].idle[SZ.i]];
    if (snd) sndAt(falloff(e.x, e.y, SZ.hear), snd);
  }
}

/* ============================ DYING ============================ */
export function enemyDie(e, idx) {
  const T = e.T, F = FACTIONS[e.fac];
  S.kills++;
  const i = idx === undefined ? S.enemies.indexOf(e) : idx;
  if (i >= 0) S.enemies.splice(i, 1);

  if (isHost() && anchorDist(e.x, e.y) < 2600)
    post('kl', Math.round(e.x), Math.round(e.y), TROOP_IDS.indexOf(e.tid));
  playDeath(e.x, e.y, e.tid);

  if (HOOKS.onKill) HOOKS.onKill(e);

  /* ---- what is left behind ---- */
  if (T.bursts) {
    worldEv('burst', e.x, e.y);
    for (let v = 0; v < 4; v++) {
      const a = rand(0, TAU);
      const n = spawnEnemy(T.bursts, { x: e.x + Math.cos(a) * 30, y: e.y + Math.sin(a) * 30 });
      if (n) { n.vx = Math.cos(a) * 260; n.vy = Math.sin(a) * 260; }
    }
  }
  if (T.boss) explode(e.x, e.y, e.r * 4, 220, 26, F.col, true, undefined, 4);
  else if (e.size === 'large') explode(e.x, e.y, e.r * 2.4, 90, 14, F.col, false, undefined, 3);
}
/* the visual half of a death, run on every machine from the kill channel */
export function playDeath(x, y, tidIdx) {
  const tid = typeof tidIdx === 'number' ? TROOP_IDS[tidIdx] : tidIdx;
  const T = TROOPS[tid];
  if (!T) return;
  const F = FACTIONS[T.fac], SZ = SIZE[T.size];
  const f = falloff(x, y, SZ.hear);
  if (f > 0.03 && Math.random() < (T.size === 'small' ? 0.5 : 1)) sndAt(f, SFX[F.die]);
  S.corpses.push({
    x, y, a: rand(0, TAU), life: T.size === 'large' ? 20 : T.size === 'medium' ? 13 : 9,
    c: F.col2, r: T.r, fac: T.fac
  });
  if (T.size !== 'small') decal(x, y, T.r * 1.4, 'rgba(0,0,0,0.3)', 20);
  const n = Math.round((T.size === 'large' ? 40 : T.size === 'medium' ? 20 : 10) * S.quality);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(40, T.size === 'large' ? 420 : 250);
    spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.2, 0.7),
          i % 3 ? F.blood : F.col2, rand(2, 5));
  }
  if (T.fac === 'automaton') {
    for (let i = 0; i < 6; i++) {
      const a = rand(0, TAU);
      spark(x, y, Math.cos(a) * rand(80, 300), Math.sin(a) * rand(80, 300),
            rand(0.2, 0.5), '#ffe9a8', 2);
    }
  }
}
