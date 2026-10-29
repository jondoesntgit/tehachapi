import { describe, expect, it } from 'vitest'
import {
  buildGraph,
  getEdge,
  locateOnPath,
  nearestTrackPosition,
  nextSteps,
  pathPolyline,
  pointAt,
} from '../src/engine/trackGraph'
import { hasRoom } from '../src/engine/routing'
import type { RouteStep } from '../src/engine/types'
import { graph, level } from './helpers'

const ids = (steps: RouteStep[]) => steps.map((s) => `${s.edgeId}:${s.direction}`).sort()

describe('trackGraph', () => {
  it('uses polyline length for edges, including siding doglegs', () => {
    expect(getEdge(graph, 'M2').lengthM).toBe(1200)
    expect(getEdge(graph, 'SIDING_A').lengthM).toBeCloseTo(2 * Math.hypot(150, 60) + 900)
  })

  it('lets lengthM override the polyline length while geometry still spans the edge', () => {
    const g = buildGraph({
      ...level,
      edges: level.edges.map((e) => (e.id === 'M1' ? { ...e, lengthM: 2000 } : e)),
    })
    const m1 = getEdge(g, 'M1')
    expect(m1.lengthM).toBe(2000)
    expect(pointAt(m1, 1000)).toEqual({ x: 500, y: 0 })
  })

  it('rejects edges that reference unknown nodes', () => {
    expect(() => buildGraph({ ...level, edges: [{ id: 'X', from: 'WEST', to: 'NOPE' }] })).toThrow()
  })

  it('offers both legs at a facing switch', () => {
    expect(ids(nextSteps(graph, { edgeId: 'M1', direction: 1 }))).toEqual(['M2:1', 'SIDING_A:1'])
  })

  it('does not let a train double back through a trailing switch', () => {
    expect(ids(nextSteps(graph, { edgeId: 'M2', direction: -1 }))).toEqual(['M1:-1'])
    expect(ids(nextSteps(graph, { edgeId: 'SIDING_A', direction: 1 }))).toEqual(['M3:1'])
  })

  it('has nowhere to go past a terminal', () => {
    expect(nextSteps(graph, { edgeId: 'M5', direction: 1 })).toEqual([])
  })

  it('locates a path distance on the right edge, in either direction', () => {
    const east: RouteStep[] = [
      { edgeId: 'M1', direction: 1 },
      { edgeId: 'M2', direction: 1 },
    ]
    expect(locateOnPath(graph, east, 1300)).toEqual({ edgeId: 'M2', offsetM: 300, direction: 1 })
    const west: RouteStep[] = [
      { edgeId: 'M2', direction: -1 },
      { edgeId: 'M1', direction: -1 },
    ]
    expect(locateOnPath(graph, west, 1300)).toEqual({ edgeId: 'M1', offsetM: 900, direction: -1 })
  })

  it('draws a path span across edges and clamps what lies off the map', () => {
    const path: RouteStep[] = [
      { edgeId: 'M1', direction: 1 },
      { edgeId: 'SIDING_A', direction: 1 },
    ]
    const span = pathPolyline(graph, path, -600, 1000 + Math.hypot(150, 60) + 100)
    expect(span[0]).toEqual({ x: 0, y: 0 })
    expect(span[span.length - 1]).toEqual({ x: 1250, y: -60 })
    expect(span).toContainEqual({ x: 1150, y: -60 })
  })

  it('snaps a tap to the nearest track, honouring vertical exaggeration', () => {
    // 60 m of siding offset drawn 6x taller: a tap at view y = -300 is nearer the siding (-360) than the main (0).
    const hit = nearestTrackPosition(graph, { x: 1600, y: -300 }, 6)!
    expect(hit.edgeId).toBe('SIDING_A')
    expect(hit.offsetM).toBeCloseTo(Math.hypot(150, 60) + 450)
    expect(hit.distance).toBeCloseTo(60)
    expect(nearestTrackPosition(graph, { x: 1600, y: -100 }, 6)!.edgeId).toBe('M2')
  })
})

describe('links between pages', () => {
  // The fixture's West terminal becomes a link onto a second page, whose line ends at FAR.
  const linked = {
    ...level,
    nodes: [
      ...level.nodes.map((n) => (n.id === 'WEST' ? { ...n, kind: 'link' as const } : n)),
      { id: 'P2_E', x: 3000, y: 0, kind: 'link' as const, page: 2 },
      { id: 'FAR', x: 0, y: 0, kind: 'terminal' as const, page: 2 },
    ],
    edges: [...level.edges, { id: 'P2', from: 'FAR', to: 'P2_E', page: 2 }],
    links: [['WEST', 'P2_E']] as [string, string][],
    schedule: level.schedule.map((e) => ({
      ...e,
      entry: e.entry === 'WEST' ? 'FAR' : e.entry,
      destination: e.destination === 'WEST' ? 'FAR' : e.destination,
    })),
    startingTrains: level.startingTrains!.map((t) => ({ ...t, destination: t.destination === 'WEST' ? 'FAR' : t.destination })),
  }

  it('runs straight on through a link, both ways, though its ends are drawn apart', () => {
    const g = buildGraph(linked)
    expect(nextSteps(g, { edgeId: 'M1', direction: -1 })).toEqual([{ edgeId: 'P2', direction: -1 }])
    expect(nextSteps(g, { edgeId: 'P2', direction: 1 })).toEqual([{ edgeId: 'M1', direction: 1 }])
    // The link is no end of the line: nothing stops there.
    expect(nextSteps(g, { edgeId: 'P2', direction: -1 })).toEqual([])
    // The blocks either side of a link are one section: neither is somewhere to stop short of it.
    expect(hasRoom(g, { edgeId: 'M1', direction: -1 })).toBe(false)
    expect(hasRoom(g, { edgeId: 'P2', direction: 1 })).toBe(false)
    expect(hasRoom(g, { edgeId: 'P2', direction: -1 })).toBe(true)
  })

  it('rejects links that are not link nodes, unjoined link nodes, and links with more than one edge', () => {
    expect(() => buildGraph({ ...linked, links: [['WEST', 'FAR']] })).toThrow(/not a link node/)
    expect(() => buildGraph({ ...linked, links: [] })).toThrow(/not joined/)
    expect(() =>
      buildGraph({ ...linked, edges: [...linked.edges, { id: 'X', from: 'WEST', to: 'SW_A2' }] }),
    ).toThrow(/exactly one edge/)
  })
})
