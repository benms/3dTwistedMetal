# Wreckyard

A Three.js arcade car-combat game with original procedural vehicles and scenery.
Choose a buggy, muscle car, or heavy truck and fight in a scrapyard: offline against
five AI drivers, or online with up to five friends while bots fill the empty seats.
Last car standing wins.

Both victory and defeat screens include a scoreboard for all six drivers: position,
driver and vehicle, wrecks, survival time, and survived/wrecked status. Your row is
highlighted. Survivors appear first, followed by sorting on wrecks and survival
time. Eliminated drivers keep their actual elimination time; surviving drivers use
the round duration. The board is a snapshot at match end, including when your
elimination ends a round while other drivers are still alive. Replay starts fresh.

## Run locally

Use Node.js 22.12+ (or a supported newer LTS) and npm. From this directory:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`. The game
requires a desktop keyboard and WebGL 2. Offline play needs no backend or API keys.
The dev and preview servers listen on localhost only; to play-test from another
device on your network, opt in with `npm run dev -- --host`.

To play online locally, also start the game server in a second terminal. Vite
proxies `/ws` to it, so **PLAY ONLINE** works with no extra configuration:

```sh
npm run dev:server    # game server on :8787, restarts on changes
# or run the production image instead: docker compose up --build
```

Open two browser windows, create a room in one and join with its code in the other.
To feel the netcode under a bad connection, start the server with simulated latency,
e.g. `WRECKYARD_LAG_MS=120 WRECKYARD_JITTER_MS=30 npm run dev:server` (bash).

```sh
npm test              # simulation, netcode, rooms, server config/HTTP, UI state
npm run typecheck     # strict TypeScript for client, server and tests
npm run build         # client: type check and static bundle in dist/ (Vercel)
npm run build:server  # server: single-file bundle in build/server.cjs (Docker)
npm start             # run the bundled server
npm run preview       # serve the production client bundle locally
npm run format        # format the source with Prettier
npm run format:check  # check formatting without writing
```

`dist/` is a static website with relative asset paths. Serve it over HTTP; do not
open `index.html` directly from the filesystem.

## Practice

_PRACTICE · NO BOTS_ in the garage drops you into the yard alone, with no
opponents and no time limit. Use it to learn the cars, weapons, pickups and barrel
chains. The HUD reads `PRACTICE / ZONE 06`. The run ends only if the yard wrecks
you (walls, barrels or your own rockets); otherwise leave from the pause menu.
_RUN IT BACK_ restarts in practice mode, and _ENTER THE YARD_ returns to the normal
five-bot match.

## Online multiplayer

- **Rooms.** _PLAY ONLINE_ asks for a callsign, then creates a room with a
  four-letter code or joins one. The garage becomes the lobby: everyone picks a car
  and the host presses _START MATCH_. Up to six humans per room. A room is joinable
  only between matches.
- **Bots.** Between matches the host can use _+ ADD BOT_ / _− REMOVE BOT_ to choose
  how many bots join (default: fill every free seat). Joining players take seats
  from bots first. With zero bots, humans fight only each other. A host alone with
  zero bots gets an online practice run.
- **Rules.** Free-for-all, no respawns. The round ends when one car is left or when
  no human is still driving. Victory goes only to the sole survivor. Once you are
  wrecked, the camera follows the leading surviving driver until the round ends.
  Results offer _BACK TO LOBBY_ for a rematch or _LEAVE ROOM_.
- **Leaving.** A player who disconnects mid-match leaves their car to a bot. The
  longest-standing remaining player becomes host. Empty rooms close.
- **Menu.** Escape opens the menu but does not pause: the match keeps running and your
  car coasts. Losing window focus opens it too. _LEAVE ROOM_ quits to the garage.
- **Netcode.** The server is authoritative. It runs the same `src/simulation.ts` at 60
  Hz and sends compact JSON snapshots (20 Hz by default). Your own car is predicted
  locally: inputs apply immediately, and the server's state is replayed forward from
  the last acknowledged input. Small corrections glide out over about 100 ms; jumps
  over 6 m snap. Other cars and projectiles are interpolated about two snapshots in
  the past. The server holds a three-tick input buffer to absorb network jitter.
  Your own shots flash and sound instantly, but hits and damage are always decided
  by the server.
- **Wake-up.** A free Render instance sleeps when idle. The client pings `/healthz`
  and retries for up to 90 seconds while showing "Waking the server…", so the
  first connection after a quiet period can take 30–60 seconds.

## Configuration

Configuration comes only from environment variables ([12-factor](https://12factor.net/config)).
All of Wreckyard's own variables start with `WRECKYARD_` (the client's with
`VITE_WRECKYARD_`, because Vite only exposes `VITE_` variables), so they cannot clash
with other services sharing a host or environment group. Only the platform-standard
`PORT` and `NODE_ENV` are unprefixed. `.env.example` lists every variable. `server/config.ts` validates them at startup,
and the server exits with a clear message on bad values.

| Variable                                  | Used by                   | Default                       | Purpose                                                                                                                                                                              |
| ----------------------------------------- | ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_WRECKYARD_SERVER_URL`               | client, **at build time** | unset                         | Game server URL, e.g. `wss://wreckyard-server.onrender.com` (`https://` also works; `/ws` is added). Unset in dev: Vite proxy. Unset in a production build: online play is disabled. |
| `PORT`                                    | server                    | `8787`                        | Listen port. Render injects it.                                                                                                                                                      |
| `WRECKYARD_ALLOWED_ORIGINS`               | server                    | localhost dev/preview origins | Comma-separated browser origins allowed to connect. **Required in production.** `https://*.vercel.app` allows one subdomain level; `*` allows any.                                   |
| `WRECKYARD_MAX_ROOMS`                     | server                    | `50`                          | Concurrent room cap.                                                                                                                                                                 |
| `WRECKYARD_SNAPSHOT_HZ`                   | server                    | `20`                          | Snapshot rate, 1–60.                                                                                                                                                                 |
| `WRECKYARD_MAX_MSG_PER_SEC`               | server                    | `120`                         | Per-socket rate limit (minimum 70).                                                                                                                                                  |
| `WRECKYARD_LOG_LEVEL`                     | server                    | `info`                        | `debug`, `info`, `warn` or `error`. Logs are JSON lines on stdout.                                                                                                                   |
| `WRECKYARD_SHUTDOWN_GRACE_MS`             | server                    | `5000`                        | On SIGTERM, how long to wait for sockets to close after players are told the server is restarting.                                                                                   |
| `WRECKYARD_LAG_MS`, `WRECKYARD_JITTER_MS` | server                    | `0`                           | Simulated one-way latency for local testing. Rejected when `NODE_ENV=production`.                                                                                                    |
| `WRECKYARD_SERVER_PORT`                   | Vite dev proxy            | `8787`                        | Where `npm run dev` forwards `/ws`.                                                                                                                                                  |

