export interface Vec2 {
  x: number
  y: number
}

export type NodeKind = 'terminal' | 'switch' | 'point'

export interface LevelNode {
  id: string
  x: number
  y: number
  kind: NodeKind
  label?: string
  /** Terminals only: CSS color for trains heading here, on the map and in the train list. */
  color?: string
}

export interface LevelEdge {
  id: string
  from: string
  to: string
  /** Intermediate drawing points between `from` and `to`. */
  points?: [number, number][]
  /** Overrides the polyline length when present. */
  lengthM?: number
  /** Terminal id this edge is a branch toward; drawn in a faint tint of that terminal's color. */
  branch?: string
}

/** Text drawn on the map at a world position. */
export interface MapLabel {
  text: string
  x: number
  y: number
  color?: string
}

export interface PhysicsConfig {
  accelMps2: number
  decelMps2: number
  stopMarginM: number
}

export interface ScheduleEntry {
  id: string
  name: string
  /** "HH:MM" */
  appearsAt: string
  /**
   * `["HH:MM", "HH:MM"]`: each game, the train appears at a random whole minute in this window
   * (inclusive) instead of being shifted by `appearsJitterMin`. Must contain `appearsAt`.
   */
  appearsBetween?: [string, string]
  entry: string
  maxSpeedMps: number
  destination: string
  /** "HH:MM" */
  dueAt: string
}

/** A train already standing on the track when the level starts. */
export interface StartingTrain {
  id: string
  name: string
  /** Edge the whole train stands on, head `STOP_CLEARANCE_M` short of its far end. */
  edge: string
  /**
   * Each game, the train stands on a random one of these edges that no earlier starting train has
   * taken, instead of `edge`. Must contain `edge`.
   */
  edgeChoices?: string[]
  /** Way the train faces on `edge`. */
  direction: Direction
  maxSpeedMps: number
  destination: string
  /** "HH:MM" */
  dueAt: string
}

export interface Level {
  id: string
  title: string
  /** "HH:MM" */
  startTime: string
  trainLengthM: number
  physics: PhysicsConfig
  nodes: LevelNode[]
  edges: LevelEdge[]
  schedule: ScheduleEntry[]
  /**
   * Each game moves every scheduled train's `appearsAt` by a random whole number of minutes, up to
   * this many either way; its `dueAt` moves with it. Omitted = the timetable as written.
   */
  appearsJitterMin?: number
  startingTrains?: StartingTrain[]
  /** Extra text on the map, e.g. naming a branch. */
  labels?: MapLabel[]
  /** Send a work train every 10 to 20 minutes while scheduled trains are still to come (see `spawnWorkTrain`). */
  workTrains?: boolean
  /** Bring scheduled trains in early so at least this many are in play (see `bringTrainsForward`). */
  minTrainsOnBoard?: number
  /** End the game if trains are on the board but none has moved for this many minutes. */
  idleLimitMin?: number
}

/** 1 = travelling from the edge's `from` node toward `to`; -1 = the reverse. */
export type Direction = 1 | -1

/** A point on the track. `offsetM` is measured from the edge's `from` node. */
export interface TrackPosition {
  edgeId: string
  offsetM: number
}

export interface HeadPosition extends TrackPosition {
  direction: Direction
}

/** One edge of a route, traversed in `direction`. */
export interface RouteStep {
  edgeId: string
  direction: Direction
}

export interface Train {
  id: string
  name: string
  maxSpeedMps: number
  /** Terminal node id the train is scheduled to leave through. */
  destination: string
  dueAtS: number
  speedMps: number
  /**
   * Edges from the one under the tail to the end of the granted route, in travel order.
   * Every edge in `path` is reserved by this train.
   */
  path: RouteStep[]
  /** Head position, measured along `path` from the start of `path[0]`. */
  headM: number
  /** Where the head stops, measured like `headM`. `null` = run off the end of `path` (exit). */
  stopAtM: number | null
  /** Game time the head reached the exit terminal, once it has. */
  arrivedAtS: number | null
  /** A work train: sent in by the game every so often, dispatched like any other, not scored. */
  work?: boolean
}

export interface TrainResult {
  trainId: string
  name: string
  arrivedAtS: number
  dueAtS: number
  /** 0 = on time. */
  lateMinutes: number
  exitedAt: string
  reachedDestination: boolean
}

/** When a scheduled train enters and is due out in this game, after any random shift. */
export interface TimetableEntry {
  appearsAtS: number
  dueAtS: number
}

export interface GameState {
  /** Game clock, seconds since midnight. */
  timeS: number
  trains: Train[]
  /** edge id -> id of the train holding it. */
  reservations: Record<string, string>
  /** Schedule entry ids that have not entered yet, in schedule order. */
  pending: string[]
  /** Schedule entry id -> this game's times. */
  timetable: Record<string, TimetableEntry>
  /** The game's random seed (0 without one); work trains draw their routes from it. */
  seed: number
  /** Work trains sent so far. */
  workTrainsSent: number
  /** Game time the next work train goes out (levels with `workTrains`). */
  nextWorkTrainS: number
  /** Every train was launched and the ones on the board blocked each other for good; the game is over. */
  deadlocked: boolean
  /** Game time since which every train on the board has stood still, or null if one is moving or none are on it. */
  idleSinceS: number | null
  /** No train moved for the level's `idleLimitMin`; the game is over. */
  stalled: boolean
  results: TrainResult[]
}
