/* The ground, and everything standing on it.
 *
 * The old build kept one JavaScript object per 30-unit cell in a string-keyed
 * hash. At the new world size that is a quarter of a million objects and a hash
 * lookup on every collision test, which is most of where the lag came from.
 * Everything is typed arrays now: one flat index, no allocation, no string keys.
 *
 * Generation is seeded, so the host sends four bytes and the joining Helldiver
 * builds the identical city or cave locally instead of downloading it. */
'use strict';
import { clamp, rand, TAU, mulberry, shuffle } from './util.js';
import { S, eachDiver, spark } from './state.js';
import { MAPS } from './data.js';

export const CELL = 30;
export const CELLHP = 85;
export const ROCKHP = 520;

/* the grid, sized to the map and reallocated only when the world size changes */
export const G = {
  w: 0, h: 0, ox: 0, oy: 0,
  solid: null,      /* 1 = you cannot walk here */
  hp: null,         /* what is left of this cell */
  max: null,        /* what it started with, for the damage shading */
  bid: null,        /* which building, or -1 for living rock */
  win: null,        /* window/rooftop-unit flavour, packed */
  fresh: null       /* time until the "just rebuilt" flash fades */
};
export let buildings = [];
export let rubble = [];
export let caveMouths = [];       /* open ground a reinforcement can walk in from */
export let mapSeed = 1;

export function gw() { return G.w; }
export function gIndex(cx, cy) {
  const x = cx + G.ox, y = cy + G.oy;
  if (x < 0 || y < 0 || x >= G.w || y >= G.h) return -1;
  return y * G.w + x;
}
export function cellX(cx) { return cx * CELL; }
export function idxOf(x, y) {
  return gIndex(Math.floor(x / CELL), Math.floor(y / CELL));
}
export function solidAt(x, y) {
  if (!G.solid) return false;
  const i = idxOf(x, y);
  return i >= 0 && G.solid[i] === 1;
}
export function pointInWall(x, y) { return S.map.city && solidAt(x, y); }

function allocGrid(world) {
  const n = Math.ceil(world / CELL);
  G.ox = n; G.oy = n;
  G.w = n * 2 + 2; G.h = n * 2 + 2;
  const len = G.w * G.h;
  G.solid = new Uint8Array(len);
  G.hp = new Uint16Array(len);
  G.max = new Uint16Array(len);
  G.bid = new Int16Array(len).fill(-1);
  G.win = new Uint8Array(len);
  G.fresh = new Float32Array(len);
}

export function buildMap(id, seed) {
  S.map = MAPS[id] || MAPS.plains;
  S.world = S.map.world;
  mapSeed = seed === undefined ? (1 + ((Math.random() * 0x7ffffffe) | 0)) : (seed >>> 0);
  buildings = []; rubble = []; caveMouths = [];
  S.rebuildQ = null;
  S.nextRebuild = REBUILD_EVERY;
  allocGrid(S.world);
  const R = mulberry(mapSeed);
  if (S.map.cave) buildCave(R);
  else if (S.map.city) buildMegacity(R);
  return mapSeed;
}