The server does not read `.env` files. Export variables in your shell, or use
`docker compose`, which passes them through.

## Deploy

The client and server deploy separately from this one repository.

**Server → Render (Docker).** In Render choose _New → Blueprint_ and select this
repository; `render.yaml` defines a Docker web service with `healthCheckPath:
/healthz`. Set `WRECKYARD_ALLOWED_ORIGINS` to your Vercel URL (for example
`https://wreckyard.vercel.app`). Add `,https://*.vercel.app` only if preview
deployments should connect; that allows any project on `vercel.app`. Render
provides TLS, so clients use `wss://<service>.onrender.com`.

The `Dockerfile` builds in two stages. The runtime image has Node plus one bundled
file (`ws` and the simulation are inlined), runs as the non-root `node` user, has a
`HEALTHCHECK`, and keeps Node as PID 1. On SIGTERM the server stops accepting
connections and fails its health check. It sends every player a "server restarting"
notice, then exits within `WRECKYARD_SHUTDOWN_GRACE_MS`.

**Client → Vercel (static).** Import the repository; `vercel.json` sets the Vite build
(`npm run build` → `dist/`) and long-lived caching for hashed assets. In _Settings →
Environment Variables_ set `VITE_WRECKYARD_SERVER_URL` to the Render URL for Production (and
Preview, if allowed above), then redeploy: Vite bakes the value into the bundle at
build time.

