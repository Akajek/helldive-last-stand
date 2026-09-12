/* Stratagems: the ball, the wait, and whatever arrives.
 *
 * Nothing here uses setTimeout any more. Delayed payloads run on the simulation
 * clock through later(), so they stop when the mission pauses, die when it ends,
 * and cannot fire into a world that has already been rebuilt. */
'use strict';
import { rand, clamp, TAU, dist, ease, angLerp } from './util.js';
import {
  S, nid, spark, blast, puff, decal, say, eachDiver, diverById, nearestDiver, isHost,
  sim, amGM, later, addShake, falloff, isSquad, anyDown
} from './state.js';
import { SFX, sndAt } from './audio.js';
import { worldEv, capeInit } from './events.js';
import { post, postArr } from './outbox.js';
import { STRATS, STRAT_BY_ID, SENTRIES, WEAPONS, SIZE } from './data.js';
import {
  freeSpot, solidAt, damageArea, collapseNear, losClear, inCave, nearestMouth, mouthIndex
} from './world.js';
import {
  explode, hurt, damageEnemy, spawnBullet, arcChain, addBeam, die, BULLETCOL
} from './combat.js';
import { refit, REINFORCE } from './diver.js';
import { enemyDie } from './enemies.js';

/* ============================ JAMMING ============================
   Underground there is no sky to call through, and a Jammer throws the same
   shadow above ground. A blocked call is refused before the ball leaves your
   hand, so you keep the stratagem instead of losing it into a dead zone. */
export function jammedAt(x, y, s) {
  if (!s) return false;
  if (s.kind === 'reinforce') return false;        /* they walk in; see reinforceAt */
  for (const o of S.objectives)
    if (o.field && o.hp > 0 && Math.hypot(o.x - x, o.y - y) < o.field) return 'JAMMED';
  /* Underground NOTHING gets through -- not a pod, not an orbital shell, and not
     an Eagle, which would have to fly through several hundred metres of rock.
     Breaking a jammer punches a hole in the interference and buys a window. */
  if (inCave(x, y) && S.mod.uplink <= 0) return 'NO SKY — BREAK A JAMMER';
  return false;
}

/* ============================ THROWING ============================ */
export function throwStratagem(P, tx, ty) {
  const armed = P.armed;
  if (!S.running || !armed || P.inPod || P.dead) return;
  if (armed.kind === 'reinforce') {
    if (S.livesLeft <= 0) { refuse(P, 'NO REINFORCEMENTS LEFT'); return; }
    if (!anyDown()) { refuse(P, 'NOBODY IS DOWN'); return; }
  }
  if (armed.uses !== undefined) {
    P.uses = P.uses || {};
    if ((P.uses[armed.id] || 0) >= armed.uses) { refuse(P, 'NONE LEFT'); return; }
  }
  const jam = jammedAt(tx, ty, armed);
  if (jam) { refuse(P, jam); return; }

  const a = Math.atan2(ty - P.y, tx - P.x);
  const d = Math.min(700, Math.hypot(tx - P.x, ty - P.y));
  const flight = clamp(d / 560, 0.45, 1.05);
  S.balls.push({
    nid: nid(), who: P.id, x: P.x, y: P.y,
    vx: Math.cos(a) * d / flight, vy: Math.sin(a) * d / flight,
    z: 16, vz: 300 * flight, spin: 0, rest: 0, beep: 0, call: 0,
    landed: false, strat: armed, dir: a
  });
  P.stt[STRATS.indexOf(armed)] = armed.cd;
  if (armed.uses !== undefined) { P.uses = P.uses || {}; P.uses[armed.id] = (P.uses[armed.id] || 0) + 1; }
  P.armed = null;
  P.cool = 0.35;
  worldEv('throwb', P.x, P.y);
}
function refuse(P, txt) {
  if (P === S.me) { SFX.fail(); say(txt, 2.5); }
  else if (isHost()) postArr('pf', ['m', txt, P.id, 2.5]);
  else if (amGM()) say(txt, 2);
}

