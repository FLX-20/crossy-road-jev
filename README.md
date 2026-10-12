# Crossy Road · Jev

A Crossy Road clone that runs in your browser. Play it yourself with the keyboard or touch, or watch **Jev** (TypeSafe `jev-latest`) play it in real time. The world keeps moving while Jev thinks, so both its decisions and its speed count.

- Voxel 3D in the browser (Three.js), with an orthographic camera at the original's angle, shadows, squash-and-hop, and a death animation for each cause.
- One deterministic simulation (`core/`) shared by the browser and the server. A run is fully described by its seed and its moves.
- Jev gets a structured, factual description of the screen, like an accessibility tree for the game, and chooses one of five actions. Nothing is pixel-based.

## Requirements

- [Node.js](https://nodejs.org) 22.9 or newer
- A TypeSafe API key, if you want to watch Jev play. You can play yourself without one.

## Setup

Clone this repository, then install the dependencies in its folder:

```bash
npm install
```

To let Jev play, copy the example config and paste your key after `TYPESAFE_API_KEY=`:

```bash
cp .env.example .env
```

Then start the game:

```bash
npm start
```

Open http://localhost:3000 and choose **PLAY** to play yourself or **Watch Jev** to let Jev play.

`.env` is git-ignored, so your key stays on your computer. The key never reaches the browser: the local server calls the TypeSafe API, and it only accepts connections from your own machine. You can also export `TYPESAFE_API_KEY` in your shell instead of using `.env`. Restart the server after changing the key.

## Controls

| Action | Keys |
| --- | --- |
| Hop | Arrows / WASD. As in the original, pressing squashes the chicken and releasing hops. |
| Touch | Tap = forward, swipe = direction |
| Mute | M |
| Pause (your own game only) | Esc |
| Play again | Space / Enter |

Your best score is kept in the browser and shown as **TOP**.

## The game

The game follows the original's rules:

| Lane | Rules |
| --- | --- |
| Grass | Safe. Trees and rocks block hops. Light and dark stripes alternate. |
| Road | Cars and longer trucks. Each lane has one direction and a constant speed, and contact kills. |
| River | Logs drift (adjacent lanes alternate direction), or static lily pads. Open water drowns you, and a log that carries you past the edge kills you. |
| Railway | The signal flashes and a bell rings about 1.4 s before a very fast train. |

- **Eagle:** the camera starts creeping forward after your first hop. If you fall 4 rows behind it, an eagle takes you, which happens after about 7.5 s of standing still. Going back too far also triggers it.
- **Score and coins:** the score is the furthest row reached. Coins are a separate counter.
- **Hops:** a hop takes 0.15 s, and one input is buffered during a hop. From the moment a hop starts, you count as being in the destination row.
- **Difficulty:** lanes come in chunks of the same type. Density and speed ramp up over the first 160 rows. A guaranteed open path keeps every world passable, which the tests check over 5,000 rows.

All constants live in `core/config.js`.

**Not included:** character unlocks, the prize machine and gifts, alternate worlds, ads, and multiplayer.

## How Jev plays

When you choose **Watch Jev**, the local server starts a realtime game and runs this loop until the chicken dies: observe → ask Jev while the world keeps running → apply the move → repeat. The browser runs its own copy of the simulation and applies Jev's moves at the server's exact ticks, checking checksums along the way. The badge at the bottom shows Jev's latest move, its latency and its confidence.

**API usage.** Every decision is one request to `https://api.typesafe.ai/v1/systemone`, billed to your key. A run usually lasts between ten seconds and about a minute (roughly 30 to 250 requests) and is capped at 10 minutes. The run continues on the server if you go back to the menu or close the tab, until Jev loses or the cap is reached.

**What Jev is asked.** `state` is the observation (below). There is one `choice` question, `move`, whose options are `up`, `down`, `left`, `right` and `wait`. Each option's criterion is a sentence describing what that action would do, built from simulation facts. It starts with a verdict:

```text
up:    SAFE. Hop forward to row 36 (road, cars moving left at 1.86 cells/s). Nothing is at that spot when your move lands (about 0.27 s from now, given your usual delay); the next car reaches it 4.06 s from now. Beyond it, row 37 (road) is clear right after you land, so you can keep going.
left:  DANGER. Hop left to x=-1.62 (river, ...). When you land there is open water: you would drown. The nearest log is under that spot 0.48 s from now (a hop takes 0.15 s).
wait:  SAFE. Wait at row 35, x=0 (grass). Nothing can hit you here. You can wait about 6.10 s before the eagle comes.
```

- **SAFE** means the action cannot kill the player, whenever within its recent delay range (the minimum and maximum of its last 5 decisions, plus a small margin) the move arrives.
- **DANGER** means the action can kill the player within that range.
- **BLOCKED** means the player would not move.

The verdicts account for a hop still in progress, a queued hop, drift on a log, and staying in the lane until the next decision. Where needed, the game simulates ahead on a copy of the state to get them right. The rules (`agents/rules.js`) tell Jev never to choose DANGER while a SAFE action exists, and to go forward whenever that is SAFE. Network errors are retried with a fresh observation. A rejected key or request ends the run as "Agent error".

### Observation format

```text
+8 row  11 grass           ..|........T|TT
+7 row  10 rail  quiet     ##|#########|##
+6 row   9 rail  quiet     ##|#########|##
+5 row   8 river >> 1.1/s  ~L|LLL~~LLL~|LL
+4 row   7 river << 0.9/s  ~L|LLLL~LLLL|~L
+3 row   6 grass           ..|T.......T|T.
+2 row   5 grass           TT|TT.T..$..|T.
+1 row   4 grass           TT|.T.....T.|T.
+0 row   3 river << 0.9/s  ~L|LL~@LLLLL|LL
-1 row   2 grass           .T|......T..|.T
-2 row   1 grass           TT|...T.....|.T
```

Legend: `@` you, `T` tree/rock, `$` coin, `.` grass, `=` road, `C` car, `K` truck, `~` water, `L` log, `O` lily pad, `#` rails, `R` train, `|` edge of the play area (x = -4..4). Columns -6..6 are shown so that incoming traffic is visible.

The JSON observation (`core/observe.js`) contains:

```jsonc
{
  "t": 1.58, "tick": 95, "alive": true, "deathCause": null, "score": 3, "coins": 0,
  "player": { "row": 3, "x": -0.62, "onLog": true, "hopping": false, "facing": "up" },
  "eagle": { "cameraMoving": true, "rowsBehindCamera": -0.69, "limit": 4, "secondsIfIdle": 8.53 },
  "lanes": [   // rows player-2 .. player+8; positions are [from, to] spans in cells
    { "dy": 8, "row": 11, "type": "grass", "trees": [4] },
    { "dy": 5, "row": 8, "type": "river", "flow": "right", "speed": 1.08, "logs": [{ "from": -5.2, "to": -1.2 }] },
    { "dy": 2, "row": 5, "type": "road", "flow": "left", "speed": 2.4, "vehicles": [{ "kind": "car", "from": 1.1, "to": 2.4 }], "coins": [0] },
    { "dy": 7, "row": 10, "type": "rail", "flow": "right", "signal": "flashing", "trainEntersViewIn": 0.6 }
  ],
  "map": ["..."],                       // the ASCII lines above
  "moves": { "up": "SAFE. ...", "down": "...", "left": "DANGER. ...", "right": "...", "wait": "..." },
  "safety": { "up": "safe", "down": "safe", "left": "danger", "right": "blocked", "wait": "safe" },
  "yourDelayS": 0.25,                   // the player's typical delay between observing and acting
  "recentActions": [{ "t": 0.75, "move": "up", "result": "moved" }]
}
```

The `moves` sentences are sent as the question's criteria rather than as part of `state`. The tests check that the sentences match what the simulation actually does. In particular, no action marked SAFE ever kills the player, even when the move is applied after a random delay within the stated range.

## Project layout

```text
core/     deterministic simulation (no DOM): config, rng, lanes, game, observe, replay
web/      browser: Three.js renderer, voxel models, animation, HUD, input, sound, live-session feed
server/   local HTTP server and realtime sessions
agents/   the Jev adapter, the rules Jev is given, and the realtime loop
test/     node:test suites (simulation rules, observation accuracy, the Jev adapter and server against a mock API)
```

```bash
npm test
```

The tests don't need an API key and don't call the real TypeSafe API.

## Disclaimer

This is an unofficial fan-made clone for fun and research. It is not affiliated with or endorsed by Hipster Whale, the makers of Crossy Road.
