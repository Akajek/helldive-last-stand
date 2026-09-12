# HELLDIVE: LAST STAND

A top-down survival shooter. Solo, or up to four people over the internet with one of
you optionally running the horde by hand.

Three factions are on the rock and only one of them came for you. They fight each
other given the chance — give it to them.

## Running it

```bash
node server.js
```

Then open <http://localhost:8080>. No `npm install`, no dependencies, no build step.
The same process serves the page *and* relays the multiplayer traffic.

Use a different port with `node server.js 3000`.

> **This build has to be served over HTTP.** It is split into ES modules, and browsers
> will not load modules off `file://`. Opening `index.html` by double-clicking it shows
> a page telling you so. If you want the double-click-and-play version, the previous
> single-file build is kept at **`legacy/index.html`** and still works that way.

## Playing with friends who aren't on your LAN

They need to reach your server. Two ways:

**A tunnel (quickest).** Leave `node server.js` running and, in a second terminal:

```bash
npx cloudflared tunnel --url http://localhost:8080
```

It prints a public `https://<words>.trycloudflare.com` URL. They open that and play —
no warning page, no account, and secure WebSockets work through it. The page works out
which relay to use from the address it was loaded from, so an `https://` page means a
`wss://` relay automatically.

**If `npx` fails on Windows** with `ENOENT ... AppData\Roaming\npm`, npm's global
folder was never created. Make it once and `npx` works from then on:

```bash
mkdir "%APPDATA%\npm"
```

**Deploy it (better if you play often).** Push this folder to any free Node host. There
is a `render.yaml` for Render; Fly.io and Railway work the same way. They set `PORT`
automatically, which the server reads. Everyone then just opens the deployed URL.

The **relay** box on the menu is only needed if the page and the relay live in
different places; leave it blank otherwise.

## Controls

| | |
|---|---|
| `WASD` | move · `SHIFT` sprint |
| mouse | aim · click to fire |
| `1` `2` `3` | primary · sidearm · support weapon |
| `R` | reload — **a reload throws away the rounds left in the magazine** |
| `G` `Q` `F` | frag · stim · melee |
| `E` | pick up, or use a terminal |
| `L` | loadout (in a mission this needs a Requisition terminal) |
| hold `CTRL` + arrows | stratagem code, then **click** to throw the beacon |
| `N` `-` `=` `M` | music · music volume · mute everything |
| `ESC` | pause and settings |

## The three factions

Each has two small, two medium and two large troops. Size decides how far it can be
heard, how hard it is to shove, and what it costs a wave's budget.

| | Small | Medium | Large |
|---|---|---|---|
| **Terminids** | Scavenger, Hunter | Bile Warrior, Bile Spewer | Charger, **Bile Titan** |
| **Automatons** | Trooper, Raider | Berserker, Devastator | Hulk, **Factory Strider** |
| **Illuminate** | Voteless, Watcher | Overseer, Fleshmob | Harvester, **Leviathan** |

Terminids swarm and bite. Automatons shoot back, and a Devastator's shield only covers
the side it is facing. The Illuminate float — Overseers and Leviathans ignore walls
entirely — and a Watcher left alone will keep calling more Voteless in.

### Armour and penetration

Every body has armour 0–4 and every round has penetration 0–4.

- penetration ≥ armour → full damage
- one short → 45%
- two or more short → 7%, a spark and a **CLANG**

That noise is the game telling you to bring something heavier, not a bug. A Liberator
will not open a Charger. A Recoilless Rifle will open anything in the game.

### They fight each other

When two factions meet, they engage. Shoot a Terminid with an Automaton bolt and the
Terminid goes after the Automaton. Two factions often draw in the same wave and arrive
from opposite sides specifically so that they run into each other on the way to you.

The **INFIGHTING** slider controls how readily this happens; at 0 they have a truce.

## The maps

- **THE PLAINS** — open ground, 6000 units square. Nothing to hide behind, and nothing
  to hide them either.
- **MEGACITY** — the same size, fully destructible down to 30-unit cells. Buildings that
  lose enough of themselves collapse, and anything inside goes with them. Super Earth
  rebuilds the block every 75 seconds.