/* ============================ ARRIVAL ============================ */
export function callIn(b) {
  const s = b.strat, x = b.x, y = b.y, who = b.who;
  switch (s.kind) {
    case 'eagle500':
      markTarget(x, y, 270, '#ff6b3d');
      later(1.5, () => explode(x, y, 290, 950, 28, '#ff6b3d', true, who, 4));
      break;
    case 'eagleair': {
      markTarget(x, y, 200, '#ff8a3d');
      const a = b.dir === undefined ? 0 : b.dir;
      for (let i = 0; i < 5; i++) {
        const px = x + Math.cos(a) * (i - 2) * 105, py = y + Math.sin(a) * (i - 2) * 105;
        later(1.2 + i * 0.16, () => explode(px, py, 150, 420, 16, '#ff8a3d', false, who, 3));
      }
      break;
    }
    case 'eaglecluster': {
      markTarget(x, y, 300, '#ffb347');
      for (let i = 0; i < 14; i++) {
        const aa = rand(0, TAU), dd = rand(0, 280);
        const px = x + Math.cos(aa) * dd, py = y + Math.sin(aa) * dd;
        later(1.2 + i * 0.055, () => explode(px, py, 92, 130, 8, '#ffd06b', false, who, 1));
      }
      break;
    }
    case 'orbprecision':
      markTarget(x, y, 150, '#9ecbff');
      worldEv('siren', x, y);
      later(1.1, () => {
        addBeam(x, y - 1400, x, y, '#9ecbff', 0.25, 0, 16);
        explode(x, y, 200, 720, 24, '#9ecbff', true, who, 4);
      });
      break;
    case 'orbrail': {
      /* picks its own target: the largest thing standing near the beacon */
      let best = null, bs = -1;
      for (const e of S.enemies) {
        if (Math.hypot(e.x - x, e.y - y) > 620) continue;
        const score = SIZE[e.size].i * 10000 + e.max;
        if (score > bs) { bs = score; best = e; }
      }
      const tx = best ? best.x : x, ty = best ? best.y : y;
      markTarget(tx, ty, 90, '#c6a6ff');
      later(1.2, () => {
        worldEv('railcannon', tx, ty);
        addBeam(tx, ty - 1600, tx, ty, '#c6a6ff', 0.35, 0, 22);
        if (best && best.hp > 0) damageEnemy(best, 6000, 4, tx, ty, true);
        explode(tx, ty, 180, 900, 22, '#c6a6ff', true, who, 4);
      });
      break;
    }
    case 'orblaser':
      S.beamRuns.push({ nid: nid(), x, y, px: x, py: y, t: 0, dur: 8,
                        ang: rand(0, TAU), who, r: 240 });
      worldEv('siren', x, y);
      break;
    case 'orbbarrage':
      for (let i = 0; i < 20; i++) {
        const aa = rand(0, TAU), dd = rand(0, 420);
        const px = x + Math.cos(aa) * dd, py = y + Math.sin(aa) * dd;
        later(0.4 + i * 0.55, () => explode(px, py, 170, 420, 18, '#ff9d3d', true, who, 4));
      }
      markTarget(x, y, 430, '#ff9d3d');
      break;
    case 'reinforce': {
      /* longest wait comes down first -- the squad does not play favourites */
      let first = null;
      for (const P of S.players) {
        if (!P.down || P.dead) continue;
        if (!first || P.downAt < first.downAt) first = P;
      }
      if (first) reinforceAt(x, y, first);
      else puff(x, y, '#4fb477');
      break;
    }
    case 'liberty':
      worldEv('liberty', x, y);
      dropPod(x, y, { kind: 'liberty', who });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + rand(0, 1);
        const px = x + Math.cos(a) * rand(90, 180), py = y + Math.sin(a) * rand(90, 180);
        later(0.25 + i * 0.26, () => dropPod(px, py, { kind: 'supply' }));
      }
      break;
    case 'destroyer':
      superDestroyer(x, y, who);
      break;
    default:
      dropPod(x, y, { kind: s.kind, strat: s.id, who });
  }
}
function markTarget(x, y, r, col) {
  S.blasts.push({ x, y, r: 0, max: r, t: 0, life: 1.6, marker: true, col });
  if (isHost()) post('mk', Math.round(x), Math.round(y), Math.round(r), col);
  sndAt(falloff(x, y, 2400), SFX.siren);
}

