import type { CSSProperties } from 'react'
import { announcedTrains, WORK_TRAIN_LABEL, type Announcement } from '../engine/scheduler'
import { useGameStore } from '../store'
import { destinationColor, LABEL_SIZE, outward, toView } from './view'

/** Gap between a terminal's end bar and its countdowns, in view units. */
const GAP = 140
/** Line spacing of stacked countdowns. */
const LINE = LABEL_SIZE * 1.15

/** "9:59" until a train enters, or "held" once it is due but its entry track is taken. */
function countdown(appearsAtS: number, timeS: number): string {
  const s = Math.ceil(appearsAtS - timeS)
  if (s <= 0) return 'held'
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Beside each terminal, every train announced to enter there, soonest nearest the track, each in
 * its destination's color with a countdown to when it enters.
 */
export function ArrivalLayer() {
  const graph = useGameStore((s) => s.graph)
  const game = useGameStore((s) => s.game)
  const page = useGameStore((s) => s.page)
  const byEntry = new Map<string, Announcement[]>()
  for (const a of announcedTrains(graph, game)) byEntry.set(a.entry, [...(byEntry.get(a.entry) ?? []), a])

  return (
    <g>
      {[...byEntry].map(([terminalId, arrivals]) => {
        const node = graph.nodes.get(terminalId)!
        if ((node.page ?? 1) !== page) return null
        const p = toView(node)
        const out = outward(graph, node)
        // Past the end of the line, reading away from the map; the soonest sits level with the track.
        const x = p.x + out.x * GAP
        const anchor = out.x < 0 ? 'end' : 'start'
        return arrivals.map((a, i) => {
          const time = countdown(a.appearsAtS, game.timeS)
          return (
            <text
              key={a.id}
              className={time === 'held' ? 'label arrival arrival-held' : 'label arrival'}
              x={x}
              y={p.y + LABEL_SIZE * 0.35 - i * LINE}
              fontSize={LABEL_SIZE}
              textAnchor={anchor}
              style={{ '--arrival-color': destinationColor(graph, a.destination) } as CSSProperties}
            >
              {`${a.work ? WORK_TRAIN_LABEL : a.id} ${time}`}
            </text>
          )
        })
      })}
    </g>
  )
}
