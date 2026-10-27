# Railroad Dispatcher — Project Guide for Claude

A browser-first railroad dispatching game. The player routes trains along a real-world-inspired local line by tapping a train, then tapping a destination. The route turns green, and the train accelerates, cruises, and brakes to a stop at the far end of the tapped block. The primary device is an iPhone in landscape. It will later be packaged as a native iOS/Android app.

- Repo: https://github.com/jondoesntgit/tehachapi
- Live game: http://github.jamwheeler.com/tehachapi/ (GitHub Pages; redeploys on every push to `main`)

## Status

The MVP is done and deployed: level 1 is playable end to end.

Working today:
- Engine: track graph, routing with reservations, following (shared track, moving stop target), exact-stop physics, clock, scheduler, scoring.
- SVG map, tap-to-route, HUD (clock, 1×/5×/10×/60× with double-tap to hold 5×, skip to next train, route-refused messages); each train's label shows minutes until it's due.
- Arrival countdowns: every train (work trains too) is announced beside its entry terminal 10 minutes before it enters.
- Game codes and tournament mode: every game has a code; the same code deals the same game, so players can compare scores.
- A second page (P1/P2 buttons): the line runs on west from Marcel across page 2, in two rows, to Bakersfield; dispatched like page 1.
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
    trackGraph.ts    # Build graph from level JSON (links join pages); edge lengths; geometry and path lookups; tap snapping
    routing.ts       # findSteps (Dijkstra), requestRoute (grant/refuse, reservations)
    physics.ts       # advance(): one train, one timestep (accel, cruise, brake, exact stop)
    clock.ts         # "HH:MM" <-> seconds since midnight
    random.ts        # seededRandom(seed): deterministic PRNG
    following.ts     # Shared track claims (holders per edge), leader/follower positions, followLimitM
    gameCode.ts      # Game codes <-> seeds: normalizeGameCode, seedFromGameCode, randomGameCode
    scheduler.ts     # Timetable (random shifts), spawning, starting trains, scoring, level-complete check
    simulation.ts    # createInitialState(graph, seed?), step(graph, state, dtS), skipToNextArrival
  render/            # React components that only READ engine state
    view.ts          # World -> view mapping (Y_SCALE), viewBox per page, edgePage/trainPage, pagePolylines
    TrackLayer.tsx   # <polyline> per edge; each cleared route drawn in its train's color; a box at each terminal, a dashed bar at each link
    TrainLayer.tsx   # Thick <polyline> per train body in its destination's color, label with minutes until due, stop marker
    ArrivalLayer.tsx # Countdowns beside each terminal for trains announced to enter there
    Hud.tsx          # P1/P2 page buttons, clock, speed buttons (double-tap 5× to hold it), messages, level-complete panel
    Tournament.tsx   # 🏆 panel: this game's code and link, restart it, play another code
  (index.css)        # The map fills the screen below the top bar; nothing covers track
  input/
    useTapRouting.ts # Tap train or its cleared route -> select; tap track or a terminal's box -> request route (a box tap beats a train in it)
  store.ts           # Zustand: holds engine state, time scale, selection; runs the fixed-step loop
  App.tsx            # requestAnimationFrame loop + layout
levels/
  level-01.json      # Track layout + schedule (see format below)
tests/               # Vitest; all tests target src/engine
  fixtures/two-sidings.json  # Frozen layout for engine unit tests (helpers.ts `graph`)
  level-01.test.ts   # Shipped level 1 (helpers.ts `graph1`): layout, page 2, timetable, siding-hopping playthrough
  following.test.ts  # Following: safety across speeds, sharing rules, whole-game no-touch check
