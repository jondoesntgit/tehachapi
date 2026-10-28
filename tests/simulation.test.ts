import { describe, expect, it } from 'vitest'
import { parseClock } from '../src/engine/clock'
import { announcedTrains, ANNOUNCE_LEAD_S, earlyTotal, entryStep, heldAtPortal, isLevelComplete, lateTotal, levelScore, pageSpans, workTrainHeld } from '../src/engine/scheduler'
import { canReach, isDeadlocked, requestRoute } from '../src/engine/routing'
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
    expect(state.reservations).toEqual({ SIDING_A: ['L1'] })
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
    expect(state.reservations).toEqual({ M1: ['T1'] })

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
    expect(Object.values(state.reservations).flat()).not.toContain('T1')
    expect(state.results[1]).toMatchObject({
      trainId: 'T1',
      exitedAt: 'EAST',
      reachedDestination: true,
      lateMinutes: 0,
    })
    expect(state.results[1].arrivedAtS).toBeLessThan(parseClock('10:50'))
    // Early by whole minutes, rounded down.
    expect(state.results[1].earlyMinutes).toBe(Math.floor((parseClock('10:50') - state.results[1].arrivedAtS) / 60))
    expect(state.results[1].earlyMinutes).toBeGreaterThan(0)
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
    expect(state.reservations.M1).toEqual(['T3'])
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
  // The fixture with work trains on, no siding for one to start on, and no traffic until 14:00, so
  // nothing gets in a work train's way and they keep coming for a few hours.
  const roomy = buildGraph({
    ...level,
    workTrains: true,
    startingTrains: [],
    schedule: [{ ...level.schedule[0], appearsAt: '14:00', dueAt: '14:20' }],
  })
  const workTrains = (s: GameState) => s.trains.filter((t) => t.work)
  const startS = parseClock(level.startTime)
  /** Runs until the first work train is on the board. */
  const firstWorkTrain = (g: TrackGraph, seed = 1) => runUntil(g, createInitialState(g, seed), (s) => workTrains(s).length > 0)
  const exitOf = (terminal: string) => (terminal === 'EAST' ? { edgeId: 'M5', offsetM: 1000 } : { edgeId: 'M1', offsetM: 0 })

  it('starts W1 on a free siding, due out 65 minutes after the start', () => {
    // L1 stands on siding A; siding B is free.
    const withSiding = buildGraph({ ...level, workTrains: true, sidings: ['SIDING_A', 'SIDING_B'] })
    for (let seed = 0; seed < 20; seed++) {
      const state = createInitialState(withSiding, seed)
      const w = workTrains(state)
      expect(w).toHaveLength(1)
      expect(w[0]).toMatchObject({ id: 'W1', name: 'Work train', speedMps: 0, dueAtS: startS + 65 * 60 })
      expect(w[0].maxSpeedMps).toBeCloseTo(5.0292)
      expect(w[0].path).toHaveLength(1)
      expect(w[0].path[0].edgeId).toBe('SIDING_B')
      expect(canReach(withSiding, w[0].path[0], w[0].destination)).toBe(true)
      expect(state.reservations.SIDING_B).toEqual(['W1'])
      expect(w[0].stopAtM).toBe(w[0].headM)
    }
  })

  it('leaves W1 out when no siding is free', () => {
    const taken = buildGraph({ ...level, workTrains: true, sidings: ['SIDING_A'] })
    expect(workTrains(createInitialState(taken, 1))).toEqual([])
  })

  it('sends each later work train in 10 minutes after the one before is due out', () => {
    const { workTimetable } = createInitialState(roomy, 1)
    // W1 is due 65 minutes in, so W2 enters 75 minutes in, W3 75 minutes after that, and so on.
    expect(workTimetable.map((w) => w.id)).toEqual(['W2', 'W3', 'W4'])
    workTimetable.forEach((w, i) => expect(w.appearsAtS).toBe(startS + (i + 1) * 75 * 60))
  })

  it('sends a work train in at its terminal at 11.25 mph', () => {
    for (let seed = 0; seed < 20; seed++) {
      const state = firstWorkTrain(roomy, seed)
      const w = workTrains(state)[0]
      expect(w).toMatchObject({ id: 'W2', name: 'Work train' })
      expect(w.maxSpeedMps).toBeCloseTo(5.0292)
      expect(state.timeS - startS).toBeGreaterThanOrEqual(75 * 60)
      expect(state.timeS - startS).toBeLessThanOrEqual(75 * 60 + 1)
    }
  })

  it('pulls up at the end of its entry block and waits there, claiming nothing beyond it', () => {
    const state = firstWorkTrain(roomy)
    const w = workTrains(state)[0]
    const waiting = runUntil(roomy, state, (s) => s.trains.find((t) => t.id === w.id)!.speedMps === 0)
    const later = runUntil(roomy, waiting, (s) => s.timeS >= waiting.timeS + 15 * 60)
    const still = later.trains.find((t) => t.id === w.id)!
    expect(still.path).toEqual([w.path[0]])
    expect(still.headM).toBe(waiting.trains.find((t) => t.id === w.id)!.headM)
    expect(Object.keys(later.reservations).filter((e) => later.reservations[e].includes(w.id))).toEqual([w.path[0].edgeId])
  })

  it('is due out 65 minutes after it enters, and is scored like any train', () => {
    let state = firstWorkTrain(roomy)
    const w = workTrains(state)[0]
    // Due 65 minutes after its timetabled entry.
    expect(w.dueAtS).toBe(state.workTimetable[0].appearsAtS + 65 * 60)
    state = route(roomy, state, w.id, exitOf(w.destination))
    state = runUntil(roomy, state, (s) => !s.trains.some((t) => t.id === w.id))
    expect(state.results).toEqual([expect.objectContaining({ trainId: w.id, exitedAt: w.destination, lateMinutes: 0 })])
    expect(Object.values(state.reservations).flat()).not.toContain(w.id)
  })

  it('keeps only one on the board; the next waits until it has gone', () => {
    let state = firstWorkTrain(roomy)
    const w2 = workTrains(state)[0]
    // Left waiting past W3's time, W2 stops it from coming in, however long it stands.
    state = runUntil(roomy, state, (s) => s.timeS >= state.timeS + 90 * 60)
    expect(workTrains(state).map((t) => t.id)).toEqual(['W2'])
    // Once it has gone, W3 follows.
    state = route(roomy, state, w2.id, exitOf(w2.destination))
    state = runUntil(roomy, state, (s) => !s.trains.some((t) => t.id === 'W2'))
    state = runUntil(roomy, state, (s) => workTrains(s).length > 0)
    expect(workTrains(state).map((t) => t.id)).toEqual(['W3'])
  })

  it('stops coming once every scheduled train has entered, and never holds the game open', () => {
    // A level whose only scheduled train enters at 10:15.
    const one = buildGraph({ ...roomy.level, schedule: [{ ...level.schedule[0], appearsAt: '10:15', dueAt: '10:45' }] })
    // Send any work train on its way, as a dispatcher would, so it isn't in T1's way.
    const sendWorkTrains = (st: GameState) =>
      workTrains(st).reduce((acc, w) => {
        const r = requestRoute(one, acc, w.id, exitOf(w.destination))
        return r.ok ? r.state : acc
      }, st)
    let state = createInitialState(one, 1)
    while (!state.trains.some((t) => t.id === 'T1')) state = sendWorkTrains(step(one, state, 0.1))
    const sent = state.workTrainsSent
    const exit = { edgeId: 'M5', offsetM: 900 }
    while (!requestRoute(one, state, 'T1', exit).ok) state = sendWorkTrains(step(one, state, 0.1))
    state = route(one, state, 'T1', exit)
    state = runUntil(one, state, (s) => s.results.some((r) => r.trainId === 'T1'))
    expect(isLevelComplete(state)).toBe(true)
    const later = runUntil(one, state, (s) => s.timeS >= state.timeS + 40 * 60)
    expect(later.workTrainsSent).toBe(sent)
  })

  it('is cleared away by skipping to the next train', () => {
    const state = firstWorkTrain(roomy)
    const skipped = skipToNextArrival(state)
    expect(skipped.trains).toEqual([])
    expect(skipped.reservations).toEqual({})
    expect(skipped.timeS).toBe(parseClock('14:00') - 10)
  })
})

