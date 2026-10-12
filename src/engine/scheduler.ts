import { parseClock } from './clock'
import { safeSpeed } from './physics'
import { STOP_CLEARANCE_M } from './routing'
import { getEdge, type TrackGraph } from './trackGraph'
import { seededRandom } from './random'
import type { GameState, RouteStep, ScheduleEntry, TimetableEntry, Train, TrainResult } from './types'

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

/**
 * This game's times for every scheduled train. With a seed, each `appearsAt` moves by up to
 * `appearsJitterMin` whole minutes either way (never before the level starts) and `dueAt` moves
 * with it, so each journey keeps its time allowance. Without a seed, the timetable is as written.
 */
export function buildTimetable(graph: TrackGraph, seed?: number): Record<string, TimetableEntry> {
  const { schedule, appearsJitterMin = 0, startTime } = graph.level
  const random = seed === undefined ? () => 0.5 : seededRandom(seed)
  const startS = parseClock(startTime)
  const timetable: Record<string, TimetableEntry> = {}
  for (const entry of schedule) {
    const nominalS = parseClock(entry.appearsAt)
    const shiftMin = Math.round((random() * 2 - 1) * appearsJitterMin)
    const appearsAtS = Math.max(nominalS + shiftMin * 60, Math.min(nominalS, startS + 60))
    timetable[entry.id] = { appearsAtS, dueAtS: parseClock(entry.dueAt) + appearsAtS - nominalS }
  }
  return timetable
}

/** Schedule entries whose time has come but whose entry block is still occupied. */
export function heldAtPortal(graph: TrackGraph, state: GameState): ScheduleEntry[] {
  return state.pending
    .map((id) => getScheduleEntry(graph, id))
    .filter((entry) => state.timetable[entry.id].appearsAtS <= state.timeS)
}

/** Earliest appearance among entries that are not due yet. */
export function nextArrivalS(state: GameState): number | null {
  const times = state.pending
    .map((id) => state.timetable[id].appearsAtS)
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
      dueAtS: next.timetable[entry.id].dueAtS,
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

/**
 * Trains already standing on the track at the start of the level, each held on its own edge with
 * the head `STOP_CLEARANCE_M` short of the far end, waiting for the dispatcher.
 */
export function placeStartingTrains(graph: TrackGraph): Pick<GameState, 'trains' | 'reservations'> {
  const { trainLengthM } = graph.level
  const trains: Train[] = []
  const reservations: Record<string, string> = {}
  for (const start of graph.level.startingTrains ?? []) {
    const edge = getEdge(graph, start.edge)
    if (reservations[edge.id] !== undefined) {
      throw new Error(`Starting trains "${reservations[edge.id]}" and "${start.id}" share edge "${edge.id}"`)
    }
    if (edge.lengthM < trainLengthM + 2 * STOP_CLEARANCE_M) {
      throw new Error(`Starting train "${start.id}" does not fit clear of the switches on edge "${edge.id}"`)
    }
    const headM = edge.lengthM - STOP_CLEARANCE_M
    trains.push({
      id: start.id,
      name: start.name,
      maxSpeedMps: start.maxSpeedMps,
      destination: start.destination,
      dueAtS: parseClock(start.dueAt),
      speedMps: 0,
      path: [{ edgeId: edge.id, direction: start.direction }],
      headM,
      stopAtM: headM,
      arrivedAtS: null,
    })
    reservations[edge.id] = start.id
  }
  return { trains, reservations }
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
