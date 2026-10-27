import { claim, isFree } from './following'
import { entryStep } from './scheduler'
import { getEdge, nextSteps, stepEndNode, type TrackGraph } from './trackGraph'
import type { Continuation, GameState, RouteStep, Train, TransitEntry } from './types'

/** The line a train carries on along after leaving through `terminal`, if there is one. */
export function continuationFrom(graph: TrackGraph, terminal: string): Continuation | undefined {
  return graph.level.continuations?.find((c) => c.from === terminal)
}

/** Fewest steps from `from` that end at `terminal` (including `from`), or null if it can't be reached. */
export function routeToTerminal(graph: TrackGraph, from: RouteStep, terminal: string): RouteStep[] | null {
  const key = (s: RouteStep) => `${s.edgeId}:${s.direction}`
  const prev = new Map<string, RouteStep | null>([[key(from), null]])
  const queue = [from]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (stepEndNode(getEdge(graph, current.edgeId), current.direction) === terminal) {
      const path: RouteStep[] = []
      for (let s: RouteStep | null = current; s; s = prev.get(key(s)) ?? null) path.unshift(s)
      return path
    }
    for (const next of nextSteps(graph, current)) {
      if (prev.has(key(next))) continue
      prev.set(key(next), current)
      queue.push(next)
    }
  }
  return null
}

/** Queues a train that has just left through a terminal with a continuation. */
export function queueTransit(graph: TrackGraph, train: Train, exitedAt: string, queue: TransitEntry[]): TransitEntry[] {
  const c = continuationFrom(graph, exitedAt)
  if (!c || train.transit) return queue
  const { id, name, maxSpeedMps, destination } = train
  return [...queue, { id, name, maxSpeedMps, destination, to: c.to, exit: c.exit }]
}

/**
 * Brings queued trains onto their continuation, in order, once its entry block is free: each runs
 * itself straight through to the line's exit at its top speed, following any transit train ahead.
 */
export function spawnTransit(graph: TrackGraph, state: GameState): GameState {
  if (state.transitQueue.length === 0) return state
  let { trains, reservations } = state
  const queue: TransitEntry[] = []
  for (const entry of state.transitQueue) {
    const first = entryStep(graph, entry.to)
    const path = routeToTerminal(graph, first, entry.exit)
    if (!path || !isFree({ reservations }, first.edgeId) || trains.some((t) => t.id === entry.id)) {
      queue.push(entry)
      continue
    }
    const train: Train = {
      id: entry.id,
      name: entry.name,
      maxSpeedMps: entry.maxSpeedMps,
      destination: entry.destination,
      dueAtS: state.timeS,
      speedMps: entry.maxSpeedMps,
      path,
      headM: 0,
      stopAtM: null,
      arrivedAtS: null,
      transit: true,
    }
    trains = [...trains, train]
    for (const step of path) reservations = claim(reservations, step.edgeId, train.id)
  }
  return { ...state, trains, reservations, transitQueue: queue }
}
