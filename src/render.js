/* Drawing. Nothing in here changes the world -- it only looks at it. */
'use strict';
import { rand, clamp, TAU } from './util.js';
import { UI } from './config.js';
import { S, livingDiver, earX, earY } from './state.js';
import { G, CELL, gIndex, buildings, rubble, caveDepth } from './world.js';
import { FACTIONS, SENTRIES, WEAPONS, OBJECTIVES } from './data.js';
import { sporeLevel } from './objectives.js';
import { W_ } from './diver.js';
import { mouse } from './sim.js';

export let cv = null, ctx = null, lightCv = null, lctx = null;
export function bindCanvas(c) {
  cv = c; ctx = c.getContext('2d');
  lightCv = document.createElement('canvas');
  lctx = lightCv.getContext('2d');
}

/* ============================ GROUND ============================ */
function drawGround() {
  const M = S.map;
  ctx.fillStyle = M.ground;
  ctx.fillRect(0, 0, S.W, S.H);
}
function drawGrid() {
  const M = S.map;
  const G0 = M.cave ? 300 : M.city ? 215 : 160;
  const x0 = Math.floor((S.cam.x - S.W / 2) / G0) * G0, x1 = S.cam.x + S.W / 2;
  const y0 = Math.floor((S.cam.y - S.H / 2) / G0) * G0, y1 = S.cam.y + S.H / 2;
  ctx.strokeStyle = M.grid; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = x0; gx < x1; gx += G0) { ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); }
  for (let gy = y0; gy < y1; gy += G0) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
  ctx.stroke();
  if (M.city && !M.cave) {
    const P = 430;
    ctx.strokeStyle = 'rgba(255,210,30,.12)'; ctx.lineWidth = 2;
    ctx.setLineDash([22, 26]);
    ctx.beginPath();
    for (let gx = Math.floor(x0 / P) * P; gx < x1; gx += P) { ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); }
    for (let gy = Math.floor(y0 / P) * P; gy < y1; gy += P) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (M.grass) {
    /* a little scrub so the plains are not a blank sheet */
    ctx.fillStyle = 'rgba(90,110,70,.14)';
    const S0 = 97;
    for (let gx = Math.floor(x0 / S0) * S0; gx < x1; gx += S0)
      for (let gy = Math.floor(y0 / S0) * S0; gy < y1; gy += S0) {
        const h = ((gx * 73856093) ^ (gy * 19349663)) & 255;
        if (h > 96) continue;
        ctx.fillRect(gx + (h & 31), gy + ((h >> 3) & 31), 3 + (h & 3), 2);
      }
  }
  ctx.strokeStyle = M.border; ctx.lineWidth = 8;
  ctx.strokeRect(-S.world, -S.world, S.world * 2, S.world * 2);
}

/* ---- the standing world, straight off the cell grid ---- */
function drawCells() {
  if (!S.map.city || !G.solid) return;
  const vx0 = S.cam.x - S.W / 2 - 60, vx1 = S.cam.x + S.W / 2 + 60;
  const vy0 = S.cam.y - S.H / 2 - 60, vy1 = S.cam.y + S.H / 2 + 120;
  const cx0 = Math.floor(vx0 / CELL), cx1 = Math.ceil(vx1 / CELL);
  const cy0 = Math.floor(vy0 / CELL), cy1 = Math.ceil(vy1 / CELL);

  /* rubble first: it is what is left where the city used to be */
  for (const R of rubble) {
    if (R.x < vx0 || R.x > vx1 || R.y < vy0 || R.y > vy1) continue;
    ctx.save(); ctx.translate(R.x, R.y); ctx.rotate(R.rot);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-R.s / 2 + 2, -R.s / 2 + 2, R.s, R.s * 0.7);
    ctx.fillStyle = R.c; ctx.fillRect(-R.s / 2, -R.s / 2, R.s, R.s * 0.7);
    ctx.restore();
  }

  /* group visible cells by owner so each building is one path */
  const groups = new Map();
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const i = gIndex(cx, cy);
      if (i < 0 || !G.solid[i]) continue;
      const bid = G.bid[i];
      let g = groups.get(bid);
      if (!g) { g = []; groups.set(bid, g); }
      g.push(cx, cy, i);
    }
  }
  for (const [bid, list] of groups) {
    const b = bid >= 0 ? buildings[bid] : null;
    const cave = bid < 0;            /* living rock, not masonry */
    /* rock, lit only by whatever torch is pointing at it, has to sit clearly
       above the cave floor or the whole map reads as one black rectangle */
    const roof = b ? b.roof : '#584534';
    const side = b ? b.side : '#2a1d12';
    const ox = b ? b.tall * 0.5 : 5, oy = b ? b.tall * 0.6 : 6;
    const shiver = (b && b.collapse) ? rand(-2.5, 2.5) : 0;

    /* shadow */
    ctx.beginPath();
    for (let k = 0; k < list.length; k += 3)
      ctx.rect(list[k] * CELL + ox + shiver, list[k + 1] * CELL + oy, CELL, CELL);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();

    /* top face */
    ctx.beginPath();
    for (let k = 0; k < list.length; k += 3)
      ctx.rect(list[k] * CELL + shiver, list[k + 1] * CELL, CELL + 0.5, CELL + 0.5);
    ctx.fillStyle = roof; ctx.fill();

    /* exposed faces and torn edges */
    ctx.beginPath();
    let edge = false;
    for (let k = 0; k < list.length; k += 3) {
      const cx = list[k], cy = list[k + 1];
      const r = gIndex(cx + 1, cy), d = gIndex(cx, cy + 1);
      if (r < 0 || !G.solid[r]) { ctx.rect(cx * CELL + CELL + shiver, cy * CELL, ox, CELL); edge = true; }
      if (d < 0 || !G.solid[d]) { ctx.rect(cx * CELL + shiver, cy * CELL + CELL, CELL, oy); edge = true; }
    }
    if (edge) { ctx.fillStyle = side; ctx.fill(); }

    ctx.beginPath();
    for (let k = 0; k < list.length; k += 3) {
      const cx = list[k], cy = list[k + 1];
      const l = gIndex(cx - 1, cy), r = gIndex(cx + 1, cy);
      const u = gIndex(cx, cy - 1), d = gIndex(cx, cy + 1);
      const X = cx * CELL + shiver, Y = cy * CELL;
      if (l < 0 || !G.solid[l]) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + CELL); }
      if (r < 0 || !G.solid[r]) { ctx.moveTo(X + CELL, Y); ctx.lineTo(X + CELL, Y + CELL); }
      if (u < 0 || !G.solid[u]) { ctx.moveTo(X, Y); ctx.lineTo(X + CELL, Y); }
      if (d < 0 || !G.solid[d]) { ctx.moveTo(X, Y + CELL); ctx.lineTo(X + CELL, Y + CELL); }
    }
    ctx.strokeStyle = cave ? 'rgba(0,0,0,.85)' : 'rgba(0,0,0,.75)';
    ctx.lineWidth = 2; ctx.stroke();

    /* detail */
    for (let k = 0; k < list.length; k += 3) {
      const cx = list[k], cy = list[k + 1], i = list[k + 2];
      const X = cx * CELL + shiver, Y = cy * CELL;
      const dmg = 1 - G.hp[i] / Math.max(1, G.max[i]);
      const win = G.win[i];
      if (cave) {
        if (win) {                       /* a glowing seam in the rock */
          ctx.fillStyle = 'rgba(120,220,160,' + (0.16 + 0.1 * Math.sin(S.time * 2 + cx)) + ')';
          ctx.fillRect(X + 8, Y + 10, 12, 5);
        }
      } else {
        const w = win >> 1;
        if (w) {
          ctx.fillStyle = w === 2 ? 'rgba(255,226,150,.5)' : 'rgba(120,150,200,.18)';
          ctx.fillRect(X + 9, Y + 9, 9, 9);
        }
        if (win & 1) {
          ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(X + 8, Y + 8, 16, 14);
          ctx.fillStyle = 'rgba(150,160,185,.35)'; ctx.fillRect(X + 6, Y + 6, 16, 14);
        }
      }
      if (G.fresh[i] > S.time) {
        const fk = (G.fresh[i] - S.time) / 0.8;
        ctx.fillStyle = 'rgba(255,210,30,' + (0.35 * fk) + ')';
        ctx.fillRect(X, Y, CELL, CELL);
        ctx.strokeStyle = 'rgba(255,226,150,' + (0.8 * fk) + ')'; ctx.lineWidth = 2;
        ctx.strokeRect(X + 1, Y + 1, CELL - 2, CELL - 2);
      }
      if (dmg > 0.15) {
        ctx.fillStyle = 'rgba(0,0,0,' + (dmg * 0.55) + ')';
        ctx.fillRect(X, Y, CELL, CELL);
      }
    }
    if (b && b.neon && !b.collapse) {
      ctx.strokeStyle = b.neon; ctx.lineWidth = 2;
      ctx.globalAlpha = (0.5 + 0.25 * Math.sin(S.time * 2 + b.x * 0.01)) * (b.alive / b.total);
      ctx.strokeRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
      ctx.globalAlpha = 1;
    }
  }
}

