import { describe, expect, it } from 'vitest'
import { parseClock } from '../src/engine/clock'
import { heldAtPortal, isLevelComplete, levelScore } from '../src/engine/scheduler'
import { requestRoute } from '../src/engine/routing'
import { createInitialState, skipToNextArrival, step } from '../src/engine/simulation'
import { buildGraph, getEdge, locateOnPath, type TrackGraph } from '../src/engine/trackGraph'
import type { GameState } from '../src/engine/types'
import { graph, level, route, runUntil } from './helpers'

const EAST_EXIT = { edgeId: 'M5', offsetM: 1000 }
const WEST_EXIT = { edgeId: 'M1', offsetM: 0 }

/** Sends the local waiting on siding A out through the west terminal. */
function clearLocal(g: TrackGraph, state: GameState): GameState {
  const routed = route(g, state, 'L1', WEST_EXIT)
  return runUntil(g, routed, (s) => s.results.some((r) => r.trainId === 'L1'))
}

/** The fixture layout with its local cleared away, skipped to just before T1. */
function startAtT1(g: TrackGraph = graph): GameState {
  return skipToNextArrival(clearLocal(g, createInitialState(g)))
}

describe('simulation', () => {
  it('starts at the level start time with the whole schedule pending', () => {
    const state = createInitialState(graph)
    expect(state.timeS).toBe(parseClock('09:53'))
    expect(state.pending).toEqual(['T1', 'T2', 'T3'])
  })

  it('starts with the local standing on siding A, clear of both switches, facing west', () => {
    const state = createInitialState(graph)
    expect(state.trains.map((t) => t.id)).toEqual(['L1'])
    expect(state.reservations).toEqual({ SIDING_A: 'L1' })
    const l1 = state.trains[0]
    expect(l1.speedMps).toBe(0)
    expect(l1.stopAtM).toBe(l1.headM)
    expect(locateOnPath(graph, l1.path, l1.headM)).toEqual({ edgeId: 'SIDING_A', offsetM: 20, direction: -1 })
    const tail = locateOnPath(graph, l1.path, l1.headM - level.trainLengthM)
    expect(tail.edgeId).toBe('SIDING_A')
    expect(tail.offsetM).toBeLessThanOrEqual(getEdge(graph, 'SIDING_A').lengthM - 20)

    // It stays put until dispatched.
    const later = runUntil(graph, state, (s) => s.timeS >= parseClock('10:00'))
    expect(later.trains[0]).toEqual(l1)
  })

  it('sends the local home on time', () => {
    const state = clearLocal(graph, createInitialState(graph))
    expect(state.results).toEqual([expect.objectContaining({ trainId: 'L1', exitedAt: 'WEST', lateMinutes: 0 })])
    expect(state.reservations).toEqual({})
  })

  it('rejects starting trains that do not fit, share an edge, or reuse an id', () => {
    const local = level.startingTrains![0]
    const withTrains = (startingTrains: typeof level.startingTrains) => () =>
      createInitialState(buildGraph({ ...level, startingTrains }))
    expect(() => createInitialState(buildGraph({ ...level, trainLengthM: 1200 }))).toThrow(/does not fit/)
    expect(withTrains([local, { ...local, id: 'L2' }])).toThrow(/share edge/)
    expect(withTrains([{ ...local, id: 'T1' }])).toThrow(/Duplicate train id/)
    expect(withTrains([{ ...local, edge: 'NOPE' }])).toThrow(/unknown edge/)
    expect(withTrains([{ ...local, destination: 'SW_A1' }])).toThrow(/not a terminal/)
  })

  it('skips ahead to just before the next train, but never while trains are on the board', () => {
    const initial = createInitialState(graph)
    expect(skipToNextArrival(initial)).toBe(initial)
    const skipped = startAtT1()
    expect(skipped.timeS).toBe(parseClock('10:32') - 10)
    const withTrain = runUntil(graph, skipped, (s) => s.trains.length > 0)
    expect(skipToNextArrival(withTrain)).toBe(withTrain)
  })

  it('brings a train in at its time and holds it short of the first switch', () => {
    let state = startAtT1()
    state = runUntil(graph, state, (s) => s.trains.length > 0)
    expect(state.timeS).toBeCloseTo(parseClock('10:32'), 0)
    expect(state.reservations).toEqual({ M1: 'T1' })

    state = runUntil(graph, state, (s) => s.trains[0].speedMps === 0)
    const t1 = state.trains[0]
    expect(locateOnPath(graph, t1.path, t1.headM)).toEqual({ edgeId: 'M1', offsetM: 980, direction: 1 })
  })

  it('runs a train across the line, releasing track behind it, and scores it on time', () => {
    let state = startAtT1()
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

    state = runUntil(graph, state, (s) => s.results.length === 2)
    expect(state.trains.some((t) => t.id === 'T1')).toBe(false)
    expect(Object.values(state.reservations)).not.toContain('T1')
    expect(state.results[1]).toMatchObject({
      trainId: 'T1',
      exitedAt: 'EAST',
      reachedDestination: true,
      lateMinutes: 0,
    })
    expect(state.results[1].arrivedAtS).toBeLessThan(parseClock('10:50'))
  })

  it('scores lateness in whole minutes', () => {
    const tight = buildGraph({ ...level, schedule: [{ ...level.schedule[0], dueAt: '10:35' }] })
    let state = startAtT1(tight)
    state = runUntil(tight, state, (s) => s.trains.length > 0)
    state = route(tight, state, 'T1', EAST_EXIT)
    state = runUntil(tight, state, (s) => s.results.length === 2)
    const { arrivedAtS, lateMinutes } = state.results[1]
    expect(lateMinutes).toBe(Math.ceil((arrivedAtS - parseClock('10:35')) / 60))
    expect(lateMinutes).toBeGreaterThan(0)
  })

  it('holds a train off the map while its entry block is occupied', () => {
    // T1 is left sitting on M1, which is also T3's entry block.
    let state = startAtT1()
    state = runUntil(graph, state, (s) => s.timeS >= parseClock('10:42'))
    expect(state.trains.map((t) => t.id).sort()).toEqual(['T1', 'T2'])
    expect(heldAtPortal(graph, state).map((e) => e.id)).toEqual(['T3'])

    // Move T1 into the siding; T3 enters as soon as T1's tail clears M1.
    state = route(graph, state, 'T1', { edgeId: 'SIDING_A', offsetM: 1100 })
    state = runUntil(graph, state, (s) => s.trains.some((t) => t.id === 'T3'))
    expect(state.reservations.M1).toBe('T3')
    expect(heldAtPortal(graph, state)).toEqual([])
  })

  it('plays the layout through: the local goes home, then a meet at siding A and a pass at siding B', () => {
    let state = startAtT1()
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

    expect(state.results.map((r) => r.trainId)).toEqual(['L1', 'T2', 'T3', 'T1'])
    expect(state.results.every((r) => r.reachedDestination)).toBe(true)
    expect(state.reservations).toEqual({})
  })

  it('is deterministic', () => {
    const run = () => {
      let state = startAtT1()
      for (let i = 0; i < 3000; i++) state = step(graph, state, 0.1)
      return state
    }
    expect(run()).toEqual(run())
  })
})

