/* Every table the game is built out of: the three factions and their troops, the
 * weapons, the stratagems, the maps and the objectives.
 *
 * ARMOUR AND PENETRATION
 *   Every body has `armor` 0-4 and every round has `pen` 0-4. A round that meets
 *   armour it cannot beat does almost nothing and rings off with a CLANG -- which
 *   is the game telling you to bring something bigger, not a bug. */
'use strict';

export function armorScale(pen, armor) {
  if (pen >= armor) return 1;
  if (pen === armor - 1) return 0.45;
  return 0.07;                      /* a ricochet: sparks, noise, no result */
}
export const RICOCHET = 0.1;        /* below this share of damage, it bounced */

/* ============================ FACTIONS ============================ */
export const FACTIONS = {
  terminid: {
    id: 'terminid', name: 'TERMINIDS', short: 'TERM',
    col: '#e0913a', col2: '#8a4f1c', blood: '#c7d13a', hud: '#ffb347',
    idle: ['termIdleS', 'termIdleM', 'termIdleL'], die: 'termDie'
  },
  automaton: {
    id: 'automaton', name: 'AUTOMATONS', short: 'AUTO',
    col: '#c8433a', col2: '#5a5f66', blood: '#ff8a3d', hud: '#ff6b5a',
    idle: ['autoIdleS', 'autoIdleM', 'autoIdleL'], die: 'autoDie'
  },
  illuminate: {
    id: 'illuminate', name: 'ILLUMINATE', short: 'ILLU',
    col: '#7b52a8', col2: '#3fd0e0', blood: '#6b2f8f', hud: '#c6a6ff',
    idle: ['illIdleS', 'illIdleM', 'illIdleL'], die: 'illDie'
  }
};
export const FACTION_IDS = ['terminid', 'automaton', 'illuminate'];

/* Angles go over the wire as a single byte. A tenth of a degree of facing is not
   worth four characters twelve times a second for every body on the map. */
export const ANG8 = 256 / (Math.PI * 2);

/* What the host sends, and therefore what the client is entitled to assume.
   Both ends read these from here: if they drift apart, the client starts
   deleting bodies the host simply has not mentioned this tick, and the edge of
   the screen flickers with things blinking in and out.
     NETCULL  how far each size class is worth sending at all
     NETNEAR  inside this, everything is sent every single snapshot
     NETMAX   hard ceiling of bodies per snapshot, nearest first */
export const NETCULL = { small: 1300, medium: 1700, large: 2800 };
export const NETNEAR = 1100;
export const NETMAX = 210;

/* size class -> how far it can be heard, and how heavy it feels */
export const SIZE = {
  small: { i: 0, hear: 620, shake: 0, mass: 1, foot: 0 },
  medium: { i: 1, hear: 1150, shake: 3, mass: 6, foot: 0 },
  large: { i: 2, hear: 2400, shake: 8, mass: 30, foot: 1 }
};

/* ============================ ENEMY TROOPS ============================
   hp/spd/dmg are the level-1 numbers; the horde level and CFG.tough scale them.
   cost is what the Game Master pays and what a wave's budget is spent in. */
