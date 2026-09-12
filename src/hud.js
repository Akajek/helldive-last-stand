/* The Helldiver's furniture: readouts, chips, the tactical map, and the screen
   where you pick what you are bringing. */
'use strict';
import { el, clamp, TAU, fmtTime } from './util.js';
import { CFG, LOADOUT, loadoutSave } from './config.js';
import { S, amGM, isClient, isSquad } from './state.js';
import { A } from './audio.js';
import { STRATS, STRAT_BY_ID, LOADOUT_POOL, WEAPONS, FACTIONS } from './data.js';
import { W_, A_, loadoutStrats } from './diver.js';
import { G, CELL, gIndex, inCave } from './world.js';
import { jammerNear } from './objectives.js';

export const GLYPH = { U: '↑', D: '↓', L: '←', R: '→' };
export const ARROW = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };

export const CODE = { typed: [], active: false };

let stratEl = null, magsEl = null, kitEl = null, chipSig = '';
export function bindHud() {
  stratEl = el('strat'); magsEl = el('mags'); kitEl = el('kit');
}

/* ============================ THE CHIP ROW ============================ */
function rebuildChips(P) {
  const list = loadoutStrats(P);
  const sig = list.map(s => s.id).join(',');
  if (sig === chipSig) return list;
  chipSig = sig;
  stratEl.innerHTML = '';
  for (const s of list) {
    const d = document.createElement('div');
    d.className = 'chip'; d.id = 'chip_' + s.id;
    stratEl.appendChild(d);
  }
  return list;
}

