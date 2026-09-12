/* Who hurts whom, and what it looks like when they do. */
'use strict';
import { rand, clamp, TAU, segHit, dist } from './util.js';
import { CFG } from './config.js';
import {
  S, eachDiver, nid, spark, blast, puff, decal, say, shakeAt, falloff, earshot,
  isHost, isClient, sim, amGM, diverById, nearestDiver, anchorDist, addShake, later
} from './state.js';
import { SFX, sndAt, A } from './audio.js';
import { worldEv, capeBlast } from './events.js';
import { post, postArr } from './outbox.js';
import { armorScale, RICOCHET, TROOPS, FACTIONS, PROJ, WEAPONS } from './data.js';
import { damageArea, collapseNear, damageCellAt, solidAt, freeSpot, CELL } from './world.js';

/* who gets told when a Helldiver goes down, so the GM can be paid for it */
export const HOOKS = { onDiverDown: null, onKill: null, onMissionEnd: null };

/* ============================ HITTING A BODY ============================
   Returns the damage that actually landed. A round that could not beat the
   armour rings off and says so -- that noise is the game telling you to bring
   something heavier, and it is deliberately loud. */
export function damageEnemy(en, dmg, pen, hitX, hitY, quiet) {
  if (!en || en.hp <= 0) return 0;
  const T = en.T;
  let armor = T ? T.armor : 0;
  /* a Devastator's slab of a shield only protects the side it is facing */
  if (T && T.shield && hitX !== undefined) {
    const a = Math.atan2(hitY - en.y, hitX - en.x);
    const d = Math.atan2(Math.sin(a - en.face), Math.cos(a - en.face));
    if (Math.abs(d) < 1.0) armor += 1;
  }
  const scale = armorScale(pen === undefined ? 1 : pen, armor);
  const out = dmg * scale;
  en.hp -= out;
  en.hit = 0.12;
  if (scale <= RICOCHET) {
    if (!quiet) {
      const f = falloff(en.x, en.y, 900);
      sndAt(f, SFX.clang);
      for (let i = 0; i < 5; i++) {
        const a = rand(0, TAU);
        spark(hitX === undefined ? en.x : hitX, hitY === undefined ? en.y : hitY,
              Math.cos(a) * rand(120, 340), Math.sin(a) * rand(120, 340),
              rand(0.1, 0.3), '#ffe9a8', 2);
      }
    }
    en.clang = 0.12;
  } else if (!quiet) {
    const col = FACTIONS[T ? T.fac : 'illuminate'].blood;
    const n = Math.round(5 * S.quality);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      spark(hitX === undefined ? en.x : hitX, hitY === undefined ? en.y : hitY,
            Math.cos(a) * rand(50, 260), Math.sin(a) * rand(50, 260),
            rand(0.15, 0.45), col, rand(2, 4));
    }
  }
  return out;
}

/* set something alight; it keeps taking damage after you stop shooting it */
export function ignite(en, secs) {
  en.burn = Math.max(en.burn || 0, secs);
}

/* ============================ EXPLOSIONS ============================
   `owner` is the diver id that called this down, 'sentry' for a turret cooking
   off, or nothing at all for the horde and the architecture -- which always hurt. */
