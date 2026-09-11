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

## The two roles

One of you hosts as **Game Master**, the other **joins as Helldiver** with the
4-character room code the host is shown.

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
| `SPACE` | snap the camera to the Helldiver |
| `1` `2` | pick Voteless (1 credit) or Fleshmob (16) |
| click / hold | deploy at the cursor |

Credits accrue over time and faster as the horde level climbs. You cannot deploy
within 380 units of the Helldiver, or inside a building — no spawn-camping. The
automatic horde spawner is switched off in a GM match: every enemy on the map is one
you placed by hand.

When the Helldiver burns through all four reinforcements, the round ends and the host
gets a **START NEXT ROUND** button.

## Soundtrack

The game ships with an original procedural score that layers up as the horde thickens.
To use your own music instead, drop an `ost.mp3` next to `index.html` (it is picked up
automatically) or choose a file from the menu. A missing `ost.mp3` logs one harmless
404 and the built-in score plays.

## How the multiplayer works

Host-authoritative. The GM's machine runs the entire simulation; the Helldiver sends
input roughly 20 times a second and receives world snapshots 12 times a second,
interpolating between them.

- The city is sent once on join (~9,000 cells) and then only as deltas, because every
  change to it funnels through `killCell` / `smashCells` / `restoreCell`.
- Enemies are culled to 1,500 units around the Helldiver and quantised to integers.
  A busy snapshot is a few KB.
- Explosions, kills and cell changes travel as events; each side plays its own sound
  and particles from them.

**Known limitation:** browsers pause `requestAnimationFrame` in background tabs, so the
host must keep its window visible or the simulation stalls for both players. This only
matters if you try to run both roles on one machine.

## What's next

Co-op (two Helldivers against the AI horde) is the other half. The networking is done;
it needs `player` split into a `players[]` array, which touches every "nearest player"
decision — enemy targeting, explosion falloff, pod crush checks, the camera.
