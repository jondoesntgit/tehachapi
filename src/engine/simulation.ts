import { parseClock } from './clock'
import { advance } from './physics'
import { isDeadlocked } from './routing'
import {
  buildTimetable,
  nextWorkTrainAt,
  nextArrivalS,
  placeStartingTrains,
  scoreArrival,
  spawnDue,
  spawnWorkTrain,
} from './scheduler'
import { getEdge, pathLength, stepEndNode, type TrackGraph } from './trackGraph'
import type { GameState, Train } from './types'

/** Timestep the game loop feeds to `step`, in game seconds. */
export const FIXED_DT_S = 0.1

/**
 * A fresh game. `seed` randomizes when scheduled trains enter (`buildTimetable`) and where starting
 * trains stand (`placeStartingTrains`).
 */
export function createInitialState(graph: TrackGraph, seed?: number): GameState {
  return {
    timeS: parseClock(graph.level.startTime),
    ...placeStartingTrains(graph, seed),
    pending: graph.level.schedule.map((entry) => entry.id),
    timetable: buildTimetable(graph, seed),
    seed: seed ?? 0,
    workTrainsSent: 0,
    nextWorkTrainS: nextWorkTrainAt(seed ?? 0, 0, parseClock(graph.level.startTime)),
    deadlocked: false,
    idleSinceS: null,
    stalled: false,
    results: [],
  }
}

/** Advances the whole game by `dtS` game seconds. */
export function step(graph: TrackGraph, state: GameState, dtS: number): GameState {
  if (state.deadlocked || state.stalled) return state
  const { trainLengthM, physics } = graph.level
  const timeS = state.timeS + dtS
  const reservations = { ...state.reservations }
  const results = [...state.results]
  const trains: Train[] = []

  for (const train of state.trains) {
    const remainingM = train.stopAtM === null ? null : train.stopAtM - train.headM
    const moved = advance({
      speedMps: train.speedMps,
      maxSpeedMps: train.maxSpeedMps,
      distanceRemainingM: remainingM,
      accelMps2: physics.accelMps2,
      decelMps2: physics.decelMps2,
      marginM: physics.stopMarginM,
      dtS,
    })
    // Land exactly on the target rather than a rounding error short of it.
    let headM = moved.distanceM === remainingM ? train.stopAtM! : train.headM + moved.distanceM
    let { path, stopAtM, arrivedAtS } = train

    if (stopAtM === null) {
      const endM = pathLength(graph, path)
      if (arrivedAtS === null && headM >= endM) arrivedAtS = timeS
      if (arrivedAtS !== null && headM - trainLengthM >= endM) {
        // Tail is through the portal: the train is gone.
        for (const s of path) delete reservations[s.edgeId]
        const last = path[path.length - 1]
        results.push(scoreArrival(train, arrivedAtS, stepEndNode(getEdge(graph, last.edgeId), last.direction)))
        continue
      }
    }

    // Release edges the tail has cleared.
    while (path.length > 1 && headM - trainLengthM >= getEdge(graph, path[0].edgeId).lengthM) {
      const cleared = path[0]
      const clearedM = getEdge(graph, cleared.edgeId).lengthM
      path = path.slice(1)
      headM -= clearedM
      if (stopAtM !== null) stopAtM -= clearedM
      if (!path.some((s) => s.edgeId === cleared.edgeId)) delete reservations[cleared.edgeId]
    }

    trains.push({ ...train, speedMps: moved.speedMps, path, headM, stopAtM, arrivedAtS })
  }

  const next = spawnWorkTrain(graph, spawnDue(graph, { ...state, timeS, trains, reservations, results }))
  if (isDeadlocked(graph, next)) return { ...next, deadlocked: true }
  return checkIdle(graph, next)
}

/**
 * Jumps the clock to shortly before the next scheduled train. Only allowed while no dispatched train
 * is on the board, so nothing that should have moved is skipped; work trains are cleared away.
 * Otherwise the state is returned unchanged.
 */
export function skipToNextArrival(state: GameState, leadS = 10): GameState {
  const nextS = nextArrivalS(state)
  if (state.trains.some((t) => !t.work) || nextS === null) return state
  const reservations = Object.fromEntries(
    Object.entries(state.reservations).filter(([, holder]) => !state.trains.some((t) => t.id === holder)),
  )
  return { ...state, trains: [], reservations, timeS: Math.max(state.timeS, nextS - leadS) }
}

/**
 * Tracks how long every train on the board has stood still; once that reaches the level's
 * `idleLimitMin`, the game is over (`stalled`). An empty board isn't idle.
 */
export function checkIdle(graph: TrackGraph, state: GameState): GameState {
  const limitMin = graph.level.idleLimitMin
  if (limitMin === undefined) return state
  const allStill = state.trains.length > 0 && state.trains.every((t) => t.speedMps === 0)
  if (!allStill) return state.idleSinceS === null ? state : { ...state, idleSinceS: null }
  const idleSinceS = state.idleSinceS ?? state.timeS
  return { ...state, idleSinceS, stalled: state.timeS - idleSinceS >= limitMin * 60 }
}
