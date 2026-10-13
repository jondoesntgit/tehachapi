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
/** A target this close to a terminal's end of the line means "leave through the terminal". */
export const EXIT_SNAP_M = 1

export type RouteFailure =
  /** No track leads from the head to the target without reversing. */
  | 'no-path'
  /** Every way there crosses an edge another train holds. */
  | 'blocked'
  /** The train is moving too fast to stop at the target. */
  | 'too-close'
  /** The train is already leaving through a terminal. */
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

/** Where on `step` the head should stop for a tap at `offsetM`, or whether it should exit instead. */
function resolveStop(graph: TrackGraph, step: RouteStep, offsetM: number): { alongM: number; exit: boolean } {
  const edge = getEdge(graph, step.edgeId)
  const rawM = alongStep(edge, step.direction, Math.min(edge.lengthM, Math.max(0, offsetM)))
  const endsAtTerminal = getNode(graph, stepEndNode(edge, step.direction)).kind === 'terminal'
  if (endsAtTerminal && rawM >= edge.lengthM - EXIT_SNAP_M) return { alongM: edge.lengthM, exit: true }
  const clearance = Math.min(STOP_CLEARANCE_M, edge.lengthM / 2)
  return { alongM: Math.min(edge.lengthM - clearance, Math.max(clearance, rawM)), exit: false }
}

/**
 * Asks for a route from a train's head to `target`. On success the train's path, stop point and
 * reservations are replaced from the head onward; edges the train still occupies stay reserved.
 */
export function requestRoute(
  graph: TrackGraph,
  state: GameState,
  trainId: string,
  target: TrackPosition,
): RouteResult {
  const train = state.trains.find((t) => t.id === trainId)
  if (!train) return { ok: false, reason: 'no-path' }
  if (train.stopAtM === null) return { ok: false, reason: 'departing' }

  const head = locateStep(graph, train.path, train.headM)
  const headStep = train.path[head.index]
  const heldByOthers = new Set(
    Object.keys(state.reservations).filter((edgeId) => state.reservations[edgeId] !== trainId),
  )

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

  let steps: RouteStep[] = []
  const onHeadEdge = target.edgeId === headStep.edgeId ? resolveStop(graph, headStep, target.offsetM) : null
  if (!onHeadEdge || onHeadEdge.alongM <= head.alongM) {
    const found = findSteps(graph, headStep, target, heldByOthers)
    if (!found) {
      const unobstructed = findSteps(graph, headStep, target, new Set())
      const refused = unobstructed && wrongDestination(unobstructed[unobstructed.length - 1])
      if (refused) return refused
      const blockedEdge = unobstructed?.find((step) => heldByOthers.has(step.edgeId))
      return blockedEdge
        ? { ok: false, reason: 'blocked', blockedBy: state.reservations[blockedEdge.edgeId] }
        : { ok: false, reason: 'no-path' }
    }
    const refused = wrongDestination(found[found.length - 1])
    if (refused) return refused
    steps = found
  }

  const path = [...train.path.slice(0, head.index + 1), ...steps]
  const lastStep = path[path.length - 1]
  const stop = steps.length > 0 ? resolveStop(graph, lastStep, target.offsetM) : onHeadEdge!
  const lastStartM = pathLength(graph, path) - getEdge(graph, lastStep.edgeId).lengthM
  const stopAtM = lastStartM + stop.alongM

  const decel = graph.level.physics.decelMps2
  if (!stop.exit && stopAtM - train.headM < brakingDistance(train.speedMps, decel)) {
    return { ok: false, reason: 'too-close' }
  }

  const reservations: Record<string, string> = {}
  for (const [edgeId, holder] of Object.entries(state.reservations)) {
    if (holder !== trainId) reservations[edgeId] = holder
  }
  for (const step of path) reservations[step.edgeId] = trainId

  const routed: Train = { ...train, path, stopAtM: stop.exit ? null : stopAtM }
  return {
    ok: true,
    state: { ...state, reservations, trains: state.trains.map((t) => (t.id === trainId ? routed : t)) },
  }
}
