import { describe, expect, it } from 'vitest'
import { parseClock } from '../src/engine/clock'
import { heldAtPortal, isLevelComplete } from '../src/engine/scheduler'
import { createInitialState, skipToNextArrival, step } from '../src/engine/simulation'
import { buildGraph, locateOnPath } from '../src/engine/trackGraph'
import { graph, level, route, runUntil } from './helpers'

const EAST_EXIT = { edgeId: 'M5', offsetM: 1000 }
const WEST_EXIT = { edgeId: 'M1', offsetM: 0 }

describe('simulation', () => {
  it('starts at the level start time with the whole schedule pending', () => {
    const state = createInitialState(graph)
    expect(state.timeS).toBe(parseClock('09:53'))
    expect(state.pending).toEqual(['T1', 'T2', 'T3'])
    expect(state.trains).toEqual([])
  })

  it('skips ahead to just before the next train, but never while trains are on the board', () => {
    const skipped = skipToNextArrival(graph, createInitialState(graph))
    expect(skipped.timeS).toBe(parseClock('10:32') - 10)
    const withTrain = runUntil(graph, skipped, (s) => s.trains.length > 0)
    expect(skipToNextArrival(graph, withTrain)).toBe(withTrain)
  })

  it('brings a train in at its time and holds it short of the first switch', () => {
    let state = skipToNextArrival(graph, createInitialState(graph))
    state = runUntil(graph, state, (s) => s.trains.length > 0)
    expect(state.timeS).toBeCloseTo(parseClock('10:32'), 0)
    expect(state.reservations).toEqual({ M1: 'T1' })

    state = runUntil(graph, state, (s) => s.trains[0].speedMps === 0)
    const t1 = state.trains[0]
    expect(locateOnPath(graph, t1.path, t1.headM)).toEqual({ edgeId: 'M1', offsetM: 980, direction: 1 })
  })

  it('runs a train across the line, releasing track behind it, and scores it on time', () => {
    let state = skipToNextArrival(graph, createInitialState(graph))
    state = runUntil(graph, state, (s) => s.trains.length > 0)
    state = route(graph, state, 'T1', EAST_EXIT)
    expect(Object.keys(state.reservations).sort()).toEqual(['M1', 'M2', 'M3', 'M4', 'M5'])

    // Once the 600 m train's tail is past SW_A2, the track behind it is free again.
    state = runUntil(graph, state, (s) => s.trains[0].path[0].edgeId === 'M3')
    expect(Object.keys(state.reservations).sort()).toEqual(['M3', 'M4', 'M5'])
    const t1 = state.trains[0]
    const headOffsetM = locateOnPath(graph, t1.path, t1.headM).offsetM
    expect(headOffsetM).toBeGreaterThanOrEqual(600)
    expect(headOffsetM).toBeLessThan(602)

    state = runUntil(graph, state, (s) => s.results.length === 1)
    expect(state.trains.some((t) => t.id === 'T1')).toBe(false)
    expect(Object.values(state.reservations)).not.toContain('T1')
    expect(state.results[0]).toMatchObject({
      trainId: 'T1',
      exitedAt: 'EAST',
      reachedDestination: true,
      lateMinutes: 0,
    })
    expect(state.results[0].arrivedAtS).toBeLessThan(parseClock('10:50'))
  })

  it('scores lateness in whole minutes', () => {
    const tight = buildGraph({ ...level, schedule: [{ ...level.schedule[0], dueAt: '10:35' }] })
    let state = skipToNextArrival(tight, createInitialState(tight))
    state = runUntil(tight, state, (s) => s.trains.length > 0)
    state = route(tight, state, 'T1', EAST_EXIT)
    state = runUntil(tight, state, (s) => s.results.length === 1)
    const { arrivedAtS, lateMinutes } = state.results[0]
    expect(lateMinutes).toBe(Math.ceil((arrivedAtS - parseClock('10:35')) / 60))
    expect(lateMinutes).toBeGreaterThan(0)
  })

  it('holds a train off the map while its entry block is occupied', () => {
    // T1 is left sitting on M1, which is also T3's entry block.
    let state = skipToNextArrival(graph, createInitialState(graph))
    state = runUntil(graph, state, (s) => s.timeS >= parseClock('10:42'))
    expect(state.trains.map((t) => t.id).sort()).toEqual(['T1', 'T2'])
    expect(heldAtPortal(graph, state).map((e) => e.id)).toEqual(['T3'])

    // Move T1 into the siding; T3 enters as soon as T1's tail clears M1.
    state = route(graph, state, 'T1', { edgeId: 'SIDING_A', offsetM: 1100 })
    state = runUntil(graph, state, (s) => s.trains.some((t) => t.id === 'T3'))
    expect(state.reservations.M1).toBe('T3')
    expect(heldAtPortal(graph, state)).toEqual([])
  })

  it('completes level 1 with a meet at siding A and a pass at siding B', () => {
    let state = skipToNextArrival(graph, createInitialState(graph))
    const done = (id: string) => (s: typeof state) => s.results.some((r) => r.trainId === id)
    const stopped = (id: string) => (s: typeof state) => s.trains.find((t) => t.id === id)?.speedMps === 0

    // T1 takes siding A to meet westbound T2, which holds the main.
    state = runUntil(graph, state, (s) => s.trains.some((t) => t.id === 'T1'))
    state = route(graph, state, 'T1', { edgeId: 'SIDING_A', offsetM: 1100 })
    state = runUntil(graph, state, (s) => s.trains.some((t) => t.id === 'T2'))
    state = route(graph, state, 'T2', WEST_EXIT)
    state = runUntil(graph, state, (s) => s.reservations.M3 === undefined && stopped('T1')(s))

    // T1 moves up to siding B and waits there for the express to overtake.
    state = route(graph, state, 'T1', { edgeId: 'SIDING_B', offsetM: 1100 })
    state = runUntil(graph, state, done('T2'))
    state = runUntil(graph, state, (s) => s.trains.some((t) => t.id === 'T3'))
    state = runUntil(graph, state, stopped('T1'))
    state = route(graph, state, 'T3', EAST_EXIT)
    state = runUntil(graph, state, done('T3'))
    state = route(graph, state, 'T1', EAST_EXIT)
    state = runUntil(graph, state, isLevelComplete)

    expect(state.results.map((r) => r.trainId)).toEqual(['T2', 'T3', 'T1'])
    expect(state.results.every((r) => r.reachedDestination)).toBe(true)
    expect(state.reservations).toEqual({})
  })

  it('is deterministic', () => {
    const run = () => {
      let state = skipToNextArrival(graph, createInitialState(graph))
      for (let i = 0; i < 3000; i++) state = step(graph, state, 0.1)
      return state
    }
    expect(run()).toEqual(run())
  })
})
