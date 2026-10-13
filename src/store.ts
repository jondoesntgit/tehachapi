import { create } from 'zustand'
import level01 from '../levels/level-01.json'
import { requestRoute, WRONG_DESTINATION_PENALTY_S, type RouteFailure } from './engine/routing'
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
  /** Terminal id -> trains that have entered there; the map pulses a terminal when it changes. */
  entryCounts: Record<string, number>
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

/** Each game gets its own seed, so trains enter at different times every play. */
const newGame = (graph: TrackGraph) => createInitialState(graph, Math.floor(Math.random() * 2 ** 32))

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
  game: newGame(graph),
  selectedTrainId: null,
  timeScale: 1,
  message: null,
  helpOpen: false,
  entryCounts: {},

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
    const newTrains = next.trains.filter((t) => !game.trains.some((g) => g.id === t.id))
    // Work trains don't need the dispatcher, so they don't end fast-forward.
    const entered = newTrains.some((t) => !t.work)
    const entryCounts = { ...get().entryCounts }
    for (const train of newTrains) {
      const first = graph.edges.get(train.path[0].edgeId)!
      const terminal = train.path[0].direction === 1 ? first.from : first.to
      entryCounts[terminal] = (entryCounts[terminal] ?? 0) + 1
    }
    // Say how each train that just cleared its terminal did.
    const cleared = next.results.slice(game.results.length)
    const label = (nodeId: string) => graph.nodes.get(nodeId)?.label ?? nodeId
    const arrivalMessage = cleared
      .map((r) => `${r.trainId} reached ${label(r.exitedAt)} ${r.lateMinutes === 0 ? 'on time' : `${r.lateMinutes} min late`}`)
      .join(' · ')
    set({
      game: next,
      selectedTrainId: stillThere ? selectedTrainId : null,
      timeScale: entered ? 1 : timeScale,
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

  setTimeScale: (timeScale) => set({ timeScale }),

  skipAhead: () => {
    set({ game: skipToNextArrival(get().game), timeScale: 1 })
  },

  clearMessage: () => set({ message: null }),

  setHelpOpen: (helpOpen) => set({ helpOpen }),

  restart: () => {
    accumulatorS = 0
    set({ game: newGame(get().graph), selectedTrainId: null, timeScale: 1, message: null })
  },
}))