describe('work trains', () => {
  // The fixture with work trains on and nothing on the board until T1 at 10:32.
  const quiet = buildGraph({ ...level, workTrains: true, startingTrains: [] })
  const workTrain = (s: GameState) => s.trains.find((t) => t.work)

  it('sends a work train, labelled W, at half line speed, when nothing is due for 5 minutes', () => {
    const state = step(quiet, createInitialState(quiet, 1), 0.1)
    const w = workTrain(state)!
    expect(w).toMatchObject({ id: 'W', name: 'Work train', stopAtM: null })
    expect(w.maxSpeedMps).toBe(Math.max(...level.schedule.map((e) => e.maxSpeedMps)) / 2)
    expect(Object.values(state.reservations).every((holder) => holder === 'W')).toBe(true)
    expect(state.workTrainsSent).toBe(1)
  })

  it('runs out through a terminal on its own and is not scored', () => {
    let state = step(quiet, createInitialState(quiet, 1), 0.1)
    expect(requestRoute(quiet, state, 'W', { edgeId: 'M3', offsetM: 100 })).toMatchObject({ reason: 'departing' })
    state = runUntil(quiet, state, (s) => !workTrain(s))
    expect(state.results).toEqual([])
    expect(Object.values(state.reservations)).not.toContain('W')
  })

  it('stays away when a scheduled train is due within 5 minutes or a train is on the board', () => {
    const soon = { ...createInitialState(quiet, 1), timeS: parseClock('10:32') - 4 * 60 }
    expect(workTrain(step(quiet, soon, 0.1))).toBeUndefined()
    expect(step(graph, createInitialState(graph, 1), 0.1).trains.some((t) => t.work)).toBe(false)
  })

  it('is cleared away by skipping to the next train', () => {
    const state = step(quiet, createInitialState(quiet, 1), 0.1)
    const skipped = skipToNextArrival(state)
    expect(skipped.trains).toEqual([])
    expect(skipped.reservations).toEqual({})
    expect(skipped.timeS).toBe(parseClock('10:32') - 10)
  })
})

describe('levelScore', () => {
  it('is 100 less every minute trains were late', () => {
    const result = (lateMinutes: number) => ({
      trainId: 'X', name: 'X', arrivedAtS: 0, dueAtS: 0, lateMinutes, exitedAt: 'EAST', reachedDestination: true,
    })
    expect(levelScore([])).toBe(100)
    expect(levelScore([result(0), result(4), result(7)])).toBe(89)
  })
})