export const TROOPS = {

  /* ---------------------------------------------------------- TERMINIDS --- */
  scavenger: {
    id: 'scavenger', art: 'scav', fac: 'terminid', size: 'small', name: 'SCAVENGER',
    hp: 26, spd: 138, dmg: 6, armor: 0, r: 11, cost: 1, atkCd: 0.7,
    melee: 1, legs: 6, sprint: 1
  },
  hunter: {
    id: 'hunter', art: 'hunter', fac: 'terminid', size: 'small', name: 'HUNTER',
    hp: 42, spd: 152, dmg: 11, armor: 0, r: 12, cost: 2, atkCd: 0.8,
    melee: 1, legs: 4, leap: { range: 260, cd: 3.4, speed: 720, wind: 0.4 }
  },
  warrior: {
    id: 'warrior', art: 'warrior', fac: 'terminid', size: 'medium', name: 'BILE WARRIOR',
    hp: 190, spd: 80, dmg: 19, armor: 1, r: 20, cost: 6, atkCd: 1.0,
    melee: 1, legs: 6
  },
  spewer: {
    id: 'spewer', art: 'spewer', fac: 'terminid', size: 'medium', name: 'BILE SPEWER',
    hp: 230, spd: 56, dmg: 13, armor: 0, r: 22, cost: 7, atkCd: 1.2,
    melee: 1, legs: 4,
    ranged: { range: 420, cd: 3.0, speed: 430, dmg: 16, spread: 0.13, burst: 5,
              proj: 'bile', snd: 'termSpit', pool: 1 }
  },
  charger: {
    id: 'charger', art: 'charger', fac: 'terminid', size: 'large', name: 'CHARGER',
    hp: 950, spd: 74, dmg: 46, armor: 3, r: 30, cost: 22, atkCd: 1.3,
    melee: 1, legs: 4, smash: 1,
    charge: { wind: 0.9, speed: 680, dur: 1.5, cd: 7, min: 210, max: 1000, snd: 'termCharge' }
  },
  biletitan: {
    id: 'biletitan', art: 'titan', fac: 'terminid', size: 'large', name: 'BILE TITAN',
    hp: 2800, spd: 46, dmg: 62, armor: 4, r: 52, cost: 55, atkCd: 2.0,
    melee: 1, legs: 8, smash: 1, boss: 1,
    slam: { wind: 1.0, radius: 130, dmg: 48 },
    ranged: { range: 620, cd: 4.5, speed: 360, dmg: 24, spread: 0.2, burst: 9,
              proj: 'bile', snd: 'termSpit', pool: 1, arc: 1 }
  },

  /* --------------------------------------------------------- AUTOMATONS --- */
  trooper: {
    id: 'trooper', art: 'trooper', fac: 'automaton', size: 'small', name: 'TROOPER',
    hp: 48, spd: 86, dmg: 7, armor: 1, r: 12, cost: 2, atkCd: 1.0,
    ranged: { range: 480, cd: 1.9, speed: 900, dmg: 8, spread: 0.10, burst: 3,
              proj: 'bolt', snd: 'autoShot' }
  },
  raider: {
    id: 'raider', art: 'raider', fac: 'automaton', size: 'small', name: 'RAIDER',
    hp: 40, spd: 118, dmg: 7, armor: 0, r: 12, cost: 2, atkCd: 0.9, sprint: 1,
    ranged: { range: 360, cd: 1.4, speed: 880, dmg: 6, spread: 0.16, burst: 4,
              proj: 'bolt', snd: 'autoShot' }
  },
  berserker: {
    id: 'berserker', art: 'berserker', fac: 'automaton', size: 'medium', name: 'BERSERKER',
    hp: 280, spd: 108, dmg: 23, armor: 1, r: 19, cost: 7, atkCd: 0.5,
    melee: 1, saw: 1
  },
  devastator: {
    id: 'devastator', art: 'devastator', fac: 'automaton', size: 'medium', name: 'DEVASTATOR',
    hp: 360, spd: 62, dmg: 12, armor: 2, r: 22, cost: 10, atkCd: 1.2,
    shield: 1,
    ranged: { range: 560, cd: 2.2, speed: 980, dmg: 10, spread: 0.09, burst: 8,
              proj: 'bolt', snd: 'autoShot' }
  },
  hulk: {
    id: 'hulk', art: 'hulk', fac: 'automaton', size: 'large', name: 'HULK',
    hp: 1500, spd: 60, dmg: 36, armor: 3, r: 30, cost: 24, atkCd: 1.2,
    melee: 1, smash: 1, stomp: 1,
    ranged: { range: 260, cd: 3.2, speed: 320, dmg: 9, spread: 0.28, burst: 14,
              proj: 'flame', snd: 'flame' }
  },
  strider: {
    id: 'strider', art: 'strider', fac: 'automaton', size: 'large', name: 'FACTORY STRIDER',
    hp: 3400, spd: 42, dmg: 20, armor: 4, r: 56, cost: 62, atkCd: 1.6,
    smash: 1, boss: 1, stomp: 1,
    spawner: { id: 'trooper', every: 7, n: 2 },
    ranged: { range: 700, cd: 1.5, speed: 1050, dmg: 13, spread: 0.06, burst: 10,
              proj: 'bolt', snd: 'autoShot' }
  },

  /* --------------------------------------------------------- ILLUMINATE --- */
  voteless: {
    id: 'voteless', art: 'voteless', fac: 'illuminate', size: 'small', name: 'VOTELESS',
    hp: 34, spd: 96, dmg: 9, armor: 0, r: 13, cost: 1, atkCd: 0.85,
    melee: 1, shamble: 1
  },
  watcher: {
    id: 'watcher', art: 'watcher', fac: 'illuminate', size: 'small', name: 'WATCHER',
    hp: 58, spd: 126, dmg: 0, armor: 0, r: 12, cost: 4, atkCd: 9,
    fly: 1, spotter: { every: 9, n: 3, id: 'voteless' }
  },
  overseer: {
    id: 'overseer', art: 'overseer', fac: 'illuminate', size: 'medium', name: 'OVERSEER',
    hp: 310, spd: 98, dmg: 13, armor: 1, r: 18, cost: 9, atkCd: 1.1,
    fly: 1,
    ranged: { range: 520, cd: 2.0, speed: 820, dmg: 12, spread: 0.08, burst: 4,
              proj: 'plasma', snd: 'illShot' }
  },
  fleshmob: {
    id: 'fleshmob', art: 'fleshmob', fac: 'illuminate', size: 'medium', name: 'FLESHMOB',
    hp: 520, spd: 52, dmg: 40, armor: 1, r: 34, cost: 14, atkCd: 1.2,
    melee: 1, smash: 1, lumps: 1, bursts: 'voteless',
    slam: { wind: 0.75, radius: 100, dmg: 34 },
    charge: { wind: 0.9, speed: 620, dur: 0.85, cd: 9, min: 210, max: 900, snd: 'roar' }
  },
  harvester: {
    id: 'harvester', art: 'harvester', fac: 'illuminate', size: 'large', name: 'HARVESTER',
    hp: 2300, spd: 54, dmg: 30, armor: 3, r: 40, cost: 32, atkCd: 1.5,
    legs: 3, smash: 1, stomp: 1,
    beam: { range: 560, cd: 5.0, wind: 1.1, dur: 2.2, dps: 46, snd: 'illBeam' }
  },
  leviathan: {
    id: 'leviathan', art: 'leviathan', fac: 'illuminate', size: 'large', name: 'LEVIATHAN',
    hp: 2600, spd: 86, dmg: 22, armor: 4, r: 48, cost: 58, atkCd: 1.4,
    fly: 1, boss: 1,
    ranged: { range: 700, cd: 2.1, speed: 900, dmg: 17, spread: 0.07, burst: 12,
              proj: 'plasma', snd: 'illShot' }
  }
};