/* ============================ THE MEGACITY ============================ */
function buildMegacity(R) {
  const P = 430, S0 = 150, W = S.world;
  const i0 = Math.ceil(-W / P), i1 = Math.floor(W / P);
  for (let i = i0; i <= i1; i++) {
    for (let j = i0; j <= i1; j++) {
      const x0 = i * P + S0 / 2, y0 = j * P + S0 / 2, bw = P - S0, bh = P - S0;
      if (x0 < -W || y0 < -W || x0 + bw > W || y0 + bh > W) continue;
      if (Math.abs(i) + Math.abs(j) <= 1) continue;      /* keep the drop zone clear */
      if (R() < 0.13) continue;                          /* plaza */
      subdivide(x0, y0, bw, bh, R() < 0.55 ? 1 : 0, R);
    }
  }
  for (let b = 0; b < buildings.length; b++) indexBuilding(b);
}
function subdivide(x, y, w, h, depth, R) {
  if (depth <= 0 || Math.min(w, h) < 150) { makeBuilding(x, y, w, h, R); return; }
  const alley = 16;
  if (w >= h) {
    const cut = w * (0.38 + R() * 0.24);
    subdivide(x, y, cut - alley / 2, h, depth - 1, R);
    subdivide(x + cut + alley / 2, y, w - cut - alley / 2, h, depth - 1, R);
  } else {
    const cut = h * (0.38 + R() * 0.24);
    subdivide(x, y, w, cut - alley / 2, depth - 1, R);
    subdivide(x, y + cut + alley / 2, w, h - cut - alley / 2, depth - 1, R);
  }
}
const NEON = ['#ff3d7f', '#3dd6ff', '#ffd21e', '#7CFF6B', '#c46bff'];
function makeBuilding(x, y, w, h, R) {
  if (w < 50 || h < 50) return;
  const cx0 = Math.ceil(x / CELL), cy0 = Math.ceil(y / CELL);
  const cx1 = Math.floor((x + w) / CELL), cy1 = Math.floor((y + h) / CELL);
  if (cx1 - cx0 < 2 || cy1 - cy0 < 2) return;
  const tone = R();
  const b = {
    id: buildings.length,
    x: cx0 * CELL, y: cy0 * CELL, w: (cx1 - cx0) * CELL, h: (cy1 - cy0) * CELL,
    cx0, cy0, cx1, cy1,
    roof: 'rgb(' + Math.round(34 + tone * 16) + ',' + Math.round(38 + tone * 18) + ',' + Math.round(50 + tone * 22) + ')',
    side: 'rgb(' + Math.round(18 + tone * 8) + ',' + Math.round(20 + tone * 9) + ',' + Math.round(28 + tone * 12) + ')',
    neon: R() < 0.45 ? NEON[(R() * NEON.length) | 0] : null,
    tall: 6 + R() * 12, alive: 0, total: 0, collapse: 0, dead: false
  };
  for (let cx = cx0; cx < cx1; cx++) {
    for (let cy = cy0; cy < cy1; cy++) {
      const i = gIndex(cx, cy);
      if (i < 0) continue;
      const win = R() < 0.3 ? (R() < 0.35 ? 2 : 1) : 0;
      const unit = R() < 0.06 ? 1 : 0;
      G.solid[i] = 1; G.hp[i] = CELLHP; G.max[i] = CELLHP;
      G.bid[i] = b.id; G.win[i] = win * 2 + unit; G.fresh[i] = 0;
      b.alive++; b.total++;
    }
  }
  buildings.push(b);
}

export const BCELL = 400;
export const bgrid = {};
function indexBuilding(i) {
  const b = buildings[i];
  const c0 = Math.floor(b.x / BCELL), c1 = Math.floor((b.x + b.w) / BCELL);
  const d0 = Math.floor(b.y / BCELL), d1 = Math.floor((b.y + b.h) / BCELL);
  for (let c = c0; c <= c1; c++) for (let d = d0; d <= d1; d++) {
    const k = c + ',' + d;
    (bgrid[k] || (bgrid[k] = [])).push(i);
  }
}
export function clearBGrid() { for (const k in bgrid) delete bgrid[k]; }

/* ============================ THE HIVE ============================
   Solid rock, then tunnels chewed out of it: a ring of chambers joined by
   corridors, with a wide cavern in the middle where the pods come down. Rock is
   far tougher than masonry and never collapses -- there is nothing above it to
   fall. */