```

ESLint fails the build if anything under `src/engine` imports React, Zustand, the store, `render/` or `input/`, or touches `window`, `document`, `performance`, `requestAnimationFrame` or `Date.now`.

The game loop calls `requestAnimationFrame`, accumulates real time × time scale, and runs `simulation.step` in fixed increments of `FIXED_DT_S` (0.1 game-seconds). The engine never reads the clock or the DOM, so tests run it deterministically.

## Core model

- **World units are meters and seconds.** Physics never sees pixels.
- **Vertical exaggeration.** The renderer draws y at `Y_SCALE` (6×), like a dispatcher's panel, because at true scale a siding sits only ~8 pt from the main on an iPhone and cannot be tapped separately. This is visual only. Tap snapping (`nearestTrackPosition`) takes the same scale.
- **Track graph:** `nodes` (terminals, switch points) and `edges` (track segments between nodes, optional intermediate `points` for drawing). An edge's length is its polyline length unless `lengthM` overrides it.
- **Direction and offsets:** `direction` is `1` when travelling from an edge's `from` node to `to`, `-1` for the reverse. `offsetM` on an edge is always measured from `from`.
- **Movement through nodes:** a train may continue onto any edge that leaves the node on the far side (heading within 90° of its arrival heading). At a `link` node it continues onto the edge at the node it is joined to (`Level.links`, `graph.linkedTo`), which may be drawn anywhere, usually on another page. That one rule makes facing switches offer both legs and stops trains doubling back through trailing switches. **Trains cannot reverse.**
- **Train position:** a train stores `path` (the `RouteStep[]` from the edge under its tail to the end of its granted route) and `headM` (head distance along that path). The body is the `trainLengthM` behind the head. `locateOnPath` converts to `{ edgeId, offsetM, direction }` when needed. All trains share the same length.
- **Stop target:** `stopAtM`, measured like `headM`. `null` means the train is leaving: it runs off the end of its path through a terminal.
- **Routes** (`requestRoute`):
  - Three ways are planned: the shortest way there, the shortest that keeps out of blocks other trains will park in (their last path edge), and the shortest that avoids every edge other trains hold. The shortest of them that `sharingConflict` allows wins, so a train takes a siding by itself when the main is held by a train it can't follow.
  - **Following (shared track, `following.ts`):** `GameState.reservations` maps each edge to the ids of every train holding it. Track from the head on may be shared only with trains running the same way along it that are either ahead of the train on its new path (it follows them; its path may not enter the block a parking leader will stop in, but may follow an exiting leader all the way out) or behind it (they follow it; it may not park in a block one of them must pass). Anything else, an opposing train or one that would be cut in front of, refuses with `blocked`. So a follower always parks in a block behind its leader, and no train cuts in between two others.
  - On success, every edge in the train's path is claimed by it (`claim`), alongside any trains it shares with. Reserved edges render in the color of the train holding them; a follower's route is drawn only up to its leader (`followLimitM`), so shared track shows the leader's color.
  - A train pulls up to the far end of the tapped edge (block), `STOP_CLEARANCE_M` (20 m) short of the switch, wherever in it the tap landed, so the block behind it is clear and a stopped train never fouls a switch (`resolveStop`).
  - A train never stops in a block too short to hold it clear of both switches (`hasRoom`: `trainLengthM + 2 × STOP_CLEARANCE_M`); `roomAhead` runs it on to the nearest block ahead with room that still leads to its destination.
  - Each end of track always has room to clear arriving trains: a target anywhere in a block that ends at a terminal becomes an exit. The store shows a message when a train clears its terminal late (on-time arrivals show only as chips).
  - A train on its way out (`stopAtM` null) can still be rerouted, e.g. into a siding to let a faster train by, until its head reaches the terminal (`arrivedAtS` set); the usual checks apply (it must be able to brake for the new stop, and the following rules hold).
  - Refusals: `no-path`, `blocked` (names the train in the way), `too-close` (cannot brake in time), `departing` (its head is already at the terminal), `wrong-destination`.
  - `wrong-destination`: from the target, the train could only leave by a terminal other than its destination (`canReach`). The refusal carries a new `state` in which the train's due time is `WRONG_DESTINATION_PENALTY_S` (3 min) earlier; the store applies it.
- **Releasing:** in `step`, an edge is dropped from `path` and the train's own claim on it released (`release`) once the tail clears it; other trains sharing it keep theirs.
- **Moving stop target (following):** each `step`, a train stops at the nearer of its own `stopAtM` and `followLimitM`: `FOLLOW_GAP_M` (20 m) short of the tail of the nearest train ahead of it on its path, running the same way. Limits are computed from positions before anyone moves; a leader only moves forward, so the target only recedes and the follower, braking with the ordinary `advance` physics, can never close within the gap, however fast it is and however slow the leader (`tests/following.test.ts` checks this across speeds, plus whole level-1 games with an eager dispatcher, asserting no two bodies ever come within the gap). A route is refused `too-close` if the train can't stop behind its new leader. A follower cruises at its top speed until its braking distance to the leader's tail runs out, then slows to keep the gap.
- **Physics, per train each step** (`advance`; the stop target is the moving one above):
  - `brakingDistance = v² / (2 · decel)`.
  - If `distanceRemaining <= brakingDistance + margin`, the train brakes, down to `CREEP_SPEED_MPS` (1 m/s), and creeps the last few meters.
  - Otherwise it accelerates at `accel` up to `maxSpeed`.
  - The final step is clamped so the head lands exactly on the target with v = 0.
- **Timetable:** `createInitialState(graph, seed)` builds `GameState.timetable` (`buildTimetable`): a scheduled train with `appearsBetween` appears at a random whole minute in that window; any other moves by a random whole number of minutes, up to the level's `appearsJitterMin` either way. The due time moves with the appearance. The store passes the seed for the game's code (see Game codes); with no seed (tests) the timetable is as written. The engine only ever reads times from `state.timetable`.
- **Announcements** (`announcedTrains`, `ANNOUNCE_LEAD_S` = 10 min): a scheduled train is announced at its entry terminal once its appearance is within 10 minutes, and stays announced (shown "held") if it is due but its entry block is taken; work trains from `state.workTimetable` are announced the same way. `ArrivalLayer` draws them beside the terminal's end bar, past the end of the line (`PADDING_X` leaves room), soonest level with the track, each in its destination's color with an m:ss countdown.
- **Keeping the board busy** (`keepTrainsInPlay`, run once in `createInitialState`): the timetable is adjusted when the game is dealt so that at every minute at least `requiredTrains` trains are in play, where a scheduled train counts from its announcement until the quickest it could have crossed the board (`quickestCrossingS`: shortest way in to out at top speed, plus the train's length and one run up to speed), and a starting train until it is due out. While short, the earliest later trains are moved to enter `ANNOUNCE_LEAD_S` after that minute (full countdown), due times moving with them. It never looks at the board, so it cannot depend on how fast the player clears trains (see Game codes). `requiredTrains` is the level's `minTrainsOnBoard` plus one for every `minTrainsRampEveryMin` minutes since the start (level 1: 4, rising by one every 15 minutes; about 12 trains a game come in early, ~11 minutes on average). Work trains don't count.
- **Entry pulse:** the store counts entries per terminal (`entryCounts`); the map pulses a terminal's end bar each time a train enters there.
- **Spawning:** at its timetabled appearance, a train's head enters at its terminal's portal with the body still off the map. It is routed to the far end of its entry edge and stops there until the player sends it on. If the entry edge is reserved, the train stays pending and the HUD warns.
- **Starting trains:** a level's `startingTrains` are already on the board at the start, stopped on their edge with the head `STOP_CLEARANCE_M` short of the far end (`placeStartingTrains`). With a seed, a train with `edgeChoices` stands on a random one of them that no earlier starting train has taken, facing whichever way reaches its destination (its written `direction` if both do; choices with neither are skipped). It uses its own random stream, so it doesn't change the timetable draws. The whole train must fit on that edge clear of both switches.
- **Leaving and scoring:** arrival time is when the head reaches the exit terminal; the train is removed when its tail clears. A `TrainResult` records minutes late (0 = on time) and whether it left through its scheduled destination (routing makes a wrong exit impossible, so this is always true in play).
- **Work trains** (levels with `workTrains: true`; ids `W1`, `W2`, …; labelled `W` on the map; drawn in its destination's color; 11.25 mph, `WORK_TRAIN_SPEED_MPS`): W1 starts the game standing on a random free siding (`placeWorkTrainOnSiding`; the level's `sidings`, else every edge its starting trains may stand on; long enough to hold it clear of both switches; own random stream), bound for a random terminal it can reach, facing that way, due out `WORK_TRAIN_ALLOWANCE_S` (65 min) after the start; it is left out if no siding is free. The rest are in `state.workTimetable` (`buildWorkTimetable`, dealt from the seed alone; `workTrainsSent` indexes the next): each enters at a random terminal, bound for another it can reach, `WORK_TRAIN_GAP_AFTER_DUE_S` (10 min) after the one before is due out, so every 75 minutes (level 1: W2 at 11:08), until the last scheduled train's entry. One enters at its timetabled time once its entry block is free and no other work train is on the board (`MAX_WORK_TRAINS` = 1); until then it waits at its portal (`workTrainHeld`, the HUD warns, the countdown shows "held"). Like a scheduled train it pulls up at the far end of its entry block and waits; the dispatcher routes it like any other. It is due out `WORK_TRAIN_ALLOWANCE_S` (65 min) after its timetabled entry, so waiting at the portal counts against the player as it does for scheduled trains, and is scored like any train, doesn't end fast-forward, doesn't hold the level open (`isLevelComplete` ignores work trains), and "Skip to next train" clears it away.
- **Score:** `levelScore` = 100 less `lateTotal` (minutes late, plus 90 for a deadlock); the end-of-game panel shows it.
- **Deadlock ends the game** (`isDeadlocked`, checked at the end of every `step`): once every scheduled train's entry time has passed (held-at-portal counts as launched), and every train on the board is stopped with no way forward (`canProgress`: no free block ahead with room that still leads to its destination), `state.deadlocked` is set. `step` then returns the state unchanged, `isLevelComplete` is true, and `DEADLOCK_PENALTY_MIN` (90) is added to the late total (`lateTotal`, `levelScore`). Reservations and the exact stop still make collisions and overruns impossible.
- **Idle limit** (`checkIdle`, at the end of every `step`; level `idleLimitMin`, 20 in level 1): `state.idleSinceS` records when every train on the board last stood still (an empty board isn't idle); once that lasts `idleLimitMin`, `state.stalled` ends the game like a deadlock but with no penalty. The end panel says why.
- **Game codes and tournament mode** (`gameCode.ts`, `store.ts`, `render/Tournament.tsx`): every game is dealt from a code, and `seedFromGameCode(code)` is its seed, so the same code always gives the same timetable, starting sidings and work trains; only the player's dispatching differs (the fixed-step loop keeps the simulation independent of frame rate). Every entry time (`state.timetable`, `state.workTimetable`) is fixed in `createInitialState` and never changes during play, whatever the player does; a train can only be held at its portal (its entry block taken, or another work train on the board), and its due time doesn't move when it is. Keep it that way: never make an entry time depend on the board. A fresh game gets a random 6-character Crockford base-32 code (`randomGameCode`; no I, L, O or U). Typed codes are normalized (`normalizeGameCode`: upper case, letters and digits only, 1–24 long), so any word works ("Friday Final" → `FRIDAYFINAL`); the seed also folds O→0 and I/L→1 so look-alike typos deal the same game. The 🏆 panel (pauses the game) shows the code and its link, restarts it, or plays a typed code. Playing a code turns on tournament mode: the top bar shows `🏆 CODE`, "Play again" becomes "Replay CODE" (restart deals the same code), and the address bar carries `?code=CODE`; opening such a link starts that game in tournament mode. "Leave tournament" deals a new random game and drops `?code=`. Share/copy buttons appear only in a secure context (HTTPS); on plain HTTP the link is shown as selectable text. Changing a level's schedule, layout or any random draw changes what a code deals, so codes are only comparable within one build.
- **Pages and links:** nodes, edges and labels may carry `page` (default 1); the store's `page` picks which one the map shows (viewBox, layers, tap routing and countdowns are all limited to it), and the HUD shows page buttons (P2 left of P1) when a level has more than one page, each with a count of trains whose head is on a page not showing. A level's `links` join pairs of `link` nodes (each with exactly one edge) into continuous track, so routing, reservations, following and physics run across pages unchanged. The renderer draws only the part of a path or body on the current page (`pagePolylines`, which also breaks a line at every link), with a dashed end bar at each link. Switching page keeps the selection, so a train picked on one page can be sent to track on the other. Level 1: Marcel (page 1's west end, node `WEST`) joins the east end of page 2's top row; its west end, Westward, joins the east end of the lower row, which ends at Bakersfield. Every siding on both pages, and page 2's second track, sits 34.5 m off its main; on page 2 all of them lie above the main (the lower row's main is at y 140). Page 2 has two sidings per row and a double-track stretch per row (30% of its 12 km main) with a V of crossovers in the middle. Trains to or from Bakersfield are due `2 × 12 km ÷ top speed + 5 min` later than they were at the old West Terminal.
- **Fast-forward:** the store drops back to 1× whenever a train enters, unless the speed is held (`speedLocked`: a double tap on 5× in the HUD; cleared by picking any speed). "Skip to next train" only works while no dispatched train is on the board.

## Level file format (`levels/*.json`)

See `levels/level-01.json`. Key fields:
- `startTime` — game clock at level start, `"HH:MM"`.
- `workTrains` (optional) — start a work train on a free siding, then send another in 10 minutes after each one is due, while scheduled trains are still to come.
- `sidings` (optional) — edges a work train may start on; defaults to every edge the starting trains may stand on.
- `minTrainsOnBoard` (optional) — bring scheduled trains in early to keep at least this many in play.
- `minTrainsRampEveryMin` (optional) — raise that minimum by one every this many minutes.
- `idleLimitMin` (optional) — end the game if trains are on the board but none has moved for this many minutes.
- `appearsJitterMin` (optional) — max random shift, in minutes either way, applied to each scheduled train per game.
- `trainLengthM`, `physics.accelMps2`, `physics.decelMps2`, `physics.stopMarginM`.
- `nodes[]`: `{ id, x, y, kind: "terminal" | "switch" | "point" | "link", label?, color?, page? }`. A terminal's `color` is the color of trains heading there (map, train list, help legend).
- `edges[]`: `{ id, from, to, points?: [[x,y],...], lengthM?, branch?, page? }`. `page` (default 1) puts it on another page of the map. `branch` names a terminal; the edge is drawn in a faint tint of its color.
- `links[]` (optional): `[nodeId, nodeId]` pairs of `link` nodes; track runs straight on from one to the other (e.g. from one page onto the next).
- `labels[]` (optional): `{ text, x, y, color?, page? }` — extra text on the map at a world position.
- `schedule[]`: `{ id, name, appearsAt, appearsBetween?: ["HH:MM", "HH:MM"], entry: <terminal node id>, maxSpeedMps, destination: <terminal node id>, dueAt }`. `appearsAt`/`dueAt` are the written timetable; `appearsBetween` (which must contain `appearsAt`) randomizes the appearance over that window each game.
- `startingTrains[]` (optional): `{ id, name, edge, edgeChoices?: [edge ids], direction: 1 | -1, maxSpeedMps, destination: <terminal node id>, dueAt }` — trains standing on `edge` at the start, facing `direction`. `edgeChoices` (which must contain `edge`) picks a random free one each game.

`buildGraph` throws on duplicate ids, edges that reference unknown nodes, schedule entries whose `entry` or `destination` is not a terminal or whose `appearsBetween` does not contain `appearsAt`, and starting trains with an unknown edge (or edge choice), `edgeChoices` that do not contain `edge`, or a non-terminal destination, and links that name a non-link node, a link node that is unjoined or joined twice, or one without exactly one edge. `createInitialState` throws if a starting train does not fit its edge, two share one, or a train's edge choices are all taken. The level is currently imported statically in `store.ts`.

## Conventions

- East = +x. "Eastbound" trains enter at the west terminal.
- Keep engine functions pure (state in, new state out) and add a Vitest test with every engine change.
- `tests/level-01.test.ts` plays level 1 through on its written timetable with a simple dispatcher that sends each stopped train on to the nearest passing track it can have (or out), with work trains off, `minTrainsOnBoard` and its ramp off, and the three four-train waves (T19–T30) left out; every train must be on time. Another test checks that every random timetable forces at least three pairs of trains to pass each other. Keep it passing; update it when level 1 changes.
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
6. Level 1: four sidings, a wye to an SE line running under the main to the east (two passing sidings), a SW branch running under the main to the west (two passing sidings), both tinted and labelled; thirty-three trains (including three waves of four, one from each terminal, at 10:27–10:30, 10:45–10:47 and 11:27–11:38; three waiting at the start on random sidings), a rising minimum of scheduled trains in play (4, plus one every 15 minutes), at least three forced passes every game, scoring out of 100, dispatchable work trains at 11.25 mph (one starting on a siding, then one 10 minutes after each is due; one at a time), randomized entry times, trains colored by destination (work trains too), 10-minute arrival countdowns beside each terminal.
7. Game codes and tournament mode: shareable codes/links that deal the same game for everyone, replayable from the 🏆 panel.
8. Following: trains heading the same way may share track, keeping 20 m behind the leader (moving stop target), following it out through its terminal, parking only in a block behind it.
9. Second page: P1/P2 buttons; the line runs on from Marcel across page 2 (two rows, sidings, 30% double track) to Bakersfield, dispatched like page 1.

Next:
10. Per-train end-of-level score breakdown (deadlock detection and the score are done).
11. Pan/zoom for layouts larger than the screen.
12. More levels and a level picker.
13. PWA install on iPhone (needs HTTPS on the Pages domain).
14. Capacitor iOS/Android builds.
