# HELLDIVE: LAST STAND

A top-down survival shooter. Solo, or two players over the internet with one of you
running the horde.

## Running it

```bash
node server.js
```

Then open <http://localhost:8080>. That's it — no `npm install`, no dependencies. The
same process serves the page *and* relays the multiplayer traffic.

Use a different port with `node server.js 3000`.

`index.html` still works on its own if you just double-click it — you only need the
server for multiplayer.

## Playing with a friend who isn't on your LAN

Your friend needs to reach your server. Two ways:

**A tunnel (quickest).** Leave `node server.js` running and, in a second terminal:

```bash
npx cloudflared tunnel --url http://localhost:8080
```

It prints a public `https://<words>.trycloudflare.com` URL. Your friend opens that and
plays — no warning page, no account, and secure WebSockets work through it. Nothing
else to configure: the page works out which relay to use from the address it was
loaded from, so `https://` page means `wss://` relay automatically.

> `npx localtunnel --port 8080` also works, but it puts an interstitial in front of the
> page that asks visitors to type your public IP address (which it displays), and that
> gate can be sticky. Cloudflare's is cleaner for this.

**If `npx` fails on Windows** with `ENOENT ... AppData\Roaming\npm`, npm's global
folder was never created. Make it once and `npx` works from then on:

```bash
mkdir "%APPDATA%\npm"
```

**Deploy it (better if you play often).** Push this folder to any free Node host
(Fly.io, Render, Railway). They set `PORT` automatically, which the server reads.
Both of you then just open the deployed URL.

The **relay** box on the menu is only needed if the page and the relay live in
different places; leave it blank otherwise.

## The lobby

Whoever hosts gets a 4-character room code; up to three more people join with it.
Everyone lands in a shared lobby with a slot list, and the host picks the mode:

- **GM vs PLAYERS** — one Game Master feeds the horde by hand against the squad.
- **CO-OP** — everybody drops as Helldivers and the AI spawner runs the horde.

Each player claims their own slot (**PLAY**, **WATCH**, or **TAKE GM**). Mission
settings belong to the host alone; everyone else sees them greyed out and synced.
The mission will not start without a sane roster — GM mode needs exactly one Game
Master and at least one Helldiver, co-op needs at least one Helldiver.

The Game Master has to be the host: the simulation lives on their machine, and
snapshots are culled around the squad, so an off-host GM would be looking at a map
with holes in it.

## The two roles

### Helldiver

| | |
|---|---|
| `WASD` | move (`SHIFT` sprint) |
| mouse / click | aim / fire |
| `R` | reload — a partial mag is thrown away, count your shots |
| `1` `2` `3` | primary / sidearm / support weapon |
| `G` `Q` `F` | grenade / stim / melee |
| `E` | pick up a crate or a dropped weapon |
| `CTRL` + arrows | stratagem code, then click to throw the beacon |
| `N` `-` `=` `M` | music on-off / volume / mute all |

### Game Master

| | |
|---|---|
| `WASD` | pan the camera (`SHIFT` faster) |
| `SPACE` | snap the camera to the nearest Helldiver |
| `1` `2` | pick Voteless (1 credit) or Fleshmob (16) |
| click / hold | deploy at the cursor |

Credits accrue over time and faster as the horde level climbs. You cannot deploy
within 380 units of any Helldiver, or inside a building — no spawn-camping. The
automatic horde spawner is switched off in a GM match: every enemy on the map is one
you placed by hand.

Reinforcements are a **squad budget**, not a personal one: every death anywhere in
the squad spends one. When they run out, the next Helldiver to fall stays down, and
the round ends once the last one is gone.

## Soundtrack

The game ships with an original procedural score that layers up as the horde thickens.
To use your own music instead, drop an `ost.mp3` next to `index.html` (it is picked up
automatically) or choose a file from the menu. A missing `ost.mp3` logs one harmless
404 and the built-in score plays.

## How the multiplayer works

Host-authoritative. The host's machine runs the entire simulation; every other player
sends input roughly 20 times a second and receives world snapshots 12 times a second,
interpolating between them. A snapshot carries every Helldiver, so each client draws
its squadmates with name tags and health bars.

Your own Helldiver is **predicted** locally — your walking and your muzzle flash happen
on your keypress, and the host's word is eased in rather than snapped, so a round trip
never shows up as lag on your own body. Squadmates are pure interpolation.

- The city is sent once on join (~9,000 cells) and then only as deltas, because every
  change to it funnels through `killCell` / `smashCells` / `restoreCell`.
- Enemies are culled to 1,500 units around the *nearest* Helldiver and quantised to
  integers. A busy snapshot is a few KB.
- Explosions, kills, gunshots and cell changes travel as events; each side plays its
  own sound and particles from them, attenuated by how far away they happened.
- Damage flashes and stim effects are addressed to one player id, so only the body it
  happened to feels it — and a shooter never gets their own gunshot replayed to them.
- Input is routed by sender: your keys only ever move your own Helldiver, and a
  spectator's keyboard addresses nobody.

**Known limitation:** browsers pause `requestAnimationFrame` in background tabs, so the
host must keep its window visible or the simulation stalls for everybody. This only
matters if you try to run two roles on one machine.

## Difficulty

The mission settings panel is the difficulty dial, and the host owns it. **HORDE RAMP**
sets how often the horde level climbs, **ENEMIES TOUGHEN** how much of that goes into
their health, **GM INCOME** and **INCOME RAMPS** how fast the Game Master can spend.
**SQUAD SCALING** is co-op only: how much thicker the swarm gets per extra Helldiver
(default +35% each, or turn it off so friends are pure upside). The four presets —
SWARM, ELITE, BOTH, FLAT — are starting points, not limits.
