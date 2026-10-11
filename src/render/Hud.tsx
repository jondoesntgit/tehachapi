import { useEffect } from 'react'
import { formatClock, parseClock } from '../engine/clock'
import { getScheduleEntry, heldAtPortal, isLevelComplete, nextArrivalS } from '../engine/scheduler'
import { TIME_SCALES, useGameStore } from '../store'

const MESSAGE_MS = 3000

export function Hud() {
  const graph = useGameStore((s) => s.graph)
  const game = useGameStore((s) => s.game)
  const selectedTrainId = useGameStore((s) => s.selectedTrainId)
  const timeScale = useGameStore((s) => s.timeScale)
  const message = useGameStore((s) => s.message)
  const { selectTrain, setTimeScale, skipAhead, clearMessage, restart } = useGameStore.getState()

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(clearMessage, MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [message, clearMessage])

  const label = (nodeId: string) => graph.nodes.get(nodeId)?.label ?? nodeId
  const held = heldAtPortal(graph, game)
  const upcoming = game.pending
    .map((id) => getScheduleEntry(graph, id))
    .filter((entry) => parseClock(entry.appearsAt) > game.timeS)
  const canSkip = game.trains.length === 0 && nextArrivalS(graph, game) !== null
  const complete = isLevelComplete(game)
  const selected = game.trains.find((t) => t.id === selectedTrainId)

  return (
    <>
      <header className="hud hud-top">
        <div className="clock">{formatClock(game.timeS, true)}</div>
        <div className="title">{graph.level.title}</div>
        <div className="buttons">
          {TIME_SCALES.map((scale) => (
            <button key={scale} className={scale === timeScale ? 'active' : ''} onClick={() => setTimeScale(scale)}>
              {scale}×
            </button>
          ))}
          <button disabled={!canSkip} onClick={skipAhead} aria-label="Skip to next train">
            ⏭
          </button>
        </div>
      </header>

      {(message || held.length > 0) && (
        <div className="hud toast" role="status">
          {message ?? `${held.map((e) => e.name).join(', ')} waiting to enter — entry track occupied`}
        </div>
      )}

      {complete && (
        <div className="hud summary">
          <h2>Level complete</h2>
          <button onClick={restart}>Play again</button>
        </div>
      )}

      <footer className="hud hud-bottom">
        {!complete && game.trains.length === 0 && upcoming.length > 0 && (
          <span className="hint">No trains yet. Fast-forward or skip to the next arrival.</span>
        )}
        {game.trains.length > 0 && !selected && <span className="hint">Tap a train, then tap where it should go.</span>}
        {game.results.map((result) => (
          <span key={result.trainId} className={result.lateMinutes === 0 ? 'chip done' : 'chip late'}>
            <b>{result.trainId}</b> {result.lateMinutes === 0 ? 'on time' : `${result.lateMinutes} min late`}
            {!result.reachedDestination && ' · wrong exit'}
          </span>
        ))}
        {game.trains.map((train) => (
          <button
            key={train.id}
            className={train.id === selectedTrainId ? 'chip active' : 'chip'}
            onClick={() => selectTrain(train.id === selectedTrainId ? null : train.id)}
          >
            <b>{train.id}</b> {train.name} → {label(train.destination)} by {formatClock(train.dueAtS)} ·{' '}
            {Math.round(train.speedMps * 3.6)} km/h
          </button>
        ))}
        {upcoming.map((entry) => (
          <span key={entry.id} className="chip upcoming">
            <b>{entry.appearsAt}</b> {entry.name} · {label(entry.entry)} → {label(entry.destination)} by {entry.dueAt}
          </span>
        ))}
      </footer>
    </>
  )
}