export const TROOP_IDS = Object.keys(TROOPS);
export function troopsOf(fac, size) {
  const out = [];
  for (const k of TROOP_IDS) {
    const T = TROOPS[k];
    if (T.fac === fac && (!size || T.size === size)) out.push(T);
  }
  return out;
}
/* the Game Master's palette for one faction, cheapest first */
export function palette(fac) {
  return troopsOf(fac).sort((a, b) => a.cost - b.cost);
}

/* enemy projectile looks */
export const PROJ = {
  bile: { col: '#c7d13a', size: 5, life: 1.6, pen: 1, trail: '#8a9410' },
  bolt: { col: '#ff6b3d', size: 3.4, life: 1.1, pen: 1, trail: '#a33a15' },
  plasma: { col: '#5fe0ff', size: 4.2, life: 1.3, pen: 1, trail: '#2a7f99' },
  flame: { col: '#ffb347', size: 7, life: 0.42, pen: 0, trail: '#ff6b3d', fade: 1 }
};

/* ============================ WEAPONS ============================ */
export const WEAPONS = {
  ar: {
    id: 'ar', slot: 1, name: 'AR-23 LIBERATOR', dmg: 19, rpm: 640, mag: 30, mags: 6,
    reload: 2.0, spread: 0.045, speed: 1250, life: 0.6, color: '#ffe38a', recoil: 2.4,
    size: 3, auto: true, kick: 0.014, kickMax: 0.075, punch: 2.4, pen: 1,
    sndF: 2400, sndVol: 0.30, sndLen: 0.10
  },
  pistol: {
    id: 'pistol', slot: 2, name: 'P-2 PEACEMAKER', dmg: 24, rpm: 420, mag: 15, mags: 6,
    reload: 1.35, spread: 0.03, speed: 1150, life: 0.5, color: '#ffd9a0', recoil: 2.0,
    size: 2.6, auto: false, kick: 0.008, kickMax: 0.042, punch: 1.5, pen: 1,
    sndF: 2000, sndVol: 0.26, sndLen: 0.09
  },
  mg43: {
    id: 'mg43', slot: 3, name: 'MG-43 MACHINE GUN', dmg: 22, rpm: 820, mag: 150, mags: 3,
    reload: 4.0, spread: 0.075, speed: 1350, life: 0.68, color: '#ffd06b', recoil: 3.2,
    size: 3.6, auto: true, kick: 0.017, kickMax: 0.1, punch: 2.9, pen: 2,
    sndF: 2100, sndVol: 0.34, sndLen: 0.11
  },
  recoilless: {
    id: 'recoilless', slot: 3, name: 'GR-8 RECOILLESS RIFLE', dmg: 700, rpm: 40, mag: 1, mags: 5,
    reload: 3.6, spread: 0.01, speed: 1500, life: 1.2, color: '#ffe9a8', recoil: 9,
    size: 6, auto: false, kick: 0.03, kickMax: 0.06, punch: 7, pen: 4,
    rocket: { radius: 130, dmg: 340 },
    sndF: 1100, sndVol: 0.55, sndLen: 0.3
  },
  flamer: {
    id: 'flamer', slot: 3, name: 'FLAM-40 INCINERATOR', dmg: 11, rpm: 720, mag: 130, mags: 2,
    reload: 3.0, spread: 0.22, speed: 460, life: 0.4, color: '#ffb347', recoil: 0.6,
    size: 7, auto: true, kick: 0.004, kickMax: 0.02, punch: 0.6, pen: 2,
    burn: 1, fade: 1,
    sndF: 900, sndVol: 0.2, sndLen: 0.14
  },
  arc: {
    id: 'arc', slot: 3, name: 'ARC-12 BLITZER', dmg: 62, rpm: 62, mag: 999, mags: 0,
    reload: 0, spread: 0, speed: 0, life: 0, color: '#9fe8ff', recoil: 3,
    size: 3, auto: true, kick: 0.006, kickMax: 0.03, punch: 2, pen: 2,
    chain: { range: 330, jumps: 4, falloff: 0.75 }, infinite: 1,
    sndF: 1600, sndVol: 0.3, sndLen: 0.2
  },
  bulletstorm: {
    id: 'bulletstorm', slot: 3, name: 'BULLETSTORM', dmg: 16, rpm: 1150, mag: 400, mags: 0,
    reload: 0, spread: 0.085, speed: 1450, life: 0.65, color: '#ffb347', recoil: 1.5,
    size: 3.6, auto: true, kick: 0.019, kickMax: 0.105, punch: 2.8, pen: 1,
    disposable: true, sndF: 3100, sndVol: 0.27, sndLen: 0.08
  }
};
export const SUPPORT_IDS = ['mg43', 'recoilless', 'flamer', 'arc', 'bulletstorm'];
/* index -> weapon, for the compact "somebody fired" channel. 0 is a sentry. */
export const SLOTW = [null, WEAPONS.ar, WEAPONS.pistol, WEAPONS.mg43, WEAPONS.recoilless,
                     WEAPONS.flamer, WEAPONS.arc, WEAPONS.bulletstorm, null];
