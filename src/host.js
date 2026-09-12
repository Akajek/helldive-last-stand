/* The host's half of the wire.
 *
 * Two things here are new, and both are about the lag your friend saw:
 *
 *  1. Snapshots are built PER CLIENT and culled around that client's own
 *     Helldiver. The old build sent one snapshot culled around the whole squad,
 *     so a squad spread across the map made everybody pay for everybody.
 *  2. Rounds are sent once, when they are fired, instead of having their
 *     position retransmitted twelve times a second for their whole short life.
 *     With four Helldivers and a Gatling sentry that was most of the traffic. */
'use strict';
import { TAU } from './util.js';
import { CFG } from './config.js';
import { S, diverById, isHost } from './state.js';
import { drain } from './outbox.js';
import { NET, netSend } from './net.js';
import { STRATS, STRAT_BY_ID, TROOP_IDS, ANG8 } from './data.js';
import { netCK, netCA, mapSeed } from './world.js';
import { reload, tryPickup, throwNade, meleeSwing, useStim, equipSlot } from './diver.js';
import { throwStratagem, reinforceAt } from './strat.js';
import { GM } from './gm.js';

const R = Math.round;

/* How far a body of each size is worth sending at all, how close it has to be
   to be refreshed every single snapshot, and the hard ceiling on how many go in
   one message.
   The ceiling is the important one. Without it a really bad moment -- five
   hundred bodies converging on one Helldiver -- sends a hundred and sixty
   kilobytes a second down a link that may not have it, and the result is the
   rubber-banding rather than the frame rate. Past about two hundred bodies the
   ones you cannot see are not worth the bandwidth. */
const CULL = { small: 1300, medium: 1700, large: 2800 };
const NEAR = 1100;
const MAXSEND = 210;

export function netSendCity() {
  netSend({
    t: 'city', map: S.map.id, seed: mapSeed, lv: S.hordeLv, cfg: CFG,
    rs: NET.roster, gm: S.gmMatch ? 1 : 0, lives: S.livesLeft
  });
}

/* ---------------------------------------------------------------- input in */
export function hostInput(m) {
  if (!isHost()) return;
  /* input only ever moves the diver it came from -- a spectator's keyboard
     addresses nobody, and the lookup failing is exactly how that is enforced */
  const P = diverById(m.from);
  if (!P) return;
  const IN = P.inp;
  IN.ax = m.ax; IN.ay = m.ay;
  const k = m.k | 0;
  IN.U = (k & 1) ? 1 : 0; IN.D = (k & 2) ? 1 : 0;
  IN.L = (k & 4) ? 1 : 0; IN.R = (k & 8) ? 1 : 0;
  IN.sprint = !!(k & 16); IN.fire = !!(k & 32);
  if (!m.a) return;
  for (const a of m.a) {
    if (a === 'r') reload(P);
    else if (a === 'e') tryPickup(P);
    else if (a === 'g') throwNade(P);
    else if (a === 'f') meleeSwing(P);
    else if (a === 'q') useStim(P);
    else if (a === '1') equipSlot(P, 1);
    else if (a === '2') equipSlot(P, 2);
    else if (a === '3') equipSlot(P, 3);
    else if (a.charAt(0) === 'S') {
      const id = a.slice(2), s = STRAT_BY_ID[id];
      if (s && P.stt[STRATS.indexOf(s)] <= 0) P.armed = s;
    }
    else if (a.charAt(0) === 'T') {
      const p = a.slice(2).split(',');
      throwStratagem(P, parseFloat(p[0]), parseFloat(p[1]));
    }
    else if (a.charAt(0) === 'R') {
      const p = a.slice(2).split(',');
      reinforceAt(parseFloat(p[0]), parseFloat(p[1]), P);
    }
  }
}

/* ------------------------------------------------------------- snapshot out */
function snapDiver(P) {
  const A = P.arsenal[P.wep] || P.arsenal.ar;
  const cd = [];
  for (let i = 0; i < P.stt.length; i++) cd.push(R(P.stt[i] * 10));
  const o = {
    i: P.id, x: R(P.x), y: R(P.y), a: R(P.ang * 100),
    hp: R(P.hp), w: P.wep, am: A.ammo, mg: A.mags,
    gr: P.grenades, sm: P.stims,
    rl: R(P.reloading * 100), gd: R(P.guard * 100),
    ki: R(P.kick * 1000), wt: R(P.waiting * 10),
    dn: P.down ? 1 : 0, ip: P.inPod ? 1 : 0, dd: P.dead ? 1 : 0,
    st: R(P.stimT * 10), ml: R(P.melee * 100), sr: P.sprint ? 1 : 0,
    sh: R(P.shield), sx: R(P.shieldMax), cy: P.carrying ? 1 : 0,
    bu: P.burn > 0 ? 1 : 0, cd
  };
  if (P.support) { o.su = P.support; o.sa = P.arsenal[P.support].ammo; o.sm2 = P.arsenal[P.support].mags; }
  if (P.armed) o.ar = P.armed.id;
  if (P.uses) o.us = P.uses;
  return o;
}

