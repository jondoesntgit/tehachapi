import { parseClock } from './clock'
import { advance } from './physics'
import { nextArrivalS, scoreArrival, spawnDue } from './scheduler'
import { getEdge, pathLength, stepEndNode, type TrackGraph } from './trackGraph'
import type { GameState, Train } from './types'

/** Timestep the game loop feeds to `step`, in game seconds. */
export const FIXED_DT_S = 0.1

export function createInitialState(graph: TrackGraph): GameState {
  return {
    timeS: parseClock(graph.level.startTime),
    trains: [],
    reservations: {},
    pending: graph.level.schedule.map((entry) => entry.id),
    results: [],
  }
}

/** Advances the whole game by `dtS` game seconds. */
export function step(graph: TrackGraph, state: GameState, dtS: number): GameState {
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

  return spawnDue(graph, { timeS, trains, reservations, pending: state.pending, results })
}

/**
 * Jumps the clock to shortly before the next scheduled train. Only allowed while the board is
 * empty, so nothing that should have moved is skipped; otherwise the state is returned unchanged.
 */
export function skipToNextArrival(graph: TrackGraph, state: GameState, leadS = 10): GameState {
  const nextS = nextArrivalS(graph, state)
  if (state.trains.length > 0 || nextS === null) return state
  return { ...state, timeS: Math.max(state.timeS, nextS - leadS) }
}