export const WEP_SND_IDX = {
  ar: 1, pistol: 2, mg43: 3, recoilless: 4, flamer: 5, arc: 6, bulletstorm: 7
};
export const SND_SENTRY = 0, SND_CANNON = 8;

/* ============================ STRATAGEMS ============================
   free:1      does not take one of your four slots
   squadOnly:1 pointless alone, so it never appears on a solo HUD
   orbital:1   jammed underground -- a cave has no sky to call through
   hidden:1    not on any loadout screen. Punch in the code and find out. */
export const STRATS = [
  { id: 'reinforce', name: 'REINFORCE', code: ['U', 'D', 'R', 'L', 'U'], cd: 4, callIn: 2.0,
    pod: true, free: 1, squadOnly: 1, color: '#4fb477', kind: 'reinforce',
    desc: 'Call a downed Helldiver back down from the ship.' },
  { id: 'resupply', name: 'RESUPPLY', code: ['D', 'D', 'U', 'R'], cd: 45, callIn: 3.0,
    pod: true, free: 1, color: '#ffd21e', kind: 'supply',
    desc: 'Four crates of ammunition, grenades and stims.' },
  { id: 'requisition', name: 'REQUISITION', code: ['L', 'D', 'R', 'U', 'D'], cd: 90, callIn: 3.0,
    pod: true, free: 1, color: '#9fe8ff', kind: 'requisition',
    desc: 'A terminal. Stand on it to swap your four stratagems mid-mission.' },

  { id: 'eagle500', name: 'EAGLE 500KG', code: ['U', 'R', 'D', 'D', 'D'], cd: 26, callIn: 3.5,
    color: '#ff6b3d', kind: 'eagle500',
    desc: 'One very large bomb. Flattens a city block, you included.' },
  { id: 'eagleair', name: 'EAGLE AIRSTRIKE', code: ['U', 'R', 'D', 'R'], cd: 20, callIn: 3.0,
    color: '#ff8a3d', kind: 'eagleair',
    desc: 'A line of five bombs along the run-in. Good on a street.' },
  { id: 'eaglecluster', name: 'EAGLE CLUSTER', code: ['U', 'R', 'D', 'D', 'R'], cd: 22, callIn: 3.0,
    color: '#ffb347', kind: 'eaglecluster',
    desc: 'Wide scatter of small bomblets. Shreds swarms, tickles armour.' },
  { id: 'orbprecision', name: 'ORBITAL PRECISION', code: ['R', 'R', 'U'], cd: 18, callIn: 2.0,
    orbital: 1, color: '#9ecbff', kind: 'orbprecision',
    desc: 'A single shell from the ship. Quick, accurate, heavy.' },
  { id: 'orblaser', name: 'ORBITAL LASER', code: ['R', 'D', 'U', 'R', 'D'], cd: 100, callIn: 2.5,
    orbital: 1, color: '#ff4d6b', kind: 'orblaser', uses: 3,
    desc: 'A beam that walks the area for eight seconds. Three per mission.' },
  { id: 'orbrail', name: 'ORBITAL RAILCANNON', code: ['R', 'U', 'D', 'D', 'R'], cd: 90, callIn: 2.0,
    orbital: 1, color: '#c6a6ff', kind: 'orbrail',
    desc: 'Automatically fires on the largest thing near the beacon.' },
  { id: 'orbbarrage', name: 'ORBITAL BARRAGE', code: ['R', 'R', 'D', 'L', 'R', 'D'], cd: 120, callIn: 3.0,
    orbital: 1, color: '#ff9d3d', kind: 'orbbarrage',
    desc: 'Twenty shells over twelve seconds across a wide area. Indiscriminate.' },

  { id: 'gatling', name: 'GATLING SENTRY', code: ['D', 'U', 'R', 'L'], cd: 30, callIn: 2.5,
    pod: true, color: '#7fd4ff', kind: 'sentry', sentry: 'gatling',
    desc: 'Automated turret. Fast, light rounds, finite belt.' },
  { id: 'autocannon', name: 'AUTOCANNON SENTRY', code: ['D', 'U', 'R', 'U', 'L'], cd: 45, callIn: 2.5,
    pod: true, color: '#9ecbff', kind: 'sentry', sentry: 'autocannon',
    desc: 'Slower turret that punches through medium armour.' },
  { id: 'mortar', name: 'MORTAR SENTRY', code: ['D', 'U', 'R', 'R', 'D'], cd: 50, callIn: 2.5,
    pod: true, color: '#ffd06b', kind: 'sentry', sentry: 'mortar',
    desc: 'Lobs shells over walls at whatever is furthest away. No friend of yours.' },
  { id: 'tesla', name: 'TESLA TOWER', code: ['D', 'U', 'R', 'U', 'L', 'D'], cd: 60, callIn: 2.5,
    pod: true, color: '#9fe8ff', kind: 'sentry', sentry: 'tesla',
    desc: 'Arcs to everything that comes close. Everything.' },

  { id: 'mg43', name: 'MACHINE GUN', code: ['D', 'L', 'U', 'U', 'R'], cd: 55, callIn: 3.0,
    pod: true, color: '#ffd06b', kind: 'support', wep: 'mg43',
    desc: 'MG-43. Medium penetration, big belt, slow reload.' },
  { id: 'recoilless', name: 'RECOILLESS RIFLE', code: ['D', 'L', 'R', 'R', 'L'], cd: 70, callIn: 3.0,
    pod: true, color: '#ffe9a8', kind: 'support', wep: 'recoilless',
    desc: 'One rocket at a time. Opens anything the game has.' },
  { id: 'flamer', name: 'FLAMETHROWER', code: ['D', 'L', 'U', 'D', 'U'], cd: 60, callIn: 3.0,
    pod: true, color: '#ff8a3d', kind: 'support', wep: 'flamer',
    desc: 'Short range, sets things alight, keeps burning them.' },
  { id: 'arc', name: 'ARC BLITZER', code: ['D', 'R', 'D', 'U', 'L', 'R'], cd: 60, callIn: 3.0,
    pod: true, color: '#9fe8ff', kind: 'support', wep: 'arc',
    desc: 'Chains between bodies. Never reloads. Will find you too.' },
  { id: 'bulletstorm', name: 'BULLETSTORM', code: ['D', 'L', 'D', 'U', 'U', 'L'], cd: 55, callIn: 3.0,
    pod: true, color: '#c6ff6b', kind: 'support', wep: 'bulletstorm',
    desc: 'A sealed drum of four hundred. No reloads, thrown away when dry.' },

  { id: 'shield', name: 'SHIELD GENERATOR', code: ['D', 'U', 'L', 'R', 'L', 'R'], cd: 80, callIn: 3.0,
    pod: true, color: '#7fd4ff', kind: 'shield',
    desc: 'A bubble that soaks damage and recharges when you stop taking it.' },
  { id: 'guarddog', name: 'GUARD DOG', code: ['D', 'U', 'L', 'U', 'R', 'R'], cd: 75, callIn: 3.0,
    pod: true, color: '#c6ff6b', kind: 'guarddog',
    desc: 'A drone that orbits you and shoots what you are not looking at.' },

  /* ------------------------------------------------------------- not listed */
  { id: 'liberty', name: "LIBERTY'S CALL", code: ['U', 'U', 'D', 'D', 'L', 'R', 'L', 'R'],
    cd: 150, callIn: 4.0, pod: true, hidden: 1, free: 1, color: '#ffffff', kind: 'liberty',
    desc: 'Everything Super Earth could spare, all at once.' },
  { id: 'destroyer', name: 'SUPER DESTROYER', code: ['U', 'U', 'U', 'U', 'D', 'D', 'D', 'D', 'L', 'R'],
    cd: 240, callIn: 5.0, hidden: 1, free: 1, orbital: 1, color: '#ffd21e', kind: 'destroyer',
    desc: 'Bring the ship down. There is no second one.' }
];
export const STRAT_BY_ID = {};
for (const s of STRATS) STRAT_BY_ID[s.id] = s;
export function stratIdx(s) { return STRATS.indexOf(s); }
/* what may be put in one of the four slots */
export const LOADOUT_POOL = STRATS.filter(s => !s.free && !s.hidden).map(s => s.id);