export function hud() {
  const me = S.me;
  const P = me || S.players[0];
  if (!P) return;

  el('timer').textContent = fmtTime(S.time);

  /* ---- the line that tells you where you are and what is coming ---- */
  const bits = [];
  bits.push('KILLS ' + S.kills);
  if (!S.gmMatch) {
    bits.push('WAVE ' + Math.max(1, S.wave) + ' in ' + Math.max(0, Math.ceil(S.waveT)) + 's');
  }
  bits.push('LV ' + S.hordeLv);
  bits.push('HOSTILES ' + S.enemies.length);
  bits.push(S.map.name);
  if (S.map.city && !S.map.caves)
    bits.push('REBUILD ' + Math.max(0, Math.ceil(S.nextRebuild - S.time)) + 's');
  if (S.mod.confuse > 0) bits.push('COMMS DOWN ' + Math.ceil(S.mod.confuse) + 's');
  if (S.mod.radar > 0) bits.push('RADAR ' + Math.ceil(S.mod.radar) + 's');
  /* only tell you the sky is gone when it actually is */
  const under = !!me && inCave(me.x, me.y);
  if (under) bits.push(S.mod.uplink > 0
    ? 'UPLINK OPEN ' + Math.ceil(S.mod.uplink) + 's' : 'UNDERGROUND — NO UPLINK');
  if (amGM()) bits.push('GAME MASTER');
  if (isClient()) bits.push(S.ping + 'ms');
  if (A.muted) bits.push('[MUTED]');
  el('subline').textContent = bits.join('  ·  ');

  /* ---- objective ticker ---- */
  const ob = el('objbar');
  if (ob) {
    if (S.objectives.length) {
      let html = '';
      for (const o of S.objectives) {
        let sub = '';
        if (o.kind === 'hold') sub = Math.round(100 * clamp(o.prog / o.D.time, 0, 1)) + '%';
        else if (o.kind === 'destroy') sub = Math.round(100 * clamp(o.hp / o.max, 0, 1)) + '% INTEGRITY';
        else sub = o.have + '/' + o.need;
        const dd = Math.round(Math.hypot(o.x - (me ? me.x : S.cam.x), o.y - (me ? me.y : S.cam.y)));
        html += '<div class="objrow" style="border-color:' + o.col + '">' +
          '<b style="color:' + o.col + '">' + o.name + '</b> ' + sub +
          ' <span class="objd">' + dd + 'm</span></div>';
      }
      ob.innerHTML = html; ob.style.display = 'block';
    } else ob.style.display = 'none';
  }

  if (amGM()) return;                 /* the GM has their own panel; none of this is theirs */

  /* ---- health ---- */
  const hp = clamp((P.hpShow === undefined ? P.hp : P.hpShow) / P.maxhp, 0, 1);
  const hb = el('hpbar');
  hb.style.width = (hp * 100) + '%';
  hb.style.background = P.stimHeal > 0 ? '#78ffa0' : hp > 0.5 ? '#4fb477' : hp > 0.25 ? '#ffd21e' : '#c1121f';
  const hg = clamp((P.hpGhost === undefined ? P.hp : P.hpGhost) / P.maxhp, 0, 1);
  el('hpghost').style.width = (Math.max(hg, hp) * 100) + '%';
  const shb = el('shbar');
  if (shb) {
    shb.parentNode.style.display = P.shieldMax > 0 ? '' : 'none';
    shb.style.width = (100 * clamp(P.shield / Math.max(1, P.shieldMax), 0, 1)) + '%';
  }

  /* ---- the gun ---- */
  const w = W_(P), a = A_(P);
  el('wname').textContent = w.name + '   ' +
    (w.infinite ? '∞' : a.ammo + ' / ' + w.mag) + (P.reloading > 0 ? '   [RELOADING]' : '');
  el('ammobar').style.width = (w.infinite ? 100 : (a.ammo / w.mag * 100)) + '%';
  const total = Math.max(0, w.mags - 1);
  let html = '';
  for (let i = 0; i < Math.max(total, a.mags); i++)
    html += '<s class="' + (i < a.mags ? '' : 'spent') + '"></s>';
  if (magsEl.innerHTML !== html) magsEl.innerHTML = html;

  const sup = P.support ? P.arsenal[P.support] : null;
  kitEl.innerHTML =
    '<span class="' + (P.wep === 'ar' ? '' : 'off') + '"><b>1</b> ' + WEAPONS.ar.name + '</span>  ' +
    '<span class="' + (P.wep === 'pistol' ? '' : 'off') + '"><b>2</b> ' + WEAPONS.pistol.name + '</span>' +
    '<br><span class="' + (sup && sup.owned ? (P.wep === P.support ? '' : 'off') : 'off') + '"><b>3</b> ' +
      (sup && sup.owned
        ? WEAPONS[P.support].name + (WEAPONS[P.support].infinite ? '' : ' (' + sup.ammo + ')')
        : '— no support weapon') + '</span>' +
    '<br><b>G</b> FRAG ×' + P.grenades + '   <b>Q</b> STIM ×' + P.stims +
    (P.carrying ? '   <b style="color:#ff8a3d">CARRYING SHELL</b>' : '') +
    '<br>REINFORCEMENTS <b>' + ('●'.repeat(Math.max(0, S.livesLeft)) +
      '○'.repeat(Math.max(0, CFG.lives - S.livesLeft))) + '</b>';

  /* ---- the chips ---- */
  const list = rebuildChips(P);
  const jam = me ? jammerNear(me.x, me.y) : null;
  for (const t of list) {
    const chip = el('chip_' + t.id);
    if (!chip) continue;
    if (t.squadOnly && !isSquad()) { chip.style.display = 'none'; continue; }
    chip.style.display = '';
    const si = STRATS.indexOf(t);
    const left = me ? me.stt[si] : 0;
    const ready = left <= 0;
    const isArmed = !!(me && me.armed === t);
    const blocked = t.kind !== 'reinforce' &&
                    (!!jam || (under && S.mod.uplink <= 0));
    let used = '';
    if (t.uses !== undefined && me) {
      const u = (me.uses && me.uses[t.id]) || 0;
      used = ' ' + (t.uses - u) + '×';
      if (u >= t.uses) chip.className = 'chip cool';
    }
    chip.className = 'chip ' + (blocked ? 'jam' : isArmed ? 'ready' : ready ? '' : 'cool');
    const fill = ready ? 100 : 100 * (1 - left / t.cd);
    chip.style.backgroundImage = ready ? 'none'
      : 'linear-gradient(to right,#242a1c ' + fill + '%,#14160f ' + fill + '%)';
    let code = '';
    for (const g of t.code) code += GLYPH[g];
    chip.innerHTML = '<b>' + code + '</b>' + t.name + used + '<br>' +
      (blocked ? 'JAMMED' : ready ? (isArmed ? 'THROW IT' : 'READY') : Math.ceil(left) + 's');
  }

  const cb = el('codebox');
  if (CODE.active) {
    cb.style.display = 'block';
    let t = '';
    for (const q of CODE.typed) t += GLYPH[q];
    cb.innerHTML = (t || '&nbsp;') + '<small>STRATAGEM INPUT</small>';
  } else cb.style.display = 'none';
}