export function explode(x, y, radius, dmg, shakeAmt, col, big, owner, pen) {
  if (isHost() && anchorDist(x, y) < 3000)
    postArr('fx', [Math.round(x), Math.round(y), Math.round(radius),
                   col || '#ffb347', big ? 1 : 0, Math.round(shakeAmt)]);
  blast(x, y, radius, col || '#ffb347', 0.6);
  const efall = shakeAt(x, y, shakeAmt, radius, big ? 3200 : 2000);
  if (dmg > 0) sndAt(efall, SFX.boom, big);
  /* every cape in range snaps, not just whichever diver the code was looking at */
  eachDiver(P => {
    if (Math.hypot(P.x - x, P.y - y) < radius * 1.6) capeBlast(P, x, y, radius * 0.55);
  });
  if (dmg > 0 && S.map.city) {
    damageArea(x, y, radius * (big ? 1.15 : 0.95), dmg * (big ? 0.9 : 0.5));
    if (big) collapseNear(x, y, radius * 0.75);
  }
  if (dmg > 0) decal(x, y, radius * 0.55, 'rgba(20,14,8,0.45)');

  if (sim()) {
    const P_ = pen === undefined ? 4 : pen;
    for (const e of S.enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d >= radius) continue;
      damageEnemy(e, dmg * (1 - 0.55 * (d / radius)), P_, x, y, true);
      const a = Math.atan2(e.y - y, e.x - x);
      const kb = 440 / Math.sqrt(e.mass || 1);
      e.vx += Math.cos(a) * kb; e.vy += Math.sin(a) * kb;
      if (!e.T || !e.T.boss) e.stun = Math.max(e.stun, 0.25);
    }
    for (const s of S.sentries) if (dist(s, { x, y }) < radius) s.hp -= dmg * 0.4;
    for (const o of S.objectives)
      if (o.hp > 0 && Math.hypot(o.x - x, o.y - y) < radius + (o.radius || 20))
        o.hp -= dmg * armorScale(P_, o.armor || 0);

    const safe = radius * 0.8;
    if (dmg > 0) eachDiver(P => {
      const pd = Math.hypot(P.x - x, P.y - y);
      if (pd >= safe) return;
      let scale = 1;
      if (owner === 'sentry' || owner === 'enemy') scale = owner === 'enemy' ? 1 : CFG.ffSentry;
      else if (typeof owner === 'number' && owner !== P.id) scale = CFG.ffTeam;
      if (scale <= 0) return;
      hurt((Math.min(95, dmg * 0.12) * (1 - pd / safe) + 12) * scale, P);
    });
  }
  const n = Math.round(70 * S.quality);
  for (let k = 0; k < n; k++) {
    const aa = rand(0, TAU), sp = rand(60, radius * 3.2);
    spark(x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, rand(0.25, 0.9),
          k % 3 ? '#ff9d3d' : '#ffe9a8', rand(2, 6));
  }
}

/* ============================ THE HELLDIVER ============================ */
export let flashEl = null, stimEl = null;
export function bindFlash(a, b) { flashEl = a; stimEl = b; }

export function hurt(d, P, fromEnemy) {
  if (!P || S.gameOver || P.guard > 0 || P.dead || P.inPod) return;
  /* the bubble takes it first, and stops recharging while it is being shot */
  if (P.shield > 0) {
    const soak = Math.min(P.shield, d);
    P.shield -= soak; d -= soak;
    P.shieldCd = 4;
    if (P === S.me) {
      for (let i = 0; i < 6; i++) {
        const a = rand(0, TAU);
        spark(P.x + Math.cos(a) * 26, P.y + Math.sin(a) * 26,
              Math.cos(a) * 90, Math.sin(a) * 90, 0.3, '#7fd4ff', 3);
      }
    }
    if (d <= 0.5) return;
  }
  P.hp -= d;
  sndAt(earshot(P, 900), SFX.hurt);
  /* The GM is not the one being hit, so the red screen is addressed to the
     Helldiver it happened to. The host consumes no feedback events of its own,
     so when the host IS a Helldiver it has to be told here as well. */
  if (isHost()) postArr('pf', ['h', Math.round(d), P.id]);
  if (P === S.me) playerHitFx(d);
  if (P.hp <= 0) die(P);
}
export function playerHitFx(d) {
  if (!flashEl) return;
  flashEl.style.opacity = Math.min(0.5, d / 22);
  setTimeout(() => { flashEl.style.opacity = 0; }, 90);
  addShake(Math.min(9, 3 + d * 0.12));
}
export function stimFx() {
  if (!stimEl) return;
  stimEl.style.opacity = 0.9;
  setTimeout(() => { stimEl.style.opacity = 0; }, 500);
}