/* ============================ ENEMIES ============================ */
function drawEnemy(e) {
  const T = e.T, F = FACTIONS[e.fac];
  const flash = e.hit > 0;
  const body = flash ? '#ffffff' : F.col;
  const dark = flash ? '#ffffff' : F.col2;
  const z = e.z || 0;

  /* shadow on the floor, offset for anything in the air */
  ctx.fillStyle = 'rgba(0,0,0,' + (z > 4 ? 0.22 : 0.32) + ')';
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + (z > 4 ? z * 0.35 : 5), e.r * (z > 4 ? 0.7 : 1.02), e.r * 0.68, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(e.x, e.y - z);
  ctx.rotate(e.face);

  if (e.fac === 'terminid') drawBug(e, T, body, dark);
  else if (e.fac === 'automaton') drawBot(e, T, body, dark);
  else drawSquid(e, T, body, dark);

  ctx.restore();

  /* telegraphs */
  if (e.cw > 0) {
    const tl = 340 * (1 - e.cw / (T.charge ? T.charge.wind : 1));
    ctx.strokeStyle = 'rgba(255,70,50,' + (0.3 + 0.45 * Math.abs(Math.sin(e.t * 24))) + ')';
    ctx.lineWidth = 4; ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x + Math.cos(e.cdir) * tl, e.y + Math.sin(e.cdir) * tl);
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (e.wind > 0) {
    ctx.strokeStyle = 'rgba(200,40,40,' + (0.35 + 0.4 * Math.sin(e.t * 28)) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(e.x, e.y, (T.slam ? T.slam.radius : e.r + 26), 0, TAU); ctx.stroke();
  }
  if (e.beamWind > 0) {
    const k = 1 - e.beamWind / (T.beam ? T.beam.wind : 1);
    ctx.strokeStyle = 'rgba(95,224,255,' + (0.3 + 0.5 * k) + ')';
    ctx.lineWidth = 2 + 4 * k;
    ctx.beginPath(); ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x + Math.cos(e.face) * T.beam.range, e.y + Math.sin(e.face) * T.beam.range);
    ctx.stroke();
  }
  if (e.burn > 0 && Math.random() < 0.5) {
    ctx.fillStyle = 'rgba(255,140,60,.5)';
    ctx.beginPath(); ctx.arc(e.x + rand(-e.r, e.r), e.y - z + rand(-e.r, e.r), rand(3, 8), 0, TAU); ctx.fill();
  }

  /* health, and a label for anything that deserves one */
  if (e.hp < e.max) {
    const w = e.size === 'large' ? 64 : e.size === 'medium' ? 40 : 22;
    const yy = e.y - z - e.r - (e.size === 'large' ? 18 : 12);
    ctx.fillStyle = '#000'; ctx.fillRect(e.x - w / 2, yy, w, e.size === 'small' ? 3 : 5);
    ctx.fillStyle = F.hud;
    ctx.fillRect(e.x - w / 2, yy, w * clamp(e.hp / e.max, 0, 1), e.size === 'small' ? 3 : 5);
  }
  if (e.size === 'large') {
    ctx.fillStyle = e.chg > 0 ? '#ff6b3d' : e.rec > 0 ? '#888' : F.hud;
    ctx.font = '10px Consolas'; ctx.textAlign = 'center';
    ctx.fillText(e.chg > 0 ? 'CHARGING' : e.rec > 0 ? 'WINDED' : T.name, e.x, e.y - z - e.r - 22);
  }
  if (T.armor >= 3) {
    ctx.strokeStyle = e.clang > 0 ? 'rgba(255,233,168,.9)' : 'rgba(255,255,255,.14)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y - z, e.r + 3, e.face - 1.1, e.face + 1.1); ctx.stroke();
  }
}
/* ---- Terminids ----
   Six of them, and they used to be one drawing at six radii: an orange oval with
   legs, scaled up. You could not tell a Hunter about to jump on you from a
   Scavenger you could ignore until it was on top of you, which is a gameplay
   problem dressed as an art one. Each has its own silhouette now, built from the
   same chitin so they still read as one faction:

     SCAVENGER   small, narrow, antennae, scuttling
     HUNTER      folded jumping legs and forward sickles
     BILE WARRIOR broad plated carapace, heavy mandibles
     BILE SPEWER  an abdomen the size of the rest of it, and it is full
     CHARGER      an armoured wedge with a body behind it
     BILE TITAN   all of the above, eight legs, and a sac                        */
