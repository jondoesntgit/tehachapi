import { create } from 'zustand'
import level01 from '../levels/level-01.json'
import { normalizeGameCode, randomGameCode, seedFromGameCode } from './engine/gameCode'
import { requestRoute, WRONG_DESTINATION_PENALTY_S, type RouteFailure } from './engine/routing'
import { createInitialState, FIXED_DT_S, skipToNextArrival, step } from './engine/simulation'
import { buildGraph, type TrackGraph } from './engine/trackGraph'
import type { GameState, Level, TrackPosition } from './engine/types'

export const TIME_SCALES = [1, 5, 10, 60] as const

/** Longest real-time gap a single frame may simulate; a backgrounded tab resumes instead of leaping. */
const MAX_FRAME_S = 0.25

interface GameStore {
  graph: TrackGraph
  game: GameState
  selectedTrainId: string | null
  timeScale: number
  /** The speed was double-tapped: it stays put when a train enters, until another speed is picked. */
  speedLocked: boolean
  message: string | null
  /** The help panel is open; the simulation is paused while it is. */
  helpOpen: boolean
  /** This game's code; the same code always deals the same game. */
  gameCode: string
  /** Tournament mode: restarting replays `gameCode` rather than dealing a new one. */
  tournament: boolean
  /** The tournament panel is open; the simulation is paused while it is. */
  tournamentOpen: boolean
  /** Terminal id -> trains that have entered there; the map pulses a terminal when it changes. */
  entryCounts: Record<string, number>
  /** Advances the simulation by a frame's worth of real time. */
  tick: (realDtS: number) => void
  selectTrain: (trainId: string | null) => void
  routeSelectedTo: (target: TrackPosition) => void
  setTimeScale: (timeScale: number, lock?: boolean) => void
  skipAhead: () => void
  clearMessage: () => void
  setHelpOpen: (open: boolean) => void
  /** Starts over: the same code in tournament mode, a new one otherwise. */
  restart: () => void
  /** Enters tournament mode and starts the game for `text`; false if it isn't a usable code. */
  playCode: (text: string) => boolean
  /** Leaves tournament mode and deals a new game. */
  leaveTournament: () => void
  setTournamentOpen: (open: boolean) => void
}

const graph = buildGraph(level01 as Level)

/** The game a code deals. Every game gets a code, so any game can be shared and replayed. */
const newGame = (graph: TrackGraph, code: string) => createInitialState(graph, seedFromGameCode(code))

const freshCode = () => randomGameCode(Math.random)

/** A tournament link (`?code=K7Q2MX`) starts that game in tournament mode. */
function codeFromUrl(): string | null {
  const text = new URLSearchParams(window.location.search).get('code')
  return text === null ? null : normalizeGameCode(text)
}

/** Keeps `?code=` in the address bar in step with tournament mode, so the page link can be shared. */
function syncUrl(code: string | null) {
  const url = new URL(window.location.href)
  if (code) url.searchParams.set('code', code)
  else url.searchParams.delete('code')
  window.history.replaceState(null, '', url)
}

/** The address that opens `code` in tournament mode. */
export function tournamentLink(code: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('code', code)
  return url.toString()
}

const linkedCode = codeFromUrl()
const initialCode = linkedCode ?? freshCode()
syncUrl(linkedCode)

// Game time owed to the simulation but not yet a whole fixed step.
let accumulatorS = 0

const WRONG_DESTINATION_PENALTY_MIN = WRONG_DESTINATION_PENALTY_S / 60

