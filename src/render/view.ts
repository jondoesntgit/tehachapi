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

export function toView(p: Vec2): Vec2 {
  return { x: p.x, y: p.y * Y_SCALE }
}

export function pointsAttr(points: readonly Vec2[]): string {
  return points.map(toView).map((p) => `${p.x},${p.y}`).join(' ')
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
