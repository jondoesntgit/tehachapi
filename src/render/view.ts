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

/** SVG viewBox that fits the whole level. */
export function viewBox(graph: TrackGraph): string {
  const points = [...graph.edges.values()].flatMap((edge) => edge.polyline).map(toView)
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
