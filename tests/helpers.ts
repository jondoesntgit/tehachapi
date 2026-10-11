import level01 from '../levels/level-01.json'
import { requestRoute } from '../src/engine/routing'
import { FIXED_DT_S, step } from '../src/engine/simulation'
import { buildGraph, type TrackGraph } from '../src/engine/trackGraph'
import type { GameState, Level, TrackPosition } from '../src/engine/types'

export const level = level01 as Level
export const graph = buildGraph(level)

/** Steps until `done` holds; fails the test if it never does within `maxGameS`. */
export function runUntil(
  g: TrackGraph,
  state: GameState,
  done: (s: GameState) => boolean,
  maxGameS = 3 * 3600,
): GameState {
  let s = state
  for (let i = 0; i < maxGameS / FIXED_DT_S; i++) {
    if (done(s)) return s
    s = step(g, s, FIXED_DT_S)
  }
  throw new Error('runUntil: condition never became true')
}

export function route(g: TrackGraph, state: GameState, trainId: string, target: TrackPosition): GameState {
  const result = requestRoute(g, state, trainId, target)
  if (!result.ok) throw new Error(`Route refused: ${result.reason}`)
  return result.state
}
