import { describe, expect, it } from 'vitest'
import { FOLLOW_GAP_M, followLimitM, positionOnPath, tailPosition } from '../src/engine/following'
import { CREEP_SPEED_MPS } from '../src/engine/physics'
import { requestRoute } from '../src/engine/routing'
import { entryStep } from '../src/engine/scheduler'
import { createInitialState, FIXED_DT_S, step } from '../src/engine/simulation'
import { buildGraph, locateOnPath, type TrackGraph } from '../src/engine/trackGraph'
import type { GameState, ScheduleEntry, Train } from '../src/engine/types'
import { level, level1, route, runUntil } from './helpers'

const EAST_EXIT = { edgeId: 'M5', offsetM: 1000 }
const { decelMps2, accelMps2 } = level.physics

/** The fixture's straight main, M1–M5 west to east, with a slow train S and a fast one F both bound east. */
function layout(slowMps: number, fastMps: number, fastAt = '10:01'): TrackGraph {
  const train = (id: string, appearsAt: string, maxSpeedMps: number): ScheduleEntry => ({
    id, name: id, appearsAt, entry: 'WEST', maxSpeedMps, destination: 'EAST', dueAt: '12:00',
  })
  return buildGraph({
    ...level,
    startingTrains: [],
    schedule: [train('S', '10:00', slowMps), train('F', fastAt, fastMps)],
  })
}

const find = (s: GameState, id: string) => s.trains.find((t) => t.id === id)
const stopped = (id: string) => (s: GameState) => find(s, id)?.speedMps === 0

/** Gap from F's head to S's tail along F's path, if S is ahead of F on it. */
function gap(g: TrackGraph, s: GameState): number | null {
  const f = find(s, 'F')
  const lead = find(s, 'S')
  if (!f || !lead) return null
  const tailM = positionOnPath(g, f.path, tailPosition(g, lead), f.headM)
  return tailM === null ? null : tailM - f.headM
}

/** S on its way out east; F entered behind it and waiting at the end of M1. */
function slowLeaderOut(g: TrackGraph): GameState {
  let state = createInitialState(g)
  state = runUntil(g, state, (s) => find(s, 'S') !== undefined && stopped('S')(s))
  state = route(g, state, 'S', EAST_EXIT)
  return runUntil(g, state, (s) => find(s, 'F') !== undefined && stopped('F')(s))
}

