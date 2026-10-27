import { describe, expect, it } from 'vitest'
import { requestRoute } from '../src/engine/routing'
import { createInitialState, checkIdle } from '../src/engine/simulation'
import { buildGraph } from '../src/engine/trackGraph'
import { routeToTerminal } from '../src/engine/transit'
import type { Level } from '../src/engine/types'
import { graph1, level, route, runUntil } from './helpers'

/** The fixture with a second page carrying the line on west of its West terminal. */
const withPage2: Level = {
  ...level,
  nodes: [
    ...level.nodes,
    { id: 'P2_EAST', x: 4000, y: 0, kind: 'terminal', page: 2 },
    { id: 'P2_WEST', x: 0, y: 0, kind: 'terminal', page: 2 },
  ],
  edges: [...level.edges, { id: 'P2_M', from: 'P2_WEST', to: 'P2_EAST', page: 2 }],
  continuations: [{ from: 'WEST', to: 'P2_EAST', exit: 'P2_WEST' }],
}
const g = buildGraph(withPage2)

describe('continuations (page 2)', () => {
  it('scores a train once at West, then runs it through page 2 by itself', () => {
    let s = createInitialState(g)
    s = route(g, s, 'L1', { edgeId: 'M1', offsetM: 0 })
    s = runUntil(g, s, (st) => st.trains.some((t) => t.id === 'L1' && t.transit))
    expect(s.results.filter((r) => r.trainId === 'L1')).toHaveLength(1)
    const transit = s.trains.find((t) => t.id === 'L1')!
    expect(transit.path.map((p) => p.edgeId)).toEqual(['P2_M'])
    expect(transit.stopAtM).toBeNull()
    expect(s.reservations['P2_M']).toEqual(['L1'])

    // The dispatcher can't route it, and it doesn't keep the board from being idle or count as idle.
    const refused = requestRoute(g, s, 'L1', { edgeId: 'P2_M', offsetM: 2000 })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toBe('departing')
    expect(checkIdle(g, { ...s, trains: [transit] }).idleSinceS).toBeNull()

    s = runUntil(g, s, (st) => !st.trains.some((t) => t.id === 'L1'))
    expect(s.results.filter((r) => r.trainId === 'L1')).toHaveLength(1)
    expect(s.reservations['P2_M'] ?? []).toEqual([])
    expect(s.transitQueue).toEqual([])
  })

  it('leaves trains through other terminals alone', () => {
    let s = createInitialState(g)
    s = runUntil(g, s, (st) => st.trains.some((t) => t.id === 'T1'))
    s = route(g, s, 'T1', { edgeId: 'M5', offsetM: 1000 })
    s = runUntil(g, s, (st) => st.results.some((r) => r.trainId === 'T1'))
    expect(s.transitQueue).toEqual([])
    expect(s.trains.some((t) => t.transit)).toBe(false)
  })

  it('rejects a continuation that names a non-terminal', () => {
    expect(() => buildGraph({ ...withPage2, continuations: [{ from: 'SW_A1', to: 'P2_EAST', exit: 'P2_WEST' }] })).toThrow(
      /not a terminal/,
    )
  })

  it('level 1 carries West Terminal on to page 2, and work trains stay on page 1', () => {
    const path = routeToTerminal(graph1, { edgeId: 'P2_M2', direction: -1 }, 'P2_WEST')
    expect(path?.map((p) => p.edgeId)).toEqual(['P2_M2', 'P2_M1'])
    for (let seed = 1; seed <= 20; seed++) {
      const s = createInitialState(graph1, seed)
      for (const w of [...s.workTimetable, ...s.trains.filter((t) => t.work)]) {
        expect(w.destination.startsWith('P2_')).toBe(false)
        if ('entry' in w) expect(w.entry.startsWith('P2_')).toBe(false)
      }
    }
  })
})
