import { parseClock } from './clock'
import { safeSpeed } from './physics'
import { canReach, STOP_CLEARANCE_M } from './routing'
import { getEdge, nextSteps, stepEndNode, type TrackGraph } from './trackGraph'
import { seededRandom } from './random'
import type { Direction, GameState, RouteStep, ScheduleEntry, TimetableEntry, Train, TrainResult, WorkTrainPlan } from './types'

/** Every train is announced at its entry terminal this long before it enters, with a countdown. */
export const ANNOUNCE_LEAD_S = 10 * 60

/** A train announced at its entry terminal and not on the board yet. */
export interface Announcement {
  /** Schedule entry id, or the work train's id-to-be (W1, W2, ...). */
  id: string
  /** Terminal it enters at. */
  entry: string
  destination: string
  appearsAtS: number
  work: boolean
}

/**
 * Trains announced at their terminals: scheduled and work trains entering within `ANNOUNCE_LEAD_S`
 * (or due and held at their portal). Soonest first.
 */
export function announcedTrains(graph: TrackGraph, state: GameState): Announcement[] {
  const announced: Announcement[] = state.pending
    .filter((id) => state.timetable[id].appearsAtS <= state.timeS + ANNOUNCE_LEAD_S)
    .map((id) => {
      const entry = getScheduleEntry(graph, id)
      return { id, entry: entry.entry, destination: entry.destination, appearsAtS: state.timetable[id].appearsAtS, work: false }
    })
  state.workTimetable.forEach((plan, i) => {
    if (i >= state.workTrainsSent && plan.appearsAtS <= state.timeS + ANNOUNCE_LEAD_S) {
      announced.push({ id: `W${i + 1}`, ...plan, work: true })
    }
  })
  return announced.sort((a, b) => a.appearsAtS - b.appearsAtS)
}

/** The next work train, if its time has come but it is waiting at its portal. */
export function workTrainHeld(state: GameState): boolean {
  const next = state.workTimetable[state.workTrainsSent]
  return next !== undefined && next.appearsAtS <= state.timeS
}

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
 * How many scheduled trains must be in play at `timeS`: `minTrainsOnBoard`, plus one more for every
 * `minTrainsRampEveryMin` minutes since the level started.
 */
export function requiredTrains(graph: TrackGraph, timeS: number): number {
  const { minTrainsOnBoard = 0, minTrainsRampEveryMin, startTime } = graph.level
  if (!minTrainsRampEveryMin) return minTrainsOnBoard
  const elapsedS = Math.max(0, timeS - parseClock(startTime))
  return minTrainsOnBoard + Math.floor(elapsedS / (minTrainsRampEveryMin * 60))
}

/** Length of the shortest way in through `entry` and out through `destination`, or null if none. */
export function shortestCrossingM(graph: TrackGraph, entry: string, destination: string): number | null {
  // Dijkstra over (edge, direction); a step's distance is measured to its far end.
  const first = entryStep(graph, entry)
  const best = new Map<string, number>()
  const queue: { step: RouteStep; distM: number }[] = [{ step: first, distM: getEdge(graph, first.edgeId).lengthM }]
  while (queue.length > 0) {
    queue.sort((a, b) => a.distM - b.distM)
    const { step, distM } = queue.shift()!
    const key = `${step.edgeId}:${step.direction}`
    if (best.has(key)) continue
    best.set(key, distM)
    if (stepEndNode(getEdge(graph, step.edgeId), step.direction) === destination) return distM
    for (const next of nextSteps(graph, step)) queue.push({ step: next, distM: distM + getEdge(graph, next.edgeId).lengthM })
  }
  return null
}

/**
 * The quickest a train could cross the board: from entering until its tail clears its destination,
 * running its shortest way at top speed, plus the time to get up to speed once (it stops at the end
 * of its entry block first).
 */
export function quickestCrossingS(graph: TrackGraph, entry: ScheduleEntry): number {
  const { trainLengthM, physics } = graph.level
  const crossingM = shortestCrossingM(graph, entry.entry, entry.destination) ?? 0
  return (crossingM + trainLengthM) / entry.maxSpeedMps + entry.maxSpeedMps / physics.accelMps2
}

/**
 * Brings scheduled trains forward so that, at every minute of the game, at least `requiredTrains`
 * are in play. A train counts from its announcement (`ANNOUNCE_LEAD_S` before it enters) until the
 * quickest it could have crossed the board (`quickestCrossingS`), as if dispatched perfectly; a
 * starting train counts until it is due out. This runs once, on the timetable, when the game is
 * dealt, so it depends only on the game's code and never on how quickly the player actually clears
 * trains: every player of a code sees the same trains at the same times. A train brought forward enters `ANNOUNCE_LEAD_S` after the
 * minute it is needed, so it still gets its full countdown; its due time moves with it, so it keeps
 * its time allowance.
 */
