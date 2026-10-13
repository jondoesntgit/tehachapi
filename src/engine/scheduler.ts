import { parseClock } from './clock'
import { safeSpeed } from './physics'
import { canReach, STOP_CLEARANCE_M } from './routing'
import { getEdge, nextSteps, stepEndNode, type TrackGraph } from './trackGraph'
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
 * This game's times for every scheduled train. With a seed, a train with `appearsBetween` appears
 * at a random whole minute in that window; any other moves by up to `appearsJitterMin` whole
 * minutes either way (never before the level starts). `dueAt` moves with the appearance, so each
 * journey keeps its time allowance. Without a seed, the timetable is as written.
 */
export function buildTimetable(graph: TrackGraph, seed?: number): Record<string, TimetableEntry> {
  const { schedule, appearsJitterMin = 0, startTime } = graph.level
  const random = seed === undefined ? () => 0.5 : seededRandom(seed)
  const startS = parseClock(startTime)
  const timetable: Record<string, TimetableEntry> = {}
  for (const entry of schedule) {
    const nominalS = parseClock(entry.appearsAt)
    let appearsAtS: number
    if (seed === undefined) {
      appearsAtS = nominalS
    } else if (entry.appearsBetween) {
      const [fromS, toS] = entry.appearsBetween.map(parseClock)
      appearsAtS = fromS + Math.floor(random() * ((toS - fromS) / 60 + 1)) * 60
    } else {
      const shiftMin = Math.round((random() * 2 - 1) * appearsJitterMin)
      appearsAtS = Math.max(nominalS + shiftMin * 60, Math.min(nominalS, startS + 60))
    }
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
 * the head `STOP_CLEARANCE_M` short of the far end, waiting for the dispatcher. With a seed, a train
 * with `edgeChoices` stands on a random one of them not already taken; without, on its `edge`.
 */
export function placeStartingTrains(graph: TrackGraph, seed?: number): Pick<GameState, 'trains' | 'reservations'> {
  const { trainLengthM } = graph.level
  // Its own stream, so placing trains doesn't change which times the timetable draws.
  const random = seed === undefined ? null : seededRandom(seed ^ 0x5eed)
  const trains: Train[] = []
  const reservations: Record<string, string> = {}
  for (const start of graph.level.startingTrains ?? []) {
    let edgeId = start.edge
    if (random && start.edgeChoices) {
      const free = start.edgeChoices.filter((id) => reservations[id] === undefined)
      if (free.length === 0) throw new Error(`Starting train "${start.id}" has no free edge to stand on`)
      edgeId = free[Math.floor(random() * free.length)]
    }
    const edge = getEdge(graph, edgeId)
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

/** A work train goes out only when nothing is on the board or due for this long. */
export const WORK_TRAIN_CLEAR_S = 5 * 60
/** Work trains run at this fraction of line speed (the fastest scheduled train's top speed). */
export const WORK_TRAIN_SPEED_FACTOR = 0.5
export const WORK_TRAIN_ID = 'W'

/** Steps from `from` to `destination`, choosing at random at each facing switch among ways that still get there. */
export function randomRoute(graph: TrackGraph, from: RouteStep, destination: string, random: () => number): RouteStep[] {
  const path = [from]
  for (let current = from; stepEndNode(getEdge(graph, current.edgeId), current.direction) !== destination; ) {
    const options = nextSteps(graph, current).filter((step) => canReach(graph, step, destination))
    if (options.length === 0 || path.length > graph.edges.size) break
    current = options[Math.floor(random() * options.length)]
    path.push(current)
  }
  return path
}

/**
 * When the board is empty and no scheduled train is due for `WORK_TRAIN_CLEAR_S`, sends a work train
 * in at a random terminal along a random route out through another, at half line speed. It holds
 * its whole route, so scheduled trains that come up meanwhile may wait at their portal.
 */
export function spawnWorkTrain(graph: TrackGraph, state: GameState): GameState {
  if (!graph.level.workTrains || state.trains.length > 0 || state.pending.length === 0) return state
  const nextS = nextArrivalS(state)
  if (nextS === null || nextS - state.timeS < WORK_TRAIN_CLEAR_S) return state

  const random = seededRandom((state.seed ^ 0x3017) + state.workTrainsSent * 7919)
  const terminals = [...graph.nodes.values()].filter((n) => n.kind === 'terminal').map((n) => n.id)
  const entry = terminals[Math.floor(random() * terminals.length)]
  const first = entryStep(graph, entry)
  const exits = terminals.filter((id) => id !== entry && canReach(graph, first, id))
  if (exits.length === 0) return state
  const destination = exits[Math.floor(random() * exits.length)]
  const path = randomRoute(graph, first, destination, random)

  const lineSpeed = Math.max(...graph.level.schedule.map((e) => e.maxSpeedMps))
  const speedMps = lineSpeed * WORK_TRAIN_SPEED_FACTOR
  const train: Train = {
    id: WORK_TRAIN_ID,
    name: 'Work train',
    maxSpeedMps: speedMps,
    destination,
    dueAtS: state.timeS,
    speedMps,
    path,
    headM: 0,
    stopAtM: null,
    arrivedAtS: null,
    work: true,
  }
  const reservations = { ...state.reservations }
  for (const step of path) reservations[step.edgeId] = WORK_TRAIN_ID
  return { ...state, trains: [...state.trains, train], reservations, workTrainsSent: state.workTrainsSent + 1 }
}

/** 100, less every minute any train was late. */
export function levelScore(results: readonly TrainResult[]): number {
  return 100 - results.reduce((sum, r) => sum + r.lateMinutes, 0)
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
