import { create } from 'zustand'
import level01 from '../levels/level-01.json'
import { requestRoute, type RouteFailure } from './engine/routing'
import { createInitialState, FIXED_DT_S, skipToNextArrival, step } from './engine/simulation'
import { buildGraph, type TrackGraph } from './engine/trackGraph'
import type { GameState, Level, TrackPosition } from './engine/types'

export const TIME_SCALES = [1, 10, 60] as const

/** Longest real-time gap a single frame may simulate; a backgrounded tab resumes instead of leaping. */
const MAX_FRAME_S = 0.25

interface GameStore {
  graph: TrackGraph
  game: GameState
  selectedTrainId: string | null
  timeScale: number
  message: string | null
  /** The help panel is open; the simulation is paused while it is. */
  helpOpen: boolean
  /** Advances the simulation by a frame's worth of real time. */
  tick: (realDtS: number) => void
  selectTrain: (trainId: string | null) => void
  routeSelectedTo: (target: TrackPosition) => void
  setTimeScale: (timeScale: number) => void
  skipAhead: () => void
  clearMessage: () => void
  setHelpOpen: (open: boolean) => void
  restart: () => void
}

const graph = buildGraph(level01 as Level)

// Game time owed to the simulation but not yet a whole fixed step.
let accumulatorS = 0

function failureMessage(reason: RouteFailure, blockedBy: string | undefined, game: GameState): string {
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
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  graph,
  game: createInitialState(graph),
  selectedTrainId: null,
  timeScale: 1,
  message: null,
  helpOpen: false,

  tick: (realDtS) => {
    const { graph, game, timeScale, selectedTrainId, helpOpen } = get()
    if (helpOpen) return
    accumulatorS += Math.min(realDtS, MAX_FRAME_S) * timeScale
    let next = game
    while (accumulatorS >= FIXED_DT_S) {
      next = step(graph, next, FIXED_DT_S)
      accumulatorS -= FIXED_DT_S
    }
    if (next === game) return
    const stillThere = next.trains.some((t) => t.id === selectedTrainId)
    // A train entering is the dispatcher's cue to act, so drop out of fast-forward.
    const arrived = next.trains.length > game.trains.length
    set({
      game: next,
      selectedTrainId: stillThere ? selectedTrainId : null,
      timeScale: arrived ? 1 : timeScale,
    })
  },

  selectTrain: (trainId) => set({ selectedTrainId: trainId }),

  routeSelectedTo: (target) => {
    const { graph, game, selectedTrainId } = get()
    if (!selectedTrainId) return
    const result = requestRoute(graph, game, selectedTrainId, target)
    if (result.ok) set({ game: result.state, message: null })
    else set({ message: failureMessage(result.reason, result.blockedBy, game) })
  },

  setTimeScale: (timeScale) => set({ timeScale }),

  skipAhead: () => {
    const { graph, game } = get()
    set({ game: skipToNextArrival(graph, game), timeScale: 1 })
  },

  clearMessage: () => set({ message: null }),

  setHelpOpen: (helpOpen) => set({ helpOpen }),

  restart: () => {
    accumulatorS = 0
    set({ game: createInitialState(get().graph), selectedTrainId: null, timeScale: 1, message: null })
  },
}))
