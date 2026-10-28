export interface Vec2 {
  x: number
  y: number
}

/** A `link` is one end of a join between pages: track runs on from its linked partner (`Level.links`). */
export type NodeKind = 'terminal' | 'switch' | 'point' | 'link'

export interface LevelNode {
  id: string
  x: number
  y: number
  kind: NodeKind
  label?: string
  /** Terminals only: CSS color for trains heading here, on the map and in the train list. */
  color?: string
  /** Map page this node is drawn on (default 1). */
  page?: number
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
  /** Map page this edge is drawn on (default 1). */
  page?: number
}

/** Text drawn on the map at a world position. */
export interface MapLabel {
  text: string
  x: number
  y: number
  color?: string
  /** Map page (default 1). */
  page?: number
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
  /**
   * Edges a work train may start the game on (levels with `workTrains`). Defaults to every edge the
   * starting trains may stand on (their `edge` and `edgeChoices`).
   */
  sidings?: string[]
  /** Extra text on the map, e.g. naming a branch. */
  labels?: MapLabel[]
  /**
   * Pairs of `link` nodes joined as one: a train reaching one runs straight on along the track at
   * the other, usually on another page. Each link node has one edge.
   */
  links?: [string, string][]
  /**
   * Start a work train on a free siding, then send another in 10 minutes after the last one is due,
   * while scheduled trains are still to come (see `placeWorkTrainOnSiding`, `buildWorkTimetable`).
   */
  workTrains?: boolean
  /** Bring scheduled trains in early so at least this many are in play (see `keepTrainsInPlay`). */
  minTrainsOnBoard?: number
  /** Raise `minTrainsOnBoard` by one every this many minutes (see `requiredTrains`). */
  minTrainsRampEveryMin?: number
  /**
   * Bring scheduled trains in early so that, were every train to run straight across at top speed,
   * no page of the map would ever stand empty (see `keepPagesBusy`).
   */
  keepPagesBusy?: boolean
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
   * This train holds every edge in `path` (sharing some with trains it follows or that follow it).
   */
  path: RouteStep[]
  /** Head position, measured along `path` from the start of `path[0]`. */
  headM: number
  /** Where the head stops, measured like `headM`. `null` = run off the end of `path` (exit). */
  stopAtM: number | null
  /** Game time the head reached the exit terminal, once it has. */
  arrivedAtS: number | null
  /** A work train: sent in by the game every so often, dispatched and scored like any other. */
  work?: boolean
}

export interface TrainResult {
  trainId: string
  name: string
  arrivedAtS: number
  dueAtS: number
  /** 0 = on time. */
  lateMinutes: number
  /** Whole minutes it arrived before it was due (0 if on the minute or late). */
  earlyMinutes: number
  exitedAt: string
  reachedDestination: boolean
}

/** A work train in this game's work-train timetable, dealt at the start like the scheduled trains. */
export interface WorkTrainPlan {
  /** W2, W3, ... (W1 starts the game on a siding). */
  id: string
  /** Terminal it enters at. */
  entry: string
  /** Terminal it is bound for. */
  destination: string
  appearsAtS: number
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
  /**
   * edge id -> ids of the trains holding it, in the order they claimed it. Several trains hold an
   * edge only when they run the same way along it, one behind another (see `following.ts`); an edge
   * nobody holds has no entry.
   */
  reservations: Record<string, string[]>
  /** Schedule entry ids that have not entered yet, in schedule order. */
  pending: string[]
  /** Schedule entry id -> this game's times. */
  timetable: Record<string, TimetableEntry>
  /** The game's random seed (0 without one); work trains draw their routes from it. */
  seed: number
  /** Work trains sent so far. */
  workTrainsSent: number
  /**
   * Every work train of this game (levels with `workTrains`), in order, fixed at the start so it is
   * the same whatever the player does. `workTrainsSent` indexes the next one to enter.
   */
  workTimetable: WorkTrainPlan[]
  /** Every train was launched and the ones on the board blocked each other for good; the game is over. */
  deadlocked: boolean
  /** Game time since which every train on the board has stood still, or null if one is moving or none are on it. */
  idleSinceS: number | null
  /** No train moved for the level's `idleLimitMin`; the game is over. */
  stalled: boolean
  results: TrainResult[]
}
