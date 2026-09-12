/* The Game Master.
 *
 * They are not carrying a rifle, so none of the Helldiver's furniture is drawn
 * for them. What they get instead is a bank account, a palette, and three
 * factions to draw from -- and a bonus every time a Helldiver goes down, which
 * is the only score they have. */
'use strict';
import { el, rand, clamp, TAU, pick } from './util.js';
import { CFG } from './config.js';
import { S, amGM, nearestDiver, anchorDist, eachDiver, spark, say } from './state.js';
import { SFX } from './audio.js';
import { worldEv } from './events.js';
import { FACTIONS, FACTION_IDS, palette } from './data.js';
import { spawnEnemy } from './enemies.js';
import { solidAt, openSpot } from './world.js';
import { HOOKS } from './combat.js';
import { blockedSpawn } from './director.js';
import { GMPENALTY } from './objectives.js';

export const GM = {
  cx: 0, cy: 0, credits: 30, max: 220, rate: 3.0, sel: 0, cool: 0,
  spent: 0, sent: 0, score: 0, fac: 'illuminate', rally: 0
};
export const GM_MIN_RANGE = 420;

export function gmReset() {
  GM.credits = CFG.credits; GM.max = CFG.maxCredits;
  GM.cool = 0; GM.spent = 0; GM.sent = 0; GM.score = 0; GM.sel = 0;
  GM.cx = 0; GM.cy = 0; GM.rally = 0;
  GM.fac = pick(FACTION_IDS);
}
export function gmPalette() { return palette(GM.fac); }

/* a Helldiver going down is the only thing a Game Master is actually paid for */
HOOKS.onDiverDown = function (P) {
  if (!S.gmMatch) return;
  GM.score++;
  GM.credits = Math.min(GM.max, GM.credits + 45);
  if (amGM()) say('HELLDIVER DOWN — +45 CREDITS', 3);
};
/* ...and every objective the squad completes takes it back off them */
GMPENALTY.fn = function (kind) {
  if (!S.gmMatch) return;
  const cost = kind === 'confuse' ? 70 : kind === 'radar' ? 55 : 35;
  GM.credits = Math.max(0, GM.credits - cost);
  if (amGM()) say('OBJECTIVE LOST — −' + cost + ' CREDITS', 3);
};

export function gmKey(k, e, keys) {
  const pal = gmPalette();
  for (let i = 0; i < pal.length; i++) if (k === String(i + 1)) GM.sel = i;
  if (k === 'tab' || k === 'e') { gmCycleFaction(1); e.preventDefault(); }
  if (k === 'q') gmCycleFaction(-1);
  if (k === ' ' || k === 'c') {
    const jn = nearestDiver(GM.cx, GM.cy);
    if (jn) { GM.cx = jn.p.x; GM.cy = jn.p.y; }
  }
  if (k === 'r') gmRally();
}
export function gmCycleFaction(dir) {
  const i = FACTION_IDS.indexOf(GM.fac);
  GM.fac = FACTION_IDS[(i + dir + FACTION_IDS.length) % FACTION_IDS.length];
  GM.sel = 0;
  say(FACTIONS[GM.fac].name + ' SELECTED', 1.6);
  SFX.arm();
}
export function gmSetFaction(f) {
  if (!FACTIONS[f]) return;
  GM.fac = f; GM.sel = 0;
  SFX.arm();
}
/* everything of your faction nearby stops what it is doing and goes for them */
function gmRally() {
  if (GM.rally > 0 || GM.credits < 25) return;
  GM.credits -= 25; GM.rally = 12;
  let n = 0;
  for (const e of S.enemies) {
    if (e.fac !== GM.fac) continue;
    if (Math.hypot(e.x - GM.cx, e.y - GM.cy) > 1400) continue;
    e.mad = null; e.madT = 0;
    const nd = nearestDiver(e.x, e.y);
    if (!nd) continue;
    e.tgt = { x: nd.p.x, y: nd.p.y, ref: nd.p, kind: 'diver' };
    e.retarget = 4;
    n++;
  }
  say('RALLY — ' + n + ' UNITS REDIRECTED', 2.5);
  SFX.arm();
}