describe('announcements', () => {
  it('announces a scheduled train at its entry terminal 10 minutes before it enters', () => {
    const t1S = parseClock('10:32')
    const before = runUntil(graph, createInitialState(graph), (s) => s.timeS >= t1S - ANNOUNCE_LEAD_S - 1)
    expect(announcedTrains(graph, before).map((a) => a.id)).not.toContain('T1')
    const announced = runUntil(graph, before, (s) => s.timeS >= t1S - ANNOUNCE_LEAD_S)
    expect(announcedTrains(graph, announced)).toContainEqual({
      id: 'T1', entry: 'WEST', destination: level.schedule[0].destination, appearsAtS: t1S, work: false,
    })
    // It stays announced until it is on the board.
    const entered = runUntil(graph, announced, (s) => s.trains.some((t) => t.id === 'T1'))
    expect(announcedTrains(graph, entered).map((a) => a.id)).not.toContain('T1')
  })

  it('lists the soonest first', () => {
    const state = runUntil(graph, createInitialState(graph), (s) => s.timeS >= parseClock('10:35'))
    const times = announcedTrains(graph, state).map((a) => a.appearsAtS)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe('work train announcements', () => {
  const roomy = buildGraph({
    ...level,
    workTrains: true,
    startingTrains: [],
    schedule: [{ ...level.schedule[0], appearsAt: '12:00', dueAt: '12:20' }],
  })
  const due = (seed = 1) => {
    const state = createInitialState(roomy, seed)
    const plan = state.workTimetable[0]
    return { plan, state: runUntil(roomy, state, (s) => s.timeS >= plan.appearsAtS - ANNOUNCE_LEAD_S) }
  }

  it('announces each work train 10 minutes ahead, then sends it in where and when announced', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { plan, state } = due(seed)
      expect(plan.id).toBe('W2')
      expect(announcedTrains(roomy, state)).toContainEqual({ ...plan, work: true })
      const entered = runUntil(roomy, state, (s) => s.trains.some((t) => t.work))
      const w = entered.trains.find((t) => t.work)!
      expect(entered.timeS).toBeCloseTo(plan.appearsAtS, 0)
      expect(w.path[0]).toEqual(entryStep(roomy, plan.entry))
      expect(w.destination).toBe(plan.destination)
      expect(announcedTrains(roomy, entered).some((a) => a.id === 'W2')).toBe(false)
    }
  })

  it('holds a work train at its portal while its entry block is taken; its due time stays put', () => {
    const { plan, state: announced } = due()
    const entryEdge = entryStep(roomy, plan.entry).edgeId
    let state = { ...announced, reservations: { ...announced.reservations, [entryEdge]: ['X'] } }
    state = runUntil(roomy, state, (s) => s.timeS >= plan.appearsAtS + 60)
    expect(state.trains.some((t) => t.work)).toBe(false)
    expect(workTrainHeld(state)).toBe(true)
    const free = Object.fromEntries(Object.entries(state.reservations).filter(([edgeId]) => edgeId !== entryEdge))
    const entered = step(roomy, { ...state, reservations: free }, 0.1)
    const w = entered.trains.find((t) => t.work)!
    expect(w.dueAtS).toBe(plan.appearsAtS + 65 * 60)
    expect(workTrainHeld(entered)).toBe(false)
  })
})

describe('levelScore', () => {
  const result = (lateMinutes: number, earlyMinutes = 0) => ({
    trainId: 'X', name: 'X', arrivedAtS: 0, dueAtS: 0, lateMinutes, earlyMinutes, exitedAt: 'EAST', reachedDestination: true,
  })

  it('is 100 less every minute trains were late', () => {
    expect(levelScore({ results: [], deadlocked: false })).toBe(100)
    expect(levelScore({ results: [result(0), result(4), result(7)], deadlocked: false })).toBe(89)
  })

  it('adds a point for every minute a train arrived early', () => {
    expect(earlyTotal({ results: [result(0, 3), result(4), result(0, 6)] })).toBe(9)
    expect(levelScore({ results: [result(0, 3), result(4), result(0, 6)], deadlocked: false })).toBe(105)
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

describe('idle limit', () => {
  it('is off unless the level sets it: a still board runs on', () => {
    let state = createInitialState(graph)
    state = runUntil(graph, state, (s) => s.timeS >= parseClock('11:00'))
    expect(state.stalled).toBe(false)
  })

  it('never counts an empty board as idle', () => {
    const empty = buildGraph({ ...level, idleLimitMin: 20, startingTrains: [] })
    const state = runUntil(empty, createInitialState(empty), (s) => s.timeS >= parseClock('10:30'))
    expect(state.idleSinceS).toBeNull()
    expect(state.stalled).toBe(false)
  })
})

describe('pageSpans', () => {
  it('times a train across the map at top speed, from head in to tail out', () => {
    const steps = ['M1', 'M2', 'M3', 'M4', 'M5'].map((edgeId) => ({ edgeId, direction: 1 as const }))
    const lengthM = steps.reduce((sum, s) => sum + graph.edges.get(s.edgeId)!.lengthM, 0)
    expect(pageSpans(graph, steps, 0, 10)).toEqual([{ page: 1, fromS: 0, toS: (lengthM + level.trainLengthM) / 10 }])
    // Already 1000 m in: it is there now, and out sooner.
    expect(pageSpans(graph, steps, 1000, 10)).toEqual([{ page: 1, fromS: 0, toS: (lengthM + level.trainLengthM - 1000) / 10 }])
  })
})