/* a death is only final once the reinforcement budget is spent */
export function die(P) {
  if (S.gameOver || P.down || P.dead) return;
  P.armed = null;
  explode(P.x, P.y, 130, 0, 18, '#c1121f');
  /* the support weapon stays where you fell, with whatever was left in it */
  if (P.support && P.arsenal[P.support] && P.arsenal[P.support].owned) {
    const a = P.arsenal[P.support];
    if (a.ammo > 0 || a.mags > 0)
      S.pickups.push({ nid: nid(), kind: 'weapon', wep: P.support, x: P.x + rand(-20, 20),
                       y: P.y + rand(-20, 20), bob: rand(0, 6), ammo: a.ammo, mags: a.mags });
    a.owned = false; a.ammo = 0; a.mags = 0;
  }
  P.support = null;
  P.wep = 'ar';
  P.down = true; P.inPod = true; P.hp = 1; P.downAt = S.time;
  P.shield = 0;
  S.deaths++;
  if (HOOKS.onDiverDown) HOOKS.onDiverDown(P);

  const squad = S.players.length > 1;
  if (S.livesLeft <= 0) {
    if (P === S.me) { SFX.siren(); say('YOU ARE DOWN — NO REINFORCEMENTS LEFT', 4); }
    else say((P.name || 'A HELLDIVER') + ' IS DOWN — AND THAT IS THE LAST OF THEM', 4);
  } else if (squad) {
    P.waiting = 0;                 /* no self-service: somebody has to call you in */
    if (P === S.me) { SFX.siren(); say('YOU ARE DOWN — WAIT FOR A REINFORCEMENT', 4); }
    else if (amGM()) say((P.name || 'A HELLDIVER') + ' IS DOWN', 3);
    else say((P.name || 'A HELLDIVER') + ' IS DOWN — CALL THEM IN  ↑↓→←↑', 4);
  } else {
    P.waiting = 8;                 /* alone: pick a drop site before one is picked for you */
    if (P === S.me) { SFX.siren(); say('REINFORCING — CLICK A DROP SITE', 3.5); }
  }
}

/* ============================ ROUNDS ============================ */
export function spawnBullet(o) {
  const b = {
    nid: nid(), x: o.x, y: o.y, px: o.x, py: o.y, vx: o.vx, vy: o.vy,
    life: o.life, dmg: o.dmg, pen: o.pen || 1, color: o.color, size: o.size,
    src: o.src, who: o.who === undefined ? -1 : o.who,
    burn: o.burn || 0, fade: o.fade || 0, rocket: o.rocket || null
  };
  S.bullets.push(b);
  if (isHost())
    post('bs', Math.round(o.x), Math.round(o.y), Math.round(o.vx), Math.round(o.vy),
         Math.round(o.life * 100), o.ci === undefined ? 0 : o.ci, Math.round(o.size * 2));
  return b;
}
export function spawnEBullet(o) {
  const P = PROJ[o.proj] || PROJ.bolt;
  const b = {
    nid: nid(), x: o.x, y: o.y, px: o.x, py: o.y, vx: o.vx, vy: o.vy,
    life: o.life || P.life, dmg: o.dmg, proj: o.proj, fac: o.fac,
    col: P.col, size: P.size, fade: P.fade || 0, pen: P.pen, pool: o.pool || 0
  };
  S.ebullets.push(b);
  if (isHost())
    post('eb', Math.round(o.x), Math.round(o.y), Math.round(o.vx), Math.round(o.vy),
         Math.round(b.life * 100), PROJIDX.indexOf(o.proj));
  return b;
}
export const PROJIDX = ['bile', 'bolt', 'plasma', 'flame'];
export const BULLETCOL = ['#ffe38a', '#ffd9a0', '#ffb347', '#bfe9ff', '#ffd06b',
                          '#ffe9a8', '#9fe8ff', '#c6ff6b'];

