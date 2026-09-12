/* The world-event channel.
 *
 * The host is the only machine that simulates a building coming down, a pod
 * landing or a Bile Titan bringing its head down. Without this, a joining
 * Helldiver watched all of it happen in silence. Events are raised once, replayed
 * on every machine, and each machine judges the range from where its OWN listener
 * is standing -- so the same collapse is a distant rumble to one player and a
 * faceful of dust to another.
 *
 * `reach` is how far the thing carries. A Scavenger dying is 600 units of news;
 * a Super Destroyer hitting the ground is the whole map. */
'use strict';
import { SFX, sndAt } from './audio.js';
import {
  S, shakeAt, falloff, say, eachDiver, spark, blast, isHost, decal
} from './state.js';
import { rand, TAU } from './util.js';
import { postArr } from './outbox.js';
import { buildings } from './world.js';

export const EVENT = {
  /* ---- the city ---- */
  crumble:   { snd: 'crumble', shake: 14, reach: 2600, say: 'BUILDING COLLAPSING', saylen: 1.6 },
  collapsed: { snd: 'crumble', shake: 16, reach: 2600 },
  rebuild:   { snd: 'rebuild', shake: 0, all: 1, say: 'RECONSTRUCTION CREWS DEPLOYED', saylen: 2.5 },
  /* ---- deliveries ---- */
  incoming:  { snd: 'incoming', shake: 0, reach: 2200 },
  impact:    { snd: 'impact', shake: 20, reach: 2600, cape: 90, capeR: 220 },
  deploy:    { snd: 'deploy', shake: 0, reach: 900 },
  sentrygo:  { snd: null, shake: 0, reach: 900, say: 'SENTRY DESTROYED', saylen: 1.6 },
  siren:     { snd: 'siren', shake: 0, reach: 2400 },
  railcannon:{ snd: 'railcannon', shake: 18, reach: 3600 },
  mortarfire:{ snd: 'mortar', shake: 2, reach: 1200 },
  teslazap:  { snd: 'tesla', shake: 0, reach: 900 },
  arczap:    { snd: 'arc', shake: 0, reach: 900 },
  laserhum:  { snd: 'laserHum', shake: 3, reach: 2000 },
  /* ---- hands ---- */
  thud:      { snd: 'thud', shake: 0, reach: 700 },
  swing:     { snd: 'swing', shake: 0, reach: 600 },
  throwb:    { snd: 'throwb', shake: 0, reach: 700 },
  pickup:    { snd: 'pickup', shake: 0, reach: 600 },
  discard:   { snd: 'discard', shake: 0, reach: 700 },
  dry:       { snd: 'dry', shake: 0, reach: 600 },
  swap:      { snd: 'swap', shake: 0, reach: 500 },
  reloadOut: { snd: 'reloadOut', shake: 0, reach: 600 },
  reloadIn:  { snd: 'reloadIn', shake: 0, reach: 600 },
  crush:     { snd: 'crush', shake: 0, reach: 900 },
  bounce:    { snd: 'bounce', shake: 0, reach: 700 },
  ping:      { snd: 'ping', shake: 0, reach: 700 },
  clang:     { snd: 'clang', shake: 0, reach: 700 },
  /* ---- the horde ---- */
  slam:      { snd: 'slam', shake: 13, reach: 1400 },
  bigslam:   { snd: 'slam', shake: 18, reach: 2400, cape: 60, capeR: 200 },
  charge:    { snd: 'charge', shake: 6, reach: 1600 },
  roar:      { snd: 'roar', shake: 0, reach: 1600 },
  burst:     { snd: 'burst', shake: 9, reach: 1200 },
  stompS:    { snd: 'autoStomp', shake: 2, reach: 900 },
  stompL:    { snd: 'footL', shake: 4, reach: 1900 },
  warp:      { snd: 'illWarp', shake: 0, reach: 1400 },
  /* ---- objectives ---- */
  objNew:    { snd: 'objNew', shake: 0, all: 1 },
  objDone:   { snd: 'objDone', shake: 0, all: 1 },
  objFail:   { snd: 'objFail', shake: 0, all: 1 },
  terminal:  { snd: 'terminal', shake: 0, reach: 700 },
  uploading: { snd: 'uploading', shake: 0, reach: 600 },
  /* ---- announcements from orbit: heard wherever you are standing ---- */
  liberty:   { snd: 'siren', shake: 0, all: 1, say: 'FOR LIBERTY!', saylen: 4 },
  /* ---- the ship ---- */
  shipWarn:  { snd: 'shipWarn', shake: 6, all: 1, say: 'COLLISION ALERT — CLEAR THE AREA', saylen: 5 },
  shipFall:  { snd: 'shipFall', shake: 22, all: 1 },
  shipHit:   { snd: 'shipHit', shake: 95, all: 1, cape: 400, capeR: 3000 }
};

/* `who` is the diver whose own machine already played this, so it is not played
   to them twice. Everything impersonal leaves it out. */