/* ============================ SENTRIES ============================ */
export const SENTRIES = {
  gatling: { name: 'GATLING SENTRY', hp: 240, ammo: 400, rpm: 850, dmg: 13, pen: 1,
             range: 900, col: '#7fd4ff', spin: 7, snd: 'sentry', spd: 1500, size: 3 },
  autocannon: { name: 'AUTOCANNON SENTRY', hp: 300, ammo: 90, rpm: 140, dmg: 70, pen: 3,
             range: 1050, col: '#9ecbff', spin: 4.4, snd: 'cannon', spd: 1300, size: 5,
             blast: { radius: 80, dmg: 60 } },
  mortar: { name: 'MORTAR SENTRY', hp: 220, ammo: 40, rpm: 30, dmg: 0, pen: 4,
             range: 1500, min: 300, col: '#ffd06b', spin: 2.2, snd: 'mortar', lob: 1,
             blast: { radius: 165, dmg: 260 } },
  tesla: { name: 'TESLA TOWER', hp: 340, ammo: 999, rpm: 70, dmg: 85, pen: 2,
             range: 330, col: '#9fe8ff', spin: 99, snd: 'tesla', arc: 1, size: 3 }
};

/* ============================ MAPS ============================ */
export const MAPS = {
  plains: {
    id: 'plains', name: 'THE PLAINS', world: 6000,
    ground: '#171a16', grid: '#1e2219', border: '#3a3f2c',
    city: false, cave: false, grass: true,
    blurb: 'Open ground. Nothing to hide behind, and nothing to hide them either.'
  },
  megacity: {
    id: 'megacity', name: 'MEGACITY', world: 6000,
    ground: '#101319', grid: '#181d27', border: '#2b3a52',
    city: true, cave: false,
    blurb: 'A destructible city block. Everything standing can come down.'
  },
  hollows: {
    id: 'hollows', name: 'THE HOLLOWS', world: 6000,
    ground: '#1a1710', grid: '#252016', border: '#5a4428',
    city: true, rockHp: 420, grass: true,
    /* open ground with cave systems dug into it -- you are underground when you
       are inside one, and back on the surface when you walk out */
    caves: { count: 6, rMin: 620, rMax: 1150, outcrops: 120 },
    blurb: 'Open ground pocked with cave systems. Nothing reaches you inside one.'
  }
};
export const MAP_IDS = ['plains', 'megacity', 'hollows'];

