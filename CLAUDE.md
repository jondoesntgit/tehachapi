# Railroad Dispatcher — Project Guide for Claude

A browser-first railroad dispatching game. The player routes trains along a real-world-inspired local line by tapping a train, then tapping a destination. The route turns green, and the train accelerates, cruises, and brakes to a stop at the far end of the tapped block. The primary device is an iPhone in landscape. It will later be packaged as a native iOS/Android app.

- Repo: https://github.com/jondoesntgit/tehachapi
- Live game: http://github.jamwheeler.com/tehachapi/ (GitHub Pages; redeploys on every push to `main`)

## Status

The MVP is done and deployed: level 1 is playable end to end.

Working today:
- Engine: track graph, routing with reservations, exact-stop physics, clock, scheduler, scoring.
- SVG map, tap-to-route, HUD (clock, 1×/10×/60×, skip to next train, train list, route-refused messages).
- CI and GitHub Pages deploy.

Not built yet (see Roadmap):
- Pan/zoom; the map only fits to the screen.
- PWA install, Capacitor builds.
- More than one level; level selection.

## Commands

```
npm install
npm run dev -- --host     # dev server; --host lets an iPhone on the same Wi-Fi connect
npm run typecheck
npm run lint
npm test
npm run build
```

Needs Node 26 (what CI uses). Every change must pass `npm run typecheck && npm run lint && npm test && npm run build`.

## Stack (decided)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Typed track graph and schedule schemas catch errors early |
| UI | React | Declarative SVG and HUD/menus |
| Build/dev | Vite | Fast dev server |
| Rendering | Plain SVG written as React JSX | No graphics library needed for lines |
| Game state | Pure TS engine + Zustand store for UI | Engine is testable without React |
| Tests | Vitest | Engine physics, routing, and schedule logic |
| Lint | ESLint (flat config) | Also enforces the engine/view split |
| CI | GitHub Actions (`ci.yml`): typecheck, lint, test, build on PRs and `main` | |
| Hosting | GitHub Pages (`deploy.yml`), deployed from `main` | |
| Interim "app" (later) | PWA via `vite-plugin-pwa` | Add to Home Screen on iPhone = full-screen app with no App Store |
| Native wrap (later) | Capacitor | Wraps this same web app into iOS/Android projects |

Do NOT use React Native. Capacitor keeps one codebase that runs identically in the browser and in the native shell.

### Deploy notes

- The site is served from `/tehachapi/`, not the domain root. `deploy.yml` passes that base path to `vite build`. Never hard-code root-absolute URLs (`/foo.png`) in TS/CSS; import assets or use `import.meta.env.BASE_URL`.
- The Pages domain currently serves plain HTTP. A service worker (PWA) needs HTTPS, so "Enforce HTTPS" must be on for the custom domain before the PWA step.

## Architecture rule: engine and view are separate

```
src/
  engine/            # Pure TypeScript. No React, no DOM, no wall clock.
    types.ts         # Level schema, RouteStep, Train, TrainResult, GameState
    trackGraph.ts    # Build graph from level JSON; edge lengths; geometry and path lookups; tap snapping
    routing.ts       # findSteps (Dijkstra), requestRoute (grant/refuse, reservations)
    physics.ts       # advance(): one train, one timestep (accel, cruise, brake, exact stop)
    clock.ts         # "HH:MM" <-> seconds since midnight
    random.ts        # seededRandom(seed): deterministic PRNG
    scheduler.ts     # Timetable (random shifts), spawning, starting trains, scoring, level-complete check
    simulation.ts    # createInitialState(graph, seed?), step(graph, state, dtS), skipToNextArrival
  render/            # React components that only READ engine state
    view.ts          # World -> view mapping (Y_SCALE), viewBox
    TrackLayer.tsx   # <polyline> per edge; green when reserved
    TrainLayer.tsx   # Thick <polyline> per train body in its destination's color, label, stop marker
    Hud.tsx          # Clock, speed buttons, train list, messages, level-complete panel
  (index.css)        # The map sits between the top bar and the train list so neither covers track
  input/
    useTapRouting.ts # Tap train -> select; tap track or terminal -> request route
  store.ts           # Zustand: holds engine state, time scale, selection; runs the fixed-step loop
  App.tsx            # requestAnimationFrame loop + layout
levels/
  level-01.json      # Track layout + schedule (see format below)
tests/               # Vitest; all tests target src/engine
  fixtures/two-sidings.json  # Frozen layout for engine unit tests (helpers.ts `graph`)
  level-01.test.ts   # Shipped level 1 (helpers.ts `graph1`): layout, timetable, scripted playthrough
```

ESLint fails the build if anything under `src/engine` imports React, Zustand, the store, `render/` or `input/`, or touches `window`, `document`, `performance`, `requestAnimationFrame` or `Date.now`.