function buildCave(R) {
  clearBGrid();
  const n = Math.ceil(S.world / CELL);
  /* fill the world with rock */
  for (let cy = -n; cy <= n; cy++) {
    for (let cx = -n; cx <= n; cx++) {
      const i = gIndex(cx, cy);
      if (i < 0) continue;
      G.solid[i] = 1; G.hp[i] = ROCKHP; G.max[i] = ROCKHP;
      G.bid[i] = -1; G.win[i] = (R() < 0.07) ? 1 : 0;   /* the odd glowing seam */
    }
  }
  const carve = (cx, cy, r) => {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const i = gIndex(cx + dx, cy + dy);
        if (i < 0) continue;
        G.solid[i] = 0; G.hp[i] = 0;
      }
    }
  };
  const tunnel = (x0, y0, x1, y1, rad) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
    let wob = R() * TAU;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      wob += (R() - 0.5) * 0.5;
      const jx = Math.cos(wob) * 1.6, jy = Math.sin(wob) * 1.6;
      carve(Math.round(x0 + (x1 - x0) * t + jx), Math.round(y0 + (y1 - y0) * t + jy),
            rad + (R() < 0.25 ? 1 : 0));
    }
  };

  /* the landing cavern */
  carve(0, 0, 14);
  const rooms = [{ x: 0, y: 0, r: 14 }];
  const RING = [0.42, 0.72, 0.95];
  for (let ring = 0; ring < RING.length; ring++) {
    const count = 5 + ring * 3;
    const base = R() * TAU;
    for (let k = 0; k < count; k++) {
      const a = base + (k / count) * TAU + (R() - 0.5) * 0.35;
      const d = n * RING[ring] * (0.82 + R() * 0.3);
      const cx = Math.round(Math.cos(a) * d), cy = Math.round(Math.sin(a) * d);
      if (Math.abs(cx) > n - 6 || Math.abs(cy) > n - 6) continue;
      const r = 5 + R() * 7;
      carve(cx, cy, r);
      rooms.push({ x: cx, y: cy, r });
    }
  }
  /* join every chamber to the one before it, then throw in some shortcuts so it
     is a network rather than a wheel */
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i], b = rooms[(R() * i) | 0];
    tunnel(a.x, a.y, b.x, b.y, 2 + ((R() * 2) | 0));
  }
  for (let k = 0; k < rooms.length; k++) {
    if (R() > 0.45) continue;
    const a = rooms[(R() * rooms.length) | 0], b = rooms[(R() * rooms.length) | 0];
    if (a !== b) tunnel(a.x, a.y, b.x, b.y, 2);
  }
  /* the outer chambers are where reinforcements come in on foot */
  caveMouths = rooms.slice(1).filter(r => Math.hypot(r.x, r.y) > n * 0.5)
    .map(r => ({ x: r.x * CELL + CELL / 2, y: r.y * CELL + CELL / 2 }));
  if (!caveMouths.length) caveMouths.push({ x: 0, y: 0 });
  S.caveRooms = rooms.map(r => ({ x: r.x * CELL, y: r.y * CELL, r: r.r * CELL }));
}
/* Somewhere in the cave with actual floor under it, as close to the hint as the
   rock allows. It used to pick a chamber at random and ignore the hint entirely,
   which dropped the squad four thousand units from the entry cavern and left the
   camera inside a wall on the way there. */
export function openSpot(nearX, nearY, tries) {
  const hx = nearX || 0, hy = nearY || 0;
  if (!solidAt(hx, hy)) return { x: hx, y: hy };
  /* walk outwards from the hint before giving up and going room-hunting */
  for (let ring = 1; ring <= 12; ring++) {
    const r = ring * CELL * 1.5, n = 6 + ring * 3;
    const off = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU;
      const x = hx + Math.cos(a) * r, y = hy + Math.sin(a) * r;
      if (Math.abs(x) < S.world && Math.abs(y) < S.world && !solidAt(x, y)) return { x, y };
    }
  }
  const rooms = (S.caveRooms || []).slice()
    .sort((a, b) => Math.hypot(a.x - hx, a.y - hy) - Math.hypot(b.x - hx, b.y - hy));
  for (let i = 0; i < (tries || 40); i++) {
    if (!rooms.length) break;
    /* prefer the nearest handful rather than the whole hive */
    const r = rooms[Math.min(rooms.length - 1, (Math.random() * Math.min(5, rooms.length)) | 0)];
    const a = rand(0, TAU), d = Math.random() * r.r * 0.75;
    const x = r.x + Math.cos(a) * d, y = r.y + Math.sin(a) * d;
    if (!solidAt(x, y)) return { x, y };
  }
  return { x: hx, y: hy };
}

/* ============================ DESTRUCTION ============================ */
export const netCK = [];          /* cells the host has knocked out this tick */
export const netCA = [];          /* ...and cells it has put back */

