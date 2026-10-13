import { describe, expect, it } from 'vitest'
import { parseClock } from '../src/engine/clock'
import { canReach, findSteps, requestRoute, STOP_CLEARANCE_M, WRONG_DESTINATION_PENALTY_S } from '../src/engine/routing'
import { createInitialState, step } from '../src/engine/simulation'
import { buildGraph } from '../src/engine/trackGraph'
import type { GameState } from '../src/engine/types'
import { level, route, runUntil } from './helpers'

/** The fixture layout without its local on siding A, so each test controls the whole board. */
const graph = buildGraph({ ...level, startingTrains: [] })

/** T1 has just entered at WEST; nothing else is on the board. */
function withT1(): GameState {
  const state = { ...createInitialState(graph), timeS: parseClock('10:32') - 0.1 }
  return step(graph, state, 0.1)
}

/** T1 stopped mid-M2 and T2 just entered at EAST. */
function withT1AndT2(): GameState {
  let state = route(graph, withT1(), 'T1', { edgeId: 'M2', offsetM: 700 })
  state = runUntil(graph, state, (s) => s.trains.some((t) => t.id === 'T2'))
  return runUntil(graph, state, (s) => s.trains.every((t) => t.speedMps === 0))
}

describe('findSteps', () => {
  const from = { edgeId: 'M1', direction: 1 } as const

  it('prefers the main line through a siding', () => {
    const steps = findSteps(graph, from, { edgeId: 'M3', offsetM: 100 }, new Set())
    expect(steps?.map((s) => s.edgeId)).toEqual(['M2', 'M3'])
  })

  it('takes the siding when the main is blocked', () => {
    const steps = findSteps(graph, from, { edgeId: 'M3', offsetM: 100 }, new Set(['M2']))
    expect(steps?.map((s) => s.edgeId)).toEqual(['SIDING_A', 'M3'])
  })

  it('finds nothing behind the train', () => {
    expect(findSteps(graph, { edgeId: 'M3', direction: 1 }, { edgeId: 'M1', offsetM: 100 }, new Set())).toBeNull()
  })
})

describe('requestRoute', () => {
  it('reserves every edge from the head to the target', () => {
    const state = route(graph, withT1(), 'T1', { edgeId: 'SIDING_B', offsetM: 500 })
    const t1 = state.trains[0]
    expect(t1.path.map((s) => s.edgeId)).toEqual(['M1', 'M2', 'M3', 'SIDING_B'])
    expect(state.reservations).toEqual({ M1: 'T1', M2: 'T1', M3: 'T1', SIDING_B: 'T1' })
    expect(t1.stopAtM).toBeCloseTo(1000 + 1200 + 1600 + 500)
  })

  it('drops reservations the new route no longer needs', () => {
    let state = route(graph, withT1(), 'T1', { edgeId: 'M3', offsetM: 800 })
    state = route(graph, state, 'T1', { edgeId: 'SIDING_A', offsetM: 600 })
    expect(state.reservations).toEqual({ M1: 'T1', SIDING_A: 'T1' })
  })

  it('keeps stop targets clear of the switches at either end of an edge', () => {
    const state = route(graph, withT1(), 'T1', { edgeId: 'M2', offsetM: 1200 })
    expect(state.trains[0].stopAtM).toBeCloseTo(1000 + 1200 - STOP_CLEARANCE_M)
  })

  it('turns a target at the far terminal into an exit', () => {
    const state = route(graph, withT1(), 'T1', { edgeId: 'M5', offsetM: 1000 })
    expect(state.trains[0].stopAtM).toBeNull()
    expect(requestRoute(graph, state, 'T1', { edgeId: 'M3', offsetM: 100 })).toMatchObject({
      ok: false,
      reason: 'departing',
    })
  })

  it('refuses a target behind the head', () => {
    const state = runUntil(graph, withT1(), (s) => s.trains[0].headM > 500)
    expect(requestRoute(graph, state, 'T1', { edgeId: 'M1', offsetM: 100 })).toMatchObject({
      ok: false,
      reason: 'no-path',
    })
  })

  it('refuses a target the train cannot brake for', () => {
    let state = route(graph, withT1(), 'T1', { edgeId: 'M3', offsetM: 800 })
    state = runUntil(graph, state, (s) => s.trains[0].speedMps === 18)
    const head = state.trains[0].headM
    expect(requestRoute(graph, state, 'T1', { edgeId: 'M1', offsetM: head + 50 })).toMatchObject({
      ok: false,
      reason: 'too-close',
    })
    expect(state.trains[0].stopAtM).toBeCloseTo(1000 + 1200 + 800)
  })

  it('routes around an occupied main via the siding', () => {
    const state = route(graph, withT1AndT2(), 'T2', { edgeId: 'M1', offsetM: 500 })
    const t2 = state.trains.find((t) => t.id === 'T2')!
    expect(t2.path.map((s) => s.edgeId)).toEqual(['M5', 'M4', 'M3', 'SIDING_A', 'M1'])
  })

  it('reports who is in the way when there is no free path', () => {
    const state = withT1AndT2()
    expect(requestRoute(graph, state, 'T2', { edgeId: 'M2', offsetM: 900 })).toEqual({
      ok: false,
      reason: 'blocked',
      blockedBy: 'T1',
    })
    expect(requestRoute(graph, state, 'T1', { edgeId: 'M5', offsetM: 1000 })).toMatchObject({
      ok: false,
      reason: 'blocked',
      blockedBy: 'T2',
    })
  })
})

describe('wrong destination', () => {
  it('refuses a route from which the train could only leave by another terminal, and docks 3 minutes', () => {
    // T1 is eastbound but bound for WEST: nothing ahead of it leads there.
    const westBound = buildGraph({
      ...level,
      startingTrains: [],
      schedule: level.schedule.map((e) => (e.id === 'T1' ? { ...e, destination: 'WEST' } : e)),
    })
    const state = step(westBound, { ...createInitialState(westBound), timeS: parseClock('10:32') - 0.1 }, 0.1)
    const result = requestRoute(westBound, state, 'T1', { edgeId: 'M3', offsetM: 100 })
    expect(result).toMatchObject({ ok: false, reason: 'wrong-destination' })
    const before = state.trains.find((t) => t.id === 'T1')!
    const after = !result.ok && result.state!.trains.find((t) => t.id === 'T1')!
    expect(after).toEqual({ ...before, dueAtS: before.dueAtS - WRONG_DESTINATION_PENALTY_S })
  })

  it('knows which terminals a step can still reach', () => {
    expect(canReach(graph, { edgeId: 'M1', direction: 1 }, 'EAST')).toBe(true)
    expect(canReach(graph, { edgeId: 'M1', direction: 1 }, 'WEST')).toBe(false)
    expect(canReach(graph, { edgeId: 'M3', direction: -1 }, 'WEST')).toBe(true)
  })
})
