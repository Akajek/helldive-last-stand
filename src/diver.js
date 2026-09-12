/* One Helldiver.
 *
 * Every function here takes the Helldiver it acts on as its first argument.
 * There is no ambient "current player" any more: the host simulates up to four
 * bodies it does not control, and an implicit subject is how a stim ends up
 * healing the wrong person. */
'use strict';
import { rand, clamp, TAU, ease, dist } from './util.js';
import { LOADOUT } from './config.js';
import { S, nid, spark, say, earshot, addShake, isHost, sim, falloff } from './state.js';
import { SFX, sndAt } from './audio.js';
import { worldEv, capeUpdate } from './events.js';
import { post, postArr } from './outbox.js';
import { WEAPONS, STRATS, STRAT_BY_ID, SUPPORT_IDS, WEP_SND_IDX } from './data.js';
import { resolveCircle, damageCellAt } from './world.js';
import { damageEnemy, spawnBullet, arcChain, hurt, die, stimFx } from './combat.js';

export const KIT = { grenades: 4, stims: 4, maxGrenades: 6, maxStims: 6 };

export function freshInput() {
  return { ax: 0, ay: 0, U: 0, D: 0, L: 0, R: 0, sprint: false, fire: false };
}
export function freshArsenal() {
  const a = {
    ar: { ammo: WEAPONS.ar.mag, mags: WEAPONS.ar.mags - 1, owned: true },
    pistol: { ammo: WEAPONS.pistol.mag, mags: WEAPONS.pistol.mags - 1, owned: true }
  };
  for (const id of SUPPORT_IDS) a[id] = { ammo: 0, mags: 0, owned: false };
  return a;
}

export function makeDiver(id, name, loadout) {
  const D = {
    x: 0, y: 0, vx: 0, vy: 0, r: 15, hp: 100, maxhp: 100, ang: 0,
    wep: 'ar', support: null, arsenal: freshArsenal(),
    reloading: 0, reloadFx: 0, cool: 0, sprint: 0,
    grenades: KIT.grenades, stims: KIT.stims,
    stimT: 0, stimHeal: 0, nadeCool: 0, inPod: true, cape: [],
    kick: 0, punch: 0, waiting: 0, down: false, guard: 0, melee: 0, meleeCd: 0,
    shield: 0, shieldMax: 0, shieldCd: 0,
    fxCool: 0, semiLatch: false, fireLatch: false,
    sx: 0, sy: 0, id, name: name || ('DIVER ' + id),
    dead: false, armed: null, stt: [], downAt: 0, burn: 0,
    /* the four codes this Helldiver actually brought, plus the free ones */
    load: (loadout && loadout.length === 4) ? loadout.slice() : LOADOUT.slots.slice(),
    inp: freshInput(), samples: 0, shells: 0, carrying: null
  };
  for (let i = 0; i < STRATS.length; i++) D.stt.push(0);
  return D;
}

/* what this Helldiver may call: their four, plus everything free, plus secrets */
export function hasStrat(P, s) {
  if (!s) return false;
  if (s.free || s.hidden) return true;
  return P.load.indexOf(s.id) >= 0;
}
export function loadoutStrats(P) {
  const out = [];
  for (const s of STRATS) if (s.free && !s.hidden) out.push(s);
  for (const id of P.load) { const s = STRAT_BY_ID[id]; if (s) out.push(s); }
  return out;
}

export function W_(P) { return WEAPONS[P.wep] || WEAPONS.ar; }
export function A_(P) { return P.arsenal[P.wep] || P.arsenal.ar; }

