/* Every sound in the game is synthesised here -- there are no audio files to ship.
 *
 * Two things guard the speakers. `sfxBudget` is refilled once per frame by the
 * loop (never by a mode-specific update, which is how joining players once ended
 * up with no sound at all), and caps how many oscillators a single busy moment
 * may start. `sfxDist` is a 0..1 multiplier the callers set from how far away the
 * thing happened, so a rifle two blocks over is not in your ear. */
'use strict';
import { VOL } from './config.js';
import { clamp } from './util.js';

export const A = {
  ac: null, master: null, sfxBus: null, musBus: null,
  muted: false, noiseBuf: null, budget: 0, dist: 1
};

export function audioInit() {
  if (A.ac) { if (A.ac.state === 'suspended') A.ac.resume(); return; }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  A.ac = new Ctor();
  A.master = A.ac.createGain(); A.master.gain.value = 0.5; A.master.connect(A.ac.destination);
  /* effects and music run on their own buses so they are independently
     adjustable, leaving master for the global mute */
  A.sfxBus = A.ac.createGain(); A.sfxBus.gain.value = VOL.sfx; A.sfxBus.connect(A.master);
  A.musBus = A.ac.createGain(); A.musBus.gain.value = VOL.music; A.musBus.connect(A.master);
  const n = A.ac.sampleRate * 1.2;
  A.noiseBuf = A.ac.createBuffer(1, n, A.ac.sampleRate);
  const d = A.noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
}
function now() { return A.ac.currentTime; }
export function canPlay() { return A.ac && !A.muted && A.budget > 0; }
export function refillBudget(n) { A.budget = n === undefined ? 16 : n; }
export function setMuted(v) {
  A.muted = v;
  if (A.master) A.master.gain.value = v ? 0 : 0.5;
}
export function applyVolume() {
  if (A.sfxBus) A.sfxBus.gain.value = A.muted ? 0 : VOL.sfx;
  if (A.musBus) A.musBus.gain.value = A.muted ? 0 : VOL.music;
}

export function noise(dur, vol, f0, f1, q, type) {
  if (!canPlay()) return; A.budget--;
  vol *= A.dist; if (vol < 0.0015) return;
  const t = now(), src = A.ac.createBufferSource();
  src.buffer = A.noiseBuf; src.loop = true;
  const flt = A.ac.createBiquadFilter();
  flt.type = type || 'lowpass';
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  flt.Q.value = q || 1;
  const g = A.ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(flt); flt.connect(g); g.connect(A.sfxBus || A.master);
  src.start(t); src.stop(t + dur + 0.02);
}
export function tone(type, f0, f1, dur, vol, delay) {
  if (!canPlay()) return; A.budget--;
  vol *= A.dist; if (vol < 0.0015) return;
  const t = now() + (delay || 0);
  const o = A.ac.createOscillator(), g = A.ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(A.sfxBus || A.master);
  o.start(t); o.stop(t + dur + 0.02);
}
/* a wobbling voice, for things that are alive and unhappy about it */
function warble(f0, f1, dur, vol, rate, depth, type) {
  if (!canPlay()) return; A.budget--;
  vol *= A.dist; if (vol < 0.0015) return;
  const t = now();
  const o = A.ac.createOscillator(), g = A.ac.createGain();
  const lfo = A.ac.createOscillator(), lg = A.ac.createGain();
  o.type = type || 'sawtooth';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  lfo.type = 'sine'; lfo.frequency.value = rate || 18;
  lg.gain.value = depth || 30;
  lfo.connect(lg); lg.connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(A.sfxBus || A.master);
  o.start(t); lfo.start(t);
  o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
}

