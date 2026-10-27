import { locateOnPath, getEdge, pointAt } from '../engine/trackGraph'
import { WORK_TRAIN_LABEL } from '../engine/scheduler'
import { useGameStore } from '../store'
import type { CSSProperties } from 'react'
import { edgePage, LABEL_SIZE, pagePolylines, toView, trainColor, viewPointsAttr } from './view'

/** Minutes until a train is due at its destination, or how late it already is. */
function dueIn(dueAtS: number, timeS: number): string {
  const minutes = Math.ceil((dueAtS - timeS) / 60)
  return minutes >= 0 ? `${minutes}m` : `${-minutes}m late`
}

export function TrainLayer() {
  const graph = useGameStore((s) => s.graph)
  const trains = useGameStore((s) => s.game.trains)
  const page = useGameStore((s) => s.page)
  const selectedTrainId = useGameStore((s) => s.selectedTrainId)
  const timeS = useGameStore((s) => s.game.timeS)
  const { trainLengthM } = graph.level

  return (
    <g>
      {trains.map((train) => {
        const selected = train.id === selectedTrainId
        // Only the part of the body on this page; a train crossing a link shows on both.
        const runs = pagePolylines(graph, train.path, train.headM - trainLengthM, train.headM, page)
        if (runs.length === 0) return null
        const front = runs[runs.length - 1]
        const head = front[front.length - 1]
        const stop = selected && train.stopAtM !== null ? locateOnPath(graph, train.path, train.stopAtM) : null
        const stopAt = stop && edgePage(graph, stop.edgeId) === page && toView(pointAt(getEdge(graph, stop.edgeId), stop.offsetM))
        return (
          <g key={train.id}>
            {stopAt && <circle className="stop-marker" cx={stopAt.x} cy={stopAt.y} r={45} />}
            {runs.map((run, i) => (
              <polyline
                key={i}
                className={selected ? 'train train-selected' : 'train'}
                style={{ '--train-color': trainColor(graph, train) } as CSSProperties}
                points={viewPointsAttr(run)}
              />
            ))}
            <text className="label train-label" x={head.x} y={head.y - 90} fontSize={LABEL_SIZE} textAnchor="middle">
              {`${train.work ? WORK_TRAIN_LABEL : train.id} · ${dueIn(train.dueAtS, timeS)}`}
            </text>
          </g>
        )
      })}
    </g>
  )
}