function drawBug(e, T, body, dark) {
  const r = e.r, art = T.art;
  const fast = art === 'scav' || art === 'hunter';
  const gait = Math.sin(e.t * (e.size === 'large' ? 5 : fast ? 13 : 9));

  if (art === 'hunter') { drawHunter(e, T, body, dark, gait); return; }
  if (art === 'charger') { drawCharger(e, T, body, dark, gait); return; }

  /* ---- legs ---- */
  const legs = T.legs || 6;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(2, r * (art === 'warrior' ? 0.17 : art === 'titan' ? 0.15 : 0.12));
  ctx.lineCap = 'round';
  for (let i = 0; i < legs; i++) {
    const side = i % 2 ? 1 : -1;
    const k = (i >> 1) / Math.max(1, (legs >> 1) - 1 || 1);
    const bx = -r * 0.4 + k * r * 0.9;
    const sw = gait * side * (0.3 + k * 0.3);
    const reach = art === 'spewer' ? 1.05 : 1.25;
    ctx.beginPath();
    ctx.moveTo(bx, side * r * 0.4);
    /* a knee, so the legs read as legs rather than as whiskers */
    ctx.lineTo(bx + sw * r * 0.35, side * (r * 0.82 + Math.abs(sw) * r * 0.12));
    ctx.lineTo(bx + sw * r * 0.5, side * (r * reach + Math.abs(sw) * r * 0.2));
    ctx.stroke();
  }

  /* ---- abdomen ---- */
  const sac = art === 'spewer' ? 1.9 : art === 'titan' ? 1.25 : art === 'warrior' ? 0.85 : 0.75;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(-r * (art === 'spewer' ? 0.62 : 0.55), 0, r * 0.42 * sac, r * 0.4 * sac, 0, 0, TAU);
  ctx.fill();
  if (art === 'spewer') {
    /* it is full, and it sloshes */
    ctx.fillStyle = e.hit > 0 ? '#ffffff' : 'rgba(199,209,58,.5)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.66, Math.sin(e.t * 3) * r * 0.06, r * 0.56, r * 0.46, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(199,209,58,.85)';
    for (let i = 0; i < 3; i++) {
      const a = 2.2 + i * 0.5;
      ctx.beginPath();
      ctx.arc(-r * 0.66 + Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.34, r * 0.09, 0, TAU);
      ctx.fill();
    }
  }

  /* ---- thorax ---- */
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(r * 0.05, 0, r * (art === 'scav' ? 0.66 : 0.78), r * (art === 'scav' ? 0.44 : 0.6),
              0, 0, TAU);
  ctx.fill();
  if (art === 'warrior' || art === 'titan') {
    /* plates: this is the armour the CLANG is coming from */
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    for (let i = 0; i < 3; i++) {
      const px = -r * 0.25 + i * r * 0.32;
      ctx.beginPath();
      ctx.arc(px, 0, r * 0.5, -1.15, 1.15);
      ctx.stroke();
    }
  }

  /* ---- head and mandibles ---- */
  const hs = art === 'spewer' ? 0.26 : art === 'warrior' ? 0.4 : 0.34;
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(r * 0.78, 0, r * hs, r * hs * 0.88, 0, 0, TAU); ctx.fill();
  const mo = Math.abs(Math.sin(e.t * (fast ? 12 : 8))) * r * 0.14;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1.6, r * (art === 'warrior' ? 0.15 : 0.1));
  ctx.beginPath();
  const ml = art === 'warrior' ? 1.5 : art === 'titan' ? 1.45 : 1.3;
  ctx.moveTo(r * 0.9, -r * 0.16 - mo); ctx.lineTo(r * ml, -r * 0.06 - mo);
  ctx.moveTo(r * 0.9, r * 0.16 + mo); ctx.lineTo(r * ml, r * 0.06 + mo);
  ctx.stroke();
  if (art === 'scav') {
    /* antennae, permanently twitching */
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(r * 0.85, -r * 0.2);
    ctx.lineTo(r * 1.35, -r * 0.5 + Math.sin(e.t * 14) * r * 0.14);
    ctx.moveTo(r * 0.85, r * 0.2);
    ctx.lineTo(r * 1.35, r * 0.5 + Math.sin(e.t * 14 + 1) * r * 0.14);
    ctx.stroke();
  }
  if (art === 'spewer') {
    /* the nozzle, aimed at you */
    ctx.fillStyle = 'rgba(199,209,58,.9)';
    ctx.beginPath(); ctx.arc(r * 1.0, 0, r * 0.12, 0, TAU); ctx.fill();
  }
  if (e.size !== 'small') {
    ctx.fillStyle = 'rgba(255,240,150,.85)';
    ctx.beginPath(); ctx.arc(r * 0.82, -r * 0.12, r * 0.08, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.82, r * 0.12, r * 0.08, 0, TAU); ctx.fill();
  }
  if (art === 'titan') {                   /* the sac, and the spines over it */
    ctx.fillStyle = 'rgba(199,209,58,.55)';
    ctx.beginPath(); ctx.ellipse(-r * 0.62, 0, r * 0.44, r * 0.38, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.5);
      ctx.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.95); ctx.stroke();
    }
  }
}
/* the one that is about to be on top of you: coiled back legs, sickles forward */
function drawHunter(e, T, body, dark, gait) {
  const r = e.r, air = (e.z || 0) > 2;
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(2, r * 0.15);
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    /* hind legs: folded when coiled, straight out when it is in the air */
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, side * r * 0.35);
    if (air) ctx.lineTo(-r * 1.2, side * r * 0.9);
    else {
      ctx.lineTo(-r * 0.55, side * r * 1.05);
      ctx.lineTo(-r * 0.05 + gait * r * 0.2, side * r * 0.95);
    }
    ctx.stroke();
    /* front legs, reaching */
    ctx.lineWidth = Math.max(1.6, r * 0.11);
    ctx.beginPath();
    ctx.moveTo(r * 0.3, side * r * 0.3);
    ctx.lineTo(r * 0.95 + gait * r * 0.15, side * r * 0.75);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, r * 0.15);
  }
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(-r * 0.5, 0, r * 0.42, r * 0.34, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(r * 0.1, 0, r * 0.72, r * 0.45, 0, 0, TAU); ctx.fill();
  /* wing cases, flared while it is airborne */
  ctx.fillStyle = dark;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.rotate(side * (air ? 0.6 : 0.18));
    ctx.beginPath(); ctx.ellipse(-r * 0.1, side * r * 0.3, r * 0.5, r * 0.16, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(r * 0.8, 0, r * 0.3, r * 0.24, 0, 0, TAU); ctx.fill();
  /* the sickles */
  ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = Math.max(1.8, r * 0.12);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(r * 0.85, side * r * 0.35, r * 0.45, side > 0 ? -1.5 : 0.2, side > 0 ? -0.2 : 1.5);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffec9e';
  ctx.beginPath(); ctx.arc(r * 0.9, -r * 0.1, r * 0.09, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.9, r * 0.1, r * 0.09, 0, TAU); ctx.fill();
}
/* mostly a face full of armour with an animal somewhere behind it */
function drawCharger(e, T, body, dark, gait) {
  const r = e.r;
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(3, r * 0.22);
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1, k = i >> 1;
    const bx = -r * 0.35 + k * r * 0.75;
    const sw = Math.sin(e.t * (e.chg > 0 ? 14 : 6) + k * 2) * side * 0.4;
    ctx.beginPath();
    ctx.moveTo(bx, side * r * 0.45);
    ctx.lineTo(bx + sw * r * 0.3, side * r * 0.85);
    ctx.lineTo(bx + sw * r * 0.55, side * r * 1.15);
    ctx.stroke();
  }
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(-r * 0.6, 0, r * 0.45, r * 0.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(-r * 0.05, 0, r * 0.72, r * 0.62, 0, 0, TAU); ctx.fill();
  /* the wedge: a slab of armour across the front, lit when it is committed */
  ctx.fillStyle = e.hit > 0 ? '#ffffff' : (e.chg > 0 ? '#e8c07a' : '#b98a4c');
  ctx.beginPath();
  ctx.moveTo(r * 1.35, 0);
  ctx.lineTo(r * 0.35, -r * 0.78);
  ctx.lineTo(r * 0.1, 0);
  ctx.lineTo(r * 0.35, r * 0.78);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#2a1c10';
  ctx.beginPath(); ctx.arc(r * 0.55, -r * 0.3, r * 0.08, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.55, r * 0.3, r * 0.08, 0, TAU); ctx.fill();
}
/* ---- Automaton: flat plates, one red eye, and a lot of right angles.
   Everything is longer than it is wide, so which way it is facing reads at a
   glance -- a square body just turns into a diamond and tells you nothing. ---- */
function drawBot(e, T, body, dark) {
  const r = e.r, step = Math.sin(e.t * 8) * r * 0.28;

  /* legs, striding */
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(2.5, r * 0.2);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, -r * 0.42); ctx.lineTo(-r * 0.15 + step, -r * 0.95);
  ctx.moveTo(-r * 0.15, r * 0.42); ctx.lineTo(-r * 0.15 - step, r * 0.95);
  ctx.stroke();

  /* torso: a slab, with the back plate darker so the front is obvious */
  ctx.fillStyle = dark;
  ctx.fillRect(-r * 0.95, -r * 0.5, r * 0.5, r * 1.0);
  ctx.fillStyle = body;
  ctx.fillRect(-r * 0.5, -r * 0.52, r * 1.15, r * 1.04);
  /* shoulder pauldrons */
  ctx.fillStyle = dark;
  ctx.fillRect(-r * 0.35, -r * 0.78, r * 0.6, r * 0.28);
  ctx.fillRect(-r * 0.35, r * 0.5, r * 0.6, r * 0.28);

  /* head, jutting forward, with the eye everyone learns to look for */
  ctx.fillStyle = dark;
  ctx.fillRect(r * 0.6, -r * 0.3, r * 0.5, r * 0.6);
  ctx.fillStyle = 'rgba(255,59,47,.35)';
  ctx.fillRect(r * 0.95, -r * 0.22, r * 0.3, r * 0.44);
  ctx.fillStyle = '#ff3b2f';
  ctx.fillRect(r * 1.0, -r * 0.11, r * 0.22, r * 0.22);

  if (T.ranged && !T.boss) {               /* the rifle it is pointing at you */
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(r * 0.35, r * 0.22, r * 1.15, r * 0.18);
    ctx.fillStyle = dark;
    ctx.fillRect(r * 0.3, r * 0.12, r * 0.3, r * 0.34);
  }
  if (T.shield) {                          /* the slab it hides behind */
    ctx.fillStyle = '#7a8088';
    ctx.fillRect(r * 0.6, -r * 1.05, r * 0.34, r * 2.1);
    ctx.fillStyle = '#575d64';
    ctx.fillRect(r * 0.6, -r * 1.05, r * 0.34, r * 0.5);
    ctx.strokeStyle = '#2f343a'; ctx.lineWidth = 2;
    ctx.strokeRect(r * 0.6, -r * 1.05, r * 0.34, r * 2.1);
  }
  if (T.saw) {                             /* two of them, and they are spinning */
    const sa = e.t * 40;
    ctx.strokeStyle = '#d2d2d2'; ctx.lineWidth = 3;
    for (const sy of [-r * 0.55, r * 0.55]) {
      ctx.beginPath(); ctx.arc(r * 0.95, sy, r * 0.4, sa, sa + 4.2); ctx.stroke();
    }
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.4); ctx.lineTo(r * 0.9, -r * 0.55);
    ctx.moveTo(r * 0.2, r * 0.4); ctx.lineTo(r * 0.9, r * 0.55);
    ctx.stroke();
  }
  if (T.boss) {                            /* the Strider: four legs and a gantry */
    ctx.strokeStyle = dark; ctx.lineWidth = r * 0.13;
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? -1 : 1, k = i % 2;
      const bx = -r * 0.45 + k * r * 0.8;
      const sw = Math.sin(e.t * 4 + i * 1.7) * r * 0.32;
      ctx.beginPath();
      ctx.moveTo(bx, side * r * 0.5);
      ctx.lineTo(bx + sw, side * r * 1.55);
      ctx.stroke();
    }
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(r * 0.3, -r * 0.5, r * 1.5, r * 0.22);
    ctx.fillRect(r * 0.3, r * 0.28, r * 1.5, r * 0.22);
    ctx.fillStyle = 'rgba(255,60,45,.3)';
    ctx.fillRect(-r * 0.95, -r * 0.24, r * 0.4, r * 0.48);
  }
}
/* ---- Illuminate: smooth, lit from inside, and mostly off the ground ---- */
function drawSquid(e, T, body, dark) {
  const r = e.r, art = T.art;
  if (art === 'fleshmob') {                /* the Fleshmob is its own thing */
    const sq = e.wind > 0 ? 1 + 0.18 * Math.sin(e.t * 30) : 1;
    ctx.fillStyle = e.hit > 0 ? '#ffffff' : '#4a3a34';
    for (let lm = 0; lm < 5; lm++) {
      const la = (lm / 5) * TAU + Math.sin(e.t * 2.4 + lm) * 0.5;
      ctx.save(); ctx.rotate(la);
      ctx.fillRect(r - 6, -3.5, 18 + Math.sin(e.t * 5 + lm) * 5, 7);
      ctx.restore();
    }
    ctx.fillStyle = e.hit > 0 ? '#ffffff' : '#8d6f66';
    ctx.beginPath(); ctx.ellipse(0, 0, r * sq, r * 0.92 * sq, 0, 0, TAU); ctx.fill();
    for (let lp = 0; lp < (e.lumps ? e.lumps.length : 0); lp++) {
      const L = e.lumps[lp];
      const lx = Math.cos(L.a + Math.sin(e.t * 1.6 + L.ph) * 0.25) * L.d;
      const ly = Math.sin(L.a + Math.sin(e.t * 1.6 + L.ph) * 0.25) * L.d;
      ctx.fillStyle = e.hit > 0 ? '#ffffff' : (lp % 2 ? '#9c7d72' : '#7d6058');
      ctx.beginPath(); ctx.arc(lx, ly, L.s * (0.9 + 0.1 * Math.sin(e.t * 3 + L.ph)) * sq, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#5e2222';
    for (let ey = 0; ey < 4; ey++) {
      const ea = (ey / 4) * TAU + e.wob;
      ctx.beginPath(); ctx.arc(Math.cos(ea) * 12, Math.sin(ea) * 12, 3, 0, TAU); ctx.fill();
    }
    return;
  }
  if (art === 'voteless') {                /* a shambling body, not a squid */
    const lean = Math.sin(e.t * 9) * 0.25;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(2, -9 + lean * 6, 14, 4);
    ctx.fillRect(2, 5 + lean * 6, 14, 4);
    ctx.fillStyle = e.hit > 0 ? '#ffffff' : '#5b3a82';
    ctx.beginPath(); ctx.ellipse(-4, 0, r * 0.55, r * 0.62, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e04bd0';
    ctx.beginPath(); ctx.arc(5, 0, 3.2, 0, TAU); ctx.fill();
    return;
  }
  const pulse = 0.85 + 0.15 * Math.sin(e.t * 3 + e.bob);
  ctx.fillStyle = 'rgba(63,208,224,' + (0.13 * pulse) + ')';
  ctx.beginPath(); ctx.arc(0, 0, r * 1.7, 0, TAU); ctx.fill();

  if (art === 'watcher') {
    /* an eye on a ring: no body to speak of, and it is looking at you */
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(2, r * 0.16);
    const spin = e.t * 1.6;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.95 * Math.abs(Math.cos(spin)), 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.fill();
    ctx.fillStyle = '#eaffff';
    ctx.beginPath(); ctx.arc(r * 0.16, 0, r * 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3fd0e0';
    ctx.beginPath(); ctx.arc(r * 0.26, 0, r * 0.15, 0, TAU); ctx.fill();
    /* the beam it is painting you with, when it is about to call something in */
    if (e.spotT !== undefined && e.spotT < 1.2) {
      ctx.strokeStyle = 'rgba(95,224,255,.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r * 0.4, 0); ctx.lineTo(r * 3.2, 0); ctx.stroke();
    }
    return;
  }
  if (art === 'overseer') {
    /* upright, cloaked, and carrying the thing it shoots you with */
    ctx.fillStyle = dark;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (i - 2) * 0.32;
      ctx.save(); ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(r * 0.95, 0, r * 0.55, r * 0.16 + Math.sin(e.t * 4 + i) * 2, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(-r * 0.05, 0, r * 0.62, r * 0.82, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(r * 0.5, 0, r * 0.34, r * 0.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(95,224,255,' + (0.8 * pulse) + ')';
    ctx.beginPath(); ctx.arc(r * 0.62, 0, r * 0.13, 0, TAU); ctx.fill();
    /* the staff */
    ctx.strokeStyle = '#cfd6e6'; ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.beginPath(); ctx.moveTo(r * 0.2, r * 0.55); ctx.lineTo(r * 1.25, r * 0.2); ctx.stroke();
    ctx.fillStyle = '#5fe0ff';
    ctx.beginPath(); ctx.arc(r * 1.3, r * 0.18, r * 0.13, 0, TAU); ctx.fill();
    return;
  }
  if (art === 'harvester') {
    /* a tripod: three jointed legs and a hull slung between them */
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(3, r * 0.12);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + e.t * 0.25;
      const knee = Math.sin(e.t * 3 + i * 2) * r * 0.22;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35);
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95 - r * 0.35 - knee);
      ctx.lineTo(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5 + knee);
      ctx.stroke();
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.85, r * 0.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(r * 0.55, 0, r * 0.4, r * 0.34, 0, 0, TAU); ctx.fill();
    /* the emitter, which brightens as it winds up */
    const heat = e.beamT > 0 ? 1 : e.beamWind > 0 ? 0.6 : 0.2 * pulse;
    ctx.fillStyle = 'rgba(95,224,255,' + heat + ')';
    ctx.beginPath(); ctx.arc(r * 0.85, 0, r * 0.2 * (0.7 + heat * 0.6), 0, TAU); ctx.fill();
    return;
  }
  if (art === 'leviathan') {
    /* the big one: a long hull with wings, and a lot of underside */
    ctx.fillStyle = dark;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, side * r * 0.2);
      ctx.quadraticCurveTo(r * 0.1, side * (r * 1.35 + Math.sin(e.t * 1.6) * r * 0.12),
                           -r * 0.95, side * r * 0.95);
      ctx.quadraticCurveTo(-r * 0.6, side * r * 0.4, -r * 0.2, side * r * 0.2);
      ctx.fill();
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.05, r * 0.46, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-r * 0.75, 0, r * 0.35, r * 0.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(95,224,255,' + (0.5 * pulse) + ')';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(-r * 0.4 + i * r * 0.35, 0, r * 0.11, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#eaffff';
    ctx.beginPath(); ctx.arc(r * 0.92, 0, r * 0.14, 0, TAU); ctx.fill();
    return;
  }
  /* anything else that floats: a shell, a glow and tendrils */
  ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI + (i - 1.5) * 0.35;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3 + Math.sin(e.t * 5 + i) * 4);
    ctx.stroke();
  }
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.92, r * 0.7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(95,224,255,' + (0.55 * pulse) + ')';
  ctx.beginPath(); ctx.ellipse(r * 0.2, 0, r * 0.4, r * 0.3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#eaffff';
  ctx.beginPath(); ctx.arc(r * 0.5, 0, r * 0.14, 0, TAU); ctx.fill();
}
/* ============================ DIVERS ============================ */
function drawCape(P) {
  const c = P.cape;
  if (!c || c.length < 2) return;
  const n = c.length, left = [], right = [];
  for (let i = 0; i < n; i++) {
    let ax, ay;
    if (i === 0) { ax = c[1].x - c[0].x; ay = c[1].y - c[0].y; }
    else { ax = c[i].x - c[i - 1].x; ay = c[i].y - c[i - 1].y; }
    const d = Math.hypot(ax, ay) || 1;
    const nx = -ay / d, ny = ax / d;
    const k = i / (n - 1);
    const wdt = 10 - 6 * k * k;
    left.push([c[i].x + nx * wdt, c[i].y + ny * wdt]);
    right.push([c[i].x - nx * wdt, c[i].y - ny * wdt]);
  }
  const path = off => {
    ctx.beginPath();
    ctx.moveTo(left[0][0] + off, left[0][1] + off);
    for (let i = 1; i < n; i++) ctx.lineTo(left[i][0] + off, left[i][1] + off);
    for (let j = n - 1; j >= 0; j--) ctx.lineTo(right[j][0] + off, right[j][1] + off);
    ctx.closePath();
  };
  path(5); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  path(0);
  const g = ctx.createLinearGradient(c[0].x, c[0].y, c[n - 1].x, c[n - 1].y);
  g.addColorStop(0, '#ffd21e'); g.addColorStop(0.55, '#e0a80f'); g.addColorStop(1, '#a97a07');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#1a1508'; ctx.lineWidth = 1.5; ctx.stroke();
}
function drawDiverTag(P) {
  const mine = P === S.me;
  ctx.font = (mine ? '10px' : 'bold 10px') + ' Consolas'; ctx.textAlign = 'center';
  ctx.globalAlpha = mine ? 0.55 : 1;
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillText(P.name, P.x + 1, P.y - 35);
  ctx.fillStyle = mine ? '#ffd21e' : '#b8e6c0'; ctx.fillText(P.name, P.x, P.y - 36);
  ctx.globalAlpha = 1;
  const h = clamp((P.hpShow === undefined ? P.hp : P.hpShow) / P.maxhp, 0, 1);
  const g = clamp((P.hpGhost === undefined ? P.hp : P.hpGhost) / P.maxhp, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(P.x - 17, P.y - 31, 34, 4);
  if (g > h) { ctx.fillStyle = '#5e1a1f'; ctx.fillRect(P.x - 16.5, P.y - 30.5, 33 * g, 3); }
  ctx.fillStyle = P.stimT > 0 ? '#78ffa0' : h > 0.5 ? '#4fb477' : h > 0.25 ? '#ffd21e' : '#c1121f';
  ctx.fillRect(P.x - 16.5, P.y - 30.5, 33 * h, 3);
  if (P.shieldMax > 0 && P.shield > 0) {
    ctx.fillStyle = '#7fd4ff';
    ctx.fillRect(P.x - 16.5, P.y - 26.5, 33 * clamp(P.shield / P.shieldMax, 0, 1), 2);
  }
}
function drawDiver(P) {
  if (P.inPod || P.dead) return;
  if (P === S.me) {
    ctx.strokeStyle = 'rgba(255,90,60,.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P.x, P.y);
    ctx.lineTo(P.x + Math.cos(P.ang + P.kick) * 900, P.y + Math.sin(P.ang + P.kick) * 900);
    ctx.stroke();
  }
  drawCape(P);
  ctx.save(); ctx.translate(P.x, P.y);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(0, 6, 17, 11, 0, 0, TAU); ctx.fill();
  if (P.stimT > 0) {
    ctx.strokeStyle = 'rgba(120,255,160,' + (0.25 + 0.2 * Math.sin(S.time * 10)) + ')';
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.stroke();
  }
  if (P.guard > 0) {
    ctx.strokeStyle = 'rgba(255,210,30,' + (0.25 + 0.35 * Math.abs(Math.sin(S.time * 18))) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 25 + 3 * Math.sin(S.time * 18), 0, TAU); ctx.stroke();
  }
  if (P.shieldMax > 0 && P.shield > 0) {
    const k = P.shield / P.shieldMax;
    ctx.strokeStyle = 'rgba(127,212,255,' + (0.18 + 0.26 * k) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(127,212,255,' + (0.06 * k) + ')';
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.fill();
  }
  if (P.burn > 0) {
    ctx.fillStyle = 'rgba(255,140,60,.45)';
    ctx.beginPath(); ctx.arc(rand(-9, 9), rand(-9, 9), rand(4, 9), 0, TAU); ctx.fill();
  }
  ctx.rotate(P.ang + P.kick * 0.7);
  ctx.fillStyle = P === S.me ? '#2f3a4a' : '#3a4a38';
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffd21e'; ctx.fillRect(-16, -4, 6, 8);
  const w = W_(P);
  const gl = w.id === 'pistol' ? 16 : w.id === 'recoilless' ? 34 : w.id === 'mg43' ? 30 : 26;
  ctx.fillStyle = '#1d232c'; ctx.fillRect(6 - P.punch, -4, gl, 8);
  if (w.id === 'flamer') { ctx.fillStyle = '#8a3a1a'; ctx.fillRect(6 - P.punch, -5, 10, 10); }
  if (w.id === 'arc') { ctx.fillStyle = '#9fe8ff'; ctx.fillRect(gl, -3, 5, 6); }
  ctx.fillStyle = '#8fa3b8'; ctx.beginPath(); ctx.arc(5, 0, 6, 0, TAU); ctx.fill();
  ctx.restore();

  if (P.carrying) {                        /* both hands on a live artillery shell */
    ctx.fillStyle = '#ff8a3d';
    ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.ang);
    ctx.fillRect(8, -5, 20, 10);
    ctx.fillStyle = '#ffd21e'; ctx.fillRect(24, -5, 5, 10);
    ctx.restore();
  }
  if (P.melee > 0) {
    const mk = 1 - P.melee / 0.24;
    ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.ang - 1.0 + 2.0 * mk);
    ctx.strokeStyle = 'rgba(232,228,216,' + (0.75 * (1 - mk)) + ')';
    ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, 46, -0.5, 0.5); ctx.stroke();
    ctx.restore();
  }
  if (P.reloading > 0) {
    ctx.fillStyle = '#000'; ctx.fillRect(P.x - 20, P.y - 30, 40, 5);
    ctx.fillStyle = '#ffd21e';
    ctx.fillRect(P.x - 20, P.y - 30, 40 * (1 - P.reloading / W_(P).reload), 5);
  }
  if (P !== S.me || UI.hp !== 'bottom') drawDiverTag(P);
}