The game loop calls `requestAnimationFrame`, accumulates real time × time scale, and runs `simulation.step` in fixed increments of `FIXED_DT_S` (0.1 game-seconds). The engine never reads the clock or the DOM, so tests run it deterministically.

## Core model

- **World units are meters and seconds.** Physics never sees pixels.
- **Vertical exaggeration.** The renderer draws y at `Y_SCALE` (6×), like a dispatcher's panel, because at true scale a siding sits only ~8 pt from the main on an iPhone and cannot be tapped separately. This is visual only. Tap snapping (`nearestTrackPosition`) takes the same scale.
- **Track graph:** `nodes` (terminals, switch points) and `edges` (track segments between nodes, optional intermediate `points` for drawing). An edge's length is its polyline length unless `lengthM` overrides it.
- **Direction and offsets:** `direction` is `1` when travelling from an edge's `from` node to `to`, `-1` for the reverse. `offsetM` on an edge is always measured from `from`.
- **Movement through nodes:** a train may continue onto any edge that leaves the node on the far side (heading within 90° of its arrival heading). That one rule makes facing switches offer both legs and stops trains doubling back through trailing switches. **Trains cannot reverse.**
- **Train position:** a train stores `path` (the `RouteStep[]` from the edge under its tail to the end of its granted route) and `headM` (head distance along that path). The body is the `trainLengthM` behind the head. `locateOnPath` converts to `{ edgeId, offsetM, direction }` when needed. All trains share the same length.
- **Stop target:** `stopAtM`, measured like `headM`. `null` means the train is leaving: it runs off the end of its path through a terminal.
- **Routes** (`requestRoute`):
  - The shortest path that avoids edges reserved by other trains wins, so a train takes a siding by itself when the main is held.
  - On success, every edge in the train's path is reserved by it (`GameState.reservations`). Reserved edges render green.
  - A train pulls up to the far end of the tapped edge (block), `STOP_CLEARANCE_M` (20 m) short of the switch, wherever in it the tap landed, so the block behind it is clear and a stopped train never fouls a switch (`resolveStop`).
  - A train never stops in a block too short to hold it clear of both switches (`hasRoom`: `trainLengthM + 2 × STOP_CLEARANCE_M`); `roomAhead` runs it on to the nearest block ahead with room that still leads to its destination.
  - Each end of track always has room to clear arriving trains: a target anywhere in a block that ends at a terminal becomes an exit. The store shows a message when a train clears its terminal late (on-time arrivals show only as chips).
  - Refusals: `no-path`, `blocked` (names the train in the way), `too-close` (cannot brake in time), `departing`, `wrong-destination`.
  - `wrong-destination`: from the target, the train could only leave by a terminal other than its destination (`canReach`). The refusal carries a new `state` in which the train's due time is `WRONG_DESTINATION_PENALTY_S` (3 min) earlier; the store applies it.
- **Releasing:** in `step`, an edge is dropped from `path` and its reservation released once the tail clears it.
- **Physics, per train each step** (`advance`):
  - `brakingDistance = v² / (2 · decel)`.
  - If `distanceRemaining <= brakingDistance + margin`, the train brakes, down to `CREEP_SPEED_MPS` (1 m/s), and creeps the last few meters.
  - Otherwise it accelerates at `accel` up to `maxSpeed`.
  - The final step is clamped so the head lands exactly on the target with v = 0.
- **Timetable:** `createInitialState(graph, seed)` builds `GameState.timetable` (`buildTimetable`): a scheduled train with `appearsBetween` appears at a random whole minute in that window; any other moves by a random whole number of minutes, up to the level's `appearsJitterMin` either way. The due time moves with the appearance. The store passes a fresh random seed each game; with no seed (tests) the timetable is as written. The engine only ever reads times from `state.timetable`.
- **Entry pulse:** the store counts entries per terminal (`entryCounts`); the map pulses a terminal's end bar each time a train enters there.
- **Spawning:** at its timetabled appearance, a train's head enters at its terminal's portal with the body still off the map. It is routed to the far end of its entry edge and stops there until the player sends it on. If the entry edge is reserved, the train stays pending and the HUD warns.
- **Starting trains:** a level's `startingTrains` are already on the board at the start, stopped on their edge with the head `STOP_CLEARANCE_M` short of the far end (`placeStartingTrains`). With a seed, a train with `edgeChoices` stands on a random one of them that no earlier starting train has taken (its own random stream, so it doesn't change the timetable draws). The whole train must fit on that edge clear of both switches.
- **Leaving and scoring:** arrival time is when the head reaches the exit terminal; the train is removed when its tail clears. A `TrainResult` records minutes late (0 = on time) and whether it left through its scheduled destination (routing makes a wrong exit impossible, so this is always true in play).
- **Work trains** (`spawnWorkTrain`, levels with `workTrains: true`): when the board is empty, trains are still pending and none is due for `WORK_TRAIN_CLEAR_S` (5 min), a train `W` enters at a random terminal, bound for another, at 15 mph (`WORK_TRAIN_SPEED_MPS`). It holds only the block its head is in and the next one (plus track under its body): `extendWorkTrains`, at the start of each `step`, grants the next block when its head reaches the last one it holds, picked at random (from `state.seed`) among turns of at most `WORK_TRAIN_MAX_TURN_DEG` (60°) that still reach its destination and aren't held; otherwise it pulls up and waits. The turn limit keeps it off the acute turn at the bottom of the wye. Refused as `work-train` if dispatched; isn't scored, doesn't end fast-forward, and "Skip to next train" clears it away.
- **Score:** `levelScore` = 100 less `lateTotal` (minutes late, plus 90 for a deadlock); the end-of-game panel shows it.
- **Deadlock ends the game** (`isDeadlocked`, checked at the end of every `step`): once every scheduled train's entry time has passed (held-at-portal counts as launched), and every train on the board is stopped with no way forward (`canProgress`: no free block ahead with room that still leads to its destination), `state.deadlocked` is set. `step` then returns the state unchanged, `isLevelComplete` is true, and `DEADLOCK_PENALTY_MIN` (90) is added to the late total (`lateTotal`, `levelScore`). Reservations and the exact stop still make collisions and overruns impossible.
- **Fast-forward:** the store drops back to 1× whenever a train enters. "Skip to next train" only works while no dispatched train is on the board.

