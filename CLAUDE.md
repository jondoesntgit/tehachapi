# Railroad Dispatcher — Project Guide for Claude

A browser-first railroad dispatching game. The player routes trains along a real-world-inspired local line by tapping a train, then tapping a destination. The route turns green, and the train accelerates, cruises, and brakes to a stop at the target. The primary device is an iPhone in landscape. It will later be packaged as a native iOS/Android app.

## Stack (decided)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Typed track graph and schedule schemas catch errors early |
| UI | React | Declarative SVG and HUD/menus |
| Build/dev | Vite | Fast dev server; `npm run dev -- --host` to test on iPhone over Wi-Fi |
| Rendering | Plain SVG written as React JSX | No graphics library needed for lines + rectangles |
| Game state | Pure TS engine + Zustand store for UI | Engine is testable without React |
| Tests | Vitest | Engine physics, routing, and schedule logic |
| Native wrap (later) | Capacitor | Wraps this same web app into iOS/Android projects |
| Interim "app" | PWA (manifest + service worker via `vite-plugin-pwa`) | Add to Home Screen on iPhone = full-screen app with no App Store |
| CI | GitHub Actions: typecheck, lint, test, build on every PR | |
| Hosting | Netlify (production from `main`, deploy previews on PRs) | |

Do NOT use React Native. Capacitor keeps one codebase that runs identically in the browser and in the native shell.

## Architecture rule: engine and view are separate

```
src/
  engine/            # Pure TypeScript. No React, no DOM.
    types.ts         # Node, Edge, Switch, Train, Route, Level, ScheduleEntry
    trackGraph.ts    # Build graph from level JSON; edge lengths; geometry lookup
    routing.ts       # Pathfinding from train head to target; reservation/conflicts
    physics.ts       # Per-train speed/position update (accel, cruise, brake)
    clock.ts         # Game clock (HH:MM), time scale, fast-forward
    scheduler.ts     # Spawns trains from the schedule at their times; scoring
    simulation.ts    # step(state, dtSeconds) -> new state; fixed timestep
  render/            # React components that only READ engine state
    TrackLayer.tsx   # <path> per edge; color by reservation state
    TrainLayer.tsx   # <rect> per train, positioned/rotated along its edge(s)
    Hud.tsx          # Clock, upcoming arrivals, messages
  input/
    useTapRouting.ts # Tap train -> select; tap location -> request route
  store.ts           # Zustand: holds engine state, exposes actions
  App.tsx
levels/
  level-01.json      # Track layout + schedule (see format below)
tests/               # Vitest; most tests target src/engine
```

The game loop calls `requestAnimationFrame`, accumulates real time × time scale, and runs `simulation.step` in fixed increments (e.g. 0.1 game-seconds). The engine never reads the clock or the DOM directly, so tests can run it deterministically.

## Core model

- **World units are meters and seconds.** The renderer maps world coordinates to the SVG `viewBox`. Physics never sees pixels.
- **Track graph:** `nodes` (terminals, switch points) and `edges` (track segments between nodes, optional intermediate `points` for drawing curves/siding offsets). An edge's length is its polyline length unless a `lengthM` value overrides it.
- **Switch:** a node with more than one edge on one side. Its state is set when a route is granted.
- **Train position:** `{ edgeId, offsetM, direction }` for the head. The body extends `trainLengthM` back along the path the train came from. All trains share the same length.
- **Route:** an ordered list of edges from the train head to a target `{ edgeId, offsetM }` (target = where the head stops).
  - A route is granted only if no edge is reserved by another train. Reserved edges render green.
  - Edges are released behind the train's tail once it clears them.
- **Physics, per train each step:**
  - `distanceRemaining` = distance along the route to the target.
  - `brakingDistance = v² / (2 · decel)`.
  - If `distanceRemaining <= brakingDistance + margin`, the train brakes.
  - Otherwise it accelerates at `accel` up to `maxSpeed`.
  - Clamp the final approach so the train stops exactly at the target (v = 0, no overshoot).
- **Spawning:** at `appearsAt`, a train enters at its terminal's portal, moving inward. If the entry block is occupied, it waits off-screen and the HUD warns.
- **Scoring (v1):** on time / late by N minutes at destination; collision or overrun = level failed.

## Level file format (`levels/*.json`)

See `levels/level-01.json`. Key fields:
- `startTime` — game clock at level start, `"HH:MM"`.
- `trainLengthM`, `physics.accelMps2`, `physics.decelMps2`.
- `nodes[]`: `{ id, x, y, kind: "terminal" | "switch" | "point", label? }`.
- `edges[]`: `{ id, from, to, points?: [[x,y],...] }`.
- `schedule[]`: `{ id, name, appearsAt, entry: <terminal node id>, maxSpeedMps, destination: <terminal node id>, dueAt }`.

## Conventions

- East = +x. "Eastbound" trains enter at the west terminal.
- Keep engine functions pure and add a Vitest test with every engine change.
- iPhone first: landscape, touch targets ≥ 44 pt, no hover-only UI, respect safe-area insets.
- Every PR must pass `npm run typecheck && npm run lint && npm test && npm run build`.

## Roadmap

1. Scaffold (Vite + React + TS + Vitest + ESLint), CI workflow, Netlify deploy.
2. Engine: track graph, a single train driven along a fixed route, physics with exact stop.
3. Render track + train in SVG; pan/zoom fit to screen.
4. Tap-to-route with reservations (green) and switch setting.
5. Clock, HUD, scheduler from JSON, fast-forward.
6. Level 1 complete: two sidings, meets/passes, scoring.
7. PWA install on iPhone. Later: Capacitor iOS/Android builds.