/* ============================ REINFORCEMENT ============================ */
export function reinforceAt(x, y, who) {
  const P = who;
  if (!P || !P.down) return;
  if (S.livesLeft <= 0) return;
  S.livesLeft--;
  P.down = false; P.waiting = 0; P.dead = false;
  /* underground there is nothing to drop through, so they come in on foot from
     the nearest chamber the hive has not sealed */
  /* a pod cannot reach you through a hillside, so a Helldiver called into a
     cave walks in from the nearest mouth instead */
  if (inCave(x, y)) {
    const m = nearestMouth(x, y) || { x: 0, y: 0 };
    const spot = freeSpot(m.x, m.y, 22);
    P.inPod = false; P.x = spot.x; P.y = spot.y; P.vx = 0; P.vy = 0;
    P.guard = 2.5;
    refit(P);
    capeInit(P);
    worldEv('deploy', P.x, P.y);
    say(isSquad() ? ((P.name || 'A HELLDIVER') + ' IS COMING IN ON FOOT — MOUTH ' +
                     (1 + mouthIndex(m))) : 'COMING IN ON FOOT', 2.5);
    return;
  }
  const spot = freeSpot(clamp(x, -S.world + 40, S.world - 40), clamp(y, -S.world + 40, S.world - 40), 22);
  dropPod(spot.x, spot.y, { kind: 'player', fresh: true, pid: P.id });
  say(isSquad() ? ((P.name || 'A HELLDIVER') + ' IS COMING BACK') : 'REINFORCEMENT INBOUND', 2.5);
}
REINFORCE.fn = reinforceAt;