describe('following', () => {
  it('lets a fast train follow a slow one out, never closer than the gap and never braking harder than it can', () => {
    for (const slowMps of [2, 3.35, 5.03, 8]) {
      for (const fastMps of [15, 27, 40]) {
        const g = layout(slowMps, fastMps)
        let state = route(g, slowLeaderOut(g), 'F', EAST_EXIT)
        let fastest = 0
        let closest = Infinity
        while (state.results.length < 2) {
          const before = find(state, 'F')
          state = step(g, state, FIXED_DT_S)
          const after = find(state, 'F')
          const d = gap(g, state)
          if (d !== null) closest = Math.min(closest, d)
          if (before && after) {
            fastest = Math.max(fastest, after.speedMps)
            const drop = before.speedMps - after.speedMps
            // Never harder than the train's brakes, except the last creep to a standstill.
            const finalCreep = after.speedMps === 0 && before.speedMps <= CREEP_SPEED_MPS + accelMps2 * FIXED_DT_S + 1e-9
            if (!finalCreep) expect(drop).toBeLessThanOrEqual(decelMps2 * FIXED_DT_S + 1e-9)
          }
          expect(state.timeS).toBeLessThan(20 * 3600)
        }
        expect(closest).toBeGreaterThanOrEqual(FOLLOW_GAP_M - 1e-6)
        // It ran well above the leader's speed before closing up on it.
        expect(fastest).toBeGreaterThan(slowMps * 1.5)
        // Both left through the east terminal, leader first.
        expect(state.results.map((r) => [r.trainId, r.exitedAt])).toEqual([['S', 'EAST'], ['F', 'EAST']])
      }
    }
  })

  it('shares the leader’s track, and releases its own claims as its tail clears', () => {
    const g = layout(3.35, 27)
    let state = route(g, slowLeaderOut(g), 'F', EAST_EXIT)
    const shared = Object.entries(state.reservations).filter(([, holders]) => holders.length > 1)
    expect(shared.length).toBeGreaterThan(0)
    for (const [, holders] of shared) expect(holders).toEqual(['S', 'F'])
    state = runUntil(g, state, (s) => !find(s, 'S'))
    expect(Object.values(state.reservations).flat()).not.toContain('S')
    expect(Object.values(state.reservations).flat()).toContain('F')
  })

  it('lets a follower park behind a parking leader, but not in or past the leader’s block on the main', () => {
    const g = layout(5, 27)
    let state = createInitialState(g)
    state = runUntil(g, state, (s) => find(s, 'S') !== undefined && stopped('S')(s))
    state = route(g, state, 'S', { edgeId: 'M4', offsetM: 600 })
    state = runUntil(g, state, (s) => find(s, 'F') !== undefined && stopped('F')(s))
    // Into the block S parks in: refused.
    expect(requestRoute(g, state, 'F', { edgeId: 'M4', offsetM: 600 })).toMatchObject({ ok: false, reason: 'blocked', blockedBy: 'S' })
    // To the block behind it: allowed, and F stops there with room to spare.
    state = route(g, state, 'F', { edgeId: 'M3', offsetM: 800 })
    state = runUntil(g, state, (s) => stopped('S')(s) && stopped('F')(s) && find(s, 'F')!.headM === find(s, 'F')!.stopAtM)
    // F parks at the far end of M3; S stands wholly in M4 beyond the switch, so they never touch.
    const f = locateOnPath(g, find(state, 'F')!.path, find(state, 'F')!.headM)
    const sTail = tailPosition(g, find(state, 'S')!)
    expect(f.edgeId).toBe('M3')
    expect(sTail.edgeId).toBe('M4')
    expect(g.edges.get('M3')!.lengthM - f.offsetM + sTail.offsetM).toBeGreaterThanOrEqual(2 * FOLLOW_GAP_M)
  })

  it('goes around a parked leader by a siding to follow the rest of the way out', () => {
    const g = layout(5, 27)
    let state = createInitialState(g)
    state = runUntil(g, state, (s) => find(s, 'S') !== undefined && stopped('S')(s))
    state = route(g, state, 'S', { edgeId: 'M4', offsetM: 600 })
    state = runUntil(g, state, (s) => find(s, 'F') !== undefined && stopped('F')(s))
    const r = requestRoute(g, state, 'F', EAST_EXIT)
    expect(r.ok).toBe(true)
    const path = r.ok ? find(r.state, 'F')!.path.map((s) => s.edgeId) : []
    expect(path).toContain('SIDING_B')
    expect(path).not.toContain('M4')
  })

  it('never lets a train cut in ahead of one coming along the main', () => {
    // P waits at the east end of siding A; S comes along the main behind the siding's far switch.
    const g = buildGraph({
      ...level,
      startingTrains: [{ id: 'P', name: 'P', edge: 'SIDING_A', direction: 1, maxSpeedMps: 20, destination: 'EAST', dueAt: '12:00' }],
      schedule: [{ id: 'S', name: 'S', appearsAt: '10:00', entry: 'WEST', maxSpeedMps: 5, destination: 'EAST', dueAt: '12:00' }],
    })
    let state = runUntil(g, createInitialState(g), (s) => find(s, 'S') !== undefined && stopped('S')(s))
    state = route(g, state, 'S', EAST_EXIT)
    // While S hasn't passed the switch where the siding rejoins, P may not pull out in front of it.
    state = runUntil(g, state, (s) => find(s, 'S')!.path.some((p) => p.edgeId === 'M2'))
    expect(requestRoute(g, state, 'P', EAST_EXIT)).toMatchObject({ ok: false, reason: 'blocked', blockedBy: 'S' })
    // Once S's tail is past it, P may follow.
    state = runUntil(g, state, (s) => tailPosition(g, find(s, 'S')!).edgeId === 'M3')
    const r = requestRoute(g, state, 'P', EAST_EXIT)
    expect(r.ok).toBe(true)
    if (r.ok) expect(followLimitM(g, r.state.trains, find(r.state, 'P')!)).not.toBeNull()
  })

  it('never shares track with a train heading the other way', () => {
    const g = buildGraph({
      ...level,
      startingTrains: [],
      schedule: [
        { id: 'E', name: 'E', appearsAt: '10:00', entry: 'WEST', maxSpeedMps: 5, destination: 'EAST', dueAt: '12:00' },
        { id: 'W', name: 'W', appearsAt: '10:00', entry: 'EAST', maxSpeedMps: 20, destination: 'WEST', dueAt: '12:00' },
      ],
    })
    let state = runUntil(g, createInitialState(g), (s) => s.trains.length === 2 && s.trains.every((t) => t.speedMps === 0))
    state = route(g, state, 'E', { edgeId: 'M3', offsetM: 800 })
    const r = requestRoute(g, state, 'W', { edgeId: 'M1', offsetM: 0 })
    expect(r).toMatchObject({ ok: false, reason: 'blocked', blockedBy: 'E' })
  })

  it('stops a leader parking in a block its follower still has to pass', () => {
    const g = layout(3, 27)
    let state = createInitialState(g)
    state = runUntil(g, state, (s) => find(s, 'S') !== undefined && stopped('S')(s))
    state = route(g, state, 'S', { edgeId: 'M4', offsetM: 600 })
    state = runUntil(g, state, (s) => find(s, 'F') !== undefined && stopped('F')(s))
    state = route(g, state, 'F', { edgeId: 'M3', offsetM: 800 })
    // S, still on its way, may not now stop short in M3, where F is headed.
    const s: Train = find(state, 'S')!
    expect(s.path.some((p) => p.edgeId === 'M2' || p.edgeId === 'M3')).toBe(true)
    expect(requestRoute(g, state, 'S', { edgeId: 'M3', offsetM: 800 })).toMatchObject({ ok: false, reason: 'blocked', blockedBy: 'F' })
  })
})

