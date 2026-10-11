import { useGameStore } from '../store'
import { LABEL_SIZE, pointsAttr, toView } from './view'

export function TrackLayer() {
  const graph = useGameStore((s) => s.graph)
  const reservations = useGameStore((s) => s.game.reservations)

  return (
    <g>
      {[...graph.edges.values()].map((edge) => (
        <polyline
          key={edge.id}
          className={reservations[edge.id] ? 'track track-reserved' : 'track'}
          points={pointsAttr(edge.polyline)}
        />
      ))}
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