/* ============================ OBJECTIVES ============================
   Each one is a thing to go and do that pays out. Several of them are aimed
   squarely at the Game Master -- an endless horde with nothing to push back
   against is just a countdown. */
export const OBJECTIVES = {
  upload: {
    id: 'upload', name: 'UPLOAD MISSION DATA', kind: 'hold', time: 42, radius: 165,
    col: '#7fd4ff', reward: 'life',
    desc: 'Stand inside the uplink until the transfer completes.'
  },
  samples: {
    id: 'samples', name: 'RECOVER SAMPLES', kind: 'collect', count: 6, spread: 900,
    col: '#ffd21e', reward: 'cooldown',
    desc: 'Six containers scattered nearby. Walk over each one.'
  },
  jammer: {
    id: 'jammer', name: 'DESTROY THE JAMMER', kind: 'destroy', hp: 2400, radius: 26,
    field: 1300, col: '#ff6b3d', reward: 'unjam', armor: 2,
    desc: 'Nothing can be called down inside its field. Blow it up.'
  },
  spore: {
    id: 'spore', name: 'BURN THE SPORE TOWER', kind: 'destroy', hp: 1700, radius: 30,
    field: 2000, col: '#c7d13a', reward: 'vision', armor: 1,
    desc: 'The spores are blinding you. Burn it down.'
  },
  radar: {
    id: 'radar', name: 'BRING UP THE RADAR', kind: 'hold', time: 20, radius: 130,
    col: '#4fb477', reward: 'radar',
    desc: 'Spins up the array: full map, and no hostile deployment near it for a while.'
  },
  broadcast: {
    id: 'broadcast', name: 'SILENCE THE BROADCAST', kind: 'destroy', hp: 2000, radius: 24,
    col: '#c6a6ff', reward: 'confuse', armor: 1,
    desc: 'It is co-ordinating them. Take it off the air and watch them turn on each other.'
  },
  artillery: {
    id: 'artillery', name: 'LOAD SEAF ARTILLERY', kind: 'carry', count: 3, spread: 620,
    col: '#ff8a3d', reward: 'barrage',
    desc: 'Carry three shells from the cache to the gun. It will earn its keep.'
  }
};
export const OBJ_IDS = Object.keys(OBJECTIVES);

/* what each reward actually does is in objectives.js; this is what it reads as */
export const REWARD_TEXT = {
  life: '+1 REINFORCEMENT',
  cooldown: 'ALL STRATAGEMS READY',
  unjam: 'STRATAGEM UPLINK RESTORED',
  vision: 'SPORE CLOUD CLEARED',
  radar: 'FULL TACTICAL MAP · DEPLOYMENT BLOCKED',
  confuse: 'HOSTILE COMMS DOWN — THEY ARE FIGHTING EACH OTHER',
  barrage: 'SEAF ARTILLERY AVAILABLE'
};
