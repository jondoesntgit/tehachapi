import { claim, followLimitM, heldByOthers, holdersOf, isAheadOn, releaseAll } from './following'
import { brakingDistance } from './physics'
import {
  alongStep,
  getEdge,
  getNode,
  locateStep,
  nextSteps,
  pathLength,
  stepEndNode,
  type TrackGraph,
} from './trackGraph'
import type { GameState, RouteStep, TrackPosition, Train } from './types'

/** Stop targets keep this far from either end of an edge so a stopped train never fouls a switch. */
export const STOP_CLEARANCE_M = 20

export type RouteFailure =
  /** No track leads from the head to the target without reversing. */
  | 'no-path'
  /** Every way there crosses an edge another train holds. */
  | 'blocked'
  /** The train is moving too fast to stop at the target. */
  | 'too-close'
  /** The train's head has already reached the terminal it is leaving by. */
  | 'departing'
  /** From the target the train could only leave through a terminal other than its destination. */
  | 'wrong-destination'

export type RouteResult =
  | { ok: true; state: GameState }
  /** `state` is set when the refusal itself changes the game (a wrong-destination penalty). */
  | { ok: false; reason: RouteFailure; blockedBy?: string; state?: GameState }

/** Asking to send a train where it can't reach its destination moves its due time this much earlier. */
export const WRONG_DESTINATION_PENALTY_S = 3 * 60

/** Whether a train following `step` can still reach `terminalId` without reversing. */
export function canReach(graph: TrackGraph, step: RouteStep, terminalId: string): boolean {
  const seen = new Set<string>()
  const queue = [step]
  while (queue.length > 0) {
    const current = queue.pop()!
    if (seen.has(stepKey(current))) continue
    seen.add(stepKey(current))
    if (stepEndNode(getEdge(graph, current.edgeId), current.direction) === terminalId) return true
    queue.push(...nextSteps(graph, current))
  }
  return false
}

const stepKey = (step: RouteStep) => `${step.edgeId}:${step.direction}`

/**
 * Shortest run of steps that follows `from` and ends on the target's edge, avoiding `blocked`
 * edges. Returns `null` when there is none.
 */
export function findSteps(
  graph: TrackGraph,
  from: RouteStep,
  target: TrackPosition,
  blocked: ReadonlySet<string>,
): RouteStep[] | null {
  // Dijkstra over (edge, direction). `dist` is the distance from the end of `from` to a step's start.
  const dist = new Map<string, number>()
  const prev = new Map<string, RouteStep | null>()
  const open: RouteStep[] = []
  const done = new Set<string>()
  const relax = (step: RouteStep, d: number, via: RouteStep | null) => {
    if (blocked.has(step.edgeId) || d >= (dist.get(stepKey(step)) ?? Infinity)) return
    dist.set(stepKey(step), d)
    prev.set(stepKey(step), via)
    open.push(step)
  }
  for (const step of nextSteps(graph, from)) relax(step, 0, null)

  let best: { end: RouteStep; totalM: number } | null = null
  while (open.length > 0) {
    let nearest = 0
    for (let i = 1; i < open.length; i++) {
      if (dist.get(stepKey(open[i]))! < dist.get(stepKey(open[nearest]))!) nearest = i
    }
    const [current] = open.splice(nearest, 1)
    if (done.has(stepKey(current))) continue
    done.add(stepKey(current))

    const d = dist.get(stepKey(current))!
    const edge = getEdge(graph, current.edgeId)
    if (current.edgeId === target.edgeId) {
      const totalM = d + alongStep(edge, current.direction, target.offsetM)
      if (!best || totalM < best.totalM) best = { end: current, totalM }
    }
    for (const next of nextSteps(graph, current)) relax(next, d + edge.lengthM, current)
  }
  if (!best) return null

  const steps: RouteStep[] = []
  for (let step: RouteStep | null = best.end; step; step = prev.get(stepKey(step)) ?? null) steps.unshift(step)
  return steps
}

/** Whether a train can stop at the far end of `step`'s block without fouling the switch behind it. */
export function hasRoom(graph: TrackGraph, step: RouteStep): boolean {
  const edge = getEdge(graph, step.edgeId)
  if (getNode(graph, stepEndNode(edge, step.direction)).kind === 'terminal') return true
  return edge.lengthM >= graph.level.trainLengthM + 2 * STOP_CLEARANCE_M
}

/**
 * Nearest run of steps after `from` that ends in a block with room for the whole train (see
 * `hasRoom`) and still leads to `destination`, avoiding `blocked` edges. `[]` if `from` already
 * has room; `null` if nothing ahead does.
 */