export const SFX = {
  /* ---------------------------------------------------------- the Helldiver */
  shot(w) {
    noise(w.sndLen, w.sndVol, w.sndF, w.sndF * 0.25, 1.1);
    tone('square', w.sndF * 0.28, 60, w.sndLen * 0.8, w.sndVol * 0.5);
  },
  dry() { noise(0.04, 0.25, 3800, 2200, 4, 'bandpass'); },
  reloadOut() { noise(0.07, 0.22, 1800, 500, 2); },
  reloadIn() { noise(0.09, 0.30, 1100, 320, 2); tone('square', 180, 90, 0.08, 0.18); },
  hit() { noise(0.06, 0.16, 900, 220, 1); },
  /* a round that could not get through -- the sound that tells you to change weapon */
  clang() { tone('square', 1800, 700, 0.11, 0.22); noise(0.09, 0.2, 5200, 2400, 6, 'bandpass'); },
  kill() { noise(0.16, 0.24, 620, 90, 0.8); tone('sawtooth', 150, 52, 0.16, 0.10); },
  hurt() { noise(0.22, 0.42, 500, 80, 0.7); tone('sawtooth', 180, 60, 0.25, 0.22); },
  boom(big) {
    noise(big ? 1.5 : 0.65, big ? 0.95 : 0.6, big ? 900 : 1400, 45, 0.8);
    tone('sine', big ? 110 : 170, big ? 24 : 40, big ? 1.1 : 0.5, big ? 0.85 : 0.45);
    if (big) tone('sine', 55, 18, 1.7, 0.5, 0.02);
  },
  beep(i) { tone('square', 760 + i * 70, 760 + i * 70, 0.055, 0.16); },
  arm() { tone('square', 900, 1500, 0.09, 0.2); tone('square', 1500, 1900, 0.07, 0.16, 0.09); },
  fail() { tone('square', 300, 140, 0.13, 0.18); },
  throwb() { noise(0.12, 0.2, 2400, 600, 1); },
  stim() { noise(0.1, 0.18, 2800, 900, 3, 'bandpass'); tone('sine', 420, 980, 0.3, 0.2); },
  pickup() { tone('square', 520, 880, 0.08, 0.18); tone('square', 880, 1180, 0.09, 0.16, 0.08); },
  swap() { noise(0.06, 0.16, 1500, 600, 2); },
  discard() { noise(0.35, 0.3, 1200, 200, 1.2); tone('square', 300, 90, 0.28, 0.14); },
  swing() { noise(0.16, 0.22, 1800, 420, 1.4, 'bandpass'); },
  thud() { noise(0.12, 0.45, 700, 150, 1); tone('sine', 180, 60, 0.14, 0.3); },
  chip() { noise(0.05, 0.12, 4200, 1800, 3, 'bandpass'); },
  crush() { noise(0.5, 0.7, 500, 60, 0.8); tone('sawtooth', 140, 30, 0.5, 0.4); },

  /* ------------------------------------------------------------- deliveries */
  deploy() { tone('square', 300, 760, 0.2, 0.2); noise(0.25, 0.25, 1200, 200, 1); },
  siren() { tone('sawtooth', 520, 880, 0.5, 0.14); tone('sawtooth', 880, 520, 0.5, 0.12, 0.5); },
  bounce() { tone('square', 900, 520, 0.05, 0.13); noise(0.04, 0.1, 3000, 1200, 2, 'bandpass'); },
  ping() { tone('sine', 1250, 1250, 0.07, 0.13); },
  incoming() { noise(0.9, 0.3, 320, 1800, 0.7, 'highpass'); tone('sawtooth', 90, 300, 0.9, 0.18); },
  impact() {
    noise(0.9, 0.8, 700, 50, 0.8); tone('sine', 90, 26, 0.8, 0.7); tone('sine', 48, 20, 1.2, 0.4, 0.03);
  },
  sentry() { noise(0.05, 0.16, 2600, 700, 1.2); },
  /* the autocannon's heavier, slower bark */
  cannon() { noise(0.14, 0.4, 1500, 180, 0.9); tone('square', 220, 70, 0.13, 0.3); },
  mortar() { tone('sine', 300, 90, 0.22, 0.35); noise(0.18, 0.3, 900, 200, 1); },
  tesla() {
    noise(0.16, 0.35, 6000, 1200, 5, 'bandpass');
    tone('sawtooth', 2400, 300, 0.15, 0.22);
  },
  arc() { noise(0.22, 0.4, 5000, 700, 4, 'bandpass'); tone('square', 1600, 180, 0.2, 0.25); },
  flame() { noise(0.22, 0.22, 900, 2600, 0.6, 'highpass'); },
  laserHum() { tone('sawtooth', 140, 150, 0.5, 0.2); tone('square', 420, 430, 0.5, 0.1); },
  railcannon() {
    tone('sawtooth', 90, 2400, 0.35, 0.3);
    noise(0.5, 0.6, 3000, 100, 0.7);
    tone('sine', 70, 22, 0.9, 0.5, 0.3);
  },
  rebuild() {
    tone('square', 180, 520, 0.5, 0.16); tone('square', 270, 780, 0.5, 0.12, 0.12);
    noise(0.7, 0.2, 400, 1600, 0.8, 'highpass');
  },
  crumble() {
    noise(1.6, 0.6, 600, 60, 0.6); tone('sine', 70, 22, 1.4, 0.45); tone('sine', 40, 16, 1.9, 0.3, 0.1);
  },

  /* ------------------------------------------------------------- objectives */
  terminal() { tone('square', 640, 640, 0.05, 0.14); tone('square', 880, 880, 0.05, 0.12, 0.06); },
  uploading() { tone('sine', 900, 1100, 0.09, 0.1); },
  objDone() {
    tone('square', 520, 520, 0.14, 0.2); tone('square', 660, 660, 0.14, 0.18, 0.13);
    tone('square', 880, 880, 0.3, 0.2, 0.26);
  },
  objFail() { tone('sawtooth', 400, 120, 0.5, 0.25); tone('sawtooth', 300, 90, 0.6, 0.2, 0.1); },
  objNew() { tone('square', 300, 700, 0.16, 0.16); tone('square', 700, 1000, 0.2, 0.14, 0.15); },

  /* ------------------------------------------------- the Terminids (organic) */
  termIdleS() { warble(420, 700, 0.16, 0.10, 40, 90, 'sawtooth'); },
  termIdleM() { warble(230, 150, 0.4, 0.18, 14, 50, 'sawtooth'); noise(0.3, 0.12, 800, 300, 1); },
  termIdleL() {
    warble(90, 62, 1.3, 0.4, 6, 18, 'sawtooth');
    noise(1.2, 0.3, 500, 90, 0.7); tone('sine', 46, 24, 1.4, 0.3);
  },
  termDie() { warble(500, 90, 0.3, 0.22, 30, 120, 'sawtooth'); noise(0.22, 0.3, 1300, 200, 1); },
  termSpit() { noise(0.26, 0.3, 500, 1700, 0.8, 'bandpass'); tone('sawtooth', 300, 120, 0.24, 0.16); },
  termCharge() { tone('sawtooth', 110, 240, 0.7, 0.34); noise(0.7, 0.35, 500, 900, 0.7); },

  /* ------------------------------------------------ the Automatons (machine) */
  autoIdleS() { tone('square', 880, 620, 0.07, 0.08); tone('square', 1240, 1240, 0.05, 0.06, 0.07); },
  autoIdleM() { noise(0.2, 0.14, 1800, 400, 2); tone('square', 190, 120, 0.22, 0.12); },
  autoIdleL() {
    tone('sawtooth', 70, 58, 1.0, 0.32); noise(0.9, 0.26, 420, 120, 0.8);
    tone('square', 150, 110, 0.5, 0.14, 0.2);
  },
  autoDie() {
    noise(0.4, 0.4, 2600, 200, 1); tone('square', 400, 60, 0.3, 0.2);
    noise(0.5, 0.2, 6000, 2000, 5, 'bandpass');
  },
  autoShot() { tone('square', 1400, 320, 0.08, 0.22); noise(0.07, 0.16, 2600, 800, 2); },
  autoRocket() { noise(0.5, 0.28, 700, 2400, 0.7, 'highpass'); tone('sawtooth', 200, 500, 0.5, 0.16); },
  autoStomp() { noise(0.26, 0.5, 400, 60, 0.9); tone('sine', 95, 34, 0.3, 0.42); },
  autoSaw() { warble(220, 240, 0.45, 0.2, 60, 70, 'square'); },

  /* ------------------------------------------------ the Illuminate (psionic) */
  illIdleS() { warble(200, 170, 0.5, 0.13, 7, 22, 'sine'); },
  illIdleM() { warble(300, 420, 0.7, 0.16, 5, 60, 'sine'); tone('sine', 900, 1100, 0.5, 0.06); },
  illIdleL() {
    tone('sine', 58, 46, 1.6, 0.38); warble(150, 120, 1.4, 0.2, 3, 30, 'sine');
    tone('sine', 300, 280, 1.2, 0.08, 0.2);
  },
  illDie() { warble(600, 120, 0.45, 0.24, 16, 200, 'sine'); noise(0.3, 0.2, 2200, 300, 1.5); },
  illShot() { tone('sine', 1900, 600, 0.1, 0.2); tone('sine', 900, 300, 0.12, 0.12, 0.02); },
  illBeam() { tone('sine', 420, 460, 0.4, 0.18); tone('sine', 1300, 1360, 0.4, 0.08); },
  illWarp() { warble(120, 1400, 0.5, 0.22, 20, 180, 'sine'); noise(0.4, 0.2, 600, 4000, 1, 'bandpass'); },

  /* ---------------------------------------------------------- shared horde */
  roar() { tone('sawtooth', 150, 70, 0.45, 0.3); noise(0.45, 0.3, 700, 180, 0.8); },
  slam() { noise(0.35, 0.5, 600, 70, 0.9); tone('sine', 120, 34, 0.35, 0.45); },
  burst() { noise(0.45, 0.6, 1100, 90, 0.7); tone('sawtooth', 180, 40, 0.4, 0.3); },
  charge() { tone('sawtooth', 110, 220, 0.7, 0.34); noise(0.7, 0.35, 500, 900, 0.7); },
  footL() { noise(0.18, 0.3, 340, 70, 0.9); tone('sine', 80, 36, 0.2, 0.24); },

  /* ------------------------------------------------------- the Super Destroyer */
  /* eight seconds of a very large object deciding to stop being in orbit */
  shipWarn() {
    tone('sawtooth', 300, 160, 1.6, 0.24); tone('sawtooth', 160, 300, 1.6, 0.2, 1.6);
    noise(3.0, 0.22, 200, 900, 0.6, 'bandpass');
  },
  shipFall() {
    tone('sine', 40, 150, 4.0, 0.6);
    tone('sawtooth', 70, 260, 4.0, 0.3);
    noise(4.0, 0.5, 180, 2400, 0.5);
  },
  shipHit() {
    noise(3.4, 1.0, 1200, 30, 0.5);
    tone('sine', 70, 14, 3.0, 0.95);
    tone('sine', 40, 11, 4.2, 0.7, 0.05);
    tone('sawtooth', 120, 20, 2.2, 0.5, 0.02);
  }
};