/* ============================ GUNPLAY ============================ */
export function fire(P) {
  const w = W_(P), a = A_(P);
  if (P.reloading > 0 || P.cool > 0 || P.inPod || P.dead || P.down) return;
  if (!w.infinite && a.ammo <= 0) {
    P.cool = 0.25; worldEv('dry', P.x, P.y);
    if (w.disposable) discardSupport(P);
    else if (a.mags > 0) reload(P);
    return;
  }
  if (!w.infinite) a.ammo--;
  P.cool = 60 / w.rpm;

  const ang = P.ang + P.kick + rand(-w.spread, w.spread) + (P.sprint ? rand(-0.03, 0.03) : 0);
  P.kick = clamp(P.kick + (Math.random() < 0.5 ? -1 : 1) * w.kick * rand(0.5, 1.5), -w.kickMax, w.kickMax);
  P.punch = w.punch;
  /* only my own rifle may move my view: a teammate's recoil, or a Helldiver the
     GM is merely watching, must not shove the camera around */
  if (P === S.me) {
    S.camKick.x -= Math.cos(ang) * w.punch * 1.5;
    S.camKick.y -= Math.sin(ang) * w.punch * 1.5;
    addShake(w.recoil);
  }
  const mx = P.x + Math.cos(ang) * 20, my = P.y + Math.sin(ang) * 20;

  if (w.chain) {
    /* the Blitzer does not fire anything; it simply decides you are connected */
    if (sim()) arcChain(mx, my, w.dmg, w.pen, w.chain.range, w.chain.jumps, w.chain.falloff,
                        P.id, '#9fe8ff');
    sndAt(earshot(P, 1100), SFX.arc);
  } else {
    const shots = w.id === 'flamer' ? 3 : 1;
    for (let s = 0; s < shots; s++) {
      const sa = ang + rand(-w.spread, w.spread);
      if (sim()) spawnBullet({
        x: mx, y: my, vx: Math.cos(sa) * w.speed * rand(0.9, 1.1), vy: Math.sin(sa) * w.speed * rand(0.9, 1.1),
        life: w.life, dmg: w.dmg, pen: w.pen, color: w.color, size: w.size,
        src: 'diver', who: P.id, burn: w.burn, fade: w.fade, rocket: w.rocket,
        ci: BULLETCOLIDX(w.color)
      });
    }
    sndAt(earshot(P, w.id === 'recoilless' ? 2200 : 1400), SFX.shot, w);
  }
  /* teammates' guns have to be audible to the rest of the squad, and they are the
     only ones who need the event -- the shooter already heard their own */
  if (isHost())
    post('sp', Math.round(P.x), Math.round(P.y), WEP_SND_IDX[w.id] || 1, P.id);

  const n = w.id === 'flamer' ? 1 : 2;
  for (let i = 0; i < n; i++)
    spark(mx, my, Math.cos(ang) * rand(60, 260) + rand(-70, 70),
          Math.sin(ang) * rand(60, 260) + rand(-70, 70), rand(0.05, 0.14), '#ffe9a8', 2);
}
import { BULLETCOL } from './combat.js';
function BULLETCOLIDX(c) { const i = BULLETCOL.indexOf(c); return i < 0 ? 0 : i; }

/* a reload consumes one whole magazine; rounds left in the old one are lost */
export function reload(P) {
  const w = W_(P), a = A_(P);
  if (w.infinite) return;
  if (w.disposable) { worldEv('dry', P.x, P.y); return; }
  if (P.reloading > 0 || a.ammo >= w.mag) return;
  if (a.mags <= 0) { worldEv('dry', P.x, P.y); return; }
  P.reloading = w.reload; P.reloadFx = 0;
  worldEv('reloadOut', P.x, P.y);
}
export function finishReload(P) {
  const w = W_(P), a = A_(P);
  if (a.mags <= 0) return;
  a.mags--; a.ammo = w.mag;
  worldEv('reloadIn', P.x, P.y);
}
export function discardSupport(P) {
  const id = P.wep;
  if (!P.arsenal[id]) return;
  P.arsenal[id].owned = false; P.arsenal[id].ammo = 0;
  if (P.support === id) P.support = null;
  P.wep = 'ar'; P.reloading = 0; P.cool = 0.5;
  worldEv('discard', P.x, P.y);
  const a = P.ang + rand(-0.5, 0.5);
  S.junk.push({ x: P.x, y: P.y, vx: Math.cos(a) * rand(180, 300), vy: Math.sin(a) * rand(180, 300),
                spin: rand(-8, 8), rot: P.ang, life: 9 });
  for (let i = 0; i < 10; i++) {
    const pa = rand(0, TAU);
    spark(P.x, P.y, Math.cos(pa) * rand(30, 140), Math.sin(pa) * rand(30, 140), 0.4, '#9a9480', 2);
  }
}
export function equipSlot(P, slot) {
  const id = slot === 1 ? 'ar' : slot === 2 ? 'pistol' : P.support;
  if (!id || P.wep === id) return;
  const a = P.arsenal[id];
  if (!a || !a.owned) return;
  P.wep = id; P.reloading = 0; P.cool = 0.25;
  worldEv('swap', P.x, P.y);
}
export function giveSupport(P, wepId, ammo, mags) {
  const W = WEAPONS[wepId];
  if (!W) return;
  /* you can only carry one support weapon; the old one hits the deck */
  if (P.support && P.support !== wepId && P.arsenal[P.support].owned) {
    const old = P.arsenal[P.support];
    S.pickups.push({ nid: nid(), kind: 'weapon', wep: P.support, x: P.x + rand(-26, 26),
                     y: P.y + rand(-26, 26), bob: rand(0, 6), ammo: old.ammo, mags: old.mags });
    old.owned = false; old.ammo = 0; old.mags = 0;
  }
  const a = P.arsenal[wepId];
  a.owned = true;
  a.ammo = ammo === undefined ? W.mag : ammo;
  a.mags = mags === undefined ? W.mags : mags;
  P.support = wepId;
  P.wep = wepId; P.reloading = 0; P.cool = 0.3;
}