export function worldEv(kind, x, y, who, extra) {
  evPlay(kind, x, y, extra);
  if (isHost())
    postArr('ev', [kind, Math.round(x), Math.round(y),
                   (who === undefined ? -1 : who), (extra === undefined ? -1 : extra)]);
}

export function evPlay(kind, x, y, extra) {
  const E = EVENT[kind];
  if (!E) return;
  const reach = E.reach || 1500;
  const fall = E.all ? 1 : (E.shake ? shakeAt(x, y, E.shake, 0, reach) : falloff(x, y, reach));
  if (E.all && E.shake) S.shake = Math.max(S.shake, E.shake);
  if (E.snd && SFX[E.snd]) sndAt(fall, SFX[E.snd]);
  if (E.cape) eachDiver(P => {
    if (Math.hypot(P.x - x, P.y - y) < E.capeR) capeBlast(P, x, y, E.cape);
  });
  if (E.say) say(E.say, E.saylen);

  const b = (extra >= 0) ? buildings[extra] : null;
  switch (kind) {
    case 'crumble':
      if (b && !b.collapse && !b.dead) b.collapse = 0.9;
      break;
    case 'collapsed':
      if (b) {
        b.collapse = 0; b.dead = true;
        blast(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * 0.8, '#6a6f7e', 0.7);
      }
      break;
    case 'burst': {
      blast(x, y, 90, '#8d2b2b', 0.4);
      const n = Math.round(50 * S.quality);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), sp = rand(60, 420);
        spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.25, 0.8),
              i % 3 ? '#7a1f1f' : '#b33b3b', rand(2, 6));
      }
      decal(x, y, 46, 'rgba(70,16,16,0.5)');
      break;
    }
    case 'bigslam': {
      blast(x, y, 120, '#8d2b2b', 0.35);
      const n = Math.round(22 * S.quality);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        spark(x, y, Math.cos(a) * rand(80, 380), Math.sin(a) * rand(80, 380),
              rand(0.2, 0.55), '#6b2020', rand(3, 6));
      }
      break;
    }
    case 'warp': {
      blast(x, y, 70, '#5fe0ff', 0.35);
      for (let i = 0; i < 14; i++) {
        const a = rand(0, TAU);
        spark(x, y, Math.cos(a) * rand(40, 220), Math.sin(a) * rand(40, 220),
              rand(0.2, 0.6), i % 2 ? '#5fe0ff' : '#c6a6ff', rand(2, 5));
      }
      break;
    }
    case 'shipWarn':
      S.shipFx = { t: 0, x, y, phase: 'warn' };
      break;
    case 'shipFall':
      S.shipFx = { t: 0, x, y, phase: 'fall' };
      break;
    case 'shipHit':
      S.shipFx = { t: 0, x, y, phase: 'hit' };
      S.flashWhite = 1.4;
      break;
  }
}

/* ---- the cape: a little verlet rope pinned to the Helldiver's shoulders ---- */
export const CAPE_N = 8, CAPE_SEG = 5.2;
export function capeInit(P) {
  P.cape = [];
  for (let i = 0; i < CAPE_N; i++)
    P.cape.push({ x: P.x - i * CAPE_SEG, y: P.y, ox: P.x - i * CAPE_SEG, oy: P.y });
}
export function capeUpdate(P, dt) {
  const c = P.cape;
  if (!c || !c.length) { capeInit(P); return; }
  const back = P.ang + Math.PI;
  const ax = P.x + Math.cos(back) * 9, ay = P.y + Math.sin(back) * 9;
  c[0].ox = c[0].x; c[0].oy = c[0].y; c[0].x = ax; c[0].y = ay;
  const windX = -P.vx * 0.55 + Math.cos(back) * 120, windY = -P.vy * 0.55 + Math.sin(back) * 120;
  const flap = Math.sin(S.time * 11) * (28 + Math.hypot(P.vx, P.vy) * 0.35);
  const px = -Math.sin(back), py = Math.cos(back);
  for (let i = 1; i < c.length; i++) {
    const p = c[i];
    const vx = (p.x - p.ox) * 0.88, vy = (p.y - p.oy) * 0.88;
    p.ox = p.x; p.oy = p.y;
    const k = i / c.length;
    p.x += vx + (windX + px * flap * k) * dt;
    p.y += vy + (windY + py * flap * k) * dt;
  }
  for (let it = 0; it < 3; it++) {
    for (let j = 1; j < c.length; j++) {
      const a = c[j - 1], b = c[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.0001;
      const f = (d - CAPE_SEG) / d;
      if (j > 1) { a.x += dx * f * 0.5; a.y += dy * f * 0.5; b.x -= dx * f * 0.5; b.y -= dy * f * 0.5; }
      else { b.x -= dx * f; b.y -= dy * f; }
    }
  }
}
export function capeBlast(P, x, y, power) {
  const c = P && P.cape;
  if (!c) return;
  for (let i = 1; i < c.length; i++) {
    const dx = c[i].x - x, dy = c[i].y - y, d = Math.hypot(dx, dy) || 1;
    const f = power * (i / c.length) / Math.max(40, d);
    c[i].x += dx / d * f; c[i].y += dy / d * f;
  }
}
