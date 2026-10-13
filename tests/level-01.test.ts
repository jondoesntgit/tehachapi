import { describe, expect, it } from 'vitest'
import { parseClock } from '../src/engine/clock'
import { requestRoute } from '../src/engine/routing'
import { buildTimetable, isLevelComplete } from '../src/engine/scheduler'
import { createInitialState } from '../src/engine/simulation'
import { buildGraph, getEdge, nextSteps } from '../src/engine/trackGraph'
import type { GameState, TrackPosition } from '../src/engine/types'
import { graph1 as graph, level1 as level, route, runUntil } from './helpers'

const EAST_EXIT = { edgeId: 'M9', offsetM: 700 }
const WEST_EXIT = { edgeId: 'M1', offsetM: 0 }
const SIDINGS = ['SIDING_A', 'SIDING_B', 'SIDING_C', 'SIDING_D']

const has = (id: string) => (s: GameState) => s.trains.some((t) => t.id === id)

/** Waits until the route would be granted, then takes it. */
function routeWhenClear(state: GameState, trainId: string, target: TrackPosition): GameState {
  const ready = runUntil(graph, state, (s) => requestRoute(graph, s, trainId, target).ok)
  return route(graph, ready, trainId, target)
}

describe('level 1', () => {
  it('has four sidings, each holding a whole train clear of its switches', () => {
    for (const id of SIDINGS) {
      const { lengthM } = getEdge(graph, id)
      expect(lengthM).toBeGreaterThanOrEqual(level.trainLengthM + 40)
      expect(lengthM).toBeLessThan(700)
    }
    expect(level.schedule).toHaveLength(9)
    expect(level.startingTrains).toHaveLength(3)
  })

  it('has a South spur off the main between sidings B and C, facing eastbound trains', () => {
    expect(graph.nodes.get('SOUTH')).toMatchObject({ kind: 'terminal', label: 'South' })
    expect(getEdge(graph, 'SPUR_S')).toMatchObject({ from: 'SW_S', to: 'SOUTH' })
    const ids = (steps: { edgeId: string }[]) => steps.map((s) => s.edgeId).sort()
    expect(ids(nextSteps(graph, { edgeId: 'M5', direction: 1 }))).toEqual(['M5E', 'SPUR_S'])
    expect(ids(nextSteps(graph, { edgeId: 'M5E', direction: -1 }))).toEqual(['M5'])
    expect(ids(nextSteps(graph, { edgeId: 'SPUR_S', direction: -1 }))).toEqual(['M5'])
  })

  it('lets an eastbound train leave through South, scored as the wrong exit', () => {
    let state = runUntil(graph, createInitialState(graph), has('T1'))
    state = routeWhenClear(state, 'T1', { edgeId: 'SPUR_S', offsetM: getEdge(graph, 'SPUR_S').lengthM })
    state = runUntil(graph, state, (s) => s.results.some((r) => r.trainId === 'T1'))
    expect(state.results.find((r) => r.trainId === 'T1')).toMatchObject({ exitedAt: 'SOUTH', reachedDestination: false })
  })

  it('keeps the written timetable without a seed', () => {
    const timetable = buildTimetable(graph)
    for (const entry of level.schedule) {
      expect(timetable[entry.id]).toEqual({ appearsAtS: parseClock(entry.appearsAt), dueAtS: parseClock(entry.dueAt) })
    }
  })

  it('enters T1–T3 from 10:00 to 10:25, T7–T9 from 10:30 to 11:30, and the rest within the jitter', () => {
    const jitterS = level.appearsJitterMin! * 60
    const seen = new Set<number>()
    const seenLate = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      const timetable = buildTimetable(graph, seed)
      for (const entry of level.schedule) {
        const { appearsAtS, dueAtS } = timetable[entry.id]
        expect(Math.abs(appearsAtS) % 60).toBe(0)
        expect(dueAtS - appearsAtS).toBe(parseClock(entry.dueAt) - parseClock(entry.appearsAt))
        if (['T1', 'T2', 'T3'].includes(entry.id)) {
          expect(entry.appearsBetween).toEqual(['10:00', '10:25'])
          expect(appearsAtS).toBeGreaterThanOrEqual(parseClock('10:00'))
          expect(appearsAtS).toBeLessThanOrEqual(parseClock('10:25'))
          seen.add(appearsAtS)
        } else if (['T7', 'T8', 'T9'].includes(entry.id)) {
          expect(entry.appearsBetween).toEqual(['10:30', '11:30'])
          expect(appearsAtS).toBeGreaterThanOrEqual(parseClock('10:30'))
          expect(appearsAtS).toBeLessThanOrEqual(parseClock('11:30'))
          seenLate.add(appearsAtS)
        } else {
          expect(Math.abs(appearsAtS - parseClock(entry.appearsAt))).toBeLessThanOrEqual(jitterS)
        }
      }
    }
    // Every minute of the window, both ends included, comes up.
    expect(seen.size).toBe(26)
    expect(seenLate.size).toBeGreaterThan(50)
  })

  it('puts L1 on siding A and L2, L3 on different random sidings among B, C and D', () => {
    const edgeOf = (s: GameState, id: string) => s.trains.find((t) => t.id === id)!.path[0].edgeId
    const written = createInitialState(graph)
    expect(['L1', 'L2', 'L3'].map((id) => edgeOf(written, id))).toEqual(['SIDING_A', 'SIDING_D', 'SIDING_B'])

    const placements = new Set<string>()
    for (let seed = 0; seed < 100; seed++) {
      const state = createInitialState(graph, seed)
      const [l1, l2, l3] = ['L1', 'L2', 'L3'].map((id) => edgeOf(state, id))
      expect(l1).toBe('SIDING_A')
      expect(['SIDING_B', 'SIDING_C', 'SIDING_D']).toContain(l2)
      expect(['SIDING_B', 'SIDING_C', 'SIDING_D']).toContain(l3)
      expect(l2).not.toBe(l3)
      expect(Object.keys(state.reservations).sort()).toEqual([l1, l2, l3].sort())
      placements.add(`${l2}/${l3}`)
    }
    // All six ways to seat two trains on three sidings come up.
    expect(placements.size).toBe(6)
  })

  it('rejects edgeChoices that do not contain the written edge or name unknown edges', () => {
    const withL2 = (change: object) =>
      buildGraph({ ...level, startingTrains: level.startingTrains!.map((t) => (t.id === 'L2' ? { ...t, ...change } : t)) })
    expect(() => withL2({ edgeChoices: ['SIDING_B'] })).toThrow(/do not contain/)
    expect(() => withL2({ edgeChoices: ['SIDING_D', 'NOPE'] })).toThrow(/unknown edge/)
  })

  it('rejects an appearsBetween window that does not contain appearsAt', () => {
    const schedule = level.schedule.map((e) => (e.id === 'T1' ? { ...e, appearsAt: '10:30' } : e))
    expect(() => buildGraph({ ...level, schedule })).toThrow(/appearsBetween/)
  })

  it('replays the same times for the same seed and varies them across seeds', () => {
    expect(buildTimetable(graph, 7)).toEqual(buildTimetable(graph, 7))
    const distinct = new Set([...Array(20).keys()].map((seed) => JSON.stringify(buildTimetable(graph, seed))))
    expect(distinct.size).toBeGreaterThan(10)
  })

  it('brings trains in at their shifted times', () => {
    const state = createInitialState(graph, 42)
    const t1 = state.timetable.T1.appearsAtS
    const before = runUntil(graph, state, (s) => s.timeS >= t1 - 1)
    expect(has('T1')(before)).toBe(false)
    const after = runUntil(graph, before, has('T1'), 5)
    expect(after.trains.find((t) => t.id === 'T1')!.dueAtS).toBe(state.timetable.T1.dueAtS)
  })

  it('plays the written timetable through on time with meets in sidings C and D', () => {
    let state = createInitialState(graph)

    // The locals head home: L1 from siding A and L3 from siding B go west, L2 from siding D east.
    state = route(graph, state, 'L1', WEST_EXIT)
    state = route(graph, state, 'L2', EAST_EXIT)
    state = routeWhenClear(state, 'L3', WEST_EXIT)
    state = runUntil(graph, state, has('T1'))
    state = routeWhenClear(state, 'T1', EAST_EXIT)

    // T2 waits in siding C while express T3 runs through, then heads west.
    state = runUntil(graph, state, has('T2'))
    state = routeWhenClear(state, 'T2', { edgeId: 'SIDING_C', offsetM: 0 })
    state = runUntil(graph, state, has('T3'))
    state = routeWhenClear(state, 'T3', EAST_EXIT)
    state = routeWhenClear(state, 'T2', WEST_EXIT)

    // Express T4 follows T2 west; local T5 waits in siding D for freight T6, then runs east.
    state = runUntil(graph, state, has('T4'))
    state = routeWhenClear(state, 'T4', WEST_EXIT)
    state = runUntil(graph, state, has('T5'))
    state = routeWhenClear(state, 'T5', { edgeId: 'SIDING_D', offsetM: 600 })
    state = runUntil(graph, state, has('T6'))
    state = routeWhenClear(state, 'T6', WEST_EXIT)
    state = routeWhenClear(state, 'T5', EAST_EXIT)

    // Express T7 runs west, then freight T8 east; local T9 waits off the map until T8 is out.
    state = runUntil(graph, state, has('T7'))
    state = routeWhenClear(state, 'T7', WEST_EXIT)
    state = runUntil(graph, state, has('T8'))
    state = routeWhenClear(state, 'T8', EAST_EXIT)
    state = runUntil(graph, state, has('T9'))
    state = routeWhenClear(state, 'T9', WEST_EXIT)
    state = runUntil(graph, state, isLevelComplete)

    expect(state.results.map((r) => r.trainId).sort()).toEqual([
      'L1', 'L2', 'L3', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
    ])
    expect(state.results.every((r) => r.reachedDestination)).toBe(true)
    expect(state.results.filter((r) => r.lateMinutes > 0)).toEqual([])
    expect(state.reservations).toEqual({})
  })
})
