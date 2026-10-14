import { describe, expect, it } from 'vitest'
import { parseClock } from '../src/engine/clock'
import { heldAtPortal, isLevelComplete, lateTotal, levelScore } from '../src/engine/scheduler'
import { isDeadlocked, requestRoute } from '../src/engine/routing'
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

  it('sends a work train, labelled W, at 15 mph, when nothing is due for 5 minutes', () => {
    const state = step(quiet, createInitialState(quiet, 1), 0.1)
    const w = workTrain(state)!
    expect(w).toMatchObject({ id: 'W', name: 'Work train' })
    expect(w.maxSpeedMps).toBeCloseTo(6.7056)
    expect(state.workTrainsSent).toBe(1)
  })

  it('holds only the block its head is in and the next one, beyond the track under its body', () => {
    let state = step(quiet, createInitialState(quiet, 1), 0.1)
    // Until T1 turns up at 10:32 and, undispatched, sits in its way.
    while (workTrain(state) && state.timeS < parseClock('10:30')) {
      const w = workTrain(state)!
      const head = locateOnPath(quiet, w.path, w.headM)
      const ahead = w.path.slice(w.path.findIndex((s) => s.edgeId === head.edgeId))
      expect(ahead.length).toBeLessThanOrEqual(2)
      expect(Object.keys(state.reservations).filter((id) => state.reservations[id] === 'W').sort()).toEqual(
        [...new Set(w.path.map((s) => s.edgeId))].sort(),
      )
      state = step(quiet, state, 0.1)
    }
  })

  it("runs out through a terminal on its own, can't be dispatched, and is not scored", () => {
    let state = step(quiet, createInitialState(quiet, 1), 0.1)
    expect(requestRoute(quiet, state, 'W', { edgeId: 'M3', offsetM: 100 })).toMatchObject({ reason: 'work-train' })
    state = runUntil(quiet, state, (s) => !workTrain(s))
    expect(state.results).toEqual([])
    expect(Object.values(state.reservations)).not.toContain('W')
  })

  it('waits for a block held by another train, then carries on', () => {
    const state = step(quiet, createInitialState(quiet, 1), 0.1)
    const w = workTrain(state)!
    // Hold every block it could take next with a phantom train.
    const next = w.path[0].edgeId === 'M1' ? ['M2', 'SIDING_A'] : ['M4', 'SIDING_B']
    const held = { ...state, reservations: { ...state.reservations, ...Object.fromEntries(next.map((id) => [id, 'X'])) } }
    const waiting = runUntil(quiet, held, (s) => workTrain(s)!.speedMps === 0 && workTrain(s)!.headM > 100)
    expect(workTrain(waiting)!.path).toHaveLength(1)
    const released = {
      ...waiting,
      reservations: Object.fromEntries(Object.entries(waiting.reservations).filter(([, holder]) => holder !== 'X')),
    }
    const moving = runUntil(quiet, released, (s) => workTrain(s)!.path.length > 1)
    expect(workTrain(moving)!.path).toHaveLength(2)
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
  const result = (lateMinutes: number) => ({
    trainId: 'X', name: 'X', arrivedAtS: 0, dueAtS: 0, lateMinutes, exitedAt: 'EAST', reachedDestination: true,
  })

  it('is 100 less every minute trains were late', () => {
    expect(levelScore({ results: [], deadlocked: false })).toBe(100)
    expect(levelScore({ results: [result(0), result(4), result(7)], deadlocked: false })).toBe(89)
  })

  it('adds 90 minutes to the late total for a deadlock', () => {
    expect(lateTotal({ results: [result(4)], deadlocked: true })).toBe(94)
    expect(levelScore({ results: [result(4)], deadlocked: true })).toBe(6)
  })
})

describe('deadlock', () => {
  // Plain single track, three blocks: two trains meeting head on can't pass.
  const single = buildGraph({
    ...level,
    trainLengthM: 400,
    startingTrains: [],
    nodes: [
      { id: 'WEST', x: 0, y: 0, kind: 'terminal' },
      { id: 'A', x: 1000, y: 0, kind: 'switch' },
      { id: 'B', x: 2000, y: 0, kind: 'switch' },
      { id: 'EAST', x: 3000, y: 0, kind: 'terminal' },
    ],
    edges: [
      { id: 'M1', from: 'WEST', to: 'A' },
      { id: 'M2', from: 'A', to: 'B' },
      { id: 'M3', from: 'B', to: 'EAST' },
    ],
    schedule: [
      { id: 'T1', name: 'East', appearsAt: '10:00', entry: 'WEST', maxSpeedMps: 15, destination: 'EAST', dueAt: '10:20' },
      { id: 'T2', name: 'West', appearsAt: '10:01', entry: 'EAST', maxSpeedMps: 15, destination: 'WEST', dueAt: '10:20' },
    ],
  })
  const has = (id: string) => (s: GameState) => s.trains.some((t) => t.id === id)
  const allStopped = (s: GameState) => s.trains.length === 2 && s.trains.every((t) => t.speedMps === 0)

  it('ends the game when every train is launched and they block each other for good', () => {
    let state = runUntil(single, createInitialState(single), has('T1'))
    state = route(single, state, 'T1', { edgeId: 'M2', offsetM: 500 })
    state = runUntil(single, state, (s) => has('T2')(s) && allStopped(s) || s.deadlocked)
    expect(state.deadlocked).toBe(true)
    expect(isLevelComplete(state)).toBe(true)
    expect(levelScore(state)).toBe(100 - 90)
    // The game stands still from here.
    expect(step(single, state, 0.1)).toBe(state)
  })

  it('does not call it a deadlock while a train still has a way forward', () => {
    let state = runUntil(single, createInitialState(single), has('T2'))
    state = runUntil(single, state, allStopped)
    // T1 and T2 face each other across the empty M2: either could move into it.
    expect(isDeadlocked(single, state)).toBe(false)
    expect(state.deadlocked).toBe(false)
  })

  it('waits until every train has been launched', () => {
    const later = buildGraph({ ...single.level, schedule: [...single.level.schedule, { ...single.level.schedule[0], id: 'T3', appearsAt: '11:00', dueAt: '11:20' }] })
    let state = runUntil(later, createInitialState(later), has('T1'))
    state = route(later, state, 'T1', { edgeId: 'M2', offsetM: 500 })
    state = runUntil(later, state, (s) => has('T2')(s) && allStopped(s))
    expect(state.deadlocked).toBe(false)
    // T3 enters at 11:00 and stops behind T1; with every train launched, that's a deadlock.
    state = runUntil(later, state, (s) => s.deadlocked)
    expect(state.timeS).toBeGreaterThanOrEqual(parseClock('11:00'))
  })
})