/* rifle butt to the face: short, wide, and it will chip masonry too */
export function meleeSwing(P) {
  if (P.meleeCd > 0 || P.inPod || P.dead || S.gameOver) return;
  P.meleeCd = 0.6; P.melee = 0.24;
  worldEv('swing', P.x, P.y, P.id);
  if (!sim()) return;
  const reach = 50, arc = 0.9;
  let hitAny = false;
  for (const e of S.enemies) {
    const d = dist(e, P);
    if (d > reach + e.r) continue;
    let da = Math.atan2(e.y - P.y, e.x - P.x) - P.ang;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > arc) continue;
    damageEnemy(e, 55, 2, e.x, e.y);
    if (!e.T.boss) {
      const ka = Math.atan2(e.y - P.y, e.x - P.x);
      const kb = 430 / Math.sqrt(e.mass || 1);
      e.vx += Math.cos(ka) * kb; e.vy += Math.sin(ka) * kb;
      e.stun = Math.max(e.stun, 0.4);
    }
    e.atk = Math.max(e.atk, 0.5);
    hitAny = true;
  }
  if (S.map.city) {
    const bx = P.x + Math.cos(P.ang) * 40, by = P.y + Math.sin(P.ang) * 40;
    if (damageCellAt(bx, by, 34, 0, 0, 2)) hitAny = true;
  }
  /* the thud carries at range, but the jolt up the arm is the swinger's alone */
  if (hitAny) {
    worldEv('thud', P.x, P.y);
    if (P === S.me) addShake(4);
  }
}
export function useStim(P) {
  if (P.stims <= 0 || S.gameOver || P.inPod || P.dead) return;
  if (P.hp >= P.maxhp && P.stimT > 0) return;
  P.stims--;
  P.stimT = 5.0;
  P.stimHeal = 2.2;
  P.burn = 0;
  sndAt(earshot(P, 700), SFX.stim);
  if (isHost()) postArr('pf', ['s', 0, P.id]);
  if (P === S.me) stimFx();
}
export function throwNade(P) {
  if (P.grenades <= 0 || P.nadeCool > 0 || S.gameOver || P.inPod || P.dead) return;
  P.grenades--; P.nadeCool = 0.55;
  const IN = P.inp;
  const a = Math.atan2(IN.ay - P.y, IN.ax - P.x);
  const d = Math.min(430, Math.hypot(IN.ax - P.x, IN.ay - P.y));
  if (sim()) S.nades.push({
    nid: nid(), who: P.id, sx: P.x, sy: P.y, x: P.x, y: P.y,
    tx: P.x + Math.cos(a) * d, ty: P.y + Math.sin(a) * d,
    t: 0, dur: 0.5, z: 0, fuse: 1.5, spin: 0
  });
  worldEv('throwb', P.x, P.y);
}

/* ============================ PICKUPS ============================ */
export function tryPickup(P) {
  if (P.inPod || P.dead) return;
  let best = -1, bd = 62;
  for (let i = 0; i < S.pickups.length; i++) {
    const d = dist(S.pickups[i], P);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) { tryInteract(P); return; }
  const p = S.pickups[best];
  if (p.kind === 'weapon') {
    giveSupport(P, p.wep, p.ammo, p.mags);
    worldEv('pickup', P.x, P.y);
  } else if (p.kind === 'sample') {
    P.samples++;
    worldEv('pickup', P.x, P.y);
    if (PICKHOOK.sample) PICKHOOK.sample(P, p);
  } else if (p.kind === 'shell') {
    if (P.carrying) return;             /* both hands full */
    P.carrying = 'shell';
    worldEv('pickup', P.x, P.y);
  } else if (p.kind === 'shield') {
    P.shieldMax = 240; P.shield = 240; P.shieldCd = 0;
    worldEv('pickup', P.x, P.y);
    if (P === S.me) say('SHIELD GENERATOR ONLINE', 2.5);
  } else if (p.kind === 'dog') {
    /* one dog each: a second pack replaces the first rather than stacking */
    for (let i = S.drones.length - 1; i >= 0; i--)
      if (S.drones[i].owner === P.id) S.drones.splice(i, 1);
    S.drones.push({ nid: nid(), owner: P.id, x: P.x, y: P.y, ang: P.ang, orbit: 0, cool: 0 });
    worldEv('pickup', P.x, P.y);
    if (P === S.me) say('GUARD DOG DEPLOYED', 2.5);
  } else if (p.kind === 'requisition') {
    if (LOADHOOK.open) LOADHOOK.open();
    return;                             /* the terminal stays where it is */
  } else {
    resupply(P);
    worldEv('pickup', P.x, P.y);
  }
  if (p.kind !== 'requisition') S.pickups.splice(best, 1);
}
/* E on an objective rather than on a crate */
function tryInteract(P) {
  if (!INTERACT.fn) return;
  INTERACT.fn(P);
}
export const INTERACT = { fn: null };
export const PICKHOOK = { sample: null };
export const LOADHOOK = { open: null };