**Scaling.** Rooms live in the server's memory, so run one instance (`numInstances:
1`). A restart or deploy ends running matches, and players get the restart notice.
Running more than one instance would need routing by room code (sticky sessions) or
a shared store such as Redis.

**12-factor summary.** One codebase with two deploy targets. Dependencies are pinned
in `package-lock.json` and installed with `npm ci`. All config comes from the
environment, and there are no backing services. Build, release and run are
separated (Docker build → image → `node server.cjs`). The server is a stateless
process apart from live matches, and it binds `PORT` itself. It is disposable: it
starts fast and shuts down gracefully on SIGTERM. `docker compose` gives local
dev/prod parity, and logs are a stdout event stream.

## Controls

| Action                    | Key                                 |
| ------------------------- | ----------------------------------- |
| Accelerate / reverse      | W / S or up / down                  |
| Steer                     | A / D or left / right               |
| Handbrake / drift         | Space                               |
| Boost                     | Shift                               |
| Fire selected weapon      | Hold left mouse button on the arena |
| Cycle weapons             | Tab                                 |
| Select machine gun        | 1 (number row or numpad)            |
| Select homing rockets     | 2 (number row or numpad)            |
| Quick-fire machine guns   | Hold J                              |
| Quick-fire homing rockets | K                                   |
| Pause / resume            | Escape (online: menu, no pause)     |
| Replay after a match      | R                                   |
| Mute / unmute             | M                                   |

The HUD highlights the selected weapon. Switching with Tab or 1/2 also immediately
shows `1 · MACHINE GUN` or `2 · HOMING ROCKET` below the crosshair's rocket-lock text.
This notification lasts 1.5 seconds and fades during its final 250 ms. A new switch
replaces it and restarts the timer; selecting the same weapon or quick-firing J/K
does not show another notification. Pausing, finishing a match, entering the garage,
or restarting clears it.

Holding left-click fires the selected weapon at
its normal firing rate; rocket ammunition and cooldowns still apply. J and K remain
direct-fire shortcuts regardless of selection. Tab cycles once per press during
gameplay; in menus it retains normal keyboard focus navigation. A new match starts
with machine guns selected. Pausing or losing focus releases mouse/keyboard inputs
and preserves the selection. Clicking interface controls does not fire weapons.

Weapons fire forward. Rockets acquire a visible opponent inside the forward lock
cone, otherwise fly straight. Repair crosses restore 45 armor; ammunition pickups
add up to 3 rockets, capped at 8. Pickups return after 16 simulated seconds. Boost
recharges after release. Ramming and barrels damage cars; cover blocks fire and
explosion damage. A simultaneous player/final-enemy death counts as defeat. A car
wrecked by a wall, barrel or its own rocket counts as a kill for the last rival who
hit it within the previous 5 seconds; otherwise the yard takes the credit.

## Structure

- `src/config.ts` contains vehicle, weapon, arena and spawn tuning.
- `src/simulation.ts`, `math.ts`, and `navigation.ts` are independent of the DOM
  and Three.js. They handle the fixed-step world, collision, combat, supplies,
  waypoint pathfinding, and bot controls.
- `src/models.ts` and `rendering.ts` provide procedural scenery, vehicles, pooled
  projectiles/effects, interpolated transforms, quality settings and chase camera.
- `src/controls.ts` contains testable held-input and weapon-selection state.
- `src/weapon-notification.ts` manages the replaceable weapon-switch notification
  and cancels its fade/expiry timers when the current screen changes.
- `src/scoreboard.ts` builds sorted, independent result rows from the world state;
  `scoreboard.css` styles the player highlight and scrollable results table.
- `src/input.ts`, `audio.ts`, and `ui.ts` handle keyboard/mouse/focus behavior,
  synthesized audio, menus, lobby, radar and HUD. `main.ts` connects the systems and
  switches between the offline loop and an online session.
- `src/net/` is the online client. `protocol.ts` holds the message types, input
  validation and snapshot encoding (shared with the server). `client.ts` is the
  socket with wake-up retries and ping; `prediction.ts` predicts and reconciles your
  car; `interpolation.ts` buffers and plays back snapshots; `session.ts` ties them
  together; `endpoint.ts` resolves `VITE_WRECKYARD_SERVER_URL`.
- `server/` is the authoritative Node server. `room.ts` handles seats, the input
  queue, ticks and snapshots; `rooms.ts` handles room codes, message routing and rate
  limiting; `app.ts` covers HTTP `/healthz`, the WebSocket upgrade with origin
  checks, and graceful shutdown. `config.ts` and `log.ts` handle environment config
  and JSON logs.

The simulation runs at 60 Hz, catching up at most six steps per animation frame.
Static scenery and vehicle parts are batched into instanced meshes, and car models
are cached across replays and selections. Rendering caps device pixel ratio at 1.5
(high) or 1 (low). Low quality disables
shadows and ambient dust and reduces the particle pool. Mute and quality settings
are saved locally when storage is available. Focus loss pauses the match and
clears held keys. Replays replace all simulation state.

## Validation status

Verified on 2026-10-03 with Node.js 22.23 and npm 10.9 on Windows 11:

- `npm install` succeeds with 0 audit vulnerabilities.
- `npm test` passes all Vitest tests (simulation, multiplayer rules, protocol,
  prediction/interpolation, rooms, server config, and HTTP/WebSocket against a
  real server).
- `npm run typecheck`, `npm run build` and `npm run build:server` pass. The server
  bundle runs standalone with no `node_modules`. In production mode it refuses to
  start without `WRECKYARD_ALLOWED_ORIGINS`, serves `/healthz`, and answers a foreign
  `Origin` with 403.
- In a Chromium-based browser, the garage, HUD, weapon-switch notice and results
  scoreboard render without console errors.
- Online, through the Vite proxy, these were exercised: create/join by code, lobby,
  host start with bot fill, two humans in one match, spectating after a wreck,
  results, back-to-lobby rematch, leave room, the connection-lost screen, and the
  non-pausing menu. With `WRECKYARD_LAG_MS=120 WRECKYARD_JITTER_MS=30` (about 280 ms RTT) your car
  responds immediately. Prediction matches the server to within a few millimetres
  except when an input arrives too late for its tick. Those corrections (one or
  two ticks of movement) glide out with no visible pop beyond 4 cm per frame.

- With Docker Desktop 29.8 these were verified:
  - the image builds with 0 audit vulnerabilities and runs as `node` with no
    `node_modules`
  - without `WRECKYARD_ALLOWED_ORIGINS` it exits with code 1
  - it binds an injected `PORT` (10000, like Render)
  - the `HEALTHCHECK` reports healthy
  - a production client build plays an online match against `docker compose`
  - `docker stop` sends players the restart notice (close 1012) and exits 0 within
    a second

**Not yet verified:** a real Render + Vercel deployment.

**Live gameplay and frame rate have not been playtested yet.** No tested hardware or
performance result is claimed. Complete this browser checklist in Chrome and Edge:

- Select each vehicle, start, drive, reverse, drift, boost and fire both weapons.
- Hold left-click to fire; switch while firing with Tab and 1/2 (including numpad).
  Confirm the highlighted weapon changes, unavailable number keys leave it alone,
  rockets consume ammo, and J/K still quick-fire their respective weapons.
- Switch repeatedly and verify the weapon-name pop-up matches the HUD immediately,
  remains visible for 1.5 seconds, fades in the last 250 ms, and stays below the
  rocket-lock text. Re-selecting the same weapon must not restart it. Pause or replay
  while it is visible and confirm it clears without reappearing from an old timer.
- Confirm collisions, cover, target locks, barrel chains, pickups and bot combat.
- Finish a match with each car; check defeat, victory, final statistics and replay.
- On both victory and defeat, verify the scoreboard contains all six drivers,
  highlights your row, and preserves each eliminated driver's survival time.
  Replay and confirm no old kills/times/rows remain. At smaller window sizes,
  verify the table and replay/garage buttons remain reachable by scrolling.
- Pause, resume, switch tabs while holding movement/fire, then return and resume.
- Release the mouse outside the canvas; confirm firing stops. Click menus/settings
  and verify they never fire a shot. Tab should navigate controls outside gameplay.
- Open/close the field manual; toggle sound and quality; resize the window.
- Replay repeatedly and confirm no extra enemies, stale input, lingering projectiles
  or duplicate audio loops. Observe memory use and frame time.
- Disable WebGL or simulate context loss and confirm the engine-error screen.
- Online: play a full match with two people on different networks against the
  deployed server; check that hits, kills and scoreboards agree on both screens, and
  that a player closing their tab mid-match leaves a bot driving their car.
- Measure high/low quality at 1080p and record browser version, GPU, resolution and
  measured frame times before asserting the 60 FPS target has been met.

This is an original game inspired by the vehicular-combat genre; it includes no
Twisted Metal names, characters, models or licensed assets. Online play is
room-code free-for-all only: there is no matchmaking, accounts, reconnect to a
running match, campaign, touch controls or gamepad controls yet.
