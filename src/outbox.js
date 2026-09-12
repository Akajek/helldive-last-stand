/* Everything the host has to tell the squad about this tick.
 *
 * It lives in its own module with no imports at all, so any part of the game can
 * post to it without dragging the network layer into a cycle. host.js drains it
 * when it builds a snapshot; solo play simply never reads it. */
'use strict';

export const OUT = {
  ev: [],   /* world events: [kind, x, y, whoAlreadyHeardIt, extra] */
  fx: [],   /* explosions */
  kl: [],   /* kills, for the corpse and the gore */
  pf: [],   /* personal feedback addressed to one Helldiver */
  sp: [],   /* somebody fired: x, y, weaponIndex, whoFiredIt */
  mk: [],   /* target markers */
  bs: [],   /* friendly rounds, sent once at birth rather than every snapshot */
  eb: [],   /* hostile rounds, likewise */
  bm: [],   /* beams and arcs: transient lines */
  ob: []    /* objective state changes */
};

const CAPS = { ev: 64, fx: 32, kl: 120, pf: 32, sp: 160, mk: 8, bs: 400, eb: 400, bm: 64, ob: 24 };

export function post(ch, ...vals) {
  const a = OUT[ch];
  if (!a || a.length >= CAPS[ch]) return;
  a.push(...vals);
}
export function postArr(ch, arr) {
  const a = OUT[ch];
  if (!a || a.length >= CAPS[ch]) return;
  a.push(arr);
}
export function drain(snap) {
  for (const k in OUT) {
    if (OUT[k].length) { snap[k] = OUT[k]; OUT[k] = []; }
  }
}
export function clearOut() { for (const k in OUT) OUT[k].length = 0; }