- **THE HOLLOWS** — open ground with six cave systems dug into it, plus boulders for
  cover. You fight on the surface and duck underground when the map sends you there.

### Underground is a place, not a map

A cave system is a region: a body of rock with chambers and corridors chewed out of the
inside and two or three mouths opening onto the surface. Walk into one and things change;
walk back out and they change back.

Inside a cave there is no sky, so **nothing can be called down** — not a pod, not an
orbital shell, not an Eagle, which would have to fly through a hillside. The light dims
as you approach a mouth rather than switching off, and underground you only see what your
torch sees.

Breaking a **JAMMER** punches a hole in the interference and opens a 120-second uplink
window. Everything you have been saving, all at once, and then the rock comes back. The
top bar tells you which state you are in.

Reinforcements still work underground: a pod cannot reach you through a hillside, so the
Helldiver walks in from the nearest mouth instead. On the surface it is still a pod.

## Waves

Every minute is a wave with a budget, and the budget grows. What it buys is deliberately
lumpy — one wave is four hundred Scavengers, the next is three Chargers and nothing
else — because a horde that arrives in the same proportions every time stops being
frightening by the fourth minute.

Wave shapes include a swarm, a mixed push, an elite wave, a ranged patrol, and from wave
five, a **titan-class signature**, which means exactly what you think.

## Objectives

One or two are live at a time. They appear on the tactical map and in the ticker under
the timer, and they time out if you ignore them.

| | What it is | What it pays |
|---|---|---|
| **UPLOAD MISSION DATA** | stand in the ring until it finishes | **+1 reinforcement** |
| **RECOVER SAMPLES** | six containers scattered nearby | every stratagem off cooldown |
| **DESTROY THE JAMMER** | a structure, armour 2 | the uplink back (and underground, a window) |
| **BURN THE SPORE TOWER** | a structure choking your vision | clear air |
| **BRING UP THE RADAR** | hold the array for 20s | full map **and no hostile deployment near it for 100s** |
| **SILENCE THE BROADCAST** | a structure, armour 1 | **50 seconds of them fighting each other** |
| **LOAD SEAF ARTILLERY** | carry three shells to the gun | a free barrage |

Three of those are aimed squarely at a Game Master — and **every** completed objective
takes credits out of their pocket.

## Stratagems

You carry **four**, chosen on the loadout screen before you drop. Three more never take
a slot: **REINFORCE**, **RESUPPLY** and **REQUISITION** — the last of which drops a
terminal you can stand on to swap your four mid-mission.

Eagles, orbitals, four sentry types, five support weapons, a shield generator and a
guard dog. Then there are two that are not on any list. One of them is very large.

## Game Master mode

The host runs the horde by hand. They get a bank account instead of a rifle, all three
faction palettes (`Q`/`E` or the tabs to switch), and a bonus every time a Helldiver
goes down — which is the only score they have.

They cannot deploy inside the bubble around a Helldiver, inside a wall, or inside a
radar exclusion the squad earned.

`R` rallies everything of the current faction nearby onto the nearest Helldiver.

**In GM mode the lobby creator is the Game Master and cannot hand it over.** The
simulation lives on their machine and snapshots are culled around each recipient, so an
off-host GM would be looking at a map with holes in it. Switch the lobby to **CO-OP** if
the host wants to play.

## The lobby

Whoever hosts gets a 4-character room code; up to three more join with it. The host owns
the mode, the mission settings and every slot's role. Everyone's chosen loadout shows in
the slot list so you can see what the squad is bringing.

**If your connection drops mid-mission you have two minutes to get back.** The relay
holds your seat, the host holds your Helldiver — standing still, and nothing hunts them
while you are gone — and the game walks back in on its own, up to fourteen attempts on a
lengthening delay, then hands you the world again. You come back as the same Helldiver
with the same kit, not as a new one. The seat is not given to anybody else while it is
being held. (The host leaving still ends the room; there is nowhere for the mission to
go without the machine that is running it.)

## Requisition, mid-mission

`L` at a **Requisition terminal** — call one down with `←↓→↑↓`, it does not take a slot —
swaps your four for anything in the pool. It opens on *your* screen, applies to your
Helldiver immediately on the host, and the cooldown on anything you drop is kept, so
swapping is not a way to reset a spent stratagem.

