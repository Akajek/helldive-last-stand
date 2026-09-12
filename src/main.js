/* Wiring: the canvas, the keyboard, the menus and the loop. */
'use strict';
import { el, fmtTime } from './util.js';
import {
  CFG, PRESETS, UI, VOL, LOADOUT, uiSave, volSave, cfgSave, myName, activeFactions
} from './config.js';
import { S, amGM, setRole, role, isHost, isClient, say, isSquad } from './state.js';
import {
  A, SFX, audioInit, applyVolume, setMuted, refillBudget, musicStart, musicStop,
  musicToggle, musicApplyVolume, useExternalTrack, probeExternalTrack, musicSchedule
} from './audio.js';
import { STRATS, STRAT_BY_ID, FACTIONS, TROOPS } from './data.js';
import { buildMap, setCollapseHooks } from './world.js';
import { worldEv } from './events.js';
import { bindFlash, hurt } from './combat.js';
import { spawnEnemy } from './enemies.js';
import {
  reload, tryPickup, throwNade, meleeSwing, useStim, equipSlot, loadoutStrats, LOADHOOK
} from './diver.js';
import { throwStratagem, reinforceAt } from './strat.js';
import {
  update, reset, healthEase, keys, mouse, NETIN, ENDHOOK, GMTICK, GMCAM
} from './sim.js';
import { bindCanvas, draw, GMDRAW } from './render.js';
import {
  hud, drawMinimap, bindHud, bindMinimap, CODE, ARROW, loadoutRender, LOADUI
} from './hud.js';
import {
  NET, LOBBY, LOBBYUI, NETHOOK, CFGHOOK, netOpen, netQuit, netSend, netAct, netStatus,
  lobbyBroadcast, lobbySetMode, lobbyWant, lobbyCount, lobbyLocked, lobbyClose,
  setMyName, sendMyLoadout, NETWAKE
} from './net.js';
import { netSnapshot, netSendCity, netSendOver, hostInput } from './host.js';
import {
  clientCity, clientSnap, updateClient, clientCode, clearMaps, CITYHOOK
} from './client.js';
import { GM, gmReset, gmUpdate, gmKey, gmDraw, gmHud, gmTrySpawn } from './gm.js';

/* ============================ CANVAS ============================ */
const cv = el('c');
bindCanvas(cv);
function resize() { S.W = cv.width = innerWidth; S.H = cv.height = innerHeight; }
addEventListener('resize', resize); resize();
bindFlash(el('dmgflash'), el('stimflash'));
bindHud(); bindMinimap();
probeExternalTrack();

cv.addEventListener('mousemove', e => {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
});
cv.addEventListener('mousedown', () => { mouse.down = true; onClick(); });
addEventListener('mouseup', () => { mouse.down = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });

/* ============================ EFFECT HOOKS ============================ */
setCollapseHooks(
  b => worldEv('crumble', b.x + b.w / 2, b.y + b.h / 2, -1, b.id),
  b => worldEv('collapsed', b.x + b.w / 2, b.y + b.h / 2, -1, b.id)
);
GMCAM.get = () => ({ x: GM.cx, y: GM.cy });
GMTICK.fn = dt => gmUpdate(dt, keys, mouse);
GMDRAW.fn = c => { if (amGM() && S.running && !S.gameOver) gmDraw(c, mouse); };