/* ============================ HELLPODS ============================ */
const POD_COL = {
  player: '#ffd21e', sentry: '#7fd4ff', support: '#ffd06b', supply: '#ffd21e',
  liberty: '#ffffff', shield: '#7fd4ff', guarddog: '#c6ff6b', requisition: '#9fe8ff'
};
export function dropPod(x, y, payload) {
  S.pods.push({
    nid: nid(), x, y, z: 1500, vz: 0, payload, t: 0,
    col: POD_COL[payload.kind] || '#ffd21e'
  });
  worldEv('incoming', x, y);
}
export function podLand(p) {
  const x = p.x, y = p.y, pay = p.payload || {}, k = pay.kind;
  worldEv('impact', x, y);

  if (sim()) {
    /* a pod does not care whose head it lands on */
    if (k !== 'player' && !S.gameOver) eachDiver(P => {
      const d = Math.hypot(P.x - x, P.y - y);
      if (d < 46) { worldEv('crush', P.x, P.y); hurt(999, P); }
      else if (d < 190) {
        const fall = 1 - (d - 46) / 144;
        hurt((P.stimT > 0 ? 26 : 42) * fall + 6, P);
        const ka = Math.atan2(P.y - y, P.x - x);
        P.vx += Math.cos(ka) * 720 * fall; P.vy += Math.sin(ka) * 720 * fall;
      }
    });
    /* anything under a pod at terminal velocity is simply gone */
    for (let i = S.enemies.length - 1; i >= 0; i--) {
      const e = S.enemies[i], d = dist(e, p);
      if (d < 78 + e.r * 0.5 && !e.T.boss) { e.hp = -1; enemyDie(e, i); continue; }
      if (d < 250) {
        const a = Math.atan2(e.y - y, e.x - x), fall = 1 - (d - 78) / 172;
        const kb = (620 + 520 * fall) / Math.sqrt(e.mass || 1);
        e.vx += Math.cos(a) * kb; e.vy += Math.sin(a) * kb;
        damageEnemy(e, 180 * fall + 40, 4, e.x, e.y, true);
        if (!e.T.boss) e.stun = Math.max(e.stun, 0.5 + 0.7 * fall);
        e.atk = Math.max(e.atk, 1.4);
        e.wind = 0;
        if (e.hp <= 0) enemyDie(e, i);
      }
    }
  }
  const n = Math.round(46 * S.quality);
  for (let q = 0; q < n; q++) {
    const aa = rand(0, TAU), sp = rand(80, 620);
    spark(x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, rand(0.3, 0.9),
          q % 3 ? '#c8c0a8' : '#ffe9a8', rand(2, 5));
  }
  blast(x, y, 150, '#d8cfae', 0.45);
  decal(x, y, 60, 'rgba(20,16,10,0.42)');
  if (S.map.city) damageArea(x, y, 86, 220);
  if (!sim()) return;                 /* the rest is the host's to decide */

  switch (k) {
    case 'player': {
      const P = diverById(pay.pid) || S.me || S.players[0];
      if (!P) break;
      P.x = x; P.y = y; P.vx = 0; P.vy = 0;
      P.inPod = false;
      P.guard = 2.0;
      capeInit(P);
      if (pay.fresh) refit(P);
      break;
    }
    case 'sentry':
      placeSentry(x, y, STRAT_BY_ID[pay.strat] ? STRAT_BY_ID[pay.strat].sentry : 'gatling', pay.who);
      break;
    case 'support': {
      const s = STRAT_BY_ID[pay.strat];
      const w = s ? s.wep : 'mg43';
      S.pickups.push({ nid: nid(), kind: 'weapon', wep: w, x, y, bob: rand(0, 6),
                       ammo: WEAPONS[w].mag, mags: WEAPONS[w].mags });
      puff(x, y, '#c6ff6b');
      break;
    }
    case 'shield': {
      const P = nearestDiver(x, y);
      S.pickups.push({ nid: nid(), kind: 'shield', x, y, bob: rand(0, 6) });
      puff(x, y, '#7fd4ff');
      break;
    }
    case 'guarddog':
      S.pickups.push({ nid: nid(), kind: 'dog', x, y, bob: rand(0, 6) });
      puff(x, y, '#c6ff6b');
      break;
    case 'requisition':
      S.pickups.push({ nid: nid(), kind: 'requisition', x, y, bob: rand(0, 6) });
      puff(x, y, '#9fe8ff');
      break;
    case 'liberty':
      /* This line is what used to take the whole game down. `b` did not exist
         here, the ReferenceError aborted the frame before the pod was removed
         from the list, and the next frame threw again -- forever. */
      explode(x, y, 260, 300, 24, '#ffffff', true, pay.who, 4);
      for (let lb = 0; lb < 3; lb++) {
        const la = rand(0, TAU);
        S.pickups.push({ nid: nid(), kind: 'supply', x: x + Math.cos(la) * 42,
                         y: y + Math.sin(la) * 42, bob: rand(0, 6) });
      }
      S.pickups.push({ nid: nid(), kind: 'weapon', wep: 'bulletstorm', x: x + rand(-50, 50),
                       y: y + rand(-50, 50), bob: rand(0, 6),
                       ammo: WEAPONS.bulletstorm.mag, mags: 0 });
      for (const P of S.players)
        for (let lc = 0; lc < STRATS.length; lc++) if (!STRATS[lc].hidden) P.stt[lc] = 0;
      puff(x, y, '#ffffff');
      break;
    default:
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.6;
        S.pickups.push({ nid: nid(), kind: 'supply', x: x + Math.cos(a) * 36,
                         y: y + Math.sin(a) * 36, bob: rand(0, 6) });
      }
      puff(x, y, '#ffd21e');
  }
}
export function placeSentry(x, y, type, who) {
  const D = SENTRIES[type] || SENTRIES.gatling;
  S.sentries.push({
    nid: nid(), type, D, x, y, hp: D.hp, max: D.hp, ang: rand(0, TAU), aim: 0,
    cool: 0, ammo: D.ammo, maxAmmo: D.ammo, warm: 1.5, dying: 0, who: who === undefined ? -1 : who
  });
  worldEv('deploy', x, y);
}

