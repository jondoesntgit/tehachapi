import { pathLength, pathPolyline } from '../engine/trackGraph'
import { useGameStore } from '../store'
import { LABEL_SIZE, pointsAttr, PX_PER_MM, toView, trimEnd, viewPointsAttr } from './view'

/** Clear screen space between the ends of two trains' green routes, so they never touch. */
const ROUTE_GAP_MM = 1
/** Matches `.track-reserved` stroke-width. Each round cap pokes out half of it past its end point. */
const RESERVED_STROKE_PX = 4

export function TrackLayer({ unitsPerPx }: { unitsPerPx: number }) {
  const graph = useGameStore((s) => s.graph)
  const trains = useGameStore((s) => s.game.trains)
  // Each end gives up half the gap. Both routes' round caps reach back into it, so add one cap each.
  const trimV = ((ROUTE_GAP_MM * PX_PER_MM) / 2 + RESERVED_STROKE_PX / 2) * unitsPerPx

  return (
    <g>
      {[...graph.edges.values()].map((edge) => (
        <polyline key={edge.id} className="track" points={pointsAttr(edge.polyline)} />
      ))}
      {trains.map((train) => {
        // A train reserves exactly the edges of its path, so its route is the whole path.
        const route = pathPolyline(graph, train.path, 0, pathLength(graph, train.path)).map(toView)
        // Trim the front, then (reversed) the rear.
        const trimmed = trimEnd(trimEnd(route, trimV).reverse(), trimV)
        return (
          trimmed.length > 1 && (
            <polyline key={train.id} className="track track-reserved" points={viewPointsAttr(trimmed)} />
          )
        )
      })}
      {[...graph.nodes.values()].map((node) => {
        const p = toView(node)
        if (node.kind !== 'terminal') {
          return node.kind === 'switch' ? <circle key={node.id} className="switch" cx={p.x} cy={p.y} r={22} /> : null
        }
        return (
          <g key={node.id}>
            <line className="portal" x1={p.x} y1={p.y - 90} x2={p.x} y2={p.y + 90} />
            <text className="label" x={p.x} y={p.y + 90 + LABEL_SIZE * 1.2} fontSize={LABEL_SIZE} textAnchor="middle">
              {node.label ?? node.id}
            </text>
          </g>
        )
      })}
    </g>
  )
}
