import { parseClock } from './clock'
import { safeSpeed } from './physics'
import { STOP_CLEARANCE_M } from './routing'
import { getEdge, type TrackGraph } from './trackGraph'
import type { GameState, RouteStep, ScheduleEntry, Train, TrainResult } from './types'

export function getScheduleEntry(graph: TrackGraph, id: string): ScheduleEntry {
  const entry = graph.level.schedule.find((e) => e.id === id)
  if (!entry) throw new Error(`Unknown schedule entry "${id}"`)
  return entry
}

/** The step a train takes when it enters through a terminal's portal. */
export function entryStep(graph: TrackGraph, terminalId: string): RouteStep {
  const edgeId = graph.edgesAt.get(terminalId)?.[0]
  if (!edgeId) throw new Error(`Terminal "${terminalId}" has no track`)
  return { edgeId, direction: getEdge(graph, edgeId).from === terminalId ? 1 : -1 }
}

/** Schedule entries whose time has come but whose entry block is still occupied. */
export function heldAtPortal(graph: TrackGraph, state: GameState): ScheduleEntry[] {
  return state.pending
    .map((id) => getScheduleEntry(graph, id))
    .filter((entry) => parseClock(entry.appearsAt) <= state.timeS)
}

/** Earliest `appearsAt` among entries that are not due yet. */
export function nextArrivalS(graph: TrackGraph, state: GameState): number | null {
  const times = state.pending
    .map((id) => parseClock(getScheduleEntry(graph, id).appearsAt))
    .filter((t) => t > state.timeS)
  return times.length > 0 ? Math.min(...times) : null
}

/**
 * Brings due trains in through their portals, head first, body still off the map. A new train is
 * routed to the far end of its entry block and stops there until the dispatcher sends it on.
 * A train whose entry block is reserved stays pending.
 */
export function spawnDue(graph: TrackGraph, state: GameState): GameState {
  const { decelMps2, stopMarginM } = graph.level.physics
  let next = state
  for (const entry of heldAtPortal(graph, state)) {
    const step = entryStep(graph, entry.entry)
    if (next.reservations[step.edgeId] !== undefined) continue
    const edge = getEdge(graph, step.edgeId)
    const stopAtM = edge.lengthM - Math.min(STOP_CLEARANCE_M, edge.lengthM / 2)
    const train: Train = {
      id: entry.id,
      name: entry.name,
      maxSpeedMps: entry.maxSpeedMps,
      destination: entry.destination,
      dueAtS: parseClock(entry.dueAt),
      speedMps: Math.min(entry.maxSpeedMps, safeSpeed(stopAtM, decelMps2, stopMarginM)),
      path: [step],
      headM: 0,
      stopAtM,
      arrivedAtS: null,
    }
    next = {
      ...next,
      trains: [...next.trains, train],
      reservations: { ...next.reservations, [step.edgeId]: train.id },
      pending: next.pending.filter((id) => id !== entry.id),
    }
  }
  return next
}

export function scoreArrival(train: Train, arrivedAtS: number, exitedAt: string): TrainResult {
  return {
    trainId: train.id,
    name: train.name,
    arrivedAtS,
    dueAtS: train.dueAtS,
    lateMinutes: Math.max(0, Math.ceil((arrivedAtS - train.dueAtS) / 60)),
    exitedAt,
    reachedDestination: exitedAt === train.destination,
  }
}

export function isLevelComplete(state: GameState): boolean {
  return state.pending.length === 0 && state.trains.length === 0
}
