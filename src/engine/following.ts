/**
 * Following: trains heading the same way may share track, one behind another. A follower treats the
 * tail of the nearest train ahead on its path, less `FOLLOW_GAP_M`, as a moving stop target. A leader
 * only ever moves forward, so that target only ever moves away: a follower that can stop for it now
 * can always stop for it later, however fast the follower and however slow the leader. Reading every
 * leader's position before anyone moves in a step keeps the gap from ever shrinking below the margin.
 */
import { alongStep, getEdge, locateOnPath, type TrackGraph } from './trackGraph'
import type { GameState, HeadPosition, RouteStep, Train } from './types'

/** The least gap a follower keeps behind the tail of the train ahead. */
export const FOLLOW_GAP_M = 20

/** Where a train's tail is: `trainLengthM` behind its head (clamped to its path while it enters). */
export function tailPosition(graph: TrackGraph, train: Train): HeadPosition {
  return locateOnPath(graph, train.path, Math.max(0, train.headM - graph.level.trainLengthM))
}

/**
 * Distance along `path` (measured like `headM`) to `pos`, if `pos` lies on `path`, travelling the
 * same way, beyond `fromM`. `null` otherwise.
 */
export function positionOnPath(
  graph: TrackGraph,
  path: readonly RouteStep[],
  pos: HeadPosition,
  fromM: number,
): number | null {
  let startM = 0
  for (const step of path) {
    const edge = getEdge(graph, step.edgeId)
    if (step.edgeId === pos.edgeId && step.direction === pos.direction) {
      const atM = startM + alongStep(edge, step.direction, pos.offsetM)
      if (atM > fromM) return atM
    }
    startM += edge.lengthM
  }
  return null
}

/** Whether `leader`'s tail lies on `path` ahead of `fromM`, travelling the same way. */
export function isAheadOn(graph: TrackGraph, path: readonly RouteStep[], fromM: number, leader: Train): boolean {
  return positionOnPath(graph, path, tailPosition(graph, leader), fromM) !== null
}

/**
 * The furthest `train`'s head may go along its path for now: `FOLLOW_GAP_M` short of the tail of the
 * nearest other train ahead of it on its path. `null` if no train is ahead of it on its path.
 */
export function followLimitM(graph: TrackGraph, trains: readonly Train[], train: Train): number | null {
  let limit: number | null = null
  for (const other of trains) {
    if (other.id === train.id) continue
    const tailM = positionOnPath(graph, train.path, tailPosition(graph, other), train.headM)
    if (tailM !== null && (limit === null || tailM - FOLLOW_GAP_M < limit)) limit = tailM - FOLLOW_GAP_M
  }
  return limit
}

/** Trains holding `edgeId`, in the order they claimed it. */
export function holdersOf(state: Pick<GameState, 'reservations'>, edgeId: string): readonly string[] {
  return state.reservations[edgeId] ?? []
}

/** Whether no train holds `edgeId`. */
export function isFree(state: Pick<GameState, 'reservations'>, edgeId: string): boolean {
  return holdersOf(state, edgeId).length === 0
}

/** Edges any train other than `trainId` holds. */
export function heldByOthers(state: Pick<GameState, 'reservations'>, trainId: string): Set<string> {
  return new Set(Object.keys(state.reservations).filter((edgeId) => holdersOf(state, edgeId).some((id) => id !== trainId)))
}

/** `reservations` with `trainId` added as a holder of `edgeId`. */
export function claim(reservations: Record<string, string[]>, edgeId: string, trainId: string): Record<string, string[]> {
  const holders = reservations[edgeId] ?? []
  return holders.includes(trainId) ? reservations : { ...reservations, [edgeId]: [...holders, trainId] }
}

/** `reservations` with `trainId` no longer holding `edgeId` (dropping the edge once no one holds it). */
export function release(reservations: Record<string, string[]>, edgeId: string, trainId: string): Record<string, string[]> {
  const holders = reservations[edgeId]
  if (!holders?.includes(trainId)) return reservations
  const rest = Object.fromEntries(Object.entries(reservations).filter(([id]) => id !== edgeId))
  const left = holders.filter((id) => id !== trainId)
  return left.length > 0 ? { ...rest, [edgeId]: left } : rest
}

/** `reservations` with `trainId` holding nothing. */
export function releaseAll(reservations: Record<string, string[]>, trainId: string): Record<string, string[]> {
  let next = reservations
  for (const edgeId of Object.keys(reservations)) next = release(next, edgeId, trainId)
  return next
}