export function resupply(P) {
  const ar = P.arsenal;
  ar.ar.mags = WEAPONS.ar.mags - 1;
  ar.pistol.mags = WEAPONS.pistol.mags - 1;
  if (P.support && ar[P.support] && ar[P.support].owned && !WEAPONS[P.support].disposable)
    ar[P.support].mags = WEAPONS[P.support].mags;
  P.grenades = Math.min(KIT.maxGrenades, P.grenades + 2);
  P.stims = Math.min(KIT.maxStims, P.stims + 2);
}
export function refit(P) {
  P.hp = P.maxhp;
  const fresh = freshArsenal();
  P.arsenal.ar = fresh.ar;
  P.arsenal.pistol = fresh.pistol;
  P.wep = 'ar'; P.support = null; P.reloading = 0; P.kick = 0;
  P.grenades = KIT.grenades; P.stims = KIT.stims;
  P.stimT = 0; P.stimHeal = 0; P.burn = 0; P.carrying = null;
  P.shield = 0; P.shieldMax = 0;
}

/* ============================ ONE FRAME ============================ */
export function updateDiver(P, dt) {
  const IN = P.inp, pod = P.inPod;
  if (P.dead) { P.vx = 0; P.vy = 0; return; }

  let ix = (pod ? 0 : IN.R - IN.L), iy = (pod ? 0 : IN.D - IN.U);
  const m = Math.hypot(ix, iy) || 1; ix /= m; iy /= m;
  const sprinting = !pod && IN.sprint && (ix || iy) && !P.carrying;
  /* a live artillery shell is not something you jog with */
  const load = P.carrying ? 0.62 : 1;
  const spd = (sprinting ? 360 : 230) * (P.stimT > 0 ? 1.25 : 1) * load;
  P.vx += (ix * spd - P.vx) * ease(12, dt);
  P.vy += (iy * spd - P.vy) * ease(12, dt);
  P.x = clamp(P.x + P.vx * dt, -S.world, S.world);
  P.y = clamp(P.y + P.vy * dt, -S.world, S.world);
  if (!pod) resolveCircle(P, P.r);
  P.sprint = sprinting ? 1 : 0;
  P.nadeCool -= dt;
  P.meleeCd -= dt;
  if (P.melee > 0) P.melee -= dt;

  if (P.burn > 0) { P.burn -= dt; hurt(11 * dt, P, true); }
  if (!pod && !S.gameOver && !P.down && P.hp <= 0) die(P);
  if (P.stimT > 0) P.stimT -= dt;
  if (P.stimHeal > 0) { P.stimHeal -= dt; P.hp = Math.min(P.maxhp, P.hp + 38 * dt); }
  P.ang = Math.atan2(IN.ay - P.y, IN.ax - P.x);

  /* the bubble knits itself back together once nothing has hit it for a moment */
  if (P.shieldMax > 0) {
    if (P.shieldCd > 0) P.shieldCd -= dt;
    else if (P.shield < P.shieldMax) P.shield = Math.min(P.shieldMax, P.shield + P.shieldMax * 0.35 * dt);
  }

  /* a countdown only runs when there is one: alone, or when the whole squad is
     down and there is nobody left to make the call */
  if (P.down && P.waiting > 0) {
    P.waiting -= dt;
    if (P.waiting <= 0 && REINFORCE.fn) REINFORCE.fn(IN.ax, IN.ay, P);
  }

  capeUpdate(P, dt);

  P.cool -= dt;
  if (P.guard > 0) P.guard -= dt;
  P.kick -= P.kick * ease(9, dt);
  P.punch -= P.punch * ease(14, dt);
  for (let i = 0; i < P.stt.length; i++)
    if (P.stt[i] > 0) P.stt[i] = Math.max(0, P.stt[i] - dt);

  if (pod || P.down) { /* no shooting from inside a hellpod, or off your back */ }
  else if (P.reloading > 0) {
    P.reloading -= dt; P.reloadFx += dt;
    if (P.reloading <= 0) finishReload(P);
  } else if (IN.fire) {
    if (W_(P).auto) fire(P);
    else if (!P.semiLatch) { fire(P); P.semiLatch = true; }
  }
  if (!IN.fire) P.semiLatch = false;
}
export const REINFORCE = { fn: null };
