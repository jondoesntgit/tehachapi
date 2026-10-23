import { parseClock } from './clock'
import { safeSpeed } from './physics'
import { canReach, STOP_CLEARANCE_M } from './routing'
import { getEdge, locateStep, nextSteps, pathLength, stepEndNode, turnDegrees, type TrackGraph } from './trackGraph'
import { seededRandom } from './random'
import type { Direction, GameState, RouteStep, ScheduleEntry, TimetableEntry, Train, TrainResult } from './types'

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
/**
 * Keeps at least `minTrainsOnBoard` scheduled trains in play (on the board, or due and waiting at
 * their portal). While there are fewer, the earliest pending train whose entry block is free is
 * brought forward to now; its due time moves with it, so it keeps its time allowance.
 */
export function bringTrainsForward(graph: TrackGraph, state: GameState): GameState {
  const min = graph.level.minTrainsOnBoard ?? 0
  const inPlay = state.trains.filter((t) => !t.work).length + heldAtPortal(graph, state).length
  if (inPlay >= min) return state
  const usedEntries = new Set<string>()
  let timetable = state.timetable
  let count = inPlay
  const waiting = state.pending
    .filter((id) => timetable[id].appearsAtS > state.timeS)
    .sort((a, b) => timetable[a].appearsAtS - timetable[b].appearsAtS)
  for (const id of waiting) {
    if (count >= min) break
    const edgeId = entryStep(graph, getScheduleEntry(graph, id).entry).edgeId
    if (state.reservations[edgeId] !== undefined || usedEntries.has(edgeId)) continue
    usedEntries.add(edgeId)
    const { appearsAtS, dueAtS } = timetable[id]
    const earlierS = appearsAtS - state.timeS
    timetable = { ...timetable, [id]: { appearsAtS: state.timeS, dueAtS: dueAtS - earlierS } }
    count++
  }
  return timetable === state.timetable ? state : { ...state, timetable }
}

export function spawnDue(graph: TrackGraph, rawState: GameState): GameState {
  const { decelMps2, stopMarginM } = graph.level.physics
  const state = bringTrainsForward(graph, rawState)
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
 * with `edgeChoices` stands on a random one of them not already taken, facing whichever way reaches
 * its destination (its written `direction` if both do); without, on its `edge` as written.
 */
export function placeStartingTrains(graph: TrackGraph, seed?: number): Pick<GameState, 'trains' | 'reservations'> {
  const { trainLengthM } = graph.level
  // Its own stream, so placing trains doesn't change which times the timetable draws.
  const random = seed === undefined ? null : seededRandom(seed ^ 0x5eed)
  const trains: Train[] = []
  const reservations: Record<string, string> = {}
  for (const start of graph.level.startingTrains ?? []) {
    // Face the train the way that reaches its destination, preferring the written direction.
    const facing = (id: string): Direction | null => {
      for (const direction of [start.direction, -start.direction as Direction]) {
        if (canReach(graph, { edgeId: id, direction }, start.destination)) return direction
      }
      return null
    }
    let edgeId = start.edge
    let direction = start.direction
    if (random && start.edgeChoices) {
      const free = start.edgeChoices.filter((id) => reservations[id] === undefined && facing(id) !== null)
      if (free.length === 0) throw new Error(`Starting train "${start.id}" has no free edge to stand on`)
      edgeId = free[Math.floor(random() * free.length)]
      direction = facing(edgeId)!
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
      path: [{ edgeId: edge.id, direction }],
      headM,
      stopAtM: headM,
      arrivedAtS: null,
    })
    reservations[edge.id] = start.id
  }
  return { trains, reservations }
}

/** A work train goes out only when nothing is on the board or due for this long. */
/** A work train goes out every this many minutes, picked at random each time. */
export const WORK_TRAIN_EVERY_MIN: readonly [number, number] = [10, 20]
/** Work trains run at 7.5 mph. */
export const WORK_TRAIN_SPEED_MPS = 7.5 * 0.44704
/**
 * Work trains never turn through more than this at a node. It keeps them off the acute turn at the
 * bottom of a wye (down one leg and straight back up the other, ~70°), while sidings (~30°) and the
 * turn from a wye leg onto its tail track (~55°) stay open.
 */
export const WORK_TRAIN_MAX_TURN_DEG = 60
/** Map label for every work train; ids are W1, W2, ... so several can run at once. */
export const WORK_TRAIN_LABEL = 'W'

/** Game time the next work train goes out, a random whole minute `WORK_TRAIN_EVERY_MIN` after `fromS`. */
export function nextWorkTrainAt(seed: number, sent: number, fromS: number): number {
  const [min, max] = WORK_TRAIN_EVERY_MIN
  const random = seededRandom((seed ^ 0x77a1) + sent * 6151)
  return fromS + (min + Math.floor(random() * (max - min + 1))) * 60
}

/** Steps a work train may take after `step`: no turn sharper than `WORK_TRAIN_MAX_TURN_DEG`. */
function gentleSteps(graph: TrackGraph, step: RouteStep): RouteStep[] {
  return nextSteps(graph, step).filter((next) => turnDegrees(graph, step, next) <= WORK_TRAIN_MAX_TURN_DEG)
}