/* ============================ INPUT ============================ */
function myStrats() {
  const P = S.me;
  if (!P) return [];
  const out = loadoutStrats(P).slice();
  for (const s of STRATS) if (s.hidden) out.push(s);
  return out;
}
addEventListener('keydown', e => {
  if (e.key === ' ' || e.key.indexOf('Arrow') === 0) e.preventDefault();
  const k = e.key.toLowerCase();
  if (keys[k] && (k === 'g' || k === 'q' || k === 'r' || k === 'e' || k === 'l')) return;
  keys[k] = true;
  if (k === 'm') { setMuted(!A.muted); applyVolume(); musicApplyVolume(); }
  if (e.key === 'Escape') {
    if (LOADUI.open) { closeLoadout(); return; }
    if (S.running && !S.gameOver) pauseToggle();
    return;
  }
  if (S.paused) return;
  if (LOADUI.open) return;
  if (amGM() && S.running) { gmKey(k, e, keys); return; }
  if (k === 'n') { say(musicToggle() ? 'MUSIC ON' : 'MUSIC OFF', 1.5); }
  if (k === '-' || k === '_') { VOL.music = Math.max(0, VOL.music - 0.1); applyVol(); }
  if (k === '=' || k === '+') { VOL.music = Math.min(1, VOL.music + 0.1); applyVol(); }
  if (!S.running) return;

  if (e.key === 'Control') { CODE.active = true; CODE.typed = []; }
  if (CODE.active && ARROW[e.key]) {
    const list = myStrats();
    if (isClient()) { clientCode(ARROW[e.key], list); return; }
    CODE.typed.push(ARROW[e.key]);
    const t = CODE.typed.join('');
    const pre = list.filter(s => s.code.join('').indexOf(t) === 0 && !(s.squadOnly && !isSquad()));
    if (!pre.length) { CODE.typed = []; SFX.fail(); }
    else {
      SFX.beep(CODE.typed.length);
      for (const s of pre) {
        if (s.code.length !== CODE.typed.length) continue;
        if (S.me && S.me.stt[STRATS.indexOf(s)] <= 0) {
          S.me.armed = s; SFX.arm();
          if (s.hidden) say('*** ' + s.name + ' AUTHORISED ***', 3.5);
        } else SFX.fail();
        CODE.typed = []; CODE.active = false;
        break;
      }
    }
    return;
  }
  if (k === 'l' && S.me) { openLoadout(true); return; }

  if (isClient()) {
    if (k === 'r') netAct('r');
    if (k === 'e') netAct('e');
    if (k === 'g') netAct('g');
    if (k === 'f' || k === 'v') { netAct('f'); if (S.me) { S.me.melee = 0.24; SFX.swing(); } }
    if (k === 'q') netAct('q');
    if (k === '1') netAct('1');
    if (k === '2') netAct('2');
    if (k === '3') netAct('3');
    return;
  }
  const P = S.me;
  if (!P) return;
  if (k === 'r') reload(P);
  if (k === 'e') tryPickup(P);
  if (k === 'g') throwNade(P);
  if (k === 'f' || k === 'v') meleeSwing(P);
  if (k === 'q') useStim(P);
  if (k === '1') equipSlot(P, 1);
  if (k === '2') equipSlot(P, 2);
  if (k === '3') equipSlot(P, 3);
});
addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
  if (e.key === 'Control') { CODE.active = false; CODE.typed = []; }
});
function applyVol() {
  applyVolume(); musicApplyVolume(); volSave();
  say('MUSIC ' + Math.round(VOL.music * 100) + '%', 1.2);
  const a = el('volmusic');
  if (a) { a.value = Math.round(VOL.music * 100); el('volmusicv').textContent = Math.round(VOL.music * 100) + '%'; }
}

function onClick() {
  audioInit();
  if (LOADUI.open) return;
  /* Holding the button is handled in gmUpdate, but a single quick click has
     its mousedown and mouseup both land between two frames -- so the frame only
     ever sees the button already released, and nothing is ever deployed. */
  if (amGM()) { gmTrySpawn(mouse); return; }
  if (!S.running || !S.me) return;
  const me = S.me;
  if (isClient()) {
    if (me.down) {
      if (me.waiting > 0) netAct('R:' + Math.round(mouse.wx) + ',' + Math.round(mouse.wy));
      return;
    }
    if (me.armed) { netAct('T:' + Math.round(mouse.wx) + ',' + Math.round(mouse.wy)); me.armed = null; }
    return;
  }
  if (me.down) {
    if (me.waiting > 0) reinforceAt(mouse.wx, mouse.wy, me);
    return;
  }
  throwStratagem(me, mouse.wx, mouse.wy);
}

