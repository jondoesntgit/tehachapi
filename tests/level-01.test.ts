import { describe, expect, it } from 'vitest'
import { parseClock } from '../src/engine/clock'
import { requestRoute } from '../src/engine/routing'
import { buildTimetable, isLevelComplete } from '../src/engine/scheduler'
import { createInitialState } from '../src/engine/simulation'
import { buildGraph, getEdge } from '../src/engine/trackGraph'
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
    expect(level.schedule).toHaveLength(6)
  })

  it('keeps the written timetable without a seed', () => {
    const timetable = buildTimetable(graph)
    for (const entry of level.schedule) {
      expect(timetable[entry.id]).toEqual({ appearsAtS: parseClock(entry.appearsAt), dueAtS: parseClock(entry.dueAt) })
    }
  })

  it('enters T1–T3 at random whole minutes from 10:00 to 10:25 and the rest within the jitter', () => {
    const jitterS = level.appearsJitterMin! * 60
    const seen = new Set<number>()
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
        } else {
          expect(Math.abs(appearsAtS - parseClock(entry.appearsAt))).toBeLessThanOrEqual(jitterS)
        }
      }
    }
    // Every minute of the window, both ends included, comes up.
    expect(seen.size).toBe(26)
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

    // The local leaves siding A for home; the board is then empty until T1.
    state = route(graph, state, 'L1', WEST_EXIT)
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
    state = runUntil(graph, state, isLevelComplete)

    expect(state.results.map((r) => r.trainId).sort()).toEqual(['L1', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'])
    expect(state.results.every((r) => r.reachedDestination)).toBe(true)
    expect(state.results.filter((r) => r.lateMinutes > 0)).toEqual([])
    expect(state.reservations).toEqual({})
  })
})
