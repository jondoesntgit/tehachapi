import { describe, expect, it } from 'vitest'
import { parseClock } from '../src/engine/clock'
import { canReach, findSteps, hasRoom, requestRoute } from '../src/engine/routing'
import { buildTimetable, entryStep, isLevelComplete, requiredTrains } from '../src/engine/scheduler'
import { createInitialState, step } from '../src/engine/simulation'
import { buildGraph, getEdge, locateOnPath, nextSteps } from '../src/engine/trackGraph'
import type { GameState, TrackPosition } from '../src/engine/types'
import { graph1 as graph, level1 as level, route, runUntil } from './helpers'

const EAST_EXIT = { edgeId: 'M9', offsetM: 700 }
const WEST_EXIT = { edgeId: 'M1', offsetM: 0 }
const SOUTHEAST_EXIT = { edgeId: 'SE3', offsetM: getEdge(graph, 'SE3').lengthM }
const SOUTHWEST_EXIT = { edgeId: 'SW5', offsetM: 0 }
/** A tap that sends a train out through `terminal`. */
const exitFor = (terminal: string) =>
  ({ WEST: WEST_EXIT, EAST: EAST_EXIT, SOUTHEAST: SOUTHEAST_EXIT, SOUTHWEST: SOUTHWEST_EXIT })[terminal]!
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
    expect(level.schedule).toHaveLength(30)
    expect(level.startingTrains).toHaveLength(3)
  })

  it('brings a train up from Southeast and lets it head west', () => {
    const t13 = level.schedule.find((e) => e.id === 'T13')!
    expect([t13.entry, t13.destination]).toEqual(['SOUTHEAST', 'WEST'])
    // T13 alone on the board.
    const alone = buildGraph({ ...level, schedule: [t13], startingTrains: [], workTrains: false })
    const at = runUntil(alone, createInitialState(alone), (s) => s.trains.some((t) => t.id === 'T13'))
    const routed = route(alone, at, 'T13', WEST_EXIT)
    const path = routed.trains.find((t) => t.id === 'T13')!.path.map((s) => s.edgeId)
    expect(path.slice(path.indexOf('SE1'), path.indexOf('SE1') + 3)).toEqual(['SE1', 'SPUR_W', 'M5'])
  })

  it('has a wye off the main between sidings B and C, open to trains from either side', () => {
    expect(graph.nodes.get('SOUTHEAST')).toMatchObject({ kind: 'terminal', label: 'SE-Terminal' })
    const ids = (steps: { edgeId: string }[]) => steps.map((s) => s.edgeId).sort()
    // Eastbound trains can turn down the west leg, westbound ones down the east leg.
    expect(ids(nextSteps(graph, { edgeId: 'M5', direction: 1 }))).toEqual(['M5M', 'SPUR_W'])
    expect(ids(nextSteps(graph, { edgeId: 'M5E', direction: -1 }))).toEqual(['M5M', 'SPUR_E'])
    // Coming up from the SE line, a train can head either way.
    expect(ids(nextSteps(graph, { edgeId: 'SE1', direction: -1 }))).toEqual(['SPUR_E', 'SPUR_W'])
    expect(ids(nextSteps(graph, { edgeId: 'SPUR_E', direction: -1 }))).toEqual(['M5E'])
    expect(ids(nextSteps(graph, { edgeId: 'SPUR_W', direction: -1 }))).toEqual(['M5'])
  })

  it('brings a train up from Southeast and lets it head east', () => {
    const t12 = level.schedule.find((e) => e.id === 'T12')!
    expect([t12.entry, t12.destination]).toEqual(['SOUTHEAST', 'EAST'])
    const graph = buildGraph({ ...level, schedule: [t12], startingTrains: [], workTrains: false })
    let state = runUntil(graph, createInitialState(graph), has('T12'))
    expect(state.trains.find((t) => t.id === 'T12')!.path[0]).toEqual({ edgeId: 'SE3', direction: -1 })
    // Nobody has dispatched T2, which holds the east entry, so stop T12 short of it.
    state = routeWhenClear(state, 'T12', { edgeId: 'M7', offsetM: 600 })
    const path = state.trains.find((t) => t.id === 'T12')!.path.map((s) => s.edgeId)
    expect(path.slice(path.indexOf('SE1'), path.indexOf('SE1') + 3)).toEqual(['SE1', 'SPUR_E', 'M5E'])
  })

  it('runs the SE line under the main, with two passing sidings', () => {
    const blocks = ['SE1', 'SE1B', 'SE1C', 'SE2', 'SE3'].map((id) => getEdge(graph, id))
    expect(blocks.map((e) => [e.from, e.to])).toEqual([
      ['SW_SJ', 'SW_E3'], ['SW_E3', 'SW_E4'], ['SW_E4', 'SW_E1'], ['SW_E1', 'SW_E2'], ['SW_E2', 'SOUTHEAST'],
    ])
    // Under the main, parallel to it, out to the east end.
    const run = [...blocks[0].polyline.slice(2), ...blocks.slice(1).flatMap((e) => e.polyline)]
    expect(run.every((p) => p.y === 180)).toBe(true)
    expect(graph.nodes.get('SOUTHEAST')!.x).toBe(graph.nodes.get('EAST')!.x)
    // It leaves the wye straight down, so trains on either leg can take it.
    expect(blocks[0].polyline[1].x).toBe(blocks[0].polyline[0].x)
    // Two passing sidings, each beside a main block that holds a whole train.
    expect(getEdge(graph, 'SE_LOOP2')).toMatchObject({ from: 'SW_E3', to: 'SW_E4' })
    expect(getEdge(graph, 'SE_LOOP')).toMatchObject({ from: 'SW_E1', to: 'SW_E2' })
    for (const id of ['SE1', 'SE1B', 'SE_LOOP2', 'SE2', 'SE_LOOP']) {
      expect(getEdge(graph, id).lengthM).toBeGreaterThanOrEqual(level.trainLengthM + 40)
    }
  })
  it('stops a train from the SE-Terminal in the first block, short of the passing siding', () => {
    const entry = level.schedule.find((e) => e.id === 'T12')!
    const graph = buildGraph({ ...level, schedule: [entry], startingTrains: [], workTrains: false })
    let state = runUntil(graph, createInitialState(graph), has('T12'))
    state = runUntil(graph, state, (s) => s.trains.find((t) => t.id === 'T12')!.speedMps === 0)
    const t12 = state.trains.find((t) => t.id === 'T12')!
    expect(locateOnPath(graph, t12.path, t12.headM)).toEqual({ edgeId: 'SE3', offsetM: 20, direction: -1 })
  })

  it('never stops a train on a wye leg or a short block at the wye', () => {
    let state = route(graph, createInitialState(graph), 'L3', WEST_EXIT)
    state = runUntil(graph, state, has('T1'))
    // A tap on the 200 m block east of the wye runs T1 on to the next block it fits in.
    state = routeWhenClear(state, 'T1', { edgeId: 'M5', offsetM: 100 })
    const t1 = state.trains.find((t) => t.id === 'T1')!
    expect(['M5M', 'M5', 'M5E', 'SPUR_W']).not.toContain(locateOnPath(graph, t1.path, t1.stopAtM!).edgeId)
    expect(hasRoom(graph, t1.path[t1.path.length - 1])).toBe(true)
  })
  it('refuses to send a train toward the wrong terminal and moves its due time 3 minutes earlier', () => {
    let state = runUntil(graph, createInitialState(graph), has('T1'))
    const dueAtS = state.trains.find((t) => t.id === 'T1')!.dueAtS
    const reservations = state.reservations
    const result = requestRoute(graph, state, 'T1', SOUTHEAST_EXIT)
    expect(result).toMatchObject({ ok: false, reason: 'wrong-destination' })
    state = result.state!
    expect(state.trains.find((t) => t.id === 'T1')!.dueAtS).toBe(dueAtS - 3 * 60)
    expect(state.reservations).toBe(reservations)

    // A stop partway down the Southeast line is a dead end for T1 too.
    const again = requestRoute(graph, state, 'T1', { edgeId: 'SE1', offsetM: 800 })
    expect(again).toMatchObject({ ok: false, reason: 'wrong-destination' })
    expect(again.ok || again.state!.trains.find((t) => t.id === 'T1')!.dueAtS).toBe(dueAtS - 6 * 60)
  })
  it('sends each work train in at a terminal, bound for another terminal it can reach', () => {
    const terminals = [...graph.nodes.values()].filter((n) => n.kind === 'terminal').map((n) => n.id)
    const seen = new Set<string>()
    for (let seed = 0; seed < 30; seed++) {
      const state = runUntil(graph, createInitialState(graph, seed), (s) => s.trains.some((t) => t.work))
      const w = state.trains.find((t) => t.work)!
      expect(terminals).toContain(w.destination)
      expect(canReach(graph, w.path[0], w.destination)).toBe(true)
      seen.add(w.destination)
    }
    expect(seen.size).toBeGreaterThan(2)
  })

  it('sends three waves of four trains, one from each terminal, each to a terminal it can reach', () => {
    const terminals = ['EAST', 'SOUTHEAST', 'SOUTHWEST', 'WEST']
    const waves = [['10:27', '10:30'], ['10:45', '10:47'], ['11:27', '11:38']]
    for (const [i, window] of waves.entries()) {
      const wave = level.schedule.filter((e) => Number(e.id.slice(1)) >= 19 + 4 * i && Number(e.id.slice(1)) < 23 + 4 * i)
      expect(wave.map((e) => e.entry).sort()).toEqual(terminals)
      for (const e of wave) {
        expect(e.appearsBetween).toEqual(window)
        expect(e.destination).not.toBe(e.entry)
        expect(canReach(graph, entryStep(graph, e.entry), e.destination)).toBe(true)
      }
    }
  })

  it('brings trains in early so the rising minimum of scheduled trains is always in play', () => {
    // Trains are left standing here, which would otherwise end the game after 20 idle minutes.
    const graph = buildGraph({ ...level, idleLimitMin: undefined })
    for (let seed = 0; seed < 20; seed++) {
      let state = createInitialState(graph, seed)
      const inPlay = (s: GameState) =>
        s.trains.filter((t) => !t.work).length + s.pending.filter((id) => s.timetable[id].appearsAtS <= s.timeS).length
      // Sample the first hour, sending every train that can leave straight out, as a player might.
      for (let i = 0; i < 60; i++) {
        state = runUntil(graph, state, (s) => s.timeS >= state.timeS + 60)
        // While enough trains remain to be brought in, the board holds at least the rising minimum.
        const need = requiredTrains(graph, state.timeS)
        if (state.pending.length >= need) expect(inPlay(state)).toBeGreaterThanOrEqual(need)
        for (const t of state.trains.filter((t) => !t.work && t.speedMps === 0)) {
          const exit = exitFor(t.destination)
          const r = requestRoute(graph, state, t.id, exit)
          if (r.ok) state = r.state
        }
      }
    }
  })

  it('needs four trains in play for the first 10 minutes, then one more every 10 minutes', () => {
    const startS = parseClock(level.startTime)
    expect([0, 9, 10, 19, 20, 35, 60].map((m) => requiredTrains(graph, startS + m * 60))).toEqual([4, 4, 5, 5, 6, 7, 10])
  })

  it('keeps each train brought forward on its time allowance', () => {
    const state = step(graph, createInitialState(graph, 3), 0.1)
    const written = buildTimetable(graph, 3)
    const moved = Object.keys(written).filter((id) => state.timetable[id].appearsAtS !== written[id].appearsAtS)
    expect(moved.length).toBeGreaterThan(0)
    for (const id of moved) {
      expect(state.timetable[id].appearsAtS).toBeLessThan(written[id].appearsAtS)
      expect(state.timetable[id].dueAtS - state.timetable[id].appearsAtS).toBe(written[id].dueAtS - written[id].appearsAtS)
    }
  })

  it('makes at least three pairs of trains pass each other in every game', () => {
    // A train's way across: shortest route from its portal to its destination.
    const routeOf = (entry: string, destination: string) => {
      const first = entryStep(graph, entry)
      const exit = exitFor(destination)
      return [first, ...(findSteps(graph, first, exit, new Set()) ?? [])]
    }
    const routes = Object.fromEntries(level.schedule.map((e) => [e.id, routeOf(e.entry, e.destination)]))
    const opposed = (a: string, b: string) =>
      routes[a].some((x) => routes[b].some((y) => x.edgeId === y.edgeId && x.direction !== y.direction))
    for (let seed = 0; seed < 100; seed++) {
      const timetable = buildTimetable(graph, seed)
      const ids = level.schedule.map((e) => e.id)
      let pairs = 0
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const [a, b] = [timetable[ids[i]], timetable[ids[j]]]
          // Both on the line at once, heading opposite ways over shared track: they have to pass.
          if (a.appearsAtS < b.dueAtS && b.appearsAtS < a.dueAtS && opposed(ids[i], ids[j])) pairs++
        }
      }
      expect(pairs).toBeGreaterThanOrEqual(3)
    }
  })

  it('ends the game once no train has moved for 20 minutes', () => {
    expect(level.idleLimitMin).toBe(20)
    // At the start every train stands still; nothing is dispatched, so nothing moves again.
    let state = createInitialState(graph, 5)
    state = runUntil(graph, state, (s) => s.trains.length > 0 && s.trains.every((t) => t.speedMps === 0))
    const stillFrom = state.timeS
    state = runUntil(graph, state, (s) => s.stalled || s.trains.some((t) => t.speedMps > 0))
    if (!state.stalled) {
      // A train entered (and moved); the clock restarted from when it stopped.
      state = runUntil(graph, state, (s) => s.stalled)
    }
    expect(state.stalled).toBe(true)
    expect(isLevelComplete(state)).toBe(true)
    expect(state.timeS - state.idleSinceS!).toBeGreaterThanOrEqual(20 * 60)
    expect(state.timeS - stillFrom).toBeGreaterThanOrEqual(20 * 60)
    // The game stands still from here.
    expect(step(graph, state, 0.1)).toBe(state)
  })

  it('restarts the idle clock whenever any train moves', () => {
    let state = createInitialState(graph, 5)
    state = runUntil(graph, state, (s) => s.idleSinceS !== null)
    const firstIdle = state.idleSinceS!
    // Send one local home: it moves, so the board isn't idle.
    const local = state.trains.find((t) => t.id.startsWith('L') && requestRoute(graph, state, t.id, exitFor(t.destination)).ok)!
    state = route(graph, state, local.id, exitFor(local.destination))
    state = runUntil(graph, state, (s) => s.trains.some((t) => t.speedMps > 0))
    expect(state.idleSinceS).toBeNull()
    state = runUntil(graph, state, (s) => s.idleSinceS !== null || s.stalled)
    expect(state.stalled).toBe(false)
    expect(state.idleSinceS!).toBeGreaterThan(firstIdle)
  })

  it('keeps the written timetable without a seed', () => {
    const timetable = buildTimetable(graph)
    for (const entry of level.schedule) {
      expect(timetable[entry.id]).toEqual({ appearsAtS: parseClock(entry.appearsAt), dueAtS: parseClock(entry.dueAt) })
    }
  })

  it('enters windowed trains at random whole minutes in their window, and the rest within the jitter', () => {
    const jitterS = level.appearsJitterMin! * 60
    const windows: Record<string, [string, string]> = {
      T1: ['10:00', '10:25'], T2: ['10:00', '10:25'], T3: ['10:00', '10:25'],
      T7: ['10:30', '11:30'], T8: ['10:30', '11:30'], T9: ['10:30', '11:30'],
      T10: ['10:00', '11:00'], T11: ['10:30', '11:30'], T12: ['10:30', '11:15'],
      T13: ['10:45', '11:40'],
      T14: ['10:20', '11:45'], T15: ['10:30', '11:55'],
      T16: ['09:55', '10:53'], T17: ['09:55', '10:53'], T18: ['09:55', '10:53'],
      ...Object.fromEntries(['T19', 'T20', 'T21', 'T22'].map((id) => [id, ['10:27', '10:30']])),
      ...Object.fromEntries(['T23', 'T24', 'T25', 'T26'].map((id) => [id, ['10:45', '10:47']])),
      ...Object.fromEntries(['T27', 'T28', 'T29', 'T30'].map((id) => [id, ['11:27', '11:38']])),
    }
    const seen: Record<string, Set<number>> = {}
    for (let seed = 0; seed < 200; seed++) {
      const timetable = buildTimetable(graph, seed)
      for (const entry of level.schedule) {
        const { appearsAtS, dueAtS } = timetable[entry.id]
        expect(Math.abs(appearsAtS) % 60).toBe(0)
        expect(dueAtS - appearsAtS).toBe(parseClock(entry.dueAt) - parseClock(entry.appearsAt))
        const window = windows[entry.id]
        expect(entry.appearsBetween).toEqual(window)
        if (window) {
          expect(appearsAtS).toBeGreaterThanOrEqual(parseClock(window[0]))
          expect(appearsAtS).toBeLessThanOrEqual(parseClock(window[1]))
          ;(seen[entry.id] ??= new Set()).add(appearsAtS)
        } else {
          expect(Math.abs(appearsAtS - parseClock(entry.appearsAt))).toBeLessThanOrEqual(jitterS)
        }
      }
    }
    // Every minute of T1's window, both ends included, comes up.
    expect(seen.T1.size).toBe(26)
    expect(seen.T11.size).toBeGreaterThan(50)
  })

  it('sends two trains, entering from the west, to the SE-Terminal', () => {
    const south = level.schedule.filter((e) => e.destination === 'SOUTHEAST')
    expect(south.map((e) => [e.id, e.entry])).toEqual([
      ['T10', 'WEST'], ['T11', 'WEST'], ['T17', 'SOUTHWEST'], ['T22', 'SOUTHWEST'], ['T23', 'WEST'], ['T28', 'EAST'],
    ])
    expect(graph.nodes.get('SOUTHEAST')?.color).toBeDefined()
  })

  it('puts every starting train on a different random siding, facing a way that reaches its destination', () => {
    const sidings = level.startingTrains![0].edgeChoices!
    expect(sidings).toEqual(['SIDING_A', 'SIDING_B', 'SIDING_C', 'SIDING_D', 'SE_LOOP', 'SE_LOOP2', 'SW_SIDING1', 'SW_SIDING2'])
    const at = (s: GameState, id: string) => s.trains.find((t) => t.id === id)!.path[0]
    const written = createInitialState(graph)
    expect(['L1', 'L2', 'L3'].map((id) => at(written, id).edgeId)).toEqual(['SIDING_A', 'SIDING_D', 'SIDING_B'])

    const used: Record<string, Set<string>> = { L1: new Set(), L2: new Set(), L3: new Set() }
    for (let seed = 0; seed < 300; seed++) {
      const state = createInitialState(graph, seed)
      const steps = ['L1', 'L2', 'L3'].map((id) => at(state, id))
      expect(new Set(steps.map((s) => s.edgeId)).size).toBe(3)
      for (const [i, id] of ['L1', 'L2', 'L3'].entries()) {
        expect(sidings).toContain(steps[i].edgeId)
        expect(canReach(graph, steps[i], state.trains.find((t) => t.id === id)!.destination)).toBe(true)
        used[id].add(steps[i].edgeId)
      }
    }
    // Westbound locals can sit anywhere but the SW branch, which only leads west to SW Terminal;
    // the eastbound local can sit on any siding at all, facing east.
    expect([...used.L1].sort()).toEqual(['SE_LOOP', 'SE_LOOP2', 'SIDING_A', 'SIDING_B', 'SIDING_C', 'SIDING_D'])
    expect([...used.L2].sort()).toEqual([...sidings].sort())
  })

  it('has a SW branch off the main between sidings A and B, with two sidings, running west under the main', () => {
    expect(graph.nodes.get('SOUTHWEST')).toMatchObject({ kind: 'terminal', label: 'SW Terminal' })
    expect(graph.nodes.get('SOUTHWEST')!.x).toBe(graph.nodes.get('WEST')!.x)
    expect(graph.nodes.get('SOUTHWEST')!.y).toBeGreaterThan(0)
    const ids = (steps: { edgeId: string }[]) => steps.map((s) => s.edgeId).sort()
    // Westbound trains can turn down it; eastbound ones run straight past.
    expect(ids(nextSteps(graph, { edgeId: 'M3E', direction: -1 }))).toEqual(['M3', 'SW1'])
    expect(ids(nextSteps(graph, { edgeId: 'M3', direction: 1 }))).toEqual(['M3E'])
    // Coming up it, a train joins the main heading east.
    expect(ids(nextSteps(graph, { edgeId: 'SW1', direction: -1 }))).toEqual(['M3E'])
    // Two passing sidings, each pairing with a main block on the branch.
    expect(getEdge(graph, 'SW_SIDING1')).toMatchObject({ from: 'SW_Q1', to: 'SW_Q2' })
    expect(getEdge(graph, 'SW_SIDING2')).toMatchObject({ from: 'SW_Q3', to: 'SW_Q4' })
    for (const id of ['SW_SIDING1', 'SW_SIDING2', 'SW2', 'SW4', 'SW1']) {
      expect(getEdge(graph, id).lengthM).toBeGreaterThanOrEqual(level.trainLengthM + 40)
    }
    const t14 = level.schedule.find((e) => e.id === 'T14')!
    const t15 = level.schedule.find((e) => e.id === 'T15')!
    expect([t14.entry, t14.destination, t15.entry, t15.destination]).toEqual(['EAST', 'SOUTHWEST', 'SOUTHWEST', 'EAST'])
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
    // Without the minimum in play, which would bring trains in sooner.
    const graph = buildGraph({ ...level, minTrainsOnBoard: 0, minTrainsRampEveryMin: undefined })
    const state = createInitialState(graph, 42)
    const t1 = state.timetable.T1.appearsAtS
    const before = runUntil(graph, state, (s) => s.timeS >= t1 - 1)
    expect(has('T1')(before)).toBe(false)
    const after = runUntil(graph, before, has('T1'), 5)
    expect(after.trains.find((t) => t.id === 'T1')!.dueAtS).toBe(state.timetable.T1.dueAtS)
  })

  it('plays the written timetable through on time with meets in sidings C and D', () => {
    // The dispatched timetable alone: this fixed script can't steer round a work train in its way.
    // The three waves of four (T19–T30) all land together, and trains brought forward to keep four
    // in play would scramble the order, so this fixed script leaves both out.
    const graph = buildGraph({
      ...level,
      workTrains: false,
      minTrainsOnBoard: 0,
      minTrainsRampEveryMin: undefined,
      schedule: level.schedule.filter((e) => Number(e.id.slice(1)) < 19),
    })
    const routeWhenClear = (state: GameState, trainId: string, target: TrackPosition) =>
      route(graph, runUntil(graph, state, (s) => requestRoute(graph, s, trainId, target).ok), trainId, target)
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

    // T10 enters behind T2 and turns off down the South spur.
    state = runUntil(graph, state, has('T10'))
    state = routeWhenClear(state, 'T10', SOUTHEAST_EXIT)

    // In the lull: T16 runs east to west; T17 crosses from SW Terminal to the SE-Terminal; T18 crosses back.
    state = runUntil(graph, state, has('T16'))
    state = routeWhenClear(state, 'T16', WEST_EXIT)
    state = runUntil(graph, state, has('T17'))
    state = routeWhenClear(state, 'T17', SOUTHEAST_EXIT)
    // T12 is listed first, so it comes up from the SE-Terminal ahead of T18 and heads east.
    state = runUntil(graph, state, has('T12'))
    state = routeWhenClear(state, 'T12', EAST_EXIT)
    state = runUntil(graph, state, has('T18'))
    state = routeWhenClear(state, 'T18', SOUTHWEST_EXIT)

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

    // T11 waits off the map until T9 is home, then runs down to South.
    state = runUntil(graph, state, has('T11'))
    state = routeWhenClear(state, 'T11', SOUTHEAST_EXIT)

    // T13 comes up from South once T11 is down, and turns west up the wye's west leg.
    state = runUntil(graph, state, has('T13'))
    state = routeWhenClear(state, 'T13', WEST_EXIT)

    // T14 comes in from the east and turns down the SW branch; T15 comes up it and heads east.
    state = runUntil(graph, state, has('T14'))
    state = routeWhenClear(state, 'T14', SOUTHWEST_EXIT)
    state = runUntil(graph, state, has('T15'))
    state = routeWhenClear(state, 'T15', EAST_EXIT)
    state = runUntil(graph, state, isLevelComplete)

    expect(state.results.map((r) => r.trainId).sort()).toEqual([
      'L1', 'L2', 'L3', 'T1', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17', 'T18', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
    ])
    expect(state.results.every((r) => r.reachedDestination)).toBe(true)
    expect(state.results.filter((r) => r.lateMinutes > 0)).toEqual([])
    expect(state.reservations).toEqual({})
  })
})