export function gmUpdate(dt, keys, mouse) {
  GM.credits = Math.min(GM.max,
    GM.credits + GM.rate * CFG.income * dt * (1 + S.hordeLv * 0.06 * CFG.incomeScale));
  GM.cool -= dt;
  if (GM.rally > 0) GM.rally -= dt;
  const sp = (keys['shift'] ? 1400 : 780) * dt;
  if (keys['d']) GM.cx += sp;
  if (keys['a']) GM.cx -= sp;
  if (keys['s']) GM.cy += sp;
  if (keys['w']) GM.cy -= sp;
  GM.cx = clamp(GM.cx, -S.world, S.world);
  GM.cy = clamp(GM.cy, -S.world, S.world);
  if (mouse.down) gmTrySpawn(mouse);
}
export function gmTrySpawn(mouse) {
  if (GM.cool > 0 || !S.running) return;
  const pal = gmPalette();
  const u = pal[GM.sel] || pal[0];
  if (!u || GM.credits < u.cost) return;
  let x = mouse.wx, y = mouse.wy;
  if (anchorDist(x, y) < GM_MIN_RANGE) return;
  if (Math.abs(x) > S.world - 40 || Math.abs(y) > S.world - 40) return;
  if (blockedSpawn(x, y)) return;
  if (solidAt(x, y)) {
    if (!S.map.cave) return;
    const o = openSpot(x, y, 14);
    if (solidAt(o.x, o.y)) return;
    x = o.x; y = o.y;
  }
  if (S.enemies.length > 560) return;
  GM.credits -= u.cost;
  GM.cool = u.cost > 12 ? 0.6 : u.cost > 4 ? 0.35 : 0.09;
  GM.spent += u.cost; GM.sent++;
  spawnEnemy(u.id, { x, y });
  const F = FACTIONS[GM.fac];
  for (let i = 0; i < 8; i++) {
    const a = rand(0, TAU);
    spark(x, y, Math.cos(a) * rand(30, 180), Math.sin(a) * rand(30, 180), 0.45, F.col, 3);
  }
  if (S.map.cave) worldEv('warp', x, y);
}