export function killCell(cx, cy, vx, vy, dusty) {
  const i = gIndex(cx, cy);
  if (i < 0 || !G.solid[i]) return;
  G.solid[i] = 0; G.hp[i] = 0;
  if (netCK.length < 600) { netCK.push(cx, cy); }
  const bid = G.bid[i];
  const b = bid >= 0 ? buildings[bid] : null;
  if (b) b.alive--;
  const x = cx * CELL, y = cy * CELL;
  if (rubble.length < 900)
    rubble.push({ x: x + rand(4, CELL - 4), y: y + rand(4, CELL - 4),
                  s: rand(7, 16), rot: rand(0, TAU), c: b ? b.side : '#3a2c1c' });
  const n = Math.round((dusty ? 7 : 4) * S.quality);
  for (let k = 0; k < n; k++) {
    const a = rand(0, TAU), sp = rand(40, 240);
    spark(x + CELL / 2, y + CELL / 2, Math.cos(a) * sp + (vx || 0) * 0.2,
          Math.sin(a) * sp + (vy || 0) * 0.2, rand(0.25, 0.8),
          k % 2 ? (S.map.cave ? '#7a6a52' : '#8b8fa0') : (S.map.cave ? '#4a3f30' : '#5a606e'),
          rand(2, 6));
  }
  if (b && !b.collapse && !b.dead && b.alive > 0 && b.alive / b.total < 0.38)
    startCollapse(b);
  if (b && b.alive <= 0) b.dead = true;
}
/* a nick from a bullet; returns true if it hit anything at all */
export function damageCellAt(x, y, dmg, vx, vy, pen) {
  const i = idxOf(x, y);
  if (i < 0 || !G.solid[i]) return false;
  /* rock shrugs off small arms; you need something with penetration */
  if (G.bid[i] < 0 && (pen || 1) < 2) dmg *= 0.12;
  G.hp[i] -= dmg;
  if (G.hp[i] <= 0) killCell(Math.floor(x / CELL), Math.floor(y / CELL), vx, vy, false);
  return true;
}
export function damageArea(x, y, radius, dmg) {
  if (!S.map.city) return;
  const c0 = Math.floor((x - radius) / CELL), c1 = Math.floor((x + radius) / CELL);
  const d0 = Math.floor((y - radius) / CELL), d1 = Math.floor((y + radius) / CELL);
  for (let cx = c0; cx <= c1; cx++) {
    for (let cy = d0; cy <= d1; cy++) {
      const i = gIndex(cx, cy);
      if (i < 0 || !G.solid[i]) continue;
      const d = Math.hypot(cx * CELL + CELL / 2 - x, cy * CELL + CELL / 2 - y);
      if (d > radius) continue;
      G.hp[i] -= dmg * (1 - 0.6 * (d / radius));
      if (G.hp[i] <= 0) killCell(cx, cy, (cx * CELL - x) * 2, (cy * CELL - y) * 2, true);
    }
  }
}
/* everything the charging mass touches simply ceases to be part of the building */
export function smashCells(x, y, r) {
  if (!S.map.city) return 0;
  let n = 0;
  const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
  const d0 = Math.floor((y - r) / CELL), d1 = Math.floor((y + r) / CELL);
  for (let cx = c0; cx <= c1; cx++) {
    for (let cy = d0; cy <= d1; cy++) {
      const i = gIndex(cx, cy);
      if (i < 0 || !G.solid[i]) continue;
      if (G.bid[i] < 0) continue;                  /* nothing charges through rock */
      if (Math.hypot(cx * CELL + CELL / 2 - x, cy * CELL + CELL / 2 - y) > r) continue;
      killCell(cx, cy, (cx * CELL - x) * 3, (cy * CELL - y) * 3, true);
      n++;
    }
  }
  return n;
}

/* collapse is a city thing; rock has nothing above it to come down */
export let onCollapseStart = null, onCollapseDone = null;
export function setCollapseHooks(a, b) { onCollapseStart = a; onCollapseDone = b; }