/** Whether a work train following `step` can reach `terminalId` without a sharp turn. */
function gentlyReaches(graph: TrackGraph, step: RouteStep, terminalId: string): boolean {
  const seen = new Set<string>()
  const queue = [step]
  while (queue.length > 0) {
    const current = queue.pop()!
    const key = `${current.edgeId}:${current.direction}`
    if (seen.has(key)) continue
    seen.add(key)
    if (stepEndNode(getEdge(graph, current.edgeId), current.direction) === terminalId) return true
    queue.push(...gentleSteps(graph, current))
  }
  return false
}

/**
 * Every 10 to 20 minutes (`state.nextWorkTrainS`), while scheduled trains are still to come, sends a
 * work train in at a random terminal whose entry block is free, bound for another, at
 * `WORK_TRAIN_SPEED_MPS`. If every entry block is held it goes as soon as one frees. It holds only its
 * entry block at first; `extendWorkTrains` grants it one block ahead at a time.
 */
export function spawnWorkTrain(graph: TrackGraph, state: GameState): GameState {
  if (!graph.level.workTrains || state.pending.length === 0 || state.timeS < state.nextWorkTrainS) return state

  const random = seededRandom((state.seed ^ 0x3017) + state.workTrainsSent * 7919)
  const terminals = [...graph.nodes.values()].filter((n) => n.kind === 'terminal').map((n) => n.id)
  const open = terminals.filter((id) => state.reservations[entryStep(graph, id).edgeId] === undefined)
  if (open.length === 0) return state
  const entry = open[Math.floor(random() * open.length)]
  const first = entryStep(graph, entry)
  const exits = terminals.filter((id) => id !== entry && gentlyReaches(graph, first, id))
  if (exits.length === 0) return state

  const id = `W${state.workTrainsSent + 1}`
  const train: Train = {
    id,
    name: 'Work train',
    maxSpeedMps: WORK_TRAIN_SPEED_MPS,
    destination: exits[Math.floor(random() * exits.length)],
    dueAtS: state.timeS,
    speedMps: 0,
    path: [first],
    headM: 0,
    stopAtM: workStop(graph, [first]),
    arrivedAtS: null,
    work: true,
  }
  const sent = state.workTrainsSent + 1
  return {
    ...state,
    trains: [...state.trains, train],
    reservations: { ...state.reservations, [first.edgeId]: id },
    workTrainsSent: sent,
    nextWorkTrainS: nextWorkTrainAt(state.seed, sent, state.timeS),
  }
}

/** Where a work train holding `path` must stop: short of the far switch, or nowhere if it ends at a terminal. */
function workStop(graph: TrackGraph, path: RouteStep[]): number | null {
  const last = path[path.length - 1]
  const edge = getEdge(graph, last.edgeId)
  if (graph.nodes.get(stepEndNode(edge, last.direction))?.kind === 'terminal') return null
  return pathLength(graph, path) - Math.min(STOP_CLEARANCE_M, edge.lengthM / 2)
}

/**
 * A work train holds the block its head is in and the next one. When its head reaches the last block
 * it holds, it takes one more: a random choice among the gentle turns that still reach its
 * destination and aren't held by another train. If none is free it pulls up and waits.
 */
export function extendWorkTrains(graph: TrackGraph, state: GameState): GameState {
  let { trains, reservations } = state
  for (const train of state.trains) {
    if (!train.work || train.dispatched || train.stopAtM === null) continue
    if (locateStep(graph, train.path, train.headM).index < train.path.length - 1) continue
    const last = train.path[train.path.length - 1]
    const options = gentleSteps(graph, last).filter(
      (step) => gentlyReaches(graph, step, train.destination) && (reservations[step.edgeId] ?? train.id) === train.id,
    )
    if (options.length === 0) continue
    const random = seededRandom((state.seed ^ 0x3017) + Number(train.id.slice(1)) * 7919 + train.path.length * 104729)
    const path = [...train.path, options[Math.floor(random() * options.length)]]
    const extended: Train = { ...train, path, stopAtM: workStop(graph, path) }
    trains = trains.map((t) => (t.id === train.id ? extended : t))
    reservations = { ...reservations, [path[path.length - 1].edgeId]: train.id }
  }
  return trains === state.trains ? state : { ...state, trains, reservations }
}

/** Minutes added to the late total when the game ends in a deadlock. */
export const DEADLOCK_PENALTY_MIN = 90

/** Every minute trains were late, plus `DEADLOCK_PENALTY_MIN` if the game ended in a deadlock. */
export function lateTotal(state: Pick<GameState, 'results' | 'deadlocked'>): number {
  return state.results.reduce((sum, r) => sum + r.lateMinutes, 0) + (state.deadlocked ? DEADLOCK_PENALTY_MIN : 0)
}

/** 100, less the late total. */
export function levelScore(state: Pick<GameState, 'results' | 'deadlocked'>): number {
  return 100 - lateTotal(state)
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

/** The game is over: every train is through, or the board deadlocked. */
export function isLevelComplete(state: GameState): boolean {
  // Work trains left running don't hold the game open.
  return state.deadlocked || (state.pending.length === 0 && state.trains.every((t) => t.work))
}