/* ============================ LOADOUT SCREEN ============================ */
function openLoadout(inMission) {
  /* mid-mission it is only available at a Requisition terminal */
  if (inMission) {
    let near = false;
    for (const p of S.pickups)
      if (p.kind === 'requisition' && S.me && Math.hypot(p.x - S.me.x, p.y - S.me.y) < 90) near = true;
    if (!near) {
      say('NO REQUISITION TERMINAL — CALL ONE WITH  ←↓→↑↓', 3);
      SFX.fail();
      return;
    }
  }
  LOADUI.open = true;
  LOADUI.sel = 0;
  el('loadscreen').className = 'on';
  el('loadnote').textContent = inMission
    ? 'Changes apply immediately. Cooldowns on anything you drop are kept.'
    : 'These are the four you drop with. RESUPPLY, REINFORCE and REQUISITION never take a slot.';
  loadoutRender(el('loadbox'), inMission);
  LOADUI.onChange = () => {
    sendMyLoadout();
    if (inMission && S.me) {
      S.me.load = LOADOUT.slots.slice();
      if (isClient()) netSend({ t: 'load', slots: LOADOUT.slots });
    }
  };
}
function closeLoadout() {
  LOADUI.open = false;
  el('loadscreen').className = '';
}
LOADHOOK.open = () => openLoadout(true);
el('loadclose').onclick = closeLoadout;
el('loadopen').onclick = () => openLoadout(false);
el('loadopen2').onclick = () => openLoadout(false);

/* ============================ MENUS ============================ */
function hideOverlay() { el('overlay').style.display = 'none'; }
function showOverlay(title, body) {
  el('ovtitle').textContent = title;
  el('ovbody').innerHTML = body;
  el('overlay').style.display = 'flex';
}

export function start(id) {
  netQuit();
  pauseClose();
  audioInit();
  lastMap = id || lastMap;
  S.gmMatch = false; NET.roster = null;
  setRole('solo');
  NETIN.roster = null; NETIN.myId = 0;
  buildMap(lastMap);
  clearMaps();
  hideOverlay();
  reset();
  gmReset();
  S.running = true;
  document.body.classList.remove('gm');
  applyUi();
  musicStart();
}
let lastMap = 'megacity';

function startGM() {
  pauseClose();
  audioInit();
  setRole('host');
  NET.peer = true;
  S.gmMatch = (LOBBY.mode === 'gm');
  /* the lobby is the roster: whoever is holding a HELLDIVER badge is dropping */
  NET.roster = [];
  for (const s of LOBBY.slots)
    if (s.role === 'diver')
      NET.roster.push({ id: s.id, name: s.name, load: s.load || LOADOUT.slots.slice() });
  NETIN.roster = NET.roster; NETIN.myId = 0;
  NET.mapId = el('gmmap').value || 'megacity';
  const seed = buildMap(NET.mapId);
  NET.seed = seed;
  clearMaps();
  el('startmission').style.display = 'none';
  lobbyClose();
  hideOverlay();
  reset();
  gmReset();
  S.running = true;
  netSendCity();
  document.body.classList.toggle('gm', amGM());
  applyUi();
  musicStart();
}

function netToMenu(title, body) {
  const was = role();
  netQuit();
  S.running = false;
  musicStop();
  showOverlay(title, body);
  lobbyClose();
  el('roombox').style.display = 'none';
  if (was !== 'solo') netStatus('offline');
}
NETHOOK.toMenu = netToMenu;
NETHOOK.input = hostInput;
NETHOOK.city = m => {
  pauseClose();
  audioInit();
  clientCity(m);
};
CITYHOOK.cfg = () => cfgApplyUI();
CITYHOOK.start = () => {
  lobbyClose();
  hideOverlay();
  el('roombox').style.display = 'none';
  S.running = true;
  document.body.classList.remove('gm');
  applyUi();
  musicStart();
  netStatus('in mission');
};
NETHOOK.snap = clientSnap;
NETHOOK.over = m => {
  S.running = false; S.gameOver = true;
  musicStop();
  showOverlay('MISSION FAILED',
    'You held out for <b>' + m.mm + 'm ' + m.ss + 's</b> on <b>' + m.map +
    '</b>, reached <b>wave ' + (m.wave || 1) + '</b> and eliminated <b>' + m.k + '</b> of them.<br>' +
    'The Game Master spent <b>' + m.spent + '</b> credits burying you.<br><br>' +
    'Wait for the host to start another round.');
};
CFGHOOK.apply = () => cfgApplyUI();