function failureMessage(
  reason: RouteFailure,
  blockedBy: string | undefined,
  game: GameState,
  trainId: string,
): string {
  switch (reason) {
    case 'blocked': {
      const blocker = game.trains.find((t) => t.id === blockedBy)
      return `Route blocked by ${blocker?.name ?? 'another train'}`
    }
    case 'too-close':
      return 'Too close to stop there'
    case 'departing':
      return 'Train is already leaving'
    case 'no-path':
      return 'No route there — trains cannot reverse'
    case 'wrong-destination': {
      const train = game.trains.find((t) => t.id === trainId)
      const where = train && (graph.nodes.get(train.destination)?.label ?? train.destination)
      return `Wrong way — ${train?.id ?? 'this train'} must go to ${where}. Now due ${WRONG_DESTINATION_PENALTY_MIN} min earlier.`
    }
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  graph,
  game: newGame(graph, initialCode),
  selectedTrainId: null,
  timeScale: 1,
  speedLocked: false,
  message: null,
  helpOpen: false,
  gameCode: initialCode,
  tournament: linkedCode !== null,
  tournamentOpen: false,
  entryCounts: {},

  tick: (realDtS) => {
    const { graph, game, timeScale, speedLocked, selectedTrainId, helpOpen, tournamentOpen } = get()
    if (helpOpen || tournamentOpen) return
    accumulatorS += Math.min(realDtS, MAX_FRAME_S) * timeScale
    let next = game
    while (accumulatorS >= FIXED_DT_S) {
      next = step(graph, next, FIXED_DT_S)
      accumulatorS -= FIXED_DT_S
    }
    if (next === game) return
    const stillThere = next.trains.some((t) => t.id === selectedTrainId)
    // A train entering is the dispatcher's cue to act, so drop out of fast-forward.
    const newTrains = next.trains.filter((t) => !game.trains.some((g) => g.id === t.id))
    // Work trains don't need the dispatcher, so they don't end fast-forward.
    const entered = newTrains.some((t) => !t.work)
    const entryCounts = { ...get().entryCounts }
    for (const train of newTrains) {
      const first = graph.edges.get(train.path[0].edgeId)!
      const terminal = train.path[0].direction === 1 ? first.from : first.to
      entryCounts[terminal] = (entryCounts[terminal] ?? 0) + 1
    }
    // Speak up only for trains that just cleared their terminal late; on-time ones show as chips.
    const late = next.results.slice(game.results.length).filter((r) => r.lateMinutes > 0)
    const label = (nodeId: string) => graph.nodes.get(nodeId)?.label ?? nodeId
    const arrivalMessage = late.map((r) => `${r.trainId} reached ${label(r.exitedAt)} ${r.lateMinutes} min late`).join(' · ')
    set({
      game: next,
      selectedTrainId: stillThere ? selectedTrainId : null,
      timeScale: entered && !speedLocked ? 1 : timeScale,
      ...(newTrains.length > 0 && { entryCounts }),
      ...(arrivalMessage && { message: arrivalMessage }),
    })
  },

  selectTrain: (trainId) => set({ selectedTrainId: trainId }),

  routeSelectedTo: (target) => {
    const { graph, game, selectedTrainId } = get()
    if (!selectedTrainId) return
    const result = requestRoute(graph, game, selectedTrainId, target)
    if (result.ok) set({ game: result.state, message: null })
    else set({ game: result.state ?? game, message: failureMessage(result.reason, result.blockedBy, game, selectedTrainId) })
  },

  setTimeScale: (timeScale, lock = false) => set({ timeScale, speedLocked: lock }),

  skipAhead: () => {
    const { game, speedLocked, timeScale } = get()
    set({ game: skipToNextArrival(game), timeScale: speedLocked ? timeScale : 1 })
  },

  clearMessage: () => set({ message: null }),

  setHelpOpen: (helpOpen) => set({ helpOpen }),

  restart: () => {
    const { tournament, gameCode } = get()
    startGame(tournament ? gameCode : freshCode(), tournament)
  },

  playCode: (text) => {
    const code = normalizeGameCode(text)
    if (!code) return false
    startGame(code, true)
    return true
  },

  leaveTournament: () => startGame(freshCode(), false),

  setTournamentOpen: (tournamentOpen) => set({ tournamentOpen }),
}))

/** Deals the game for `code` from the start. */
function startGame(code: string, tournament: boolean) {
  accumulatorS = 0
  syncUrl(tournament ? code : null)
  useGameStore.setState({
    game: newGame(useGameStore.getState().graph, code),
    gameCode: code,
    tournament,
    tournamentOpen: false,
    selectedTrainId: null,
    timeScale: 1,
    speedLocked: false,
    message: null,
    entryCounts: {},
  })
}
