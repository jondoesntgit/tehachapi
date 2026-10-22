import { locateOnPath, getEdge, pathPolyline, pointAt } from '../engine/trackGraph'
import { useGameStore } from '../store'
import type { CSSProperties } from 'react'
import { LABEL_SIZE, pointsAttr, toView, trainColor } from './view'

export function TrainLayer() {
  const graph = useGameStore((s) => s.graph)
  const trains = useGameStore((s) => s.game.trains)
  const selectedTrainId = useGameStore((s) => s.selectedTrainId)
  const { trainLengthM } = graph.level

  return (
    <g>
      {trains.map((train) => {
        const selected = train.id === selectedTrainId
        const body = pathPolyline(graph, train.path, train.headM - trainLengthM, train.headM)
        const head = toView(body[body.length - 1])
        const stop = selected && train.stopAtM !== null ? locateOnPath(graph, train.path, train.stopAtM) : null
        const stopAt = stop && toView(pointAt(getEdge(graph, stop.edgeId), stop.offsetM))
        return (
          <g key={train.id}>
            {stopAt && <circle className="stop-marker" cx={stopAt.x} cy={stopAt.y} r={45} />}
            <polyline
              className={selected ? 'train train-selected' : 'train'}
              style={{ '--train-color': trainColor(graph, train) } as CSSProperties}
              points={pointsAttr(body)}
            />
            <text className="label train-label" x={head.x} y={head.y - 90} fontSize={LABEL_SIZE} textAnchor="middle">
              {train.id}
            </text>
          </g>
        )
      })}
    </g>
  )
}
