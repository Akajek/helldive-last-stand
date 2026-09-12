/* Mission settings, sound levels and HUD preferences -- everything that survives
   a reload, and everything the lobby host ships to the squad so both ends agree
   on the rules before the pods leave the rack. */
'use strict';
import { clamp } from './util.js';

/* ------------------------------------------------------------------ audio */
export const VOL = { sfx: 0.9, music: 0.45 };
try {
  const raw = localStorage.getItem('hd_vol');
  if (raw) {
    const v = JSON.parse(raw);
    if (typeof v.sfx === 'number') VOL.sfx = clamp(v.sfx, 0, 1);
    if (typeof v.music === 'number') VOL.music = clamp(v.music, 0, 1);
  }
} catch (e) { /* private mode, or a corrupt entry -- defaults are fine */ }
export function volSave() {
  try { localStorage.setItem('hd_vol', JSON.stringify(VOL)); } catch (e) {}
}

/* ------------------------------------------------------------------- HUD */
/* Where your own health reads: the corner panel, a bar over your Helldiver, or
   both. Squadmates always get the bar over their head -- you cannot cover
   someone whose health you have to guess at. */
export const UI = { hp: 'both', quality: 'auto' };
try {
  const raw = localStorage.getItem('hd_ui');
  if (raw) {
    const u = JSON.parse(raw);
    if (u.hp === 'bottom' || u.hp === 'above' || u.hp === 'both') UI.hp = u.hp;
    if (u.quality === 'auto' || u.quality === 'high' || u.quality === 'low') UI.quality = u.quality;
  }
} catch (e) {}
export function uiSave() {
  try { localStorage.setItem('hd_ui', JSON.stringify(UI)); } catch (e) {}
}

/* --------------------------------------------------------------- loadout */
/* Four stratagem slots, chosen before the drop and carried by this browser.
   RESUPPLY, REINFORCE and REQUISITION are not in here -- they never take a slot. */
export const LOADOUT = { slots: ['eagle500', 'gatling', 'mg43', 'orbprecision'] };
try {
  const raw = localStorage.getItem('hd_load');
  if (raw) {
    const l = JSON.parse(raw);
    if (Array.isArray(l) && l.length === 4) LOADOUT.slots = l.map(String);
  }
} catch (e) {}
export function loadoutSave() {
  try { localStorage.setItem('hd_load', JSON.stringify(LOADOUT.slots)); } catch (e) {}
}

/* ------------------------------------------------------------- the mission */
/* squad:     how hard the co-op horde thickens per extra Helldiver.
   tough:     how much enemies gain from the horde level.
   wave:      how fast the wave budget climbs -- the size of each minute's swarm.
   infight:   how readily two factions that meet each other stop caring about you.
   ffTeam:    how much of a squadmate's round or blast lands on you.
   ffSentry:  the same for your own turrets.
   Neither friendly-fire dial touches what your OWN ordnance does to you --
   standing under your own 500KG is the deal you made. */
export const CFG = {
  ramp: 25, tough: 1, income: 1, incomeScale: 1, lives: 5, squad: 1,
  wave: 1, infight: 1, objectives: 1,
  ffTeam: 0, ffSentry: 0, credits: 30, maxCredits: 220,
  /* which factions the director may draw from; the GM always has all three */
  fTerm: 1, fAuto: 1, fIllum: 1
};

export const PRESETS = {
  /* they never toughen -- the swarm simply gets wider every minute */
  swarm: { ramp: 20, tough: 0, income: 1.35, incomeScale: 2.0, lives: 5, wave: 1.5, infight: 1 },
  /* a thin stream of increasingly nasty things */
  elite: { ramp: 25, tough: 1.8, income: 0.85, incomeScale: 0, lives: 5, wave: 0.65, infight: 1 },
  /* everything climbs */
  both: { ramp: 25, tough: 1, income: 1, incomeScale: 1, lives: 5, wave: 1, infight: 1 },
  /* nothing climbs: the mission you start is the mission you finish */
  flat: { ramp: 0, tough: 0, income: 1, incomeScale: 0, lives: 5, wave: 0, infight: 1 },
  /* three factions at full strength, all of them furious with each other */
  war: { ramp: 20, tough: 1.2, income: 1.2, incomeScale: 1.2, lives: 6, wave: 1.8, infight: 1 }
};

try {
  const raw = localStorage.getItem('hd_cfg');
  if (raw) {
    const c = JSON.parse(raw);
    for (const k in CFG) if (typeof c[k] === 'number') CFG[k] = c[k];
  }
} catch (e) {}
export function cfgSave() {
  try { localStorage.setItem('hd_cfg', JSON.stringify(CFG)); } catch (e) {}
}

/* which factions the wave director is allowed to use this mission */
export function activeFactions() {
  const out = [];
  if (CFG.fTerm) out.push('terminid');
  if (CFG.fAuto) out.push('automaton');
  if (CFG.fIllum) out.push('illuminate');
  return out.length ? out : ['illuminate'];
}

/* ------------------------------------------------------------------- name */
let MYNAME = '';
export function myName() {
  if (MYNAME) return MYNAME;
  try { MYNAME = localStorage.getItem('hd_name') || ''; } catch (e) {}
  if (!MYNAME) MYNAME = 'DIVER ' + (1 + Math.floor(Math.random() * 89));
  return MYNAME;
}
export function setStoredName(v) {
  MYNAME = v;
  try { localStorage.setItem('hd_name', v); } catch (e) {}
}