ENDHOOK.fn = () => {
  if (isHost()) netSendOver();
  musicStop();
  if (amGM()) {
    showOverlay('SQUAD ELIMINATED',
      'They lasted <b>' + fmtTime(S.time) + '</b> and killed <b>' + S.kills + '</b> of your units.<br>' +
      'You spent <b>' + Math.round(GM.spent) + '</b> credits across <b>' + GM.sent + '</b> deployments, ' +
      'and put <b>' + GM.score + '</b> Helldivers on the ground.<br><br>Start another round when you are ready.');
  } else {
    showOverlay('MISSION FAILED',
      'You held out for <b>' + fmtTime(S.time) + '</b> on <b>' + S.map.name + '</b>, reached <b>wave ' +
      Math.max(1, S.wave) + '</b> and eliminated <b>' + S.kills + '</b> of them.<br>' +
      'All reinforcements expended — ' +
      (isSquad() ? 'the squad is down with nobody left to call them back up.' : 'and the last of them is spent.') +
      '<br><br>' + (isClient() ? 'Wait for the host to start another round.' : 'Start another round when you are ready.'));
  }
  el('newround').style.display = isHost() ? 'inline-block' : 'none';
};

/* ---- quitting mid-mission. Super Earth takes a dim view of it. ---- */
function quitToMenu() {
  pauseClose();
  const wasNet = role() !== 'solo';
  netQuit();
  S.running = false; S.gameOver = true;
  musicStop();
  showOverlay('DESERTION LOGGED',
    'You abandoned an active mission.<br><br>' +
    'Your conduct has been forwarded to your Democracy Officer, your cape privileges ' +
    'are under review, and the words <b>"voluntarily reassigned to the front rank"</b> ' +
    'now appear on your service record.' +
    (wasNet ? '<br><br>Your squad has been informed of the betrayal.' : '') +
    '<br><br>Liberty is disappointed. Liberty is patient. Dive again.');
  el('newround').style.display = 'none';
  el('startmission').style.display = 'none';
}

/* ============================ PAUSE ============================ */
function pauseOpen() {
  if (!S.running || S.gameOver) return;
  S.paused = true;
  mouse.down = false;
  if (S.me) S.me.inp.fire = false;
  applyUi();
  audioInit(); applyVolume();
  el('pausesub').textContent = isClient() ? 'THE MISSION CONTINUES WITHOUT YOU'
    : amGM() ? 'MISSION SUSPENDED — YOUR HELLDIVERS ARE WAITING' : 'MISSION SUSPENDED';
  el('pausenote').innerHTML = isClient()
    ? 'You are not the host, so the horde keeps moving while this is open.<br>ESC to close.'
    : 'ESC to resume.';
  el('pause').style.display = 'flex';
}
function pauseClose() { S.paused = false; el('pause').style.display = 'none'; }
function pauseToggle() { if (S.paused) pauseClose(); else pauseOpen(); }

