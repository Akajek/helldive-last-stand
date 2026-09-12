/* Cave systems, dug into a surface map rather than replacing it.
 *
 * A map with `caves` in its definition gets a handful of them scattered across
 * open ground: a disc of rock with chambers and corridors chewed out of the
 * inside, and two or three mouths opening onto the surface. Everything that used
 * to be true of "the cave map" is now true of a position instead -- you are
 * underground when you are inside one of these, and on the surface when you walk
 * back out. Darkness fades in at the mouth, and stratagems stop working past it.
 *
 * The generator writes straight into the world grid, so collision, destruction,
 * line of sight and the minimap all work on it without knowing it is a cave. */
'use strict';
import { clamp, TAU } from './util.js';
import { S } from './state.js';

/* set by dig(); read by everything that wants to know where it is standing */
export let caveZones = [];        /* {x, y, r} in world units */
export let caveMouths = [];       /* where a reinforcement can walk in */

/* 0 on the surface, 1 well inside a cave, ramping over the last stretch to the
   rim so that walking into a mouth dims rather than snaps. */
export function caveDepth(x, y) {
  let best = 0;
  for (let i = 0; i < caveZones.length; i++) {
    const z = caveZones[i];
    const d = Math.hypot(x - z.x, y - z.y);
    if (d >= z.r) continue;
    const k = clamp((z.r - d) / 260, 0, 1);
    if (k > best) best = k;
  }
  return best;
}
/* Is there rock over this point? Used for jamming and for reinforcement, and
   deliberately the whole disc -- standing in an entrance tunnel still counts. */
export function inCave(x, y) {
  for (let i = 0; i < caveZones.length; i++) {
    const z = caveZones[i];
    if (Math.hypot(x - z.x, y - z.y) < z.r) return true;
  }
  return false;
}
export function nearestMouth(x, y) {
  let best = null, bd = Infinity;
  for (const m of caveMouths) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}
export function mouthIndex(m) { return caveMouths.indexOf(m); }
/* Called for EVERY map, not just the ones with caves. Leaving the last map's
   zones lying around made stretches of open plains count as underground --
   stratagems refused, reinforcements walking in from a mouth that was not
   there any more. */
export function clearCaves() {
  caveZones = []; caveMouths = [];
  S.caveRooms = [];
}

/* ============================ DIGGING ============================ */
export function dig(G, gIndex, CELL, R, rockHp) {
  clearCaves();
  const spec = S.map.caves;
  if (!spec) return;
  const rooms = [];

  const fill = (cx, cy, r) => {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++)
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const i = gIndex(cx + dx, cy + dy);
        if (i < 0) continue;
        G.solid[i] = 1; G.hp[i] = rockHp; G.max[i] = rockHp;
        G.bid[i] = -1; G.win[i] = (R() < 0.06) ? 1 : 0;   /* the odd glowing seam */
      }
  };
  const carve = (cx, cy, r) => {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++)
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const i = gIndex(cx + dx, cy + dy);
        if (i < 0) continue;
        G.solid[i] = 0; G.hp[i] = 0;
      }
  };
  const tunnel = (x0, y0, x1, y1, rad) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
    let wob = R() * TAU;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      wob += (R() - 0.5) * 0.5;
      carve(Math.round(x0 + (x1 - x0) * t + Math.cos(wob) * 1.5),
            Math.round(y0 + (y1 - y0) * t + Math.sin(wob) * 1.5),
            rad + (R() < 0.25 ? 1 : 0));
    }
  };

  /* ---- where the systems go ---- */
  const W = S.world;
  const want = spec.count || 5;
  for (let attempt = 0; attempt < want * 40 && caveZones.length < want; attempt++) {
    const a = R() * TAU;
    const d = (0.26 + R() * 0.64) * W;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const r = spec.rMin + R() * (spec.rMax - spec.rMin);
    /* inside the world, clear of the drop zone, and not overlapping each other */
    if (Math.abs(x) + r > W - 260 || Math.abs(y) + r > W - 260) continue;
    if (Math.hypot(x, y) < 1100 + r) continue;
    let clash = false;
    for (const z of caveZones)
      if (Math.hypot(z.x - x, z.y - y) < z.r + r + 420) { clash = true; break; }
    if (clash) continue;
    caveZones.push({ x, y, r });
  }

  /* ---- dig each one out ---- */
  for (const z of caveZones) {
    const cx = Math.round(z.x / CELL), cy = Math.round(z.y / CELL);
    const cr = z.r / CELL;
    fill(cx, cy, cr);

    /* a main hall, and satellites around it */
    const local = [{ x: cx, y: cy, r: Math.max(5, cr * 0.17) }];
    carve(local[0].x, local[0].y, local[0].r);
    const sats = 4 + ((R() * 4) | 0);
    const base = R() * TAU;
    for (let k = 0; k < sats; k++) {
      const a = base + (k / sats) * TAU + (R() - 0.5) * 0.5;
      const dd = cr * (0.42 + R() * 0.36);
      const sx = Math.round(cx + Math.cos(a) * dd), sy = Math.round(cy + Math.sin(a) * dd);
      const sr = Math.max(3.5, cr * (0.08 + R() * 0.10));
      carve(sx, sy, sr);
      local.push({ x: sx, y: sy, r: sr });
    }
    /* join them up, then add a shortcut or two so it is a network not a wheel */
    for (let i = 1; i < local.length; i++)
      tunnel(local[i].x, local[i].y, local[0].x, local[0].y, 1 + ((R() * 2) | 0));
    for (let k = 0; k < sats; k++) {
      if (R() > 0.4) continue;
      const a = local[1 + ((R() * sats) | 0)], b = local[1 + ((R() * sats) | 0)];
      if (a !== b) tunnel(a.x, a.y, b.x, b.y, 1);
    }

    /* ---- the mouths: bore straight out through the rim to open ground ---- */
    const mouths = 2 + ((R() * 2) | 0);
    const mBase = R() * TAU;
    for (let k = 0; k < mouths; k++) {
      const a = mBase + (k / mouths) * TAU + (R() - 0.5) * 0.4;
      const ex = Math.round(cx + Math.cos(a) * (cr + 4));
      const ey = Math.round(cy + Math.sin(a) * (cr + 4));
      /* from the nearest chamber out past the rim */
      let from = local[0], bd = Infinity;
      for (const l of local) {
        const dd = Math.hypot(l.x - ex, l.y - ey);
        if (dd < bd) { bd = dd; from = l; }
      }
      tunnel(from.x, from.y, ex, ey, 2);   /* mouths stay wide enough to fight in */
      caveMouths.push({ x: ex * CELL, y: ey * CELL, zone: caveZones.length });
    }
    for (const l of local) rooms.push({ x: l.x * CELL, y: l.y * CELL, r: l.r * CELL });
  }

  /* ---- boulders on the surface, so open ground is not a blank sheet ---- */
  const out = spec.outcrops === undefined ? 110 : spec.outcrops;
  for (let k = 0; k < out; k++) {
    const a = R() * TAU, d = (0.1 + R() * 0.88) * W;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    if (Math.hypot(x, y) < 700) continue;              /* leave the drop zone alone */
    if (inCave(x, y)) continue;
    let near = false;
    for (const z of caveZones) if (Math.hypot(z.x - x, z.y - y) < z.r + 120) near = true;
    if (near) continue;
    fill(Math.round(x / CELL), Math.round(y / CELL), 1 + R() * 2.4);
  }

  if (!caveMouths.length) caveMouths.push({ x: 0, y: 0, zone: 0 });
  S.caveRooms = rooms;
}