/* ============================ SENTRIES ============================ */
export function updateSentries(dt) {
  const simulate = sim();
  for (let s = S.sentries.length - 1; s >= 0; s--) {
    const st = S.sentries[s], D = st.D || SENTRIES.gatling;
    st.warm -= dt; st.cool -= dt;
    if (st.dying > 0) {
      st.dying -= dt;
      if (st.dying <= 0) { puff(st.x, st.y, D.col); S.sentries.splice(s, 1); }
      continue;
    }
    if (!simulate) {
      if (st.aim !== undefined) st.ang = angLerp(st.ang, st.aim, ease(14, dt));
      continue;
    }
    /* find something to shoot: nearest first, but only if it can see it */
    let tgt = null;
    const cand = [];
    for (const e of S.enemies) {
      const dv = dist(e, st);
      if (dv < D.range && (!D.min || dv > D.min)) cand.push([dv, e]);
    }
    cand.sort((a, b) => D.lob ? b[0] - a[0] : a[0] - b[0]);
    for (let c = 0; c < cand.length && c < 8; c++) {
      if (D.lob || losClear(st.x, st.y, cand[c][1].x, cand[c][1].y)) { tgt = cand[c][1]; break; }
    }
    if (D.arc) {
      /* a Tesla tower does not aim; it waits */
      st.ang += dt * 2.4;
      if (tgt && st.warm <= 0 && st.cool <= 0) {
        st.cool = 60 / D.rpm; st.ammo--;
        worldEv('teslazap', st.x, st.y);
        arcChain(st.x, st.y, D.dmg, D.pen, D.range, 4, 0.78, st.who, D.col);
      }
    } else if (tgt) {
      const want = Math.atan2(tgt.y - st.y, tgt.x - st.x);
      const diff = ((want - st.ang + Math.PI * 3) % TAU) - Math.PI;
      st.ang += clamp(diff, -D.spin * dt, D.spin * dt);
      if (st.warm <= 0 && st.cool <= 0 && Math.abs(diff) < 0.2 && st.ammo > 0) {
        st.cool = 60 / D.rpm; st.ammo--;
        const sa = st.ang + rand(-0.05, 0.05);
        const mx = st.x + Math.cos(sa) * 26, my = st.y + Math.sin(sa) * 26;
        if (D.lob) {
          /* a mortar throws its shell over everything and lands it late */
          const flight = clamp(dist(tgt, st) / 700, 0.7, 2.0);
          const tx = tgt.x + rand(-40, 40), ty = tgt.y + rand(-40, 40);
          S.nades.push({ nid: nid(), who: 'sentry', sx: st.x, sy: st.y, x: st.x, y: st.y,
                         tx, ty, t: 0, dur: flight, z: 0, fuse: flight, spin: 0,
                         blast: D.blast, mortar: 1 });
          worldEv('mortarfire', st.x, st.y);
        } else {
          spawnBullet({
            x: mx, y: my, vx: Math.cos(sa) * D.spd, vy: Math.sin(sa) * D.spd,
            life: D.range / D.spd, dmg: D.dmg, pen: D.pen, color: D.col, size: D.size || 3,
            src: 'sentry', who: -1, rocket: D.blast || null, ci: BULLETCOL.indexOf(D.col)
          });
          sndAt(falloff(st.x, st.y, 1400), SFX[D.snd] || SFX.sentry);
          if (isHost()) post('sp', Math.round(st.x), Math.round(st.y),
                             D.snd === 'cannon' ? 8 : 0, -1);
        }
      }
    }
    if (st.hp <= 0) {
      explode(st.x, st.y, 110, 70, 10, D.col, false, 'sentry');
      S.sentries.splice(s, 1);
    } else if (st.ammo <= 0 && st.dying <= 0) {
      st.dying = 1.1; worldEv('dry', st.x, st.y);
    }
  }
}