function snapWorldShared() {
  const st = [];
  for (const s of S.sentries)
    st.push(s.nid, R(s.x), R(s.y), R(s.ang * 57.2958), R(100 * s.hp / s.max),
            R(100 * s.ammo / s.maxAmmo), s.dying > 0 ? 1 : 0, sentryIdx(s.type));
  const pk = [];
  for (const p of S.pickups)
    pk.push(p.nid, PICKIDX.indexOf(p.kind), R(p.x), R(p.y),
            p.kind === 'weapon' ? WEPIDX.indexOf(p.wep) : 0);
  const pd = [];
  for (const p of S.pods)
    pd.push(p.nid, R(p.x), R(p.y), R(p.z), p.col,
            (p.payload && typeof p.payload.pid === 'number') ? p.payload.pid : -1);
  const bl = [];
  for (const b of S.balls)
    bl.push(b.nid, R(b.x), R(b.y), R(b.z), STRATS.indexOf(b.strat), b.landed ? 1 : 0, R(b.call * 10));
  const nd = [];
  for (const n of S.nades)
    nd.push(n.nid, R(n.x), R(n.y), R(n.z), R(n.fuse * 10), n.mortar ? 1 : 0);
  const dr = [];
  for (const d of S.drones) dr.push(d.nid, R(d.x), R(d.y), R(d.ang * 57.2958), d.owner);
  const ob = [];
  for (const o of S.objectives)
    ob.push(o.nid, OBJIDX.indexOf(o.id), R(o.x), R(o.y),
            R(o.prog * 10), R(o.hp), o.have, o.active || 0);
  return { s: st, pk, pd, bl, nd, dr, ob };
}
export const PICKIDX = ['supply', 'weapon', 'sample', 'shell', 'shield', 'dog', 'requisition'];
export const WEPIDX = ['ar', 'pistol', 'mg43', 'recoilless', 'flamer', 'arc', 'bulletstorm'];
export const SENIDX = ['gatling', 'autocannon', 'mortar', 'tesla'];
export const OBJIDX = ['upload', 'samples', 'jammer', 'spore', 'radar', 'broadcast', 'artillery'];
function sentryIdx(t) { const i = SENIDX.indexOf(t); return i < 0 ? 0 : i; }

export function netSnapshot() {
  if (!isHost()) return;
  NET.tick++;

  /* the channels are global: drain once, then include in everybody's copy */
  const shared = {};
  drain(shared);
  if (netCK.length) { shared.ck = netCK.slice(); netCK.length = 0; }
  if (netCA.length) { shared.ca = netCA.slice(); netCA.length = 0; }

  const world = snapWorldShared();
  const ps = S.players.map(snapDiver);

  const base = {
    t: 'snap', tm: R(S.time * 10), lv: S.hordeLv, wv: S.wave, wt: R(S.waveT),
    ki: S.kills, rb: R(S.nextRebuild), rf: S.livesLeft, ps,
    md: [R(S.mod.confuse), R(S.mod.radar), R(S.mod.spore), S.mod.barrage,
         S.mod.noSpawn ? R(S.mod.noSpawn.x) : 0, S.mod.noSpawn ? R(S.mod.noSpawn.y) : 0,
         S.mod.noSpawn ? R(S.mod.noSpawn.r) : 0, R(S.mod.uplink)],
    gm: { c: R(GM.credits), s: GM.score },
    wr: S.wreck ? [R(S.wreck.x), R(S.wreck.y), R(S.wreck.a * 100)] : 0
  };
  Object.assign(base, world, shared);
  if (S.paused) base.pz = 1;
  if (S.wipeT > 0) base.wp = R(S.wipeT * 10);

  /* one copy per listener, with the horde culled around THEM */
  const targets = NET.peers.length ? NET.peers : [];
  if (!targets.length) return;
  for (const peer of targets) {
    const P = diverById(peer.id);
    const ax = P ? P.x : S.cam.x, ay = P ? P.y : S.cam.y;
    base.e = cullEnemies(ax, ay, NET.tick);
    base.to = peer.id;
    netSend(base);
  }
}

function cullEnemies(ax, ay, tick) {
  const cand = [];
  for (const en of S.enemies) {
    const dx = en.x - ax, dy = en.y - ay;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > CULL[en.size]) continue;
    /* Past arm's reach the small and medium classes refresh every third word,
       staggered by id so a third of them move each time rather than all of them
       stuttering together. Anything large is always current -- a Bile Titan
       teleporting twenty units is a great deal more noticeable. */
    if (d > NEAR && en.size !== 'large' && (tick % 3) !== (en.id % 3)) continue;
    cand.push(d, en);
  }
  /* over the ceiling: keep the nearest, drop the rest of this word */
  let list = cand;
  if (cand.length / 2 > MAXSEND) {
    const pairs = [];
    for (let i = 0; i < cand.length; i += 2) pairs.push([cand[i], cand[i + 1]]);
    pairs.sort((a, b) => a[0] - b[0]);
    pairs.length = MAXSEND;
    list = [];
    for (const p of pairs) list.push(p[0], p[1]);
  }
  const e = [];
  for (let i = 1; i < list.length; i += 2) {
    const en = list[i];
    /* height rides in the high bits of the flag word rather than costing a
       field of its own, since it is zero for everything that walks */
    const z = Math.min(63, Math.round((en.z || 0) / 2));
    const fl = (en.hit > 0 ? 1 : 0) | (en.wind > 0 ? 2 : 0) | (en.cw > 0 ? 4 : 0) |
               (en.chg > 0 ? 8 : 0) | (en.rec > 0 ? 16 : 0) | (en.burn > 0 ? 32 : 0) |
               (en.beamT > 0 ? 64 : 0) | (en.beamWind > 0 ? 128 : 0) | (z << 8);
    e.push(en.id, TROOP_IDS.indexOf(en.tid), R(en.x), R(en.y),
           R((((en.face % TAU) + TAU) % TAU) * ANG8) & 255,
           R(100 * en.hp / en.max), fl);
  }
  return e;
}

export function netSendOver() {
  netSend({
    t: 'over', mm: Math.floor(S.time / 60), ss: Math.floor(S.time % 60),
    k: S.kills, map: S.map.name, spent: R(GM.spent), wave: S.wave
  });
}