/* ============================ SETTINGS UI ============================ */
export function applyUi() {
  document.querySelectorAll('[data-hp]').forEach(b => {
    b.className = 'preset' + (b.getAttribute('data-hp') === UI.hp ? ' on' : '');
  });
  const bl = el('botleft');
  if (bl) bl.style.display = (UI.hp === 'above' && !amGM()) ? 'none' : '';
}
const CFGIN = [
  ['cfgramp', 'ramp', 1], ['cfgtough', 'tough', 100], ['cfgincome', 'income', 100],
  ['cfgiscale', 'incomeScale', 100], ['cfglives', 'lives', 1], ['cfgsquad', 'squad', 100],
  ['cfgwave', 'wave', 100], ['cfginfight', 'infight', 100],
  ['cfgffteam', 'ffTeam', 100], ['cfgffsentry', 'ffSentry', 100]
];
export function cfgApplyUI() {
  if (!el('cfgramp')) return;
  for (const [id, key, scale] of CFGIN) {
    const n = el(id);
    if (n) n.value = Math.round(CFG[key] * scale);
  }
  el('cfgobj').checked = !!CFG.objectives;
  el('facterm').checked = !!CFG.fTerm;
  el('facauto').checked = !!CFG.fAuto;
  el('facillum').checked = !!CFG.fIllum;
  el('cfgrampv').textContent = CFG.ramp > 0 ? ('every ' + CFG.ramp + 's') : 'OFF';
  el('cfgtoughv').textContent = CFG.tough > 0 ? Math.round(CFG.tough * 100) + '%' : 'NEVER';
  el('cfgincomev').textContent = Math.round(CFG.income * 100) + '%';
  el('cfgiscalev').textContent = CFG.incomeScale > 0 ? Math.round(CFG.incomeScale * 100) + '%' : 'FLAT';
  el('cfglivesv').textContent = CFG.lives;
  el('cfgsquadv').textContent = CFG.squad > 0 ? ('+' + Math.round(CFG.squad * 35) + '%/diver') : 'OFF';
  el('cfgwavev').textContent = CFG.wave > 0 ? Math.round(CFG.wave * 100) + '%' : 'FLAT';
  el('cfginfightv').textContent = CFG.infight > 0 ? Math.round(CFG.infight * 100) + '%' : 'TRUCE';
  el('cfgffteamv').textContent = CFG.ffTeam > 0 ? Math.round(CFG.ffTeam * 100) + '%' : 'OFF';
  el('cfgffsentryv').textContent = CFG.ffSentry > 0 ? Math.round(CFG.ffSentry * 100) + '%' : 'OFF';
  cfgSummary();
}
function cfgSummary() {
  const t = [];
  t.push(CFG.ramp > 0 ? ('Horde level climbs every ' + CFG.ramp + 's.') : 'Horde level never climbs.');
  t.push(CFG.tough > 0 ? ('Enemies toughen as it climbs (' + Math.round(CFG.tough * 100) + '%).')
                       : 'Enemies never toughen.');
  t.push(CFG.wave > 0 ? ('Each wave buys ' + Math.round(CFG.wave * 100) + '% more than the last.')
                      : 'Every wave is the same size.');
  t.push(CFG.infight > 0 ? 'Factions that meet each other will fight.' : 'The factions have a truce.');
  const f = activeFactions().map(k => FACTIONS[k].name);
  t.push('In play: ' + f.join(', ') + '.');
  t.push(CFG.objectives ? 'Objectives appear and pay out.' : 'No objectives.');
  t.push(CFG.ffTeam > 0 ? ('Squadmates hit each other for ' + Math.round(CFG.ffTeam * 100) + '%.')
                        : 'Squadmates cannot hurt each other.');
  t.push(CFG.ffSentry > 0 ? ('Sentries hit their own side for ' + Math.round(CFG.ffSentry * 100) + '%.')
                          : 'Sentries never hit their own side.');
  t.push('Your own ordnance always hurts you.');
  const e = el('cfgsum');
  if (e) e.textContent = t.join(' ');
}
function cfgRead() {
  for (const [id, key, scale] of CFGIN) {
    const n = el(id);
    if (n) CFG[key] = scale === 1 ? +n.value : n.value / scale;
  }
  CFG.objectives = el('cfgobj').checked ? 1 : 0;
  CFG.fTerm = el('facterm').checked ? 1 : 0;
  CFG.fAuto = el('facauto').checked ? 1 : 0;
  CFG.fIllum = el('facillum').checked ? 1 : 0;
  cfgApplyUI(); cfgSave();
  if (NET.hosting) lobbyBroadcast();
}

