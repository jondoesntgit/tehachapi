import { useEffect, useRef } from 'react'
import { formatClock } from '../engine/clock'
import {
  DEADLOCK_PENALTY_MIN,
  heldAtPortal,
  isLevelComplete,
  workTrainHeld,
  earlyTotal,
  lateTotal,
  levelScore,
  nextArrivalS,
} from '../engine/scheduler'
import { TIME_SCALES, useGameStore } from '../store'
import { Help } from './Help'
import { Tournament } from './Tournament'
import { pageCount, trainPage } from './view'

const MESSAGE_MS = 3000
/** The speed a double tap holds. */
const LOCKABLE_SCALE = 5
const DOUBLE_TAP_MS = 400

export function Hud() {
  const graph = useGameStore((s) => s.graph)
  const game = useGameStore((s) => s.game)
  const timeScale = useGameStore((s) => s.timeScale)
  const message = useGameStore((s) => s.message)
  const helpOpen = useGameStore((s) => s.helpOpen)
  const speedLocked = useGameStore((s) => s.speedLocked)
  const gameCode = useGameStore((s) => s.gameCode)
  const tournament = useGameStore((s) => s.tournament)
  const tournamentOpen = useGameStore((s) => s.tournamentOpen)
  const page = useGameStore((s) => s.page)
  const { setPage, setTimeScale, skipAhead, clearMessage, setHelpOpen, setTournamentOpen, restart } = useGameStore.getState()

  // Two taps on 5× in quick succession hold it there, even when trains enter.
  const lastTap = useRef<{ scale: number; at: number } | null>(null)
  const onSpeed = (scale: number) => {
    const now = Date.now()
    const double = scale === LOCKABLE_SCALE && lastTap.current?.scale === scale && now - lastTap.current.at < DOUBLE_TAP_MS
    lastTap.current = { scale, at: now }
    setTimeScale(scale, double)
  }

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(clearMessage, MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [message, clearMessage])

  const held = [...heldAtPortal(graph, game).map((e) => e.name), ...(workTrainHeld(game) ? ['Work train'] : [])]
  const canSkip = game.trains.every((t) => t.work) && nextArrivalS(game) !== null
  const complete = isLevelComplete(game)

  return (
    <>
      <header className="hud hud-top">
        <div className="clock">{formatClock(game.timeS, true)}</div>
        <div className="title">
          {tournament ? (
            <span className="badge">🏆 {gameCode}</span>
          ) : (
            graph.level.title
          )}
        </div>
        <div className="buttons">
          {/* The score so far: 100, less minutes late, plus minutes early. */}
          <div className="running-score" aria-label="Score">
            {levelScore(game)}
          </div>
          {pageCount(graph) > 1 &&
            // Highest page first: P2 sits left of P1.
            Array.from({ length: pageCount(graph) }, (_, i) => pageCount(graph) - i).map((p) => {
              // How many trains are on a page you aren't looking at.
              const count = p === page ? 0 : game.trains.filter((t) => trainPage(graph, t) === p).length
              return (
                <button key={`P${p}`} className={p === page ? 'active' : ''} onClick={() => setPage(p)} aria-label={`Page ${p}`}>
                  P{p}
                  {count > 0 && <span className="lock"> ·{count}</span>}
                </button>
              )
            })}
          {TIME_SCALES.map((scale) => (
            <button
              key={scale}
              className={scale === timeScale ? 'active' : ''}
              aria-label={scale === LOCKABLE_SCALE ? `${scale}× (double-tap to hold)` : `${scale}×`}
              onClick={() => onSpeed(scale)}
            >
              {scale}×{scale === timeScale && speedLocked && <span className="lock"> 🔒</span>}
            </button>
          ))}
          <button disabled={!canSkip} onClick={skipAhead} aria-label="Skip to next train">
            ⏭
          </button>
          <button className={tournament ? 'active' : ''} onClick={() => setTournamentOpen(true)} aria-label="Tournament">
            🏆
          </button>
          <button onClick={() => setHelpOpen(true)} aria-label="Help">
            ?
          </button>
        </div>
      </header>

      {(message || held.length > 0) && (
        <div className="hud toast" role="status">
          {message ?? `${held.join(', ')} waiting to enter — entry track occupied`}
        </div>
      )}

      {complete && (
        <div className="hud summary">
          <h2>
            {game.deadlocked
              ? 'Deadlock — trains blocked each other'
              : game.stalled
                ? `Game over — no train moved for ${graph.level.idleLimitMin} minutes`
                : 'Level complete'}
          </h2>
          <p className="score">
            Your score is <b>{levelScore(game)}</b>
          </p>
          <p className="hint">
            100, less {lateTotal(game)} minutes late in all
            {game.deadlocked && ` (including ${DEADLOCK_PENALTY_MIN} for the deadlock)`}, plus {earlyTotal(game)} minutes
            early
          </p>
          <p className="hint">
            {tournament ? 'Tournament' : 'Game'} code <b className="code-inline">{gameCode}</b>
          </p>
          <div className="tournament-buttons">
            <button onClick={restart}>{tournament ? `Replay ${gameCode}` : 'Play again'}</button>
            <button onClick={() => setTournamentOpen(true)}>Tournament…</button>
          </div>
        </div>
      )}

      {helpOpen && <Help onClose={() => setHelpOpen(false)} />}
      {tournamentOpen && <Tournament onClose={() => setTournamentOpen(false)} />}
    </>
  )
}