/* ============================ TACTICAL MAP ============================ */
let mmc = null, mmx = null;
export function bindMinimap() { mmc = el('mm'); mmx = mmc.getContext('2d'); }
export function drawMinimap() {
  if (!mmx) return;
  const Sz = mmc.width, half = Sz / 2;
  const R = S.mod.radar > 0 ? 3200 : 1700;
  const k = half / R;
  const ox = S.me ? S.me.x : S.cam.x, oy = S.me ? S.me.y : S.cam.y;
  mmx.clearRect(0, 0, Sz, Sz);
  mmx.fillStyle = S.map.caves ? 'rgba(14,11,7,.82)' : S.map.city ? 'rgba(10,13,20,.8)' : 'rgba(12,16,12,.8)';
  mmx.fillRect(0, 0, Sz, Sz);
  const px = x => half + (x - ox) * k;
  const py = y => half + (y - oy) * k;

  mmx.strokeStyle = S.map.border; mmx.lineWidth = 2;
  mmx.strokeRect(px(-S.world), py(-S.world), S.world * 2 * k, S.world * 2 * k);

  /* the standing world, sampled coarsely so this stays cheap */
  if (S.map.city && G.solid) {
    const step = 3;
    mmx.fillStyle = S.map.caves ? 'rgba(150,125,85,.45)' : 'rgba(120,150,200,.22)';
    const c0 = Math.floor((ox - R) / CELL), c1 = Math.ceil((ox + R) / CELL);
    const d0 = Math.floor((oy - R) / CELL), d1 = Math.ceil((oy + R) / CELL);
    const sz = Math.max(1, CELL * k * step);
    for (let cy = d0; cy <= d1; cy += step) {
      for (let cx = c0; cx <= c1; cx += step) {
        const i = gIndex(cx, cy);
        if (i < 0 || !G.solid[i]) continue;
        mmx.fillRect(px(cx * CELL), py(cy * CELL), sz, sz);
      }
    }
  }

  /* objectives are the reason to look at this thing */
  for (const o of S.objectives) {
    mmx.strokeStyle = o.col; mmx.lineWidth = 2;
    mmx.beginPath(); mmx.arc(px(o.x), py(o.y), 7 + Math.sin(S.time * 4) * 1.5, 0, TAU); mmx.stroke();
    mmx.fillStyle = o.col;
    mmx.beginPath(); mmx.arc(px(o.x), py(o.y), 2.5, 0, TAU); mmx.fill();
  }
  if (S.mod.noSpawn) {
    mmx.strokeStyle = 'rgba(79,180,119,.5)'; mmx.lineWidth = 1; mmx.setLineDash([5, 4]);
    mmx.beginPath(); mmx.arc(px(S.mod.noSpawn.x), py(S.mod.noSpawn.y), S.mod.noSpawn.r * k, 0, TAU);
    mmx.stroke(); mmx.setLineDash([]);
  }

  for (const e of S.enemies) {
    if (Math.abs(e.x - ox) > R || Math.abs(e.y - oy) > R) continue;
    const F = FACTIONS[e.fac];
    if (e.size === 'large') {
      mmx.fillStyle = F.hud;
      mmx.beginPath(); mmx.arc(px(e.x), py(e.y), 4, 0, TAU); mmx.fill();
    } else if (e.size === 'medium') {
      mmx.fillStyle = F.hud;
      mmx.fillRect(px(e.x) - 1.8, py(e.y) - 1.8, 3.6, 3.6);
    } else {
      mmx.fillStyle = F.col;
      mmx.fillRect(px(e.x) - 1, py(e.y) - 1, 2, 2);
    }
  }
  for (const s of S.sentries) {
    mmx.fillStyle = '#7fd4ff';
    mmx.fillRect(px(s.x) - 2.5, py(s.y) - 2.5, 5, 5);
  }
  for (const p of S.pickups) {
    mmx.fillStyle = p.kind === 'sample' ? '#ffd21e' : p.kind === 'shell' ? '#ff8a3d' :
                    p.kind === 'weapon' ? '#c6ff6b' : '#ffd21e';
    mmx.fillRect(px(p.x) - 2, py(p.y) - 2, 4, 4);
  }
  for (const b of S.balls) {
    mmx.fillStyle = b.strat.color;
    mmx.beginPath(); mmx.arc(px(b.x), py(b.y), 2.5, 0, TAU); mmx.fill();
  }
  for (const p of S.pods) {
    mmx.strokeStyle = 'rgba(255,80,40,' + (0.4 + 0.6 * Math.abs(Math.sin(S.time * 12))) + ')';
    mmx.lineWidth = 2;
    mmx.beginPath(); mmx.arc(px(p.x), py(p.y), 6, 0, TAU); mmx.stroke();
  }
  if (S.wreck) {
    mmx.fillStyle = 'rgba(255,138,61,.4)';
    mmx.beginPath(); mmx.arc(px(S.wreck.x), py(S.wreck.y), 620 * k, 0, TAU); mmx.fill();
  }

  if (!S.gameOver) for (const MP of S.players) {
    if (MP.dead) continue;
    const hx = px(MP.x), hy = py(MP.y), mine = MP === S.me;
    mmx.fillStyle = mine ? 'rgba(255,210,30,.18)' : 'rgba(120,230,150,.16)';
    mmx.beginPath();
    mmx.moveTo(hx, hy);
    mmx.arc(hx, hy, 26, MP.ang - 0.45, MP.ang + 0.45);
    mmx.closePath(); mmx.fill();
    mmx.fillStyle = MP.down ? '#ff6b6b' : mine ? '#ffd21e' : '#7fe6a0';
    mmx.beginPath();
    mmx.moveTo(hx + Math.cos(MP.ang) * 6, hy + Math.sin(MP.ang) * 6);
    mmx.lineTo(hx + Math.cos(MP.ang + 2.6) * 5, hy + Math.sin(MP.ang + 2.6) * 5);
    mmx.lineTo(hx + Math.cos(MP.ang - 2.6) * 5, hy + Math.sin(MP.ang - 2.6) * 5);
    mmx.closePath(); mmx.fill();
  }
  mmx.strokeStyle = 'rgba(255,210,30,.18)'; mmx.lineWidth = 1;
  mmx.beginPath(); mmx.arc(half, half, half - 6, 0, TAU); mmx.stroke();
  const lab = el('mmlabel');
  if (lab) lab.textContent = S.mod.radar > 0 ? 'RADAR — FULL SWEEP' : 'TACTICAL MAP';
}