/* Play a world sound at the volume its distance deserves, then put the dial back
   exactly where it was -- these nest, so a plain reset to 1 would be wrong. */
export function sndAt(fall, snd, arg) {
  if (fall <= 0.02 || !snd) return;
  const o = A.dist; A.dist = fall;
  try { snd(arg); } finally { A.dist = o; }
}
export function setDist(v) { A.dist = clamp(v, 0, 1); }

/* ============================== MUSIC ==============================
   Either an original procedural march built from the same oscillators, or any
   audio file the player supplies (ost.mp3 beside the page, or picked from the
   menu). The march thickens as the horde does. */
export const MUS = {
  on: true, step: 0, next: 0, timer: null, intensity: 1,
  ext: null, extName: '', running: false, faction: 'illuminate'
};
const SCALE = [0, 3, 5, 7, 10];
const CHORDS = [0, 0, -4, -2];

function mvoice(type, f0, f1, t, dur, vol, cut) {
  const o = A.ac.createOscillator(), g = A.ac.createGain(), f = A.ac.createBiquadFilter();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  f.type = 'lowpass'; f.frequency.value = cut || 2600;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(f); f.connect(g); g.connect(A.musBus);
  o.start(t); o.stop(t + dur + 0.03);
}
function mnoise(t, dur, vol, f0, f1, type) {
  const src = A.ac.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
  const f = A.ac.createBiquadFilter(); f.type = type || 'lowpass';
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
  const g = A.ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f); f.connect(g); g.connect(A.musBus);
  src.start(t); src.stop(t + dur + 0.03);
}
function musicStep(i, t) {
  const bar = Math.floor(i / 8) % 4, beat = i % 8;
  const root = 55 * Math.pow(2, CHORDS[bar] / 12);
  const I = MUS.intensity;
  if (beat % 2 === 0) { mvoice('sine', 110, 42, t, 0.22, 0.5, 900); mnoise(t, 0.06, 0.18, 900, 200); }
  if (beat === 4) mnoise(t, 0.16, 0.3, 2600, 600, 'bandpass');
  if (beat === 2 || beat === 6) mnoise(t, 0.09, 0.13, 3000, 1400, 'bandpass');
  mvoice('square', root, root, t, 0.16, 0.16, 700);
  if (I >= 2 && beat % 4 === 0) {
    mvoice('sawtooth', root * 4, root * 4, t, 0.55, 0.075, 1500);
    mvoice('sawtooth', root * 6, root * 6, t, 0.55, 0.045, 1400);
  }
  if (I >= 3) {
    const mel = [0, 2, 4, 2, 3, 4, 2, 0][beat];
    const f = root * 8 * Math.pow(2, SCALE[mel % SCALE.length] / 12);
    if (beat % 2 === 0 || beat === 3) mvoice('square', f, f, t, 0.2, 0.05, 3200);
  }
  /* at full tilt the march picks up a dissonant fourth voice -- it stops sounding
     like a parade and starts sounding like a problem */
  if (I >= 4) {
    if (beat % 2 === 1) mnoise(t, 0.045, 0.05, 6000, 3000, 'highpass');
    if (beat === 0 || beat === 5) mvoice('sawtooth', root * 4 * 1.414, root * 4 * 1.414, t, 0.5, 0.05, 1200);
  } else if (I >= 2 && beat % 2 === 1) mnoise(t, 0.045, 0.05, 6000, 3000, 'highpass');
}
export function musicSchedule() {
  if (!A.ac || !MUS.on || MUS.ext || !MUS.running) return;
  const spb = 60 / 104 / 2;
  const horizon = now() + 0.25;
  if (MUS.next < now()) MUS.next = now() + 0.05;
  while (MUS.next < horizon) { musicStep(MUS.step, MUS.next); MUS.step++; MUS.next += spb; }
}
export function musicStart() {
  audioInit();
  MUS.running = true;
  if (MUS.ext) { if (MUS.on) { MUS.ext.currentTime = 0; MUS.ext.play().catch(() => {}); } return; }
  if (!A.ac) return;
  MUS.step = 0; MUS.next = now() + 0.1;
  if (!MUS.timer) MUS.timer = setInterval(musicSchedule, 40);
}
export function musicStop() {
  MUS.running = false;
  if (MUS.timer) { clearInterval(MUS.timer); MUS.timer = null; }
  if (MUS.ext) MUS.ext.pause();
}
export function musicApplyVolume() {
  if (A.musBus) A.musBus.gain.value = (MUS.on && !A.muted) ? VOL.music : 0;
  if (MUS.ext) MUS.ext.volume = (MUS.on && !A.muted) ? VOL.music : 0;
}
export function musicToggle() {
  MUS.on = !MUS.on;
  musicApplyVolume();
  if (MUS.ext) { if (MUS.on && MUS.running) MUS.ext.play().catch(() => {}); else MUS.ext.pause(); }
  return MUS.on;
}
export function useExternalTrack(url, name) {
  if (MUS.ext) MUS.ext.pause();
  const a = new Audio(url);
  a.loop = true; a.volume = (MUS.on && !A.muted) ? VOL.music : 0;
  MUS.ext = a; MUS.extName = name;
  const e = document.getElementById('musicname');
  if (e) e.textContent = name;
  if (MUS.timer) { clearInterval(MUS.timer); MUS.timer = null; }
  if (MUS.running && MUS.on) a.play().catch(() => {});
}
/* If an ost.mp3 is sitting next to the page it becomes the soundtrack. Asked
   with a HEAD request rather than by pointing an <audio> element at it, because
   a missing file that way logs a red 404 in everyone's console forever. */
export function probeExternalTrack() {
  if (!window.fetch) return;
  fetch('ost.mp3', { method: 'HEAD' })
    .then(r => { if (r.ok) useExternalTrack('ost.mp3', 'ost.mp3'); })
    .catch(() => {});
}
