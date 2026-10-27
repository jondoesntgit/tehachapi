import { getEdge, type TrackGraph } from '../engine/trackGraph'
import type { LevelNode, Train, Vec2 } from '../engine/types'

/**
 * The line is kilometres long but sidings sit only tens of metres off the main, so the view
 * stretches the vertical axis, like a dispatcher's panel. Purely visual: physics uses world metres.
 */
export const Y_SCALE = 6

/** Text height in view units; the whole map scales with the screen, labels included. */
export const LABEL_SIZE = 110

// Wide enough beside each terminal for its arrival countdowns ("T12 9:59").
const PADDING_X = 860
const PADDING_Y = 380

/** CSS pixels in a millimetre. */
export const PX_PER_MM = 96 / 25.4

export function toView(p: Vec2): Vec2 {
  return { x: p.x, y: p.y * Y_SCALE }
}

/** `points` attribute for world-space points. */
export function pointsAttr(points: readonly Vec2[]): string {
  return viewPointsAttr(points.map(toView))
}

/** `points` attribute for points already in view space. */
export function viewPointsAttr(points: readonly Vec2[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

/** Shortens a view-space polyline by `lengthV` view units at its end; empty if nothing is left. */
export function trimEnd(points: readonly Vec2[], lengthV: number): Vec2[] {
  let remaining = lengthV
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i - 1]
    const b = points[i]
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (segment > remaining) {
      const t = (segment - remaining) / segment
      return [...points.slice(0, i), { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }]
    }
    remaining -= segment
  }
  return []
}

const edgePages = new WeakMap<TrackGraph, Map<string, number>>()

/** The page of the map an edge is drawn on (1 unless the level says otherwise). */
export function edgePage(graph: TrackGraph, edgeId: string): number {
  let pages = edgePages.get(graph)
  if (!pages) {
    pages = new Map(graph.level.edges.map((e) => [e.id, e.page ?? 1]))
    edgePages.set(graph, pages)
  }
  return pages.get(edgeId) ?? 1
}

/** The page a train is on: that of the edge under its tail. */
export function trainPage(graph: TrackGraph, train: Pick<Train, 'path'>): number {
  return edgePage(graph, train.path[0].edgeId)
}

/** The highest page number the level uses. */
export function pageCount(graph: TrackGraph): number {
  return Math.max(1, ...graph.level.edges.map((e) => e.page ?? 1))
}

/** SVG viewBox that fits one page of the level. */
export function viewBox(graph: TrackGraph, page = 1): string {
  const points = [...graph.edges.values()]
    .filter((edge) => edgePage(graph, edge.id) === page)
    .flatMap((edge) => edge.polyline)
    .map(toView)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs) - PADDING_X
  const minY = Math.min(...ys) - PADDING_Y
  const width = Math.max(...xs) + PADDING_X - minX
  const height = Math.max(...ys) + PADDING_Y - minY
  return `${minX} ${minY} ${width} ${height}`
}

/** Color for a train heading to `destination`, if its terminal has one. */
export function destinationColor(graph: TrackGraph, destination: string): string | undefined {
  return graph.nodes.get(destination)?.color
}

/** The color a train is drawn in: its destination's color, work trains included. */
export function trainColor(graph: TrackGraph, train: Pick<Train, 'destination'>): string | undefined {
  return destinationColor(graph, train.destination)
}

/** Unit vector, in view space, pointing along the track out through a terminal. */
export function outward(graph: TrackGraph, node: LevelNode): Vec2 {
  const edgeId = graph.edgesAt.get(node.id)?.[0]
  if (!edgeId) return { x: 1, y: 0 }
  const { polyline, from } = getEdge(graph, edgeId)
  const inner = toView(from === node.id ? polyline[1] : polyline[polyline.length - 2])
  const end = toView(node)
  const length = Math.hypot(end.x - inner.x, end.y - inner.y)
  return { x: (end.x - inner.x) / length, y: (end.y - inner.y) / length }
}