export function roomAhead(
  graph: TrackGraph,
  from: RouteStep,
  destination: string,
  blocked: ReadonlySet<string>,
): RouteStep[] | null {
  if (hasRoom(graph, from)) return []
  const dist = new Map<string, number>()
  const prev = new Map<string, RouteStep | null>()
  const open: RouteStep[] = []
  const relax = (step: RouteStep, d: number, via: RouteStep | null) => {
    if (blocked.has(step.edgeId) || d >= (dist.get(stepKey(step)) ?? Infinity)) return
    dist.set(stepKey(step), d)
    prev.set(stepKey(step), via)
    open.push(step)
  }
  for (const step of nextSteps(graph, from)) relax(step, getEdge(graph, step.edgeId).lengthM, null)
  while (open.length > 0) {
    open.sort((a, b) => dist.get(stepKey(a))! - dist.get(stepKey(b))!)
    const current = open.shift()!
    if (hasRoom(graph, current) && canReach(graph, current, destination)) {
      const steps: RouteStep[] = []
      for (let step: RouteStep | null = current; step; step = prev.get(stepKey(step)) ?? null) steps.unshift(step)
      return steps
    }
    const d = dist.get(stepKey(current))!
    for (const next of nextSteps(graph, current)) relax(next, d + getEdge(graph, next.edgeId).lengthM, current)
  }
  return null
}

/**
 * Where on `step` the head should stop for a tap anywhere in its block, or whether it should exit.
 * A train pulls up to the far end of the tapped block (short of the switch by the clearance), so the
 * block behind it is left clear. A block that ends at a terminal always has room beyond it, so a
 * train sent into one runs out through the terminal.
 */
function resolveStop(graph: TrackGraph, step: RouteStep): { alongM: number; exit: boolean } {
  const edge = getEdge(graph, step.edgeId)
  if (getNode(graph, stepEndNode(edge, step.direction)).kind === 'terminal') return { alongM: edge.lengthM, exit: true }
  return { alongM: edge.lengthM - Math.min(STOP_CLEARANCE_M, edge.lengthM / 2), exit: false }
}

/** A route a train could be given: its whole new path and where it stops (`null` = exit). */
interface Plan {
  path: RouteStep[]
  stopAtM: number | null
}

/**
 * Why `train` may not take `path` (stopping at `stopAtM`, `null` = exit) alongside the trains that
 * already hold its edges: the id of the first train in the way, or `null` if it may. Track from the
 * head on may be shared only with trains heading the same way that are either
 * - ahead of `train` on `path` (it follows them), as long as `path` doesn't enter the block such a
 *   leader will park in (a leader leaving through a terminal can be followed all the way out), or
 * - behind `train` (they follow it), as long as `train` doesn't park in a block one of them must
 *   pass through.
 * So a follower always parks in a block behind its leader, and nobody cuts in between two trains.
 */
function sharingConflict(
  graph: TrackGraph,
  state: GameState,
  train: Train,
  path: readonly RouteStep[],
  stopAtM: number | null,
): string | null {
  const headIndex = locateStep(graph, path, train.headM).index
  const ahead = path.slice(headIndex)
  const finalEdge = path[path.length - 1].edgeId
  // `train` as it would be on this route, so others can be checked against its tail.
  const routed: Train = { ...train, path: [...path], stopAtM }
  for (const step of ahead) {
    for (const holderId of holdersOf(state, step.edgeId)) {
      if (holderId === train.id) continue
      const other = state.trains.find((t) => t.id === holderId)
      if (!other) return holderId
      const theirs = other.path.find((s) => s.edgeId === step.edgeId)
      if (!theirs || theirs.direction !== step.direction) return holderId
      if (isAheadOn(graph, path, train.headM, other)) {
        // Following: never into the block the leader parks in.
        const leaderParksIn = other.stopAtM === null ? null : other.path[other.path.length - 1].edgeId
        if (leaderParksIn !== null && ahead.some((s) => s.edgeId === leaderParksIn)) return holderId
      } else if (isAheadOn(graph, other.path, other.headM, routed)) {
        // Being followed: never park where the follower has to pass.
        if (stopAtM !== null && other.path.some((s) => s.edgeId === finalEdge)) return holderId
      } else {
        return holderId
      }
    }
  }
  return null
}

/**
 * Asks for a route from a train's head to `target`. On success the train's path, stop point and
 * reservations are replaced from the head onward; edges the train still occupies stay reserved.
 * The shortest allowed way wins, of: the shortest way there; the shortest that keeps out of blocks
 * other trains will park in; and the shortest that avoids other trains' track altogether. Sharing
 * track is allowed only with trains heading the same way (see `sharingConflict`).
 */
