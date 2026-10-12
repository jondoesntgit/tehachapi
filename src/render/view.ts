import type { TrackGraph } from '../engine/trackGraph'
import type { Vec2 } from '../engine/types'

/**
 * The line is kilometres long but sidings sit only tens of metres off the main, so the view
 * stretches the vertical axis, like a dispatcher's panel. Purely visual: physics uses world metres.
 */
export const Y_SCALE = 6

/** Text height in view units; the whole map scales with the screen, labels included. */
export const LABEL_SIZE = 110

const PADDING_X = 520
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
