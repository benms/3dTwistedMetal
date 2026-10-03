# Wreckyard

A standalone Three.js arcade car-combat game with original procedural vehicles and
scenery. Choose a buggy, muscle car, or heavy truck and fight five AI drivers in a
scrapyard. Last car standing wins.

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
requires a desktop keyboard and WebGL 2. It has no backend or API keys. The dev and
preview servers listen on localhost only; to play-test from another device on your
network, opt in with `npm run dev -- --host`.

```sh
npm test              # simulation, collision, weapons, navigation, lifecycle
npm run build         # strict TypeScript check and production bundle
npm run preview       # serve the production bundle locally
npm run format        # format the source with Prettier
npm run format:check  # check formatting without writing
```

`dist/` is a static website with relative asset paths. Serve it over HTTP; do not
open `index.html` directly from the filesystem. No public deployment is configured.

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
| Pause / resume            | Escape                              |
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
  synthesized audio, menus, radar and HUD. `main.ts` connects the systems.

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
- `npm test` passes all 64 Vitest tests (simulation, controls, weapon notification,
  scoreboard).
- `npm run build` passes the strict TypeScript check and produces the bundle.
- In a Chromium-based browser, the garage, HUD, weapon-switch notice and results
  scoreboard render without console errors.

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
- Measure high/low quality at 1080p and record browser version, GPU, resolution and
  measured frame times before asserting the 60 FPS target has been met.

This is an original game inspired by the vehicular-combat genre; it includes no
Twisted Metal names, characters, models or licensed assets. No multiplayer, campaign,
touch controls or gamepad controls are included in this first version.