export function requestRoute(
  graph: TrackGraph,
  state: GameState,
  trainId: string,
  target: TrackPosition,
): RouteResult {
  const train = state.trains.find((t) => t.id === trainId)
  if (!train) return { ok: false, reason: 'no-path' }
  // A train on its way out can still be rerouted, until its head reaches the terminal.
  if (train.arrivedAtS !== null) return { ok: false, reason: 'departing' }

  const head = locateStep(graph, train.path, train.headM)
  const headStep = train.path[head.index]
  const othersHold = heldByOthers(state, trainId)

  // Never send a train somewhere it could only leave by the wrong terminal; the attempt costs time.
  const wrongDestination = (lastStep: RouteStep): RouteResult | null => {
    if (canReach(graph, lastStep, train.destination)) return null
    const penalized: Train = { ...train, dueAtS: train.dueAtS - WRONG_DESTINATION_PENALTY_S }
    return {
      ok: false,
      reason: 'wrong-destination',
      state: { ...state, trains: state.trains.map((t) => (t.id === trainId ? penalized : t)) },
    }
  }

  const onHeadEdge = target.edgeId === headStep.edgeId ? resolveStop(graph, headStep) : null
  const staysOnHeadEdge = onHeadEdge !== null && onHeadEdge.alongM > head.alongM

  /** The route to the target avoiding `blocked` edges, or null if there is none. */
  const plan = (blocked: ReadonlySet<string>): Plan | null => {
    let steps: RouteStep[] = []
    if (!staysOnHeadEdge) {
      const found = findSteps(graph, headStep, target, blocked)
      if (!found) return null
      steps = found
    }
    // A block too short for the whole train would leave it across a switch: run on to the next one with room.
    const lastTapped = steps.length > 0 ? steps[steps.length - 1] : headStep
    const extension = roomAhead(graph, lastTapped, train.destination, blocked)
    if (!extension) return null
    steps = [...steps, ...extension]
    const path = [...train.path.slice(0, head.index + 1), ...steps]
    const lastStep = path[path.length - 1]
    const stop = steps.length > 0 ? resolveStop(graph, lastStep) : onHeadEdge!
    const lastStartM = pathLength(graph, path) - getEdge(graph, lastStep.edgeId).lengthM
    return { path, stopAtM: stop.exit ? null : lastStartM + stop.alongM }
  }

  if (!staysOnHeadEdge) {
    const unobstructed = findSteps(graph, headStep, target, new Set())
    if (!unobstructed) return { ok: false, reason: 'no-path' }
    const refused = wrongDestination(unobstructed[unobstructed.length - 1])
    if (refused) return refused
  }

  const shared = plan(new Set())
  if (!shared) return { ok: false, reason: 'no-path' }
  // Sharing track, but around any block another train will park in (e.g. by a siding).
  const parkedBlocks = new Set(
    state.trains.filter((t) => t.id !== trainId && t.stopAtM !== null).map((t) => t.path[t.path.length - 1].edgeId),
  )
  const aroundParked = plan(parkedBlocks)
  const alone = plan(othersHold)
  const candidates = [shared, aroundParked, alone]
    .filter((p): p is Plan => p !== null)
    .filter((p) => sharingConflict(graph, state, train, p.path, p.stopAtM) === null)
    .sort((a, b) => pathLength(graph, a.path) - pathLength(graph, b.path))
  if (candidates.length === 0) {
    const blockedBy =
      sharingConflict(graph, state, train, shared.path, shared.stopAtM) ??
      holdersOf(state, shared.path.find((s) => othersHold.has(s.edgeId))?.edgeId ?? '').find((id) => id !== trainId)
    return { ok: false, reason: 'blocked', blockedBy }
  }
  const { path, stopAtM } = candidates[0]

  // It must be able to stop in time: at its own stop, and behind any train it now follows.
  const routed: Train = { ...train, path, stopAtM }
  const limitM = followLimitM(graph, state.trains, routed)
  const mustStopByM = Math.min(stopAtM ?? Infinity, limitM ?? Infinity)
  const decel = graph.level.physics.decelMps2
  if (mustStopByM - train.headM < brakingDistance(train.speedMps, decel)) {
    return { ok: false, reason: 'too-close' }
  }

  let reservations = releaseAll(state.reservations, trainId)
  for (const step of path) reservations = claim(reservations, step.edgeId, trainId)
  return {
    ok: true,
    state: { ...state, reservations, trains: state.trains.map((t) => (t.id === trainId ? routed : t)) },
  }
}

/**
 * Whether `train` has any way forward: a block ahead of its head that holds it, still leads to its
 * destination, and isn't held by another train. Its own block doesn't count, even if it has room.
 */
export function canProgress(graph: TrackGraph, state: GameState, train: Train): boolean {
  if (train.stopAtM === null) return true
  const headStep = train.path[locateStep(graph, train.path, train.headM).index]
  const others = heldByOthers(state, train.id)
  return nextSteps(graph, headStep).some(
    (step) => !others.has(step.edgeId) && roomAhead(graph, step, train.destination, others) !== null,
  )
}

/**
 * Deadlock: every scheduled train has been launched (its entry time has passed, even if it is still
 * held at its portal), and the trains on the board are all stopped with no way forward.
 */
export function isDeadlocked(graph: TrackGraph, state: GameState): boolean {
  const allLaunched = state.pending.every((id) => state.timetable[id].appearsAtS <= state.timeS)
  const board = state.trains
  if (!allLaunched || board.length === 0) return false
  if (board.some((t) => t.speedMps > 0 || t.stopAtM === null)) return false
  return !board.some((t) => canProgress(graph, state, t))
}
