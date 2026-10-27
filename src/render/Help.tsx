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
  {
    swatch: <polyline className="track track-reserved" style={{ '--route-color': 'var(--text)' } as CSSProperties} points="6,10 42,10" />,
    text: 'Route cleared for a train, in that train’s color',
  },
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
              <dd>Select it.</dd>
              <dt>Then tap track</dt>
              <dd>Send it into that block. It speeds up, cruises and pulls up at the far end of the block, leaving the track behind it clear. If the block is too short for the whole train, it runs on to the next block it fits in.</dd>
              <dt>Then tap a terminal</dt>
              <dd>Send it out through that end of the line. Tapping anywhere in the last block before a terminal does the same. Until it reaches the terminal you can still send it somewhere else, such as into a siding to let a faster train by.</dd>
              <dt>Tap empty space</dt>
              <dd>Clear the selection.</dd>
              <dt>P1 P2</dt>
              <dd>Switch between the two pages of the map. Page 2 carries the line on west: a train that leaves through West Terminal is scored there, then runs itself through page 2. A dot and number show how many trains are on the other page.</dd>
              <dt>1× 5× 10× 60×</dt>
              <dd>Game speed. Drops back to 1× whenever a train enters, unless you double-tap 5×: that holds 5× until you pick another speed.</dd>
              <dt>⏭</dt>
              <dd>Skip to the next train. Only works while the board is empty.</dd>
              <dt>🏆</dt>
              <dd>Tournament: see this game’s code, share it, restart it, or play a code someone gave you. Everyone on the same code gets the same game.</dd>
              <dt>?</dt>
              <dd>This help. The game pauses while it is open.</dd>
            </dl>
            <p className="hint">
              Trains cannot reverse. A route takes a siding by itself when the main is held, and is refused if
              another train is in the way or the train cannot stop in time. A train may follow another heading
              the same way: it keeps at least 20 m behind, slowing to match, and can follow it out through its
              terminal, but it can’t be sent into the block where the train ahead will stop. Sending a train where it could
              only leave by the wrong terminal is refused, and moves its due time 3 minutes earlier.
              Every train is announced at the terminal it will enter by, 10 minutes ahead, with a countdown.
            A work train (W) starts on a siding with 65 minutes to clear before it counts as late; the next arrives 10 minutes after that one is due, and so on. They run at 11.25 mph, one at a time, in their destination’s color; route them like any other train. More trains are kept in play as the game goes on: at least 4 at first, one more every 15 minutes. Your
              score at the end is 100, less every minute trains were late. If every train has entered and the ones on the board block each other with
              no way forward, the game ends and 90 minutes are added to the late total. The game also ends if no train moves for 20 minutes.
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
            <h3>Train labels</h3>
            <ul className="legend">
              <li>
                <b>T3 · 12m</b>&nbsp;due at its destination in 12 minutes
              </li>
              <li>
                <b>T3 · 2m late</b>&nbsp;already 2 minutes past due
              </li>
              <li>
                <b>W · 40m</b>&nbsp;a work train, due out in 40 minutes
              </li>
            </ul>
            <h3>Beside a terminal</h3>
            <ul className="legend">
              <li>
                <b>T7 4:32</b>&nbsp;T7 enters here in 4 minutes 32 seconds
              </li>
              <li>
                <b>W 9:10</b>&nbsp;the next work train enters here
              </li>
              <li>
                <b>T7 held</b>&nbsp;due now, but the track inside is occupied
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
