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

**Making the lobby is how you become the Game Master.** In GM mode the host holds the
badge and cannot put it down, and nobody else can ask for it — switch the lobby to
CO-OP if you would rather play. This is not politeness: the simulation lives on the
host's machine and snapshots are culled around the squad, so an off-host GM would be
looking at a map with holes in it.

Everyone else claims their own slot (**PLAY** or **WATCH**). Mission settings belong
to the host alone; the rest see them greyed out and synced. The mission will not start
without a sane roster — GM mode needs at least one Helldiver, and so does co-op.

Set your **name** in the menu or in the lobby bar. It is remembered between sessions,
shows in the slot list, and is painted over your Helldiver's head in the mission so
the squad can tell each other apart. Changing it mid-mission applies next round — the
roster is fixed at the drop.

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
| `ESC` | pause — volumes, and where your health reads |

Your own health can sit in the **corner** panel, on a **bar over your Helldiver**, or
both; pick it in the pause menu and it is remembered. Squadmates always get the bar
over their head regardless — you cannot cover someone whose health you have to guess at.

### Game Master

The Game Master does not carry a rifle, so none of the Helldiver's furniture is drawn
for them. They get their own panel instead: credits and income rate, the unit palette,
and a **live squad readout** — every Helldiver's name, health bar and status (`INBOUND`,
`DOWN`, `LOST`), plus deployments made, credits spent, kills taken off you, and how many
reinforcements the squad has left.

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

## Dying, and getting back up

Reinforcements are a **squad budget**, not a personal one: every death anywhere in the
squad spends one. When they run out, the next Helldiver to fall stays down for good,
and the round ends once the last one is gone.

Reinforcements are spent **when someone is called back up, not when they fall**. Dying
only puts you on the ground; the budget only moves when a pod actually comes down for
you. A call that cannot be answered — nobody down, or nothing left in the budget — is
refused and costs neither the beacon nor the cooldown.

**On your own**, you pick your own drop site — click where you want to land, or dither
and the ship picks for you.

**In a squad, you do not redeploy yourself.** You lie there watching a squadmate's
shoulder until one of them punches in the **REINFORCE** stratagem — `↑ ↓ → ← ↑` — and
throws the beacon. Whoever has been waiting longest comes down at it, on their feet
with a fresh kit. The call is refused, and costs nothing, if nobody is actually down.

If the *whole* squad goes down at once there is nobody left to make the call, so after
six seconds the ship makes it for you — **as many Helldivers as there are reinforcements
left, last to fall first back up**, all landing on the ground the last one lost. If the
budget only covers some of you, the rest stay down and have to be called by whoever got
up. When the budget is gone and everyone is down, that is the mission.

The stratagem does not appear at all in a solo game.

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

Everything the host sends carries an id, so a body is *carried* from where it was
drawn to where the host says it is, arriving exactly as the next snapshot lands. The
earlier code rebuilt those lists twelve times a second, which cannot be interpolated
at all -- it can only blink. Tracers are the exception: a bullet flies straight at a
known speed, so once seen it is simulated locally and stays perfectly smooth.

Your own Helldiver is **predicted** locally — your walking and your muzzle flash happen
on your keypress, and the host's word is eased in rather than snapped, so a round trip
never shows up as lag on your own body. Squadmates are pure interpolation.

- The city is sent once on join (~9,000 cells) and then only as deltas, because every
  change to it funnels through `killCell` / `smashCells` / `restoreCell`.
- Enemies are culled to 1,500 units around the *nearest* Helldiver and quantised to
  integers. A busy snapshot is a few KB.
- Explosions, kills, gunshots and cell changes travel as events; each side plays its
  own sound and particles from them, attenuated by how far away they happened.
- So does everything else the world does. Only the host simulates a building coming
  down, a hellpod landing, a Fleshmob bringing its arms down or a Helldiver slapping a
  fresh magazine in, so all of it is raised as a **world event** and replayed on every
  machine, each judging the range from where its own listener stands. A building sends
  the start and the end of its collapse, so the animation is driven by the host rather
  than by a parallel timer that could drift.
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

**Friendly fire** is two separate dials, both **off by default**:

- **TEAM FIRE** — how much of a squadmate's round or blast lands on you.
- **SENTRY FIRE** — the same for your own turrets, their gunfire and their cook-off.

Neither one touches what your **own** ordnance does to you. Standing under your own
500KG is the deal you made, and a frag at your feet is still a frag at your feet.
A round never hits the Helldiver who fired it either. Hellpods still flatten whoever
is underneath regardless — that is gravity, not friendly fire — and nothing the horde
or a collapsing building does is affected by these at all.