/* ---- what the Game Master sees over the world ---- */
export function gmDraw(ctx, mouse) {
  const F = FACTIONS[GM.fac];
  ctx.strokeStyle = 'rgba(255,210,30,.20)'; ctx.lineWidth = 2; ctx.setLineDash([10, 12]);
  eachDiver(P => { ctx.beginPath(); ctx.arc(P.x, P.y, GM_MIN_RANGE, 0, TAU); ctx.stroke(); });
  ctx.setLineDash([]);
  if (S.mod.noSpawn) {
    ctx.strokeStyle = 'rgba(79,180,119,.5)'; ctx.lineWidth = 3; ctx.setLineDash([18, 14]);
    ctx.beginPath(); ctx.arc(S.mod.noSpawn.x, S.mod.noSpawn.y, S.mod.noSpawn.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4fb477'; ctx.font = '12px Consolas'; ctx.textAlign = 'center';
    ctx.fillText('RADAR EXCLUSION — NO DEPLOYMENT',
                 S.mod.noSpawn.x, S.mod.noSpawn.y - S.mod.noSpawn.r - 10);
  }
  const pal = gmPalette();
  const u = pal[GM.sel] || pal[0];
  if (!u) return;
  const ok = GM.credits >= u.cost && anchorDist(mouse.wx, mouse.wy) >= GM_MIN_RANGE &&
             !blockedSpawn(mouse.wx, mouse.wy) &&
             !(S.map.city && !S.map.cave && solidAt(mouse.wx, mouse.wy));
  ctx.strokeStyle = ok ? F.hud : 'rgba(255,80,60,.6)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(mouse.wx, mouse.wy, u.r, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(mouse.wx, mouse.wy, u.r + 7, 0, TAU); ctx.stroke();
  ctx.fillStyle = ok ? F.hud : '#ff8a7a'; ctx.font = '11px Consolas'; ctx.textAlign = 'center';
  ctx.fillText(u.name + '  ' + u.cost, mouse.wx, mouse.wy - u.r - 12);
}

/* ---- the panel ---- */
let lastPal = '';
export function gmHud() {
  if (!S.gmMatch) return;
  const F = FACTIONS[GM.fac];
  let fh = '';
  for (const f of FACTION_IDS)
    fh += '<span class="gmfac' + (GM.fac === f ? ' on' : '') + '" data-fac="' + f + '" ' +
          'style="border-color:' + FACTIONS[f].hud + ';' +
          (GM.fac === f ? 'background:' + FACTIONS[f].hud + ';color:#111' : 'color:' + FACTIONS[f].hud) +
          '">' + FACTIONS[f].short + '</span>';
  const fe = el('gmfacs');
  if (fe && fe.innerHTML !== fh) {
    fe.innerHTML = fh;
    fe.querySelectorAll('[data-fac]').forEach(n => {
      n.onclick = () => gmSetFaction(n.getAttribute('data-fac'));
    });
  }
  const pal = gmPalette();
  let ph = '';
  for (let i = 0; i < pal.length; i++)
    ph += '<span class="gmunit' + (GM.sel === i ? ' on' : '') +
          (GM.credits < pal[i].cost ? ' poor' : '') + '" data-u="' + i + '">' +
          (i + 1) + ' ' + pal[i].name + ' <b>' + pal[i].cost + '</b></span>';
  const pe = el('gmpal');
  if (pe && ph !== lastPal) {
    pe.innerHTML = ph; lastPal = ph;
    pe.querySelectorAll('[data-u]').forEach(n => {
      n.onclick = () => { GM.sel = +n.getAttribute('data-u'); };
    });
  }
  el('gmcnum').textContent = Math.floor(GM.credits);
  const perSec = GM.rate * CFG.income * (1 + S.hordeLv * 0.06 * CFG.incomeScale);
  el('gmrate').textContent = '(+' + perSec.toFixed(1) + '/s)';
  el('gmcredits').firstChild.style.width = (100 * GM.credits / GM.max) + '%';

  if (!amGM()) return;
  let sq = '';
  for (const Q of S.players) {
    const qh = clamp(Q.hp / Q.maxhp, 0, 1);
    const st = Q.dead ? 'LOST' : Q.down ? 'DOWN' : Q.inPod ? 'INBOUND' : Math.round(Q.hp) + '%';
    sq += '<div class="gmd"><div class="gmdn"><span>' + Q.name + '</span>' +
      '<span class="gmds" style="color:' + (Q.dead ? '#777' : Q.down ? '#ff6b6b' : '#b8e6c0') + '">' +
      st + '</span></div>' +
      '<div class="gmdbar"><i style="width:' + (Q.dead ? 0 : qh * 100) + '%;background:' +
      (qh > 0.5 ? '#4fb477' : qh > 0.25 ? '#ffd21e' : '#c1121f') + '"></i></div></div>';
  }
  const sqe = el('gmsquad');
  if (sqe && sqe.innerHTML !== sq) sqe.innerHTML = sq;
  el('gmstats').innerHTML =
    'DEPLOYED ' + GM.sent + ' &middot; SPENT ' + Math.round(GM.spent) +
    ' &middot; THEY LOST ' + S.kills +
    '<br>TAKEDOWNS <b style="color:#c6a6ff">' + GM.score + '</b>' +
    ' &middot; REINFORCEMENTS LEFT ' + Math.max(0, S.livesLeft) +
    (S.objectives.length ? '<br><span style="color:#7fd4ff">OBJECTIVE ACTIVE — ' +
      S.objectives[0].name + '</span>' : '');
}