/* ---------------------------------------------------------- friendly rounds */
export function updateBullets(dt) {
  const simulate = sim();
  for (let i = S.bullets.length - 1; i >= 0; i--) {
    const b = S.bullets[i];
    b.px = b.x; b.py = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.fade) { b.vx *= Math.pow(0.22, dt); b.vy *= Math.pow(0.22, dt); }
    let hitOne = false;

    if (simulate) {
      for (const e of S.enemies) {
        if (e.hp <= 0) continue;
        const rr = e.r + 4;
        if (Math.abs(e.x - b.x) > rr + 60 || Math.abs(e.y - b.y) > rr + 60) continue;
        if (!segHit(b.px, b.py, b.x, b.y, e.x, e.y, e.r)) continue;
        const out = damageEnemy(e, b.dmg * (e.rec > 0 ? 1.6 : 1), b.pen, b.x, b.y);
        if (b.burn) ignite(e, 3.2);
        const kb = 0.05 / (e.mass || 1);
        e.vx += b.vx * kb; e.vy += b.vy * kb;
        if (out > 0 && Math.random() < 0.3) sndAt(falloff(e.x, e.y, 900), SFX.hit);
        hitOne = true;
        if (b.rocket) explode(b.x, b.y, b.rocket.radius, b.rocket.dmg, 14, '#ffb347', false, b.who, 4);
        break;
      }
      /* objectives are structures and can be shot */
      if (!hitOne) for (const o of S.objectives) {
        if (!(o.hp > 0)) continue;
        if (!segHit(b.px, b.py, b.x, b.y, o.x, o.y, o.radius || 24)) continue;
        o.hp -= b.dmg * armorScale(b.pen, o.armor || 0);
        sndAt(falloff(o.x, o.y, 900), b.pen >= (o.armor || 0) ? SFX.hit : SFX.clang);
        hitOne = true;
        if (b.rocket) explode(b.x, b.y, b.rocket.radius, b.rocket.dmg, 14, '#ffb347', false, b.who, 4);
        break;
      }
      /* A round only looks for a friendly body if the mission says it may, and
         never for the Helldiver who fired it -- the muzzle sits in their hitbox. */
      if (!hitOne && b.src) {
        const ffs = b.src === 'sentry' ? CFG.ffSentry : CFG.ffTeam;
        if (ffs > 0) for (const FP of S.players) {
          if (FP.inPod || FP.dead || FP.guard > 0) continue;
          if (b.src === 'diver' && FP.id === b.who) continue;
          if (Math.abs(FP.x - b.x) > 70 || Math.abs(FP.y - b.y) > 70) continue;
          if (!segHit(b.px, b.py, b.x, b.y, FP.x, FP.y, FP.r)) continue;
          hurt(b.dmg * ffs * (FP.stimT > 0 ? 0.6 : 1), FP);
          for (let q = 0; q < 5; q++) {
            const a = Math.atan2(b.vy, b.vx) + rand(-0.9, 0.9);
            spark(FP.x, FP.y, Math.cos(a) * rand(50, 240), Math.sin(a) * rand(50, 240),
                  rand(0.15, 0.45), '#c1121f', rand(2, 4));
          }
          sndAt(earshot(FP, 900), SFX.hit);
          hitOne = true; break;
        }
      }
    }
    if (!hitOne && S.map.city) {
      const mx = (b.x + b.px) / 2, my = (b.y + b.py) / 2;
      if (solidAt(b.x, b.y) || solidAt(mx, my)) {
        if (simulate) {
          damageCellAt(b.x, b.y, b.dmg * 0.45, b.vx, b.vy, b.pen);
          damageCellAt(mx, my, b.dmg * 0.45, b.vx, b.vy, b.pen);
        }
        hitOne = true;
        if (b.rocket && simulate)
          explode(b.x, b.y, b.rocket.radius, b.rocket.dmg, 14, '#ffb347', false, b.who, 4);
        const n = Math.round(4 * S.quality);
        for (let sp = 0; sp < n; sp++) {
          const a = Math.atan2(-b.vy, -b.vx) + rand(-1, 1);
          spark(b.x, b.y, Math.cos(a) * rand(40, 200), Math.sin(a) * rand(40, 200),
                rand(0.1, 0.3), S.map.cave ? '#a8926e' : '#cfd6ff', 2);
        }
      }
    }
    if (hitOne || b.life <= 0) S.bullets.splice(i, 1);
  }
}

/* ---------------------------------------------------------- hostile rounds */
export function updateEBullets(dt) {
  const simulate = sim();
  for (let i = S.ebullets.length - 1; i >= 0; i--) {
    const b = S.ebullets[i];
    b.px = b.x; b.py = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.fade) { b.vx *= Math.pow(0.3, dt); b.vy *= Math.pow(0.3, dt); }
    let hit = false;

    if (simulate) {
      for (const P of S.players) {
        if (P.inPod || P.dead || P.guard > 0) continue;
        if (Math.abs(P.x - b.x) > 70 || Math.abs(P.y - b.y) > 70) continue;
        if (!segHit(b.px, b.py, b.x, b.y, P.x, P.y, P.r)) continue;
        hurt(b.dmg * (P.stimT > 0 ? 0.65 : 1), P, true);
        for (let q = 0; q < 5; q++) {
          const a = Math.atan2(b.vy, b.vx) + rand(-0.9, 0.9);
          spark(P.x, P.y, Math.cos(a) * rand(50, 240), Math.sin(a) * rand(50, 240),
                rand(0.15, 0.45), '#c1121f', rand(2, 4));
        }
        hit = true; break;
      }
      /* This is what makes a three-way war a war: a Trooper's bolt does not know
         a Terminid from a Helldiver, and the bugs notice. */
      if (!hit) for (const e of S.enemies) {
        if (e.hp <= 0 || e.T.fac === b.fac) continue;
        if (Math.abs(e.x - b.x) > e.r + 60 || Math.abs(e.y - b.y) > e.r + 60) continue;
        if (!segHit(b.px, b.py, b.x, b.y, e.x, e.y, e.r)) continue;
        damageEnemy(e, b.dmg, b.pen, b.x, b.y);
        e.mad = b.fac; e.madT = 8;              /* it has a new problem now */
        hit = true; break;
      }
      if (!hit) for (const s of S.sentries) {
        if (Math.abs(s.x - b.x) > 60 || Math.abs(s.y - b.y) > 60) continue;
        if (!segHit(b.px, b.py, b.x, b.y, s.x, s.y, 22)) continue;
        s.hp -= b.dmg; hit = true; break;
      }
    }
    if (!hit && S.map.city && solidAt(b.x, b.y)) {
      if (simulate) damageCellAt(b.x, b.y, b.dmg * 0.5, b.vx, b.vy, b.pen);
      hit = true;
      for (let sp = 0; sp < 3; sp++) {
        const a = Math.atan2(-b.vy, -b.vx) + rand(-1, 1);
        spark(b.x, b.y, Math.cos(a) * rand(40, 200), Math.sin(a) * rand(40, 200),
              rand(0.1, 0.3), b.col, 2);
      }
    }
    if (hit && b.pool && simulate) {
      /* a bile round leaves a patch of something you do not want to stand in */
      S.decals.push({ x: b.x, y: b.y, r: 34, col: 'rgba(150,170,20,0.35)', life: 9, max: 9, acid: 1 });
    }
    if (hit || b.life <= 0) S.ebullets.splice(i, 1);
  }
}

