/* Small maths and helpers. Nothing in here knows what a Helldiver is. */
'use strict';

export const TAU = Math.PI * 2;
export const DEG = 57.29577951308232;

export function rand(a, b) { return a + Math.random() * (b - a); }
export function randi(a, b) { return a + ((Math.random() * (b - a + 1)) | 0); }
export function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

/* Exponential smoothing that lands in the same place whatever the frame rate.
   `Math.min(1, dt*k)` drifts: on a 144Hz screen it eases three times as far per
   second as on a 48Hz one, so the same camera feels different on two machines. */
export function ease(k, dt) { return 1 - Math.exp(-k * dt); }

/* shortest way round the circle, so a turn through north does not spin the long way */
export function angLerp(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
export function angDiff(a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }

/* does the swept segment (x1,y1)->(x2,y2) touch the circle (cx,cy,r)? */
export function segHit(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const px = x1 + dx * t - cx, py = y1 + dy * t - cy;
  return px * px + py * py <= r * r;
}

/* Fisher-Yates, in place. */
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* A deterministic little PRNG, so the host and a joining player can generate the
   same cave from the same seed instead of shipping every rock over the wire. */
export function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function el(id) { return document.getElementById(id); }
export function fmtTime(t) {
  const m = String(Math.floor(t / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  return m + ':' + s;
}