export function keepTrainsInPlay(
  graph: TrackGraph,
  timetable: Record<string, TimetableEntry>,
): Record<string, TimetableEntry> {
  if (!graph.level.minTrainsOnBoard) return timetable
  const next = { ...timetable }
  const ids = Object.keys(next)
  const crossingS = Object.fromEntries(ids.map((id) => [id, quickestCrossingS(graph, getScheduleEntry(graph, id))]))
  const lastS = Math.max(...ids.map((id) => next[id].appearsAtS))
  const startingDueS = (graph.level.startingTrains ?? []).map((start) => parseClock(start.dueAt))
  for (let t = parseClock(graph.level.startTime); t <= lastS; t += 60) {
    const announceByS = t + ANNOUNCE_LEAD_S
    const inPlay =
      startingDueS.filter((dueS) => dueS > t).length +
      ids.filter((id) => next[id].appearsAtS <= announceByS && next[id].appearsAtS + crossingS[id] > t).length
    const later = ids
      .filter((id) => next[id].appearsAtS > announceByS)
      .sort((a, b) => next[a].appearsAtS - next[b].appearsAtS || ids.indexOf(a) - ids.indexOf(b))
      .slice(0, Math.max(0, requiredTrains(graph, t) - inPlay))
    for (const id of later) {
      const { appearsAtS, dueAtS } = next[id]
      next[id] = { appearsAtS: announceByS, dueAtS: dueAtS - (appearsAtS - announceByS) }
    }
  }
  return next
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

/** A work train goes out every this many minutes (a range would be picked from at random each time). */
export const WORK_TRAIN_EVERY_MIN: readonly [number, number] = [60, 60]
/** Work trains run at 11.25 mph. */
export const WORK_TRAIN_SPEED_MPS = 11.25 * 0.44704
/** A work train is due out this long after it enters; past that it counts as late. */
export const WORK_TRAIN_ALLOWANCE_S = 65 * 60
/** Only one work train on the board at a time; a due one waits until it has gone. */
export const MAX_WORK_TRAINS = 1

/** Map label for every work train; ids are W1, W2, ... */
export const WORK_TRAIN_LABEL = 'W'

/** Game time the next work train goes out, a random whole minute `WORK_TRAIN_EVERY_MIN` after `fromS`. */
export function nextWorkTrainAt(seed: number, sent: number, fromS: number): number {
  const [min, max] = WORK_TRAIN_EVERY_MIN
  const random = seededRandom((seed ^ 0x77a1) + sent * 6151)
  return fromS + (min + Math.floor(random() * (max - min + 1))) * 60
}

/**
 * This game's work trains (levels with `workTrains`), dealt at the start from the seed alone so they
 * are the same for every player of a code: one every 60 minutes (`WORK_TRAIN_EVERY_MIN`) for as
 * long as scheduled trains are still to enter, each at a random terminal, bound for another it can
 * reach from there.
 */
export function buildWorkTimetable(
  graph: TrackGraph,
  seed: number,
  timetable: Record<string, TimetableEntry>,
): WorkTrainPlan[] {
  if (!graph.level.workTrains) return []
  const terminals = [...graph.nodes.values()].filter((n) => n.kind === 'terminal').map((n) => n.id)
  const exitsFrom = (entry: string) => terminals.filter((id) => id !== entry && canReach(graph, entryStep(graph, entry), id))
  const entries = terminals.filter((id) => exitsFrom(id).length > 0)
  if (entries.length === 0) return []
  const lastS = Math.max(...Object.values(timetable).map((e) => e.appearsAtS))
  const plans: WorkTrainPlan[] = []
  for (let atS = nextWorkTrainAt(seed, 0, parseClock(graph.level.startTime)); atS < lastS; ) {
    const random = seededRandom((seed ^ 0x3017) + plans.length * 7919)
    const entry = entries[Math.floor(random() * entries.length)]
    const exits = exitsFrom(entry)
    plans.push({ entry, destination: exits[Math.floor(random() * exits.length)], appearsAtS: atS })
    atS = nextWorkTrainAt(seed, plans.length, atS)
  }
  return plans
}

/**
 * Sends the next work train in once its time has come, its entry block is free and no other work
 * train is on the board (`MAX_WORK_TRAINS`); until then it waits at its portal. It enters at
 * `WORK_TRAIN_SPEED_MPS`, pulls up at the far end of its entry block like a scheduled train and
 * waits for the dispatcher. It is due out `WORK_TRAIN_ALLOWANCE_S` after its timetabled entry, so
 * waiting at the portal counts against the player, as it does for scheduled trains.
 */
export function spawnWorkTrain(graph: TrackGraph, state: GameState): GameState {
  const plan = state.workTimetable[state.workTrainsSent]
  if (!plan || state.timeS < plan.appearsAtS) return state
  if (state.trains.filter((t) => t.work).length >= MAX_WORK_TRAINS) return state
  const first = entryStep(graph, plan.entry)
  if (state.reservations[first.edgeId] !== undefined) return state

  const { decelMps2, stopMarginM } = graph.level.physics
  const edge = getEdge(graph, first.edgeId)
  const stopAtM = edge.lengthM - Math.min(STOP_CLEARANCE_M, edge.lengthM / 2)
  const id = `W${state.workTrainsSent + 1}`
  const train: Train = {
    id,
    name: 'Work train',
    maxSpeedMps: WORK_TRAIN_SPEED_MPS,
    destination: plan.destination,
    dueAtS: plan.appearsAtS + WORK_TRAIN_ALLOWANCE_S,
    speedMps: Math.min(WORK_TRAIN_SPEED_MPS, safeSpeed(stopAtM, decelMps2, stopMarginM)),
    path: [first],
    headM: 0,
    stopAtM,
    arrivedAtS: null,
    work: true,
  }
  const sent = state.workTrainsSent + 1
  return {
    ...state,
    trains: [...state.trains, train],
    reservations: { ...state.reservations, [first.edgeId]: id },
    workTrainsSent: sent,
  }
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

/** The game is over: every train is through, the board deadlocked, or nothing moved for too long. */
export function isLevelComplete(state: GameState): boolean {
  // Work trains left running don't hold the game open.
  return state.deadlocked || state.stalled || (state.pending.length === 0 && state.trains.every((t) => t.work))
}