/* ============================ ARCS ============================
   The Tesla tower and the Blitzer both work this way: find a body, hit it, then
   look for the next one from there. Used by the horde too when the Illuminate
   feel like it. */
export function arcChain(fromX, fromY, dmg, pen, range, jumps, falloffK, ownerId, col) {
  const hitList = [];
  let cx = fromX, cy = fromY, d = dmg;
  const used = new Set();
  for (let j = 0; j < jumps; j++) {
    let best = null, bd = range;
    for (const e of S.enemies) {
      if (e.hp <= 0 || used.has(e)) continue;
      const dd = Math.hypot(e.x - cx, e.y - cy);
      if (dd < bd) { bd = dd; best = e; }
    }
    if (!best) break;
    used.add(best);
    damageEnemy(best, d, pen, best.x, best.y, true);
    best.stun = Math.max(best.stun, 0.35);
    hitList.push([cx, cy, best.x, best.y]);
    cx = best.x; cy = best.y; d *= falloffK;
  }
  /* arcs are not fussy about whose side you are on */
  if (CFG.ffSentry > 0 || ownerId === undefined) {
    for (const P of S.players) {
      if (P.inPod || P.dead || P.guard > 0 || P.id === ownerId) continue;
      if (Math.hypot(P.x - fromX, P.y - fromY) < range * 0.7)
        hurt(dmg * 0.35 * (ownerId === undefined ? 1 : CFG.ffSentry), P);
    }
  }
  for (const seg of hitList) addBeam(seg[0], seg[1], seg[2], seg[3], col || '#9fe8ff', 0.12, 1);
  return hitList.length;
}

export function addBeam(x1, y1, x2, y2, col, life, jag, w) {
  S.beams.push({ x1, y1, x2, y2, col, life, max: life, jag: jag || 0, w: w || 2 });
  if (isHost())
    postArr('bm', [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2),
                   col, Math.round(life * 100), jag ? 1 : 0, w || 2]);
}
export function updateBeams(dt) {
  for (let i = S.beams.length - 1; i >= 0; i--) {
    S.beams[i].life -= dt;
    if (S.beams[i].life <= 0) S.beams.splice(i, 1);
  }
}

/* ---- burning, acid, and other things that keep hurting after the fact ---- */
export function updateStatus(dt) {
  if (!sim()) return;
  for (const e of S.enemies) {
    if (e.burn > 0) {
      e.burn -= dt;
      e.hp -= 26 * dt;
      if (Math.random() < dt * 14)
        spark(e.x + rand(-e.r, e.r), e.y + rand(-e.r, e.r), rand(-20, 20), rand(-90, -30),
              rand(0.2, 0.5), Math.random() < 0.5 ? '#ffb347' : '#ff6b3d', rand(2, 5));
    }
  }
  /* acid puddles */
  for (const d of S.decals) {
    if (!d.acid) continue;
    eachDiver(P => {
      if (Math.hypot(P.x - d.x, P.y - d.y) < d.r) hurt(14 * dt, P, true);
    });
  }
}