export function startCollapse(b) {
  if (b.collapse || b.dead || S.map.cave) return;
  b.collapse = 0.9;
  if (onCollapseStart) onCollapseStart(b);
}
export function collapseNear(x, y, radius) {
  for (const b of buildings) {
    if (b.dead || b.collapse) continue;
    const nx = clamp(x, b.x, b.x + b.w), ny = clamp(y, b.y, b.y + b.h);
    if (Math.hypot(x - nx, y - ny) < radius) startCollapse(b);
  }
}
export function updateCollapses(dt, hurtFn) {
  for (const b of buildings) {
    if (!b.collapse) continue;
    b.collapse -= dt;
    const wave = Math.max(2, Math.ceil(b.total * dt / 0.9));
    for (let n = 0; n < wave && b.alive > 0; n++) {
      const cx = b.cx0 + ((Math.random() * (b.cx1 - b.cx0)) | 0);
      const cy = b.cy0 + ((Math.random() * (b.cy1 - b.cy0)) | 0);
      killCell(cx, cy, 0, 0, true);
    }
    if (b.collapse <= 0) {
      for (let x2 = b.cx0; x2 < b.cx1; x2++)
        for (let y2 = b.cy0; y2 < b.cy1; y2++) killCell(x2, y2, 0, 0, true);
      b.collapse = 0; b.dead = true;
      for (const en of S.enemies)
        if (en.x > b.x - 10 && en.x < b.x + b.w + 10 && en.y > b.y - 10 && en.y < b.y + b.h + 10)
          en.hp = -1;
      if (!S.gameOver && hurtFn) eachDiver(P => {
        if (P.x > b.x - 10 && P.x < b.x + b.w + 10 && P.y > b.y - 10 && P.y < b.y + b.h + 10)
          hurtFn(120, P);
      });
      if (onCollapseDone) onCollapseDone(b);
    }
  }
}

/* ---- reconstruction: Super Earth rebuilds the block every minute ---- */
export const REBUILD_EVERY = 75;
export function cellFree(cx, cy) {
  const x0 = cx * CELL, y0 = cy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
  const clear = (o, r) => {
    const nx = clamp(o.x, x0, x1), ny = clamp(o.y, y0, y1);
    return Math.hypot(o.x - nx, o.y - ny) > r;
  };
  let blocked = false;
  eachDiver(P => { if (!clear(P, P.r + 12)) blocked = true; });
  if (blocked) return false;
  for (const s of S.sentries) if (!clear(s, 26)) return false;
  for (const p of S.pickups) if (!clear(p, 22)) return false;
  for (const p of S.pods) if (!clear(p, 44)) return false;
  for (const o of S.objectives) if (!clear(o, (o.radius || 40) + 10)) return false;
  return true;
}
export function restoreCell(bid, cx, cy, win) {
  const i = gIndex(cx, cy);
  if (i < 0 || G.solid[i]) return;
  if (!cellFree(cx, cy)) return;
  const b = buildings[bid];
  if (!b) return;
  G.solid[i] = 1; G.hp[i] = CELLHP; G.max[i] = CELLHP;
  G.bid[i] = bid; G.win[i] = win === undefined ? G.win[i] : win;
  G.fresh[i] = S.time + 0.8;
  if (netCA.length < 900) netCA.push(bid, cx, cy, G.win[i]);
  b.alive++;
  if (b.alive > 0) b.dead = false;
  const mx = cx * CELL + CELL / 2, my = cy * CELL + CELL / 2;
  for (const en of S.enemies)
    if (Math.abs(en.x - mx) < CELL / 2 + en.r * 0.4 && Math.abs(en.y - my) < CELL / 2 + en.r * 0.4) {
      en.hp -= 70; en.hit = 0.12;
    }
  for (let q = 0; q < 3; q++)
    spark(mx + rand(-12, 12), my + rand(-12, 12), rand(-30, 30), rand(-90, -20),
          rand(0.3, 0.7), q % 2 ? '#ffd21e' : '#9aa3b8', rand(2, 4));
}
export function startRebuild() {
  const q = [];
  for (const b of buildings) {
    b.collapse = 0;
    for (let cx = b.cx0; cx < b.cx1; cx++) {
      for (let cy = b.cy0; cy < b.cy1; cy++) {
        const i = gIndex(cx, cy);
        if (i < 0) continue;
        if (!G.solid[i]) q.push(b.id, cx, cy);
        else if (G.hp[i] < G.max[i]) { G.hp[i] = G.max[i]; G.fresh[i] = S.time + 0.8; }
      }
    }
  }
  if (!q.length) return false;
  /* scatter the order so it knits together rather than sweeping across */
  const trip = [];
  for (let i = 0; i < q.length; i += 3) trip.push([q[i], q[i + 1], q[i + 2]]);
  shuffle(trip);
  S.rebuildQ = { q: trip, i: 0, t: 0, dur: 3.2 };
  rubble = [];
  return true;
}
export function updateRebuild(dt) {
  if (!S.rebuildQ) return;
  S.rebuildQ.t += dt;
  const target = Math.ceil(S.rebuildQ.q.length * Math.min(1, S.rebuildQ.t / S.rebuildQ.dur));
  while (S.rebuildQ.i < target) {
    const e = S.rebuildQ.q[S.rebuildQ.i++];
    restoreCell(e[0], e[1], e[2]);
  }
  if (S.rebuildQ.i >= S.rebuildQ.q.length) S.rebuildQ = null;
}

