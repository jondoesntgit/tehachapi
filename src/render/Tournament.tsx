import { useState, type FormEvent } from 'react'
import { MAX_GAME_CODE_LENGTH } from '../engine/gameCode'
import { tournamentLink, useGameStore } from '../store'

/**
 * Tournament play: everyone who starts the same code gets the same game (trains, entry times,
 * starting sidings, work trains), so scores can be compared fairly.
 */
export function Tournament({ onClose }: { onClose: () => void }) {
  const gameCode = useGameStore((s) => s.gameCode)
  const tournament = useGameStore((s) => s.tournament)
  const { playCode, leaveTournament } = useGameStore.getState()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shared, setShared] = useState<string | null>(null)

  const link = tournamentLink(gameCode)
  // Share and the clipboard only work on HTTPS (or localhost); otherwise the link is shown to copy by hand.
  const canShare = window.isSecureContext && (typeof navigator.share === 'function' || !!navigator.clipboard)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (playCode(text)) return
    setError(`Codes are 1–${MAX_GAME_CODE_LENGTH} letters or digits`)
  }

  const onShare = async () => {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Railroad Dispatcher', text: `Dispatch game ${gameCode}`, url: link })
      } else {
        await navigator.clipboard.writeText(link)
        setShared('Link copied')
      }
    } catch {
      // Dismissing the share sheet lands here too; nothing to report.
    }
  }

  return (
    <div className="hud help-backdrop" onClick={onClose}>
      <div className="help tournament" role="dialog" aria-label="Tournament" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2>Tournament</h2>
          <span className="hint">Paused</span>
          <button onClick={onClose} aria-label="Close tournament">
            ✕
          </button>
        </div>

        <p className="hint">
          Every game has a code. Everyone who plays the same code gets the same game: the same trains at the
          same times, the same starting sidings and the same work trains. Only the dispatching differs, so the
          scores compare fairly.
        </p>

        <div className="tournament-columns">
          <section>
            <h3>{tournament ? 'Tournament code' : 'This game'}</h3>
            <div className="game-code">{gameCode}</div>
            <div className="selectable link">{link}</div>
            <div className="tournament-buttons">
              {canShare && <button onClick={onShare}>Share link</button>}
              <button onClick={() => playCode(gameCode)}>{tournament ? 'Restart this code' : 'Play this code as a tournament'}</button>
            </div>
            {shared && <p className="hint">{shared}</p>}
          </section>

          <section>
            <h3>Play a code</h3>
            <form className="code-form" onSubmit={onSubmit}>
              <input
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setError(null)
                }}
                placeholder="e.g. K7Q2MX"
                aria-label="Game code"
                maxLength={MAX_GAME_CODE_LENGTH + 8}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
              />
              <button type="submit" disabled={text.trim() === ''}>
                Play
              </button>
            </form>
            {error ? (
              <p className="hint error">{error}</p>
            ) : (
              <p className="hint">Starts that game from the beginning. Any word works too, such as FRIDAY FINAL.</p>
            )}
            {tournament && (
              <button className="leave" onClick={leaveTournament}>
                Leave tournament (new random game)
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