## Level file format (`levels/*.json`)

See `levels/level-01.json`. Key fields:
- `startTime` — game clock at level start, `"HH:MM"`.
- `workTrains` (optional) — send work trains through gaps in the timetable.
- `appearsJitterMin` (optional) — max random shift, in minutes either way, applied to each scheduled train per game.
- `trainLengthM`, `physics.accelMps2`, `physics.decelMps2`, `physics.stopMarginM`.
- `nodes[]`: `{ id, x, y, kind: "terminal" | "switch" | "point", label?, color? }`. A terminal's `color` is the color of trains heading there (map, train list, help legend).
- `edges[]`: `{ id, from, to, points?: [[x,y],...], lengthM?, branch? }`. `branch` names a terminal; the edge is drawn in a faint tint of its color.
- `labels[]` (optional): `{ text, x, y, color? }` — extra text on the map at a world position.
- `schedule[]`: `{ id, name, appearsAt, appearsBetween?: ["HH:MM", "HH:MM"], entry: <terminal node id>, maxSpeedMps, destination: <terminal node id>, dueAt }`. `appearsAt`/`dueAt` are the written timetable; `appearsBetween` (which must contain `appearsAt`) randomizes the appearance over that window each game.
- `startingTrains[]` (optional): `{ id, name, edge, edgeChoices?: [edge ids], direction: 1 | -1, maxSpeedMps, destination: <terminal node id>, dueAt }` — trains standing on `edge` at the start, facing `direction`. `edgeChoices` (which must contain `edge`) picks a random free one each game.

`buildGraph` throws on duplicate ids, edges that reference unknown nodes, schedule entries whose `entry` or `destination` is not a terminal or whose `appearsBetween` does not contain `appearsAt`, and starting trains with an unknown edge (or edge choice), `edgeChoices` that do not contain `edge`, or a non-terminal destination. `createInitialState` throws if a starting train does not fit its edge, two share one, or a train's edge choices are all taken. The level is currently imported statically in `store.ts`.

## Conventions

- East = +x. "Eastbound" trains enter at the west terminal.
- Keep engine functions pure (state in, new state out) and add a Vitest test with every engine change.
- `tests/level-01.test.ts` contains a scripted full playthrough of level 1 on its written timetable, with work trains off. Keep it passing; update it when level 1 changes.
- Engine unit tests use the frozen fixture layout, so retuning a real level doesn't break them.
- iPhone first: landscape, touch targets ≥ 44 pt, no hover-only UI, respect safe-area insets.
- Stroke widths are in screen pixels (`vector-effect: non-scaling-stroke`); map label sizes are in view units.

## Roadmap

Done:
1. Scaffold, CI, deploy.
2. Engine: track graph, routing, physics with exact stop.
3. Render track + trains in SVG, fit to screen.
4. Tap-to-route with reservations (green).
5. Clock, HUD, scheduler from JSON, fast-forward.
6. Level 1: four sidings, a wye to an SE line running under the main (three blocks, a passing siding, tinted, labelled), sixteen trains (two bound for Southeast, two entering from it; three waiting on sidings at the start, two of them on random sidings), meets/passes, scoring out of 100, work trains in timetable gaps, randomized entry times, trains colored by destination.

Next:
7. Per-train end-of-level score breakdown (deadlock detection and the score are done).
8. Pan/zoom for layouts larger than the screen.
9. More levels and a level picker.
10. PWA install on iPhone (needs HTTPS on the Pages domain).
11. Capacitor iOS/Android builds.
