import { followLimitM } from '../engine/following'
import { pathLength, pathPolyline } from '../engine/trackGraph'
import type { CSSProperties } from 'react'
import { useGameStore } from '../store'
import { LABEL_SIZE, outward, pointsAttr, PX_PER_MM, toView, trainColor, trimEnd, viewPointsAttr } from './view'

/** Clear screen space between the ends of two trains' routes, so they never touch. */
const ROUTE_GAP_MM = 1
/** Matches `.track-reserved` stroke-width. Each round cap pokes out half of it past its end point. */
const RESERVED_STROKE_PX = 4

/** Half-length of a terminal's end-of-line bar, in view units. */
const PORTAL_HALF = 90

export function TrackLayer({ unitsPerPx }: { unitsPerPx: number }) {
  const graph = useGameStore((s) => s.graph)
  const trains = useGameStore((s) => s.game.trains)
  const entryCounts = useGameStore((s) => s.entryCounts)
  const branchOf = new Map(graph.level.edges.map((e) => [e.id, e.branch]))
  // Each end gives up half the gap. Both routes' round caps reach back into it, so add one cap each.
  const trimV = ((ROUTE_GAP_MM * PX_PER_MM) / 2 + RESERVED_STROKE_PX / 2) * unitsPerPx

  return (
    <g>
      {[...graph.edges.values()].map((edge) => (
        <polyline
          key={edge.id}
          className={branchOf.get(edge.id) ? 'track track-branch' : 'track'}
          style={{ '--branch-color': graph.nodes.get(branchOf.get(edge.id) ?? '')?.color } as CSSProperties}
          points={pointsAttr(edge.polyline)}
        />
      ))}
      {trains.map((train) => {
        // A train reserves exactly the edges of its path, so its route is the whole path; a follower's
        // is drawn only up to the train it follows, so shared track shows the leader's color.
        const endM = Math.min(pathLength(graph, train.path), followLimitM(graph, trains, train) ?? Infinity)
        const route = pathPolyline(graph, train.path, 0, endM).map(toView)
        // Trim the front, then (reversed) the rear.
        const trimmed = trimEnd(trimEnd(route, trimV).reverse(), trimV)
        return (
          trimmed.length > 1 && (
            <polyline
              key={train.id}
              className="track track-reserved"
              // The cleared route is drawn in the train's own color.
              style={{ '--route-color': trainColor(graph, train) } as CSSProperties}
              points={viewPointsAttr(trimmed)}
            />
          )
        )
      })}
      {[...graph.nodes.values()].map((node) => {
        const p = toView(node)
        if (node.kind !== 'terminal') {
          return node.kind === 'switch' ? <circle key={node.id} className="switch" cx={p.x} cy={p.y} r={30} /> : null
        }
        // The bar crosses the track. The label sits under the bar, or past the end of a track that runs down.
        const out = outward(graph, node)
        const horizontal = Math.abs(out.x) >= Math.abs(out.y)
        const labelY = horizontal ? p.y + PORTAL_HALF + LABEL_SIZE * 1.2 : p.y + Math.sign(out.y) * LABEL_SIZE * 1.6
        return (
          <g key={node.id}>
            <line
              // A new key each time a train enters here restarts the pulse animation.
              key={entryCounts[node.id] ?? 0}
              className={entryCounts[node.id] ? 'portal portal-entered' : 'portal'}
              x1={p.x - out.y * PORTAL_HALF}
              y1={p.y + out.x * PORTAL_HALF}
              x2={p.x + out.y * PORTAL_HALF}
              y2={p.y - out.x * PORTAL_HALF}
            />
            {/* Named in the color of trains heading there. */}
            <text className="label" x={p.x} y={labelY} fontSize={LABEL_SIZE} textAnchor="middle" style={{ fill: node.color }}>
              {node.label ?? node.id}
            </text>
          </g>
        )
      })}
      {(graph.level.labels ?? []).map((label) => {
        const p = toView(label)
        return (
          <text key={label.text} className="label map-label" x={p.x} y={p.y} fontSize={LABEL_SIZE} style={{ fill: label.color }}>
            {label.text}
          </text>
        )
      })}
    </g>
  )
}
