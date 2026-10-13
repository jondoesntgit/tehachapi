import type { CSSProperties, ReactNode } from 'react'
import { useGameStore } from '../store'

/** A short stretch of map drawn with the same classes the map uses, so the legend can't drift. */
function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg className="swatch" viewBox="0 0 48 20" aria-hidden="true">
      {children}
    </svg>
  )
}

const line = (className: string) => <polyline className={className} points="6,10 42,10" />

const LEGEND: { swatch: ReactNode; text: string }[] = [
  { swatch: line('track'), text: 'Free track' },
  { swatch: line('track track-reserved'), text: 'Track reserved for a train’s route' },
  { swatch: line('train train-selected'), text: 'Selected train' },
  { swatch: <circle className="stop-marker" cx={24} cy={10} r={7} />, text: 'Where the selected train will stop' },
  { swatch: <circle className="switch" cx={24} cy={10} r={4} />, text: 'Switch' },
  { swatch: <line className="portal" x1={24} y1={2} x2={24} y2={18} />, text: 'Terminal (end of the line)' },
]

export function Help({ onClose }: { onClose: () => void }) {
  const graph = useGameStore((s) => s.graph)
  // One train swatch per destination, in the destination's color.
  const trainColors = [...graph.nodes.values()]
    .filter((node) => node.kind === 'terminal' && node.color)
    .map((node) => ({
      swatch: (
        <polyline
          className="train"
          style={{ '--train-color': node.color } as CSSProperties}
          points="6,10 42,10"
        />
      ),
      text: `Train heading to ${node.label ?? node.id}`,
    }))
  const legend = [...LEGEND.slice(0, 2), ...trainColors, ...LEGEND.slice(2)]
  return (
    <div className="hud help-backdrop" onClick={onClose}>
      <div className="help" role="dialog" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2>How to dispatch</h2>
          <span className="hint">Paused</span>
          <button onClick={onClose} aria-label="Close help">
            ✕
          </button>
        </div>

        <div className="help-columns">
          <section>
            <h3>Commands</h3>
            <dl>
              <dt>Tap a train</dt>
              <dd>Select it. The train chips along the bottom select too.</dd>
              <dt>Then tap track</dt>
              <dd>Send it into that block. It speeds up, cruises and pulls up at the far end of the block, leaving the track behind it clear.</dd>
              <dt>Then tap a terminal</dt>
              <dd>Send it out through that end of the line. Tapping anywhere in the last block before a terminal does the same.</dd>
              <dt>Tap empty space</dt>
              <dd>Clear the selection.</dd>
              <dt>1× 10× 60×</dt>
              <dd>Game speed. Drops back to 1× whenever a train enters.</dd>
              <dt>⏭</dt>
              <dd>Skip to the next train. Only works while the board is empty.</dd>
              <dt>?</dt>
              <dd>This help. The game pauses while it is open.</dd>
            </dl>
            <p className="hint">
              Trains cannot reverse. A route takes a siding by itself when the main is held, and is refused if
              another train is in the way or the train cannot stop in time. Sending a train where it could
              only leave by the wrong terminal is refused, and moves its due time 3 minutes earlier.
            </p>
          </section>

          <section>
            <h3>Map colors</h3>
            <ul className="legend">
              {legend.map(({ swatch, text }) => (
                <li key={text}>
                  <Swatch>{swatch}</Swatch>
                  {text}
                </li>
              ))}
            </ul>
            <h3>Train list</h3>
            <ul className="legend">
              <li>
                <span className="chip done">
                  <b>T1</b>
                </span>
                Left on time
              </li>
              <li>
                <span className="chip late">
                  <b>T1</b>
                </span>
                Left late
              </li>
              <li>
                <span className="chip upcoming">10:32</span>
                Due to enter later
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
