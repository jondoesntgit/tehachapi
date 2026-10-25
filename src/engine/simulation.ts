import { parseClock } from './clock'
import { followLimitM, release, releaseAll } from './following'
import { advance } from './physics'
import { isDeadlocked } from './routing'
import {
  buildTimetable,
  buildWorkTimetable,
  keepTrainsInPlay,
  placeWorkTrainOnSiding,
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
 * A fresh game. `seed` randomizes when scheduled trains enter (`buildTimetable`, then
 * `keepTrainsInPlay`), the work trains (`placeWorkTrainOnSiding`, `buildWorkTimetable`) and where
 * starting trains stand (`placeStartingTrains`). Nothing later changes when a train is due to enter.
 */
export function createInitialState(graph: TrackGraph, seed?: number): GameState {
  // Every entry time is fixed here, from the seed alone, so it never depends on how the game is played.
  const timetable = keepTrainsInPlay(graph, buildTimetable(graph, seed))
  return {
    timeS: parseClock(graph.level.startTime),
    ...placeWorkTrainOnSiding(graph, seed ?? 0, placeStartingTrains(graph, seed)),
    pending: graph.level.schedule.map((entry) => entry.id),
    timetable,
    seed: seed ?? 0,
    workTrainsSent: 0,
    workTimetable: buildWorkTimetable(graph, seed ?? 0, timetable),
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
  let reservations = state.reservations
  const results = [...state.results]
  const trains: Train[] = []
  // Every follower's limit from where its leader is before anyone moves: leaders only move forward,
  // so this errs on the safe side and the gap never shrinks below FOLLOW_GAP_M.
  const limits = new Map(state.trains.map((t) => [t.id, followLimitM(graph, state.trains, t)]))

  for (const train of state.trains) {
    // Stop at its own stop, or behind the train ahead if that comes first.
    const targetM = Math.min(train.stopAtM ?? Infinity, limits.get(train.id) ?? Infinity)
    const remainingM = targetM === Infinity ? null : Math.max(0, targetM - train.headM)
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
    let headM = moved.distanceM === remainingM ? train.headM + remainingM : train.headM + moved.distanceM
    let { path, stopAtM, arrivedAtS } = train

    if (stopAtM === null) {
      const endM = pathLength(graph, path)
      if (arrivedAtS === null && headM >= endM) arrivedAtS = timeS
      if (arrivedAtS !== null && headM - trainLengthM >= endM) {
        // Tail is through the portal: the train is gone.
        reservations = releaseAll(reservations, train.id)
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
      if (!path.some((s) => s.edgeId === cleared.edgeId)) reservations = release(reservations, cleared.edgeId, train.id)
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
  const reservations = state.trains.reduce((acc, t) => releaseAll(acc, t.id), state.reservations)
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