/* ============================ LOBBY UI ============================ */
LOBBYUI.open = () => {
  const box = el('cfgbox'), slot = el('cfgslot');
  if (box && slot && box.parentNode !== slot) {
    LOBBYUI.home = box.parentNode;
    const h = document.createElement('h3');
    h.textContent = '— MISSION SETTINGS —';
    slot.innerHTML = ''; slot.appendChild(h); slot.appendChild(box);
  }
  el('lobbyscreen').className = 'on';
  el('overlay').style.display = 'none';
  syncNames();
  LOBBYUI.render();
};
LOBBYUI.close = () => {
  const box = el('cfgbox');
  if (box && LOBBYUI.home && box.parentNode !== LOBBYUI.home) LOBBYUI.home.appendChild(box);
  el('lobbyscreen').className = '';
};
LOBBYUI.render = () => {
  const box = el('slots');
  if (!box) return;
  el('lobbycode').textContent = NET.room || '----';
  syncNames();
  let html = '';
  for (const s of LOBBY.slots) {
    const mine = s.id === LOBBY.myId;
    const ld = (s.load || []).map(id => STRAT_BY_ID[id]).filter(Boolean);
    html += '<div class="slot' + (mine ? ' mine' : '') + '">' +
      '<span class="badge ' + s.role + '">' +
        (s.role === 'gm' ? 'GAME MASTER' : s.role === 'spec' ? 'SPECTATOR' : 'HELLDIVER') + '</span>' +
      '<span class="nm">' + s.name + (s.id === 0 ? ' <span class="you">(host)</span>' : '') +
        (mine ? ' <span class="you">(you)</span>' : '') +
        (s.role === 'diver' && ld.length
          ? '<br><span class="slload">' + ld.map(x =>
              '<i style="color:' + x.color + '">' + x.name + '</i>').join(' · ') + '</span>'
          : '') +
      '</span>';
    if (mine && lobbyLocked(s.id))
      html += '<span class="you">you made the lobby — switch to CO-OP to play</span>';
    else if (mine) {
      if (s.role !== 'diver') html += '<button class="preset" data-want="diver">PLAY</button>';
      if (s.role !== 'spec') html += '<button class="preset" data-want="spec">WATCH</button>';
    }
    html += '</div>';
  }
  for (let e = LOBBY.slots.length; e < 4; e++)
    html += '<div class="slot"><span class="badge spec">OPEN</span>' +
            '<span class="nm empty">waiting for a player…</span></div>';
  box.innerHTML = html;
  box.querySelectorAll('[data-want]').forEach(n => {
    n.onclick = () => lobbyWant(n.getAttribute('data-want'));
  });
  document.querySelectorAll('[data-mode]').forEach(n => {
    const on = n.getAttribute('data-mode') === LOBBY.mode;
    n.className = 'preset modebtn' + (on ? ' on' : '');
    n.style.display = NET.hosting ? 'inline-block' : 'none';
  });
  el('cfgbox').className = NET.hosting ? '' : 'locked';

  const divers = lobbyCount('diver'), gms = lobbyCount('gm');
  const ok = LOBBY.mode === 'gm' ? (gms === 1 && divers >= 1) : (divers >= 1);
  let hint;
  if (LOBBY.mode === 'gm')
    hint = gms !== 1 ? 'GM mode needs exactly one Game Master.'
      : divers < 1 ? 'You run the horde. Waiting for at least one Helldiver to join.'
      : 'Ready: ' + divers + ' Helldiver' + (divers > 1 ? 's' : '') + ' against the Game Master.';
  else
    hint = divers < 1 ? 'Co-op needs at least one Helldiver.'
      : 'Ready: ' + divers + ' Helldiver' + (divers > 1 ? 's' : '') + ' against three factions.';
  el('lobbyhint').textContent = hint;
  const sm = el('startmission');
  if (sm) {
    sm.style.display = NET.hosting ? 'inline-block' : 'none';
    sm.disabled = !ok;
    sm.style.opacity = ok ? 1 : 0.45;
  }
};
function syncNames() {
  const n = myName();
  for (const id of ['namebox', 'namebox2']) {
    const f = el(id);
    if (f && document.activeElement !== f) f.value = n;
  }
}

/* ============================ THE LOOP ============================
   Three things can wake this: requestAnimationFrame while the window is being
   painted, a worker timer when it is not, and an arriving network message. The
   last one matters more than it sounds -- a browser will throttle both of the
   first two down to once a second for a background page, but it delivers socket
   messages as they arrive. A host with three Helldivers is therefore woken
   sixty times a second by their input no matter what the window manager thinks.

   And time is never thrown away. The previous version clamped the step to 50ms,
   which meant a throttled tick reporting a full second of elapsed time advanced
   the world by a twentieth of it -- the mission did not freeze, it ran at five
   per cent speed and then snapped forward when you came back. */
const STEP_MAX = 0.033;        /* longest single step: keeps collisions honest */
const CATCHUP_MAX = 0.5;       /* more debt than this is simply written off */
const RAF_STALL = 0.25;        /* silence from rAF before the other clocks help */