/* ============================ QUERIES ============================ */
/* push a circle out of any standing cell it overlaps; gives wall-sliding for free */
export function resolveCircle(o, r) {
  if (!S.map.city || !G.solid) return false;
  let hit = false;
  const c0 = Math.floor((o.x - r) / CELL), c1 = Math.floor((o.x + r) / CELL);
  const d0 = Math.floor((o.y - r) / CELL), d1 = Math.floor((o.y + r) / CELL);
  for (let cx = c0; cx <= c1; cx++) {
    for (let cy = d0; cy <= d1; cy++) {
      const i = gIndex(cx, cy);
      if (i < 0 || !G.solid[i]) continue;
      const bx = cx * CELL, by = cy * CELL;
      const nx = clamp(o.x, bx, bx + CELL), ny = clamp(o.y, by, by + CELL);
      const dx = o.x - nx, dy = o.y - ny, dd = dx * dx + dy * dy;
      if (dd < r * r) {
        hit = true;
        if (dd > 0.01) {
          const d = Math.sqrt(dd);
          o.x = nx + dx / d * r; o.y = ny + dy / d * r;
        } else {
          const l = o.x - bx, rt = bx + CELL - o.x, t = o.y - by, bt = by + CELL - o.y;
          const m = Math.min(l, rt, t, bt);
          if (m === l) o.x = bx - r; else if (m === rt) o.x = bx + CELL + r;
          else if (m === t) o.y = by - r; else o.y = by + CELL + r;
        }
      }
    }
  }
  return hit;
}
export function losClear(x1, y1, x2, y2) {
  if (!S.map.city) return true;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  const steps = Math.min(70, Math.ceil(len / 26));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (solidAt(x1 + dx * t, y1 + dy * t)) return false;
  }
  return true;
}
export function freeSpot(x, y, r) {
  const o = { x, y };
  for (let i = 0; i < 5; i++) if (!resolveCircle(o, r)) break;
  /* in a cave a pushed-out point can still be buried; walk it to real floor */
  if (S.map.cave && solidAt(o.x, o.y)) return openSpot(x, y);
  return o;
}
/* a point a certain distance from the divers with floor under it */
export function spawnPoint(anchorX, anchorY, minD, maxD) {
  for (let i = 0; i < 30; i++) {
    const a = rand(0, TAU), d = rand(minD, maxD);
    const x = clamp(anchorX + Math.cos(a) * d, -S.world + 60, S.world - 60);
    const y = clamp(anchorY + Math.sin(a) * d, -S.world + 60, S.world - 60);
    if (!solidAt(x, y)) return { x, y };
  }
  if (S.map.cave) return openSpot(anchorX, anchorY);
  return { x: clamp(anchorX, -S.world + 60, S.world - 60),
           y: clamp(anchorY, -S.world + 60, S.world - 60) };
}