describe('following in full games', () => {
  /** The stretch of each edge a train's body covers, as [edgeId, lowOffset, highOffset]. */
  function body(g: TrackGraph, t: Train): [string, number, number][] {
    const fromM = Math.max(0, t.headM - g.level.trainLengthM)
    const out: [string, number, number][] = []
    let startM = 0
    for (const s of t.path) {
      const len = g.edges.get(s.edgeId)!.lengthM
      const a = Math.max(fromM, startM)
      const b = Math.min(t.headM, startM + len)
      if (b > a) {
        const [x, y] = s.direction === 1 ? [a - startM, b - startM] : [startM + len - b, startM + len - a]
        out.push([s.edgeId, x, y])
      }
      startM += len
    }
    return out
  }

  it('never lets two trains touch while an eager dispatcher sends every train straight out', () => {
    const g = buildGraph({ ...level1, idleLimitMin: undefined })
    // Tapping the end of the line at a terminal sends a train out there.
    const exitFor = (terminal: string) => {
      const { edgeId, direction } = entryStep(g, terminal)
      return { edgeId, offsetM: direction === 1 ? 0 : g.edges.get(edgeId)!.lengthM }
    }
    let followed = 0
    for (const seed of [1, 2, 3, 4, 5]) {
      let state = createInitialState(g, seed)
      for (let i = 0; i < (2.5 * 3600) / FIXED_DT_S && !state.deadlocked; i++) {
        state = step(g, state, FIXED_DT_S)
        if (i % 50 === 0) {
          for (const t of state.trains.filter((t) => t.speedMps === 0)) {
            const r = requestRoute(g, state, t.id, exitFor(t.destination))
            if (r.ok) state = r.state
          }
          followed += state.trains.filter((t) => followLimitM(g, state.trains, t) !== null).length
          const bodies = state.trains.map((t) => body(g, t))
          for (let a = 0; a < bodies.length; a++) {
            for (let b = a + 1; b < bodies.length; b++) {
              for (const [ea, lo, hi] of bodies[a]) {
                for (const [eb, lo2, hi2] of bodies[b]) {
                  if (ea === eb) expect(Math.min(hi, hi2) - Math.max(lo, lo2)).toBeLessThanOrEqual(-FOLLOW_GAP_M + 1e-6)
                }
              }
            }
          }
        }
      }
    }
    // Following really happened in these games.
    expect(followed).toBeGreaterThan(0)
  })
})