let last = 0, lastRaf = 0, lastPaint = 0;
let fpsAcc = 0, fpsN = 0, errShown = false, pumping = false;

function simTick(dt) {
  if (!S.running) return;
  if (isClient()) updateClient(dt);
  else {
    if (!S.paused) update(dt);
    if (isHost()) {
      NET.acc += dt;
      /* keep shipping snapshots while paused so the squad is told why the world
         stopped moving */
      if (NET.acc >= NET.rate) { NET.acc = 0; netSnapshot(); }
    }
  }
}

function paintTick(t) {
  const pdt = Math.min(0.1, (t - lastPaint) / 1000 || 0.016);
  lastPaint = t;
  healthEase(pdt);
  draw(); hud(); gmHud(); drawMinimap();
  fpsAcc += pdt; fpsN++;
  if (fpsAcc >= 0.75) {
    S.fps = fpsN / fpsAcc;
    fpsAcc = 0; fpsN = 0;
    if (UI.quality === 'auto') {
      if (S.fps < 42 && S.quality > 0.3) S.quality = Math.max(0.3, S.quality - 0.15);
      else if (S.fps > 57 && S.quality < 1) S.quality = Math.min(1, S.quality + 0.08);
    } else S.quality = UI.quality === 'low' ? 0.35 : 1;
    S.particleCap = Math.round(400 + 1200 * S.quality);
  }
}

/* Advance the world by however much real time has passed since the last time
   anything did, in steps small enough to simulate honestly. */
function pump(paint) {
  if (pumping) return;                 /* a wake arriving mid-pump can wait */
  pumping = true;
  const t = performance.now();
  let left = (t - last) / 1000;
  last = t;
  if (!(left > 0)) left = 0;
  if (left > CATCHUP_MAX) left = CATCHUP_MAX;
  /* The sound budget is refilled once per pump, not once per sub-step -- a
     catch-up of twelve steps must not be twelve times as loud. It lives here,
     for every role: it used to live inside update(), which a joining Helldiver
     never runs, so they had no sound effects at all and nothing said so. */
  refillBudget(paint ? 16 : 5);
  try {
    let n = 0;
    while (left > 0.0008 && n < 20) {
      const dt = Math.min(STEP_MAX, left);
      simTick(dt);
      left -= dt; n++;
    }
    /* the procedural march schedules itself ahead on a main-thread timer, which
       is throttled along with everything else; nudging it here keeps it from
       tearing holes in itself while the window is in the background */
    musicSchedule();
    if (paint) paintTick(t);
  } catch (err) {
    if (!errShown) { console.error(err); errShown = true; }
    HD.lastError = err;
  }
  pumping = false;
}