/* what each thing lying on the ground looks like, and what it is called */
const PICKLOOK = {
  supply:      { col: '#ffd21e', glow: 'rgba(255,210,30,.13)', label: '[E] SUPPLIES' },
  weapon:      { col: '#c6ff6b', glow: 'rgba(198,255,107,.14)', label: '[E] WEAPON' },
  sample:      { col: '#ffd21e', glow: 'rgba(255,210,30,.20)', label: '[E] SAMPLE' },
  shell:       { col: '#ff8a3d', glow: 'rgba(255,138,61,.16)', label: '[E] SEAF SHELL' },
  shield:      { col: '#7fd4ff', glow: 'rgba(127,212,255,.16)', label: '[E] SHIELD PACK' },
  dog:         { col: '#c6ff6b', glow: 'rgba(198,255,107,.14)', label: '[E] GUARD DOG' },
  requisition: { col: '#9fe8ff', glow: 'rgba(159,232,255,.16)', label: '[E] REQUISITION' }
};

/* ============================ OBJECTIVES ============================ */
function drawObjective(o) {
  const t = S.time;
  ctx.save();
  if (o.field) {
    ctx.strokeStyle = 'rgba(255,107,61,' + (0.12 + 0.06 * Math.sin(t * 2)) + ')';
    ctx.lineWidth = 3; ctx.setLineDash([26, 22]);
    ctx.beginPath(); ctx.arc(o.x, o.y, o.field, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.kind === 'hold') {
    const k = clamp(o.prog / o.D.time, 0, 1);
    ctx.fillStyle = 'rgba(127,212,255,' + (o.active ? 0.14 : 0.07) + ')';
    ctx.beginPath(); ctx.arc(o.x, o.y, o.radius, 0, TAU); ctx.fill();
    ctx.strokeStyle = o.col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.radius, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ffd21e'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.radius - 6, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    /* the terminal itself */
    ctx.fillStyle = '#2a2f24'; ctx.fillRect(o.x - 16, o.y - 22, 32, 34);
    ctx.fillStyle = o.col; ctx.fillRect(o.x - 12, o.y - 18, 24, 14);
    ctx.fillStyle = (Math.floor(t * 4) % 2) ? '#ffd21e' : '#4a4a3a';
    ctx.fillRect(o.x - 10, o.y + 1, 20, 4);
  } else if (o.kind === 'destroy') {
    const k = clamp(o.hp / o.max, 0, 1);
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.spin);
    ctx.fillStyle = '#3a3f46';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * o.radius, Math.sin(a) * o.radius);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = o.col;
    ctx.beginPath(); ctx.arc(0, 0, o.radius * 0.55 * (0.85 + 0.15 * Math.sin(t * 5)), 0, TAU); ctx.fill();
    ctx.restore();
    /* the mast */
    ctx.strokeStyle = '#4a4f56'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - 54); ctx.stroke();
    ctx.fillStyle = (Math.floor(t * 3) % 2) ? '#ff3b2f' : '#601a14';
    ctx.beginPath(); ctx.arc(o.x, o.y - 58, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#000'; ctx.fillRect(o.x - 34, o.y - 78, 68, 6);
    ctx.fillStyle = o.col; ctx.fillRect(o.x - 34, o.y - 78, 68 * k, 6);
  } else {
    /* a gun, or a collection point */
    ctx.fillStyle = '#2a2f24';
    ctx.beginPath(); ctx.arc(o.x, o.y, o.radius || 26, 0, TAU); ctx.fill();
    ctx.strokeStyle = o.col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.radius || 26, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#3d4636';
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(-0.6);
    ctx.fillRect(0, -8, 46, 16); ctx.restore();
  }
  ctx.fillStyle = o.col; ctx.font = 'bold 11px Consolas'; ctx.textAlign = 'center';
  ctx.fillText(o.name, o.x, o.y - (o.kind === 'destroy' ? 88 : o.radius + 14));
  if (o.kind === 'collect' || o.kind === 'carry') {
    ctx.fillStyle = '#e8e4d8'; ctx.font = '11px Consolas';
    ctx.fillText(o.have + ' / ' + o.need, o.x, o.y - (o.radius + 2));
  }
  ctx.restore();
}