## Mission settings

Presets: **SWARM**, **ELITE**, **BOTH**, **FLAT**, and **TOTAL WAR**. Underneath: which
factions are in play, whether objectives appear, how fast the horde level and the wave
budget climb, how hard enemies toughen, the Game Master's income, how many
reinforcements the squad gets, and squad scaling.

**Friendly fire** is two separate dials — one for what your squadmates do to you, one
for what your own turrets do. Both off by default. Neither touches what your *own*
ordnance does to you; standing under your own 500KG is the deal you made.

## Performance and the network

Things that were specifically fixed, since they were the reported problems:

- **The Liberty crash.** `podLand()` referenced an undefined variable on that payload.
  Under strict mode it threw before the pod was removed from the list, so the next frame
  threw again — forever. The game froze permanently. It was reproducible on any
  platform; it just got found on Linux first. There is a regression test for it.
- **Snapshots are built per client** and culled around *that* client's Helldiver, with a
  hard ceiling of 210 bodies per message, nearest first. The old build culled around the
  whole squad, so everybody paid for everybody. Worst case measured 157 KB/s → 90 KB/s;
  a realistic busy fight is about 34.
- **Rounds are sent once when fired** instead of having their position retransmitted
  twelve times a second for their whole short life.
- **Alt-tabbing no longer degrades the mission for everyone else.** Browsers stop
  calling `requestAnimationFrame` for a background page and throttle its timers to once
  a second, so a host who alt-tabbed first froze the game for the whole squad and then —
  after the first fix — ran it at five per cent speed. Time is now *consumed* rather
  than clamped, and three separate clocks feed it: rAF while the window is painted, a
  Worker timer when it is not, and arriving network messages, which browsers deliver on
  time regardless. Measured by blocking the main thread outright: 483ms stalled, 0.483s
  simulated.
- **Detail scales automatically** to hold the frame rate, and can be pinned to HIGH or
  LOW in the pause menu.

## The old build

`legacy/index.html` is the previous single-file version, unchanged and still playable —
including by double-clicking it. It is also tagged `v1-single-file` in git.

## Layout

```
index.html     shell: markup, CSS, and a <script type="module">
src/           eighteen modules, loaded directly by the browser
server.js      static host + dependency-free WebSocket relay
legacy/        the previous single-file build
test/          headless test suites (see below)
```

`src/` is split by concern: `data.js` holds every table the game is built out of
(factions, troops, weapons, stratagems, maps, objectives), `sim.js` is one frame of the
world, `host.js` and `client.js` are the two halves of the wire, and nothing has an
ambient "current player" — every function that acts on a Helldiver takes that Helldiver
as an argument.

## Tests

```bash
npm test
```

Runs four suites, none of which need a browser:

- **`test/run.mjs`** — the real simulation, headless. Twenty minutes on every map, every
  stratagem, every weapon, every sentry, armour, infighting, all seven objectives, the
  cave uplink, the squad wipe and reinforcement rules, a five-hundred-body stress test,
  and leak checks. ~270 assertions in about twelve seconds.
- **`test/net.mjs`** — the host builds a real snapshot, the client consumes it, and the
  two worlds are compared field by field. Also checks input travelling back and
  bandwidth under load.
- **`test/relay.mjs`** — starts `server.js` on a spare port and talks to it over real
  sockets: room codes, addressed messages, and the seat-holding that lets somebody whose
  connection dropped walk back into the same body.
- **`test/imports.mjs`** — every named import resolves to a real export, and no module
  calls a function it forgot to import.

The harness exists because testing the old build meant staring at a browser, and a
hidden tab stops calling `requestAnimationFrame` — which made several measurements
during development simply wrong. A twenty-minute mission now takes about a second and a
crash is a stack trace instead of a frozen tab.

`test/prune.mjs` is a one-shot tidy that removes imported names a file never uses.

There is also a read-only `window.HD` handle in the browser console (`HD.S` is the
world, `HD.lastError` is the last exception the loop swallowed) for looking at a bug
rather than guessing at it.