/* ============================ GUARD DOG ============================ */
export function updateDrones(dt) {
  for (let i = S.drones.length - 1; i >= 0; i--) {
    const d = S.drones[i];
    const P = diverById(d.owner);
    if (!P || P.dead) { S.drones.splice(i, 1); continue; }
    d.orbit += dt * 2.2;
    const tx = P.x + Math.cos(d.orbit) * 44, ty = P.y + Math.sin(d.orbit) * 44;
    d.x += (tx - d.x) * ease(8, dt);
    d.y += (ty - d.y) * ease(8, dt);
    d.cool -= dt;
    if (!sim() || P.inPod || P.down) continue;
    let best = null, bd = 520;
    for (const e of S.enemies) {
      const dd = dist(e, d);
      if (dd < bd && losClear(d.x, d.y, e.x, e.y)) { bd = dd; best = e; }
    }
    if (!best) continue;
    d.ang = angLerp(d.ang, Math.atan2(best.y - d.y, best.x - d.x), ease(10, dt));
    if (d.cool > 0) continue;
    d.cool = 60 / 520;
    const a = d.ang + rand(-0.06, 0.06);
    spawnBullet({
      x: d.x + Math.cos(a) * 12, y: d.y + Math.sin(a) * 12,
      vx: Math.cos(a) * 1300, vy: Math.sin(a) * 1300, life: 0.5,
      dmg: 14, pen: 1, color: '#c6ff6b', size: 2.6, src: 'sentry', who: -1,
      ci: BULLETCOL.indexOf('#c6ff6b')
    });
    sndAt(falloff(d.x, d.y, 900), SFX.sentry);
  }
}

/* ============================ THE ORBITAL LASER ============================ */
export function updateBeamRuns(dt) {
  for (let i = S.beamRuns.length - 1; i >= 0; i--) {
    const B = S.beamRuns[i];
    B.t += dt;
    /* Where the cutting head wants to be. It used to walk a fixed spiral, which
       meant it drew circles in an empty street while the horde stood ten metres
       away and watched -- so it looks for the biggest thing near the beacon and
       walks over to it, sweeping as it goes. The host decides; a joining
       Helldiver is told where the head is, because working it out locally from a
       horde that has been culled around them would put the beam somewhere else
       on their screen. */
    let px = B.px === undefined ? B.x : B.px, py = B.py === undefined ? B.y : B.py;
    if (sim()) {
      B.hunt -= dt;
      if (!B.tgt || B.tgt.hp <= 0 || B.hunt <= 0 ||
          Math.hypot(B.tgt.x - B.x, B.tgt.y - B.y) > B.r * 2.4) {
        B.hunt = 0.6;
        B.tgt = pickBeamTarget(B);
      }
      B.ang += dt * 1.5;
      let wx, wy;
      if (B.tgt) { wx = B.tgt.x; wy = B.tgt.y; }
      else {
        /* nothing left standing: fall back to sweeping the beacon */
        const rr = B.r * (0.25 + 0.75 * Math.abs(Math.sin(B.t * 0.6)));
        wx = B.x + Math.cos(B.ang) * rr; wy = B.y + Math.sin(B.ang) * rr;
      }
      /* it tracks at a finite speed -- a target further than the beam can walk
         to simply gets away with it */
      const dx = wx - px, dy = wy - py, dd = Math.hypot(dx, dy);
      const step = 520 * dt;
      if (dd > step) { px += dx / dd * step; py += dy / dd * step; }
      else { px = wx; py = wy; }
      B.px = px; B.py = py;
    }
    S.beams.push({ x1: px, y1: py - 1500, x2: px, y2: py, col: '#ff4d6b',
                   life: 0.06, max: 0.06, jag: 0, w: 20, live: 1 });
    blast(px, py, 70, '#ff4d6b', 0.18);
    if (sim()) {
      for (let e = S.enemies.length - 1; e >= 0; e--) {
        const en = S.enemies[e];
        if (Math.hypot(en.x - px, en.y - py) > 72 + en.r) continue;
        damageEnemy(en, 1400 * dt, 4, en.x, en.y, true);
        if (en.hp <= 0) enemyDie(en, e);
      }
      eachDiver(P => {
        if (Math.hypot(P.x - px, P.y - py) < 72 + P.r) hurt(260 * dt, P);
      });
      if (S.map.city) damageArea(px, py, 74, 900 * dt);
    }
    if (Math.random() < dt * 30) sndAt(falloff(px, py, 2400), SFX.laserHum);
    addShake(falloff(px, py, 1800) * 5);
    if (sim() && B.t >= B.dur) S.beamRuns.splice(i, 1);
  }
}
/* the largest thing in range of the beacon, because that is what the Helldiver
   who threw it was hoping for */