/* ============================ THE FRAME ============================ */
export function draw() {
  const sx = (Math.random() - 0.5) * S.shake, sy = (Math.random() - 0.5) * S.shake;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawGround();
  ctx.translate(S.W / 2 - S.cam.x + sx + S.camKick.x, S.H / 2 - S.cam.y + sy + S.camKick.y);
  drawGrid();

  /* scorch marks and puddles, under everything */
  for (const d of S.decals) {
    ctx.globalAlpha = clamp(d.life / Math.min(4, d.max), 0, 1) * 0.9;
    ctx.fillStyle = d.col;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const c of S.corpses) {
    ctx.globalAlpha = Math.min(1, c.life / 3) * 0.6;
    ctx.fillStyle = c.c || '#3a2a1a';
    ctx.beginPath(); ctx.ellipse(c.x, c.y, (c.r || 15) * 1.1, (c.r || 15) * 0.7, c.a, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawCells();

  for (const j of S.junk) {
    ctx.save(); ctx.translate(j.x, j.y); ctx.rotate(j.rot);
    ctx.globalAlpha = Math.min(1, j.life / 2);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-16, -3, 34, 10);
    ctx.fillStyle = '#2b2f22'; ctx.fillRect(-18, -5, 34, 10);
    ctx.fillStyle = '#55503f'; ctx.fillRect(-18, -5, 34, 3);
    ctx.restore(); ctx.globalAlpha = 1;
  }

  for (const o of S.objectives) drawObjective(o);

  /* pickups */
  ctx.textAlign = 'center';
  for (const pk of S.pickups) {
    const bob = Math.sin(pk.bob * 3) * 3;
    ctx.save(); ctx.translate(pk.x, pk.y + bob);
    const P = PICKLOOK[pk.kind] || PICKLOOK.supply;
    const col = P.col;
    const label = pk.kind === 'weapon'
      ? '[E] ' + (WEAPONS[pk.wep] ? WEAPONS[pk.wep].name : 'WEAPON') : P.label;
    ctx.fillStyle = P.glow;
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.fill();
    if (pk.kind === 'sample') {
      ctx.fillStyle = '#2b2f22'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 6 + Math.sin(S.time * 4) * 1.4, 0, TAU); ctx.fill();
    } else if (pk.kind === 'shell') {
      ctx.fillStyle = '#3a3422'; ctx.fillRect(-8, -16, 16, 32);
      ctx.fillStyle = col; ctx.fillRect(-8, -16, 16, 8);
    } else if (pk.kind === 'weapon') {
      ctx.fillStyle = '#2b2f22'; ctx.fillRect(-20, -7, 40, 14);
      ctx.fillStyle = col; ctx.fillRect(-20, -7, 40, 3);
    } else {
      ctx.fillStyle = '#3a3422'; ctx.fillRect(-14, -12, 28, 24);
      ctx.fillStyle = col; ctx.fillRect(-14, -12, 28, 4); ctx.fillRect(-2, -8, 4, 20);
    }
    ctx.fillStyle = '#e8e4d8'; ctx.font = '11px Consolas';
    ctx.fillText(label, 0, -20);
    ctx.restore();
  }

  /* sentries */
  for (const st of S.sentries) {
    const D = st.D || SENTRIES.gatling;
    ctx.save(); ctx.translate(st.x, st.y);
    if (st.dying > 0) ctx.globalAlpha = Math.max(0, st.dying / 1.1);
    ctx.fillStyle = '#2a2f24'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill();
    ctx.strokeStyle = D.col; ctx.lineWidth = 2; ctx.stroke();
    if (D.arc) {
      ctx.strokeStyle = 'rgba(159,232,255,' + (0.2 + 0.2 * Math.sin(S.time * 6)) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, D.range, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#9fe8ff';
      ctx.fillRect(-3, -34, 6, 34);
      ctx.beginPath(); ctx.arc(0, -38, 7, 0, TAU); ctx.fill();
    } else {
      ctx.rotate(st.ang);
      ctx.fillStyle = '#3d4636'; ctx.fillRect(0, -7, D.lob ? 26 : 34, 14);
      ctx.fillStyle = D.col; ctx.fillRect(D.lob ? 20 : 28, -3, 10, 6);
    }
    ctx.restore(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#111'; ctx.fillRect(st.x - 22, st.y - 36, 44, 4);
    ctx.fillStyle = D.col; ctx.fillRect(st.x - 22, st.y - 36, 44 * clamp(st.hp / st.max, 0, 1), 4);
    ctx.fillStyle = '#111'; ctx.fillRect(st.x - 22, st.y - 31, 44, 3);
    ctx.fillStyle = '#ffd21e'; ctx.fillRect(st.x - 22, st.y - 31, 44 * clamp(st.ammo / st.maxAmmo, 0, 1), 3);
  }

  /* guard dogs */
  for (const d of S.drones) {
    ctx.save(); ctx.translate(d.x, d.y - 26); ctx.rotate(d.ang);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(0, 26, 8, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2b2f22'; ctx.fillRect(-8, -5, 16, 10);
    ctx.fillStyle = '#c6ff6b'; ctx.fillRect(6, -2, 8, 4);
    ctx.strokeStyle = 'rgba(198,255,107,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  /* the horde, culled to what is on screen */
  const vx0 = S.cam.x - S.W / 2 - 120, vx1 = S.cam.x + S.W / 2 + 120;
  const vy0 = S.cam.y - S.H / 2 - 120, vy1 = S.cam.y + S.H / 2 + 120;
  for (const e of S.enemies) {
    if (e.x < vx0 || e.x > vx1 || e.y < vy0 || e.y > vy1) continue;
    drawEnemy(e);
  }

  /* rounds */
  ctx.lineCap = 'round';
  for (const b of S.bullets) {
    ctx.strokeStyle = b.color; ctx.lineWidth = b.size;
    ctx.globalAlpha = b.fade ? clamp(b.life / 0.4, 0, 1) : 1;
    ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (const b of S.ebullets) {
    ctx.strokeStyle = b.col; ctx.lineWidth = b.size;
    ctx.globalAlpha = b.fade ? clamp(b.life / 0.4, 0, 1) : 1;
    ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* beams and arcs */
  for (const bm of S.beams) {
    const k = clamp(bm.life / bm.max, 0, 1);
    ctx.globalAlpha = k;
    ctx.strokeStyle = bm.col; ctx.lineWidth = bm.w * k;
    ctx.beginPath();
    if (bm.jag) {
      const n = 6;
      ctx.moveTo(bm.x1, bm.y1);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        ctx.lineTo(bm.x1 + (bm.x2 - bm.x1) * t + rand(-9, 9),
                   bm.y1 + (bm.y2 - bm.y1) * t + rand(-9, 9));
      }
      ctx.lineTo(bm.x2, bm.y2);
    } else { ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); }
    ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, bm.w * k * 0.3);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const P of S.players) if (!S.gameOver) drawDiver(P);

  /* stratagem balls */
  for (const be of S.balls) {
    const blink = be.landed && (Math.floor(be.call * 6) % 2 === 0);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.4 - Math.min(0.3, be.z / 300)) + ')';
    ctx.beginPath(); ctx.ellipse(be.x, be.y, 6, 4, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(be.x, be.y - be.z); ctx.rotate(be.spin);
    ctx.fillStyle = '#20241c'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = be.strat.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.stroke();
    ctx.fillStyle = blink ? '#ffffff' : be.strat.color;
    ctx.fillRect(-2.5, -2.5, 5, 5);
    ctx.restore();
    if (be.landed) {
      ctx.strokeStyle = be.strat.color; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(be.x, be.y, 18, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - be.call / be.strat.callIn));
      ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = be.strat.color; ctx.font = '11px Consolas'; ctx.textAlign = 'center';
      ctx.fillText(be.call.toFixed(1), be.x, be.y - 24);
    }
  }

  /* hellpods */
  for (const po of S.pods) {
    const zk = clamp(po.z / 1500, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.45 * (1 - zk)) + ')';
    ctx.beginPath(); ctx.ellipse(po.x, po.y, 26 + 34 * zk, 17 + 22 * zk, 0, 0, TAU); ctx.fill();
    const warn = 0.3 + 0.7 * Math.abs(Math.sin(po.t * 13));
    ctx.strokeStyle = 'rgba(255,' + Math.round(60 + 150 * zk) + ',40,' + warn + ')';
    ctx.lineWidth = 3; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(po.x, po.y, 46, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.save(); ctx.translate(po.x, po.y - po.z * 0.55);
    ctx.fillStyle = '#3b4038';
    ctx.beginPath(); ctx.moveTo(-15, -20); ctx.lineTo(15, -20);
    ctx.lineTo(11, 20); ctx.lineTo(-11, 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = po.col; ctx.fillRect(-15, -20, 30, 5);
    ctx.fillStyle = '#1b1f19'; ctx.fillRect(-8, -10, 16, 12);
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath(); ctx.moveTo(-11, 20); ctx.lineTo(11, 20);
    ctx.lineTo(rand(-6, 6), 20 + rand(26, 60)); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  for (const gr of S.nades) {
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.arc(gr.x, gr.y, 5, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(gr.x, gr.y - gr.z); ctx.rotate(gr.spin);
    ctx.fillStyle = gr.mortar ? '#4a4536' : '#4a5540';
    ctx.fillRect(-5, -6, 10, gr.mortar ? 16 : 12);
    ctx.fillStyle = (Math.floor(gr.fuse * 10) % 2) ? '#ff4d3d' : '#7a2a22';
    ctx.fillRect(-2, -8, 4, 3);
    ctx.restore();
  }

  for (const b of S.blasts) {
    const k = b.t / b.life;
    if (b.marker) {
      const rr = b.max * (1 - k * 0.12);
      ctx.strokeStyle = 'rgba(255,107,61,' + (0.35 + 0.6 * Math.abs(Math.sin(b.t * 14))) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.x - rr, b.y); ctx.lineTo(b.x + rr, b.y);
      ctx.moveTo(b.x, b.y - rr); ctx.lineTo(b.x, b.y + rr);
      ctx.stroke();
      continue;
    }
    ctx.globalAlpha = Math.max(0, 1 - k);
    const gd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(1, b.r));
    gd.addColorStop(0, '#fff7d6'); gd.addColorStop(0.4, b.col); gd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gd; ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(1, b.r), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const p of S.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
  }
  ctx.globalAlpha = 1;

  drawShip();
  drawWreck();
  drawReticles();

  /* Darkness is a property of where you are standing, not of the map: it comes
     up as you walk into a cave mouth and drops away as you come back out. */
  const dark = caveDepth(earX(), earY());
  if (dark > 0.01) drawDarkness(sx, sy, dark);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawOverlays();
}

/* ---- the incoming Super Destroyer, and what it leaves ---- */
function drawShip() {
  if (S.shipTarget) {
    const t = S.shipTarget;
    const r = 1500;
    ctx.strokeStyle = 'rgba(255,60,40,' + (0.3 + 0.6 * Math.abs(Math.sin(S.time * 6))) + ')';
    ctx.lineWidth = 8; ctx.setLineDash([40, 30]);
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,60,40,.05)';
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, TAU); ctx.fill();
  }
  const F = S.shipFx;
  if (!F || F.phase === 'hit') return;
  const k = F.phase === 'warn' ? clamp(F.t / 3.4, 0, 1) : clamp(F.t / 3.0, 0, 1);
  const z = F.phase === 'warn' ? 1 : 1 - k;
  const sc = 0.25 + (1 - z) * 2.4;
  ctx.save();
  ctx.translate(F.x, F.y - z * 900);
  ctx.globalAlpha = F.phase === 'warn' ? 0.3 : 0.55 + 0.45 * (1 - z);
  ctx.scale(sc, sc);
  ctx.fillStyle = '#2a2f36';
  ctx.beginPath();
  ctx.moveTo(-260, -90); ctx.lineTo(260, -60); ctx.lineTo(330, 0);
  ctx.lineTo(260, 60); ctx.lineTo(-260, 90); ctx.lineTo(-320, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#454c56';
  ctx.fillRect(-180, -50, 300, 100);
  ctx.fillStyle = '#ffd21e';
  ctx.fillRect(-240, -20, 60, 40);
  ctx.fillStyle = '#ff8a3d';
  for (let i = 0; i < 5; i++) ctx.fillRect(-330, -60 + i * 30, 40, 16);
  ctx.restore();
  ctx.globalAlpha = 1;
  /* the shadow it throws */
  ctx.fillStyle = 'rgba(0,0,0,' + (0.15 + 0.5 * (1 - z)) + ')';
  ctx.beginPath();
  ctx.ellipse(F.x, F.y, 340 * sc, 130 * sc, 0, 0, TAU);
  ctx.fill();
}
function drawWreck() {
  const W = S.wreck;
  if (!W) return;
  ctx.save(); ctx.translate(W.x, W.y); ctx.rotate(W.a);
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.beginPath(); ctx.ellipse(0, 0, 620, 300, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#23272e';
  ctx.beginPath();
  ctx.moveTo(-520, -170); ctx.lineTo(500, -120); ctx.lineTo(620, 0);
  ctx.lineTo(480, 140); ctx.lineTo(-500, 180); ctx.lineTo(-600, 10);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#31363f'; ctx.fillRect(-340, -90, 560, 180);
  ctx.strokeStyle = '#12151a'; ctx.lineWidth = 6;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo(-520 + i * 160, -170); ctx.lineTo(-460 + i * 160, 180);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,138,61,' + (0.25 + 0.2 * Math.sin(S.time * 3)) + ')';
  ctx.beginPath(); ctx.arc(-120, 20, 140, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawReticles() {
  const me = S.me;
  if (me && me.down && me.waiting > 0 && !S.gameOver) {
    const rx = mouse.wx, ry = mouse.wy;
    ctx.strokeStyle = 'rgba(255,210,30,' + (0.5 + 0.5 * Math.abs(Math.sin(S.time * 8))) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(rx, ry, 34, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffd21e'; ctx.font = '12px Consolas'; ctx.textAlign = 'center';
    ctx.fillText('DROP SITE  ' + Math.max(0, me.waiting).toFixed(1) + 's', rx, ry - 60);
  }
  if (me && me.armed) {
    const aa = Math.atan2(mouse.wy - me.y, mouse.wx - me.x);
    const dd = Math.min(680, Math.hypot(mouse.wx - me.x, mouse.wy - me.y));
    const tx = me.x + Math.cos(aa) * dd, ty = me.y + Math.sin(aa) * dd;
    ctx.strokeStyle = me.armed.color; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(tx, ty, 26, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = me.armed.color; ctx.font = '11px Consolas'; ctx.textAlign = 'center';
    ctx.fillText(me.armed.name, tx, ty - 34);
  }
  if (GMDRAW.fn) GMDRAW.fn(ctx);
}
export const GMDRAW = { fn: null };

/* ---- underground it is dark, and you carry the only light ---- */
function drawDarkness(sx, sy, depth) {
  if (lightCv.width !== S.W || lightCv.height !== S.H) {
    lightCv.width = S.W; lightCv.height = S.H;
  }
  const L = lctx;
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.globalCompositeOperation = 'source-over';
  L.fillStyle = 'rgba(3,3,5,' + (0.94 * depth).toFixed(3) + ')';
  L.fillRect(0, 0, S.W, S.H);
  L.globalCompositeOperation = 'destination-out';
  const ox = S.W / 2 - S.cam.x + sx + S.camKick.x;
  const oy = S.H / 2 - S.cam.y + sy + S.camKick.y;
  const hole = (x, y, r, soft) => {
    const g = L.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(soft === undefined ? 0.55 : soft, 'rgba(0,0,0,0.75)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    L.fillStyle = g;
    L.beginPath(); L.arc(x + ox, y + oy, r, 0, TAU); L.fill();
  };
  /* Each hole is a gradient object, and gradients are not free. Budget them:
     the squad's torches always get theirs, and the decoration takes what is
     left, nearest first. */
  const budget = Math.round(26 * S.quality) + 8;
  for (const P of S.players) {
    if (P.inPod || P.dead) continue;
    /* Keep the pool well inside the view. At 540 it reached the corners of a
       1024-wide screen and the cave stopped reading as dark at all. */
    hole(P.x, P.y, P === S.me ? 330 : 250);
    /* the torch points where you are looking */
    const a = P.ang;
    /* the torch reaches further than the pool, but only where you are looking */
    const steps = S.quality > 0.6 ? 5 : 3;
    for (let i = 1; i <= steps; i++)
      hole(P.x + Math.cos(a) * i * (500 / steps), P.y + Math.sin(a) * i * (500 / steps),
           200 - i * (120 / steps), 0.15);
  }
  const lit = [];
  for (const b of S.blasts) if (!b.marker) lit.push([b.x, b.y, b.r * 2.2, 0.1]);
  for (const s of S.sentries) lit.push([s.x, s.y, 200, 0.3]);
  for (const o of S.objectives) lit.push([o.x, o.y, 260, 0.3]);
  for (const p of S.pods) lit.push([p.x, p.y, 300, 0.2]);
  if (S.wreck) lit.push([S.wreck.x, S.wreck.y, 900, 0.2]);
  if (lit.length > budget) {
    lit.sort((a, b) => Math.hypot(a[0] - S.cam.x, a[1] - S.cam.y)
                     - Math.hypot(b[0] - S.cam.x, b[1] - S.cam.y));
    lit.length = budget;
  }
  for (const L of lit) hole(L[0], L[1], L[2], L[3]);
  L.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(lightCv, 0, 0);
  ctx.translate(ox, oy);
}

function drawOverlays() {
  const me = S.me;
  if (me && me.down && me.waiting <= 0 && !S.gameOver) {
    ctx.font = 'bold 22px Consolas'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillText('YOU ARE DOWN', S.W / 2 + 2, S.H * 0.38 + 2);
    ctx.fillStyle = '#ff6b6b'; ctx.fillText('YOU ARE DOWN', S.W / 2, S.H * 0.38);
    ctx.font = '13px Consolas';
    ctx.fillStyle = 'rgba(232,228,216,.8)';
    ctx.fillText(S.livesLeft <= 0 ? 'no reinforcements left'
      : livingDiver(me) ? 'waiting for a squadmate to call ↑↓→←↑'
      : 'no one left standing — emergency redeploy in ' + Math.max(0, Math.ceil(S.wipeT)) + 's',
      S.W / 2, S.H * 0.38 + 24);
  }
  if (S.toast.t > 0) {
    const inT = clamp((S.toast.max - S.toast.t) / 0.18, 0, 1);
    const rise = (1 - inT) * (1 - inT) * 14;
    const ty = S.H * 0.22 + rise;
    ctx.globalAlpha = Math.min(1, S.toast.t) * inT;
    ctx.font = 'bold 26px Consolas'; ctx.textAlign = 'center';
    ctx.fillStyle = '#000'; ctx.fillText(S.toast.txt, S.W / 2 + 2, ty + 2);
    ctx.fillStyle = '#ffd21e'; ctx.fillText(S.toast.txt, S.W / 2, ty);
    ctx.globalAlpha = 1;
  }
  /* spores make the air thick long before they make it dangerous */
  const sp = sporeLevel();
  if (sp > 0) {
    ctx.fillStyle = 'rgba(140,160,60,' + (0.22 * sp) + ')';
    ctx.fillRect(0, 0, S.W, S.H);
  }
  if (S.mod.confuse > 0) {
    ctx.strokeStyle = 'rgba(198,166,255,.25)'; ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, S.W - 4, S.H - 4);
  }
  const v = ctx.createRadialGradient(S.W / 2, S.H / 2, Math.min(S.W, S.H) * 0.35,
                                     S.W / 2, S.H / 2, Math.max(S.W, S.H) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.7)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, S.W, S.H);
  if (S.flashWhite > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + clamp(S.flashWhite, 0, 1) + ')';
    ctx.fillRect(0, 0, S.W, S.H);
  }
}