function frame() {
  lastRaf = performance.now();
  pump(true);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---- the clocks that take over when the window stops being painted ----
   Gated on "has rAF actually run recently" rather than `document.hidden`: a
   window merely covered by another one, or minimised, keeps reporting itself as
   visible while the compositor quietly stops painting it, and that is exactly
   the case a host is most likely to hit. */
function wake() {
  if (performance.now() - lastRaf < RAF_STALL * 1000) return;   /* rAF has it */
  pump(false);
}
NETWAKE.fn = wake;                      /* every arriving message is a heartbeat */
let ticker = null;
try {
  const src = 'setInterval(function(){postMessage(0)},16)';
  ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  ticker.onmessage = wake;
} catch (e) { /* no workers: the network heartbeat carries it alone */ }
document.addEventListener('visibilitychange', () => {
  /* do not charge the simulation for time nobody was watching */
  last = performance.now();
  lastPaint = last;
});

/* ============================ BUTTON WIRING ============================ */
document.querySelectorAll('#maps [data-map]').forEach(b => {
  b.onclick = () => start(b.getAttribute('data-map'));
});
el('hostbtn').onclick = () => {
  audioInit();
  if (el('namebox').value.trim()) setMyName(el('namebox').value);
  netOpen('host', null, el('gmmap').value);
};
el('joinbtn').onclick = () => {
  audioInit();
  if (el('namebox').value.trim()) setMyName(el('namebox').value);
  const c = el('joincode').value.trim().toUpperCase();
  if (c.length < 4) { netStatus('enter the 4-character room code', true); return; }
  netOpen('join', c, null);
};
el('joincode').addEventListener('keydown', e => {
  if (e.key === 'Enter') el('joinbtn').onclick();
  e.stopPropagation();
});
el('relayurl').addEventListener('keydown', e => e.stopPropagation());
el('leavelobby').onclick = () => netToMenu('LOBBY LEFT',
  'You stepped out of the lobby. Dive solo, or open another one.');
el('startmission').onclick = () => { if (NET.hosting) startGM(); };
el('newround').onclick = () => { if (isHost() && NET.peer) startGM(); };
document.querySelectorAll('[data-mode]').forEach(n => {
  n.onclick = () => lobbySetMode(n.getAttribute('data-mode'));
});
for (const id of ['namebox', 'namebox2']) {
  const f = el(id);
  f.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') f.blur(); });
  f.addEventListener('change', () => setMyName(f.value));
  f.addEventListener('blur', () => { setMyName(f.value); syncNames(); });
}
document.querySelectorAll('[data-hp]').forEach(b => {
  b.onclick = () => { UI.hp = b.getAttribute('data-hp'); uiSave(); applyUi(); };
});
document.querySelectorAll('[data-q]').forEach(b => {
  b.onclick = () => {
    UI.quality = b.getAttribute('data-q'); uiSave();
    document.querySelectorAll('[data-q]').forEach(x => {
      x.className = 'preset' + (x.getAttribute('data-q') === UI.quality ? ' on' : '');
    });
  };
});
for (const [id] of CFGIN) { const n = el(id); if (n) n.oninput = cfgRead; }
for (const id of ['cfgobj', 'facterm', 'facauto', 'facillum']) {
  const n = el(id); if (n) n.onchange = cfgRead;
}
document.querySelectorAll('[data-preset]').forEach(b => {
  b.onclick = () => {
    const P = PRESETS[b.getAttribute('data-preset')];
    if (!P) return;
    for (const k in P) CFG[k] = P[k];
    cfgApplyUI(); cfgSave();
    if (NET.hosting) lobbyBroadcast();
  };
});
el('resumebtn').onclick = pauseClose;
el('quitbtn').onclick = quitToMenu;
el('volmusic').oninput = function () {
  VOL.music = this.value / 100;
  el('volmusicv').textContent = this.value + '%';
  applyVolume(); musicApplyVolume(); volSave();
};
el('volsfx').oninput = function () {
  VOL.sfx = this.value / 100;
  el('volsfxv').textContent = this.value + '%';
  applyVolume(); volSave();
  if (A.ac && !A.muted) SFX.chip();
};
const mf = el('musicfile');
if (mf) mf.onchange = function () {
  const f = this.files && this.files[0];
  if (f) useExternalTrack(URL.createObjectURL(f), f.name);
};
document.querySelectorAll('[data-q]').forEach(x => {
  x.className = 'preset' + (x.getAttribute('data-q') === UI.quality ? ' on' : '');
});

/* A handle on the world for the browser console. Nothing in the game reads it;
   it is here so a bug can be looked at instead of guessed at.
     HD.S           the whole world
     HD.lastError   the last exception the loop swallowed
     HD.spawn('biletitan', 400, 0)   put one there and see what it does */
const HD = {
  S, CFG, GM, NET, LOBBY, LOADOUT, start, version: 2, lastError: null,
  spawn: (id, x, y) => spawnEnemy(id, { x: x === undefined ? S.cam.x + 300 : x,
                                        y: y === undefined ? S.cam.y : y }),
  troops: () => Object.keys(TROOPS)
};
window.HD = HD;

/* ---- open on a quiet map so the menu has something behind it ---- */
cfgApplyUI();
syncNames();
applyUi();
el('volmusic').value = Math.round(VOL.music * 100);
el('volmusicv').textContent = Math.round(VOL.music * 100) + '%';
el('volsfx').value = Math.round(VOL.sfx * 100);
el('volsfxv').textContent = Math.round(VOL.sfx * 100) + '%';
buildMap('plains');
reset();