/* ============================ LOADOUT SCREEN ============================
   Four slots. RESUPPLY, REINFORCE and REQUISITION are not on it because they
   never take one. */
export const LOADUI = { open: false, onChange: null };
export function loadoutRender(container, live) {
  const box = container || el('loadbox');
  if (!box) return;
  let html = '<div class="loadslots">';
  for (let i = 0; i < 4; i++) {
    const s = STRAT_BY_ID[LOADOUT.slots[i]];
    html += '<div class="lslot' + (LOADUI.sel === i ? ' on' : '') + '" data-slot="' + i + '">' +
      '<span class="lsnum">' + (i + 1) + '</span>' +
      '<b style="color:' + (s ? s.color : '#888') + '">' + (s ? s.name : 'EMPTY') + '</b>' +
      '<span class="lscode">' + (s ? s.code.map(c => GLYPH[c]).join('') : '') + '</span></div>';
  }
  html += '</div><div class="loadpool">';
  for (const id of LOADOUT_POOL) {
    const s = STRAT_BY_ID[id];
    const taken = LOADOUT.slots.indexOf(id) >= 0;
    html += '<div class="lpick' + (taken ? ' taken' : '') + '" data-pick="' + id + '">' +
      '<b style="color:' + s.color + '">' + s.name + '</b>' +
      '<span class="lscode">' + s.code.map(c => GLYPH[c]).join('') + '</span>' +
      '<i>' + s.desc + '</i></div>';
  }
  html += '</div>';
  if (box.innerHTML !== html) box.innerHTML = html;

  box.querySelectorAll('[data-slot]').forEach(n => {
    n.onclick = () => { LOADUI.sel = +n.getAttribute('data-slot'); loadoutRender(box, live); };
  });
  box.querySelectorAll('[data-pick]').forEach(n => {
    n.onclick = () => {
      const id = n.getAttribute('data-pick');
      const at = LOADOUT.slots.indexOf(id);
      const sel = LOADUI.sel || 0;
      if (at >= 0) {                       /* already carried: swap the two slots */
        LOADOUT.slots[at] = LOADOUT.slots[sel];
      }
      LOADOUT.slots[sel] = id;
      LOADUI.sel = (sel + 1) % 4;
      loadoutSave();
      loadoutRender(box, live);
      if (LOADUI.onChange) LOADUI.onChange();
    };
  });
}