function pickBeamTarget(B) {
  let best = null, bs = -1;
  for (const e of S.enemies) {
    const d = Math.hypot(e.x - B.x, e.y - B.y);
    if (d > B.r * 2.2) continue;
    /* size first, then nearness to the head, so it does not ping-pong across
       the crater between two equals */
    const score = SIZE[e.size].i * 4000 + e.max * 0.5
                - Math.hypot(e.x - B.px, e.y - B.py) * 1.5;
    if (score > bs) { bs = score; best = e; }
  }
  return best;
}

/* ============================ THE SUPER DESTROYER ============================
   The one that is not on any list. Eight seconds of warning, then eighty
   thousand tonnes of Super Earth arrives and the map is a different shape. */
export function superDestroyer(x, y, who) {
  worldEv('shipWarn', x, y);
  say('*** SUPER DESTROYER INBOUND — RUN ***', 5);
  S.shipTarget = { x, y, t: 0 };
  later(3.4, () => {
    worldEv('shipFall', x, y);
  });
  later(6.4, () => {
    worldEv('shipHit', x, y);
    /* the crater itself */
    for (let ring = 0; ring < 7; ring++) {
      const r = 220 + ring * 180;
      const n = 6 + ring * 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + ring;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        later(ring * 0.11, () => explode(px, py, 320, 900, 30, ring < 3 ? '#ffffff' : '#ff8a3d',
                                         true, undefined, 4));
      }
    }
    if (sim()) {
      /* nothing inside survives, and that includes you */
      for (let e = S.enemies.length - 1; e >= 0; e--) {
        const en = S.enemies[e];
        if (Math.hypot(en.x - x, en.y - y) < 1500) { en.hp = -1; enemyDie(en, e); }
      }
      eachDiver(P => {
        const d = Math.hypot(P.x - x, P.y - y);
        if (d < 900) hurt(9999, P);
        else if (d < 1700) {
          hurt(60 * (1 - (d - 900) / 800), P);
          const a = Math.atan2(P.y - y, P.x - x);
          P.vx += Math.cos(a) * 1400; P.vy += Math.sin(a) * 1400;
        }
      });
      for (let s = S.sentries.length - 1; s >= 0; s--)
        if (dist(S.sentries[s], { x, y }) < 1400) S.sentries.splice(s, 1);
      if (S.map.city) {
        collapseNear(x, y, 1450);
        damageArea(x, y, 900, 4000);
      }
    }
    S.wreck = { x, y, t: 0, a: rand(0, TAU) };
    S.shipTarget = null;
    decal(x, y, 520, 'rgba(30,14,6,0.6)', 9999);
  });
}
/* the burning hull, and the fire that never quite goes out */
export function updateWreck(dt) {
  if (!S.wreck) return;
  S.wreck.t += dt;
  if (Math.random() < dt * 26) {
    const a = rand(0, TAU), d = rand(0, 300);
    spark(S.wreck.x + Math.cos(a) * d, S.wreck.y + Math.sin(a) * d,
          rand(-30, 30), rand(-150, -50), rand(0.6, 1.8),
          Math.random() < 0.5 ? '#ff8a3d' : '#4a4a52', rand(3, 9));
  }
  if (Math.random() < dt * 1.2) sndAt(falloff(S.wreck.x, S.wreck.y, 2200), SFX.flame);
}

/* ============================ IN FLIGHT ============================ */
export function updateBalls(dt) {
  for (let bn = S.balls.length - 1; bn >= 0; bn--) {
    const bc = S.balls[bn];
    const ox = bc.x, oy = bc.y;
    bc.x += bc.vx * dt; bc.y += bc.vy * dt;
    if (S.map.city && bc.z < 70 && solidAt(bc.x, bc.y)) {
      if (!solidAt(ox, bc.y)) { bc.vx *= -0.55; bc.x = ox; }
      else if (!solidAt(bc.x, oy)) { bc.vy *= -0.55; bc.y = oy; }
      else { bc.vx *= -0.55; bc.vy *= -0.55; bc.x = ox; bc.y = oy; }
      worldEv('bounce', bc.x, bc.y);
    }
    bc.spin += Math.hypot(bc.vx, bc.vy) * dt * 0.06;
    bc.vz -= 1500 * dt; bc.z += bc.vz * dt;
    if (bc.z <= 0) {
      bc.z = 0;
      if (bc.vz < -60) {
        bc.vz *= -0.42; bc.vx *= 0.62; bc.vy *= 0.62;
        worldEv('bounce', bc.x, bc.y);
        for (let bp = 0; bp < 5; bp++) {
          const ba = rand(0, TAU);
          spark(bc.x, bc.y, Math.cos(ba) * rand(20, 90), Math.sin(ba) * rand(20, 90),
                0.25, '#9a9480', 2);
        }
      } else {
        bc.vz = 0;
        bc.vx *= Math.pow(0.02, dt); bc.vy *= Math.pow(0.02, dt);
      }
    }
    if (!bc.landed && bc.z === 0 && Math.hypot(bc.vx, bc.vy) < 28) {
      bc.landed = true; bc.call = bc.strat.callIn; bc.vx = 0; bc.vy = 0;
    }
    bc.x = clamp(bc.x, -S.world, S.world); bc.y = clamp(bc.y, -S.world, S.world);
    if (bc.landed) {
      const pre = bc.call;
      bc.call -= dt;
      if (Math.ceil(pre) !== Math.ceil(bc.call) && bc.call > 0) worldEv('ping', bc.x, bc.y);
      if (bc.call <= 0) {
        S.balls.splice(bn, 1);
        if (sim()) callIn(bc);
      }
    }
  }
}
export function updatePods(dt) {
  for (let pd = S.pods.length - 1; pd >= 0; pd--) {
    const po = S.pods[pd];
    po.t += dt;
    po.vz += 3400 * dt;
    po.z -= po.vz * dt;
    if (po.t > 0.06 && S.particles.length < S.particleCap)
      spark(po.x + rand(-7, 7), po.y - po.z * 0.55 + rand(0, 16), rand(-40, 40), rand(20, 120),
            rand(0.2, 0.5), Math.random() < 0.5 ? '#ffd9a0' : '#ff8a3d', rand(2, 5));
    if (po.z <= 0) {
      /* the pod comes off the list FIRST. If anything below throws, it throws
         once -- it does not get another go at it every frame forever. */
      S.pods.splice(pd, 1);
      try { podLand(po); }
      catch (err) { console.error('podLand', err); }
    }
  }
}
export function updateNades(dt) {
  for (let g = S.nades.length - 1; g >= 0; g--) {
    const gr = S.nades[g];
    gr.t += dt; gr.fuse -= dt; gr.spin += dt * 14;
    const k = Math.min(1, gr.t / gr.dur);
    gr.x = gr.sx + (gr.tx - gr.sx) * k;
    gr.y = gr.sy + (gr.ty - gr.sy) * k;
    gr.z = Math.sin(k * Math.PI) * (gr.mortar ? 190 : 46);
    if (gr.fuse <= 0) {
      S.nades.splice(g, 1);
      if (sim()) {
        if (gr.blast) explode(gr.x, gr.y, gr.blast.radius, gr.blast.dmg, 16, '#ffd06b', true,
                              gr.who === 'sentry' ? 'sentry' : gr.who, 4);
        else explode(gr.x, gr.y, 150, 180, 14, '#ffb347', false, gr.who, 3);
      }
    }
  }
}
