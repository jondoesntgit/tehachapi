import { parseClock } from './clock'
import type { Direction, HeadPosition, Level, LevelNode, RouteStep, TrackPosition, Vec2 } from './types'

export interface GraphEdge {
  id: string
  from: string
  to: string
  /** Drawing geometry from `from` to `to`, in world metres. */
  polyline: Vec2[]
  /** Polyline distance at each vertex; same length as `polyline`. */
  cumulativeM: number[]
  /** Length used by physics and routing: `lengthM` from the level, else the polyline length. */
  lengthM: number
}

export interface TrackGraph {
  level: Level
  nodes: ReadonlyMap<string, LevelNode>
  edges: ReadonlyMap<string, GraphEdge>
  /** node id -> ids of the edges touching it. */
  edgesAt: ReadonlyMap<string, readonly string[]>
  /** link node id -> the link node it is joined to (`Level.links`), both ways. */
  linkedTo: ReadonlyMap<string, string>
}

export function buildGraph(level: Level): TrackGraph {
  const nodes = new Map<string, LevelNode>()
  for (const node of level.nodes) {
    if (nodes.has(node.id)) throw new Error(`Duplicate node id "${node.id}"`)
    nodes.set(node.id, node)
  }

  const edges = new Map<string, GraphEdge>()
  const edgesAt = new Map<string, string[]>(level.nodes.map((n) => [n.id, []]))
  for (const edge of level.edges) {
    if (edges.has(edge.id)) throw new Error(`Duplicate edge id "${edge.id}"`)
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) throw new Error(`Edge "${edge.id}" references an unknown node`)

    const polyline: Vec2[] = [
      { x: from.x, y: from.y },
      ...(edge.points ?? []).map(([x, y]) => ({ x, y })),
      { x: to.x, y: to.y },
    ]
    const cumulativeM = [0]
    for (let i = 1; i < polyline.length; i++) {
      cumulativeM.push(cumulativeM[i - 1] + distance(polyline[i - 1], polyline[i]))
    }
    if (edge.branch !== undefined && level.nodes.find((n) => n.id === edge.branch)?.kind !== 'terminal') {
      throw new Error(`Edge "${edge.id}" is a branch toward "${edge.branch}", which is not a terminal`)
    }
    const lengthM = edge.lengthM ?? cumulativeM[cumulativeM.length - 1]
    if (!(lengthM > 0)) throw new Error(`Edge "${edge.id}" has no length`)

    edges.set(edge.id, { id: edge.id, from: edge.from, to: edge.to, polyline, cumulativeM, lengthM })
    edgesAt.get(edge.from)!.push(edge.id)
    if (edge.to !== edge.from) edgesAt.get(edge.to)!.push(edge.id)
  }

  for (const entry of level.schedule) {
    for (const id of [entry.entry, entry.destination]) {
      if (nodes.get(id)?.kind !== 'terminal') {
        throw new Error(`Schedule entry "${entry.id}" references "${id}", which is not a terminal`)
      }
    }
  }

  for (const entry of level.schedule) {
    if (!entry.appearsBetween) continue
    const [fromS, toS] = entry.appearsBetween.map(parseClock)
    const nominalS = parseClock(entry.appearsAt)
    if (!(fromS <= nominalS && nominalS <= toS)) {
      throw new Error(`Schedule entry "${entry.id}" has an appearsBetween window that does not contain appearsAt`)
    }
  }

  const trainIds = new Set(level.schedule.map((entry) => entry.id))
  for (const train of level.startingTrains ?? []) {
    if (trainIds.has(train.id)) throw new Error(`Duplicate train id "${train.id}"`)
    trainIds.add(train.id)
    if (!edges.has(train.edge)) throw new Error(`Starting train "${train.id}" references unknown edge "${train.edge}"`)
    for (const id of train.edgeChoices ?? []) {
      if (!edges.has(id)) throw new Error(`Starting train "${train.id}" references unknown edge "${id}"`)
    }
    if (train.edgeChoices && !train.edgeChoices.includes(train.edge)) {
      throw new Error(`Starting train "${train.id}" has edgeChoices that do not contain its edge`)
    }
    if (nodes.get(train.destination)?.kind !== 'terminal') {
      throw new Error(`Starting train "${train.id}" references "${train.destination}", which is not a terminal`)
    }
  }

  const linkedTo = new Map<string, string>()
  for (const [a, b] of level.links ?? []) {
    for (const id of [a, b]) {
      if (nodes.get(id)?.kind !== 'link') throw new Error(`Link "${a}"–"${b}" references "${id}", which is not a link node`)
      if (linkedTo.has(id)) throw new Error(`Link node "${id}" is joined twice`)
      if (edgesAt.get(id)!.length !== 1) throw new Error(`Link node "${id}" must have exactly one edge`)
    }
    if (a === b) throw new Error(`Link node "${a}" is joined to itself`)
    linkedTo.set(a, b)
    linkedTo.set(b, a)
  }
  for (const node of nodes.values()) {
    if (node.kind === 'link' && !linkedTo.has(node.id)) throw new Error(`Link node "${node.id}" is not joined to another`)
  }

  return { level, nodes, edges, edgesAt, linkedTo }
}

export function getEdge(graph: TrackGraph, edgeId: string): GraphEdge {
  const edge = graph.edges.get(edgeId)
  if (!edge) throw new Error(`Unknown edge "${edgeId}"`)
  return edge
}

export function getNode(graph: TrackGraph, nodeId: string): LevelNode {
  const node = graph.nodes.get(nodeId)
  if (!node) throw new Error(`Unknown node "${nodeId}"`)
  return node
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Node a step ends at. */
export function stepEndNode(edge: GraphEdge, direction: Direction): string {
  return direction === 1 ? edge.to : edge.from
}

/** Distance travelled along a step to reach `offsetM`. */
export function alongStep(edge: GraphEdge, direction: Direction, offsetM: number): number {
  return direction === 1 ? offsetM : edge.lengthM - offsetM
}

/** Inverse of `alongStep`. */
export function offsetOnStep(edge: GraphEdge, direction: Direction, alongM: number): number {
  return direction === 1 ? alongM : edge.lengthM - alongM
}

/** Polyline distance for a track offset (they differ only when `lengthM` is overridden). */
function toGeometric(edge: GraphEdge, offsetM: number): number {
  const total = edge.cumulativeM[edge.cumulativeM.length - 1]
  return (clamp(offsetM, 0, edge.lengthM) / edge.lengthM) * total
}

function pointAtGeometric(edge: GraphEdge, geometricM: number): Vec2 {
  const { polyline, cumulativeM } = edge
  let i = 1
  while (i < polyline.length - 1 && cumulativeM[i] < geometricM) i++
  const segment = cumulativeM[i] - cumulativeM[i - 1]
  const t = segment > 0 ? (geometricM - cumulativeM[i - 1]) / segment : 0
  const a = polyline[i - 1]
  const b = polyline[i]
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function pointAt(edge: GraphEdge, offsetM: number): Vec2 {
  return pointAtGeometric(edge, toGeometric(edge, offsetM))
}

/** The part of an edge's polyline between two offsets, ordered from `fromOffsetM` to `toOffsetM`. */
export function edgePolyline(edge: GraphEdge, fromOffsetM: number, toOffsetM: number): Vec2[] {
  if (fromOffsetM > toOffsetM) return edgePolyline(edge, toOffsetM, fromOffsetM).reverse()
  const a = toGeometric(edge, fromOffsetM)
  const b = toGeometric(edge, toOffsetM)
  const inner = edge.polyline.filter((_, i) => edge.cumulativeM[i] > a && edge.cumulativeM[i] < b)
  return [pointAtGeometric(edge, a), ...inner, pointAtGeometric(edge, b)]
}

/** Unit-less travel heading where a step starts or ends. */
export function heading(edge: GraphEdge, direction: Direction, at: 'start' | 'end'): Vec2 {
  const p = edge.polyline
  const last = p.length - 1
  // Pick the polyline segment at that end, then orient it along the direction of travel.
  const atFromEnd = (direction === 1) === (at === 'start')
  const [a, b] = atFromEnd ? [p[0], p[1]] : [p[last - 1], p[last]]
  return { x: (b.x - a.x) * direction, y: (b.y - a.y) * direction }
}

/** Angle, in degrees, a train turns through going from the end of `from` onto `to` (0 = straight on). */
export function turnDegrees(graph: TrackGraph, from: RouteStep, to: RouteStep): number {
  const a = heading(getEdge(graph, from.edgeId), from.direction, 'end')
  const b = heading(getEdge(graph, to.edgeId), to.direction, 'start')
  const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
}

/**
 * Steps a train can take after finishing `step`. A train runs through a node onto the edges on
 * the far side, never doubling back onto an edge on the side it arrived from.
 */
export function nextSteps(graph: TrackGraph, step: RouteStep): RouteStep[] {
  const edge = getEdge(graph, step.edgeId)
  const nodeId = stepEndNode(edge, step.direction)
  const arriving = heading(edge, step.direction, 'end')
  const result: RouteStep[] = []
  // At a link the track carries on from its partner node, which may be drawn somewhere else entirely.
  const linked = graph.linkedTo.get(nodeId)
  const at = linked ?? nodeId
  for (const nextId of graph.edgesAt.get(at) ?? []) {
    if (nextId === edge.id) continue
    const next = getEdge(graph, nextId)
    const direction: Direction = next.from === at ? 1 : -1
    const leaving = heading(next, direction, 'start')
    if (arriving.x * leaving.x + arriving.y * leaving.y > 0) result.push({ edgeId: nextId, direction })
  }
  return result
}

export function pathLength(graph: TrackGraph, path: readonly RouteStep[]): number {
  return path.reduce((sum, step) => sum + getEdge(graph, step.edgeId).lengthM, 0)
}

export interface PathLocation {
  /** Index into the path. */
  index: number
  /** Path distance at which that step starts. */
  startM: number
  /** Distance travelled along that step. */
  alongM: number
}

/** Finds the step containing a path distance. A distance on a joint belongs to the earlier step. */
export function locateStep(graph: TrackGraph, path: readonly RouteStep[], distM: number): PathLocation {
  if (path.length === 0) throw new Error('Cannot locate a position on an empty path')
  let startM = 0
  for (let index = 0; index < path.length; index++) {
    const lengthM = getEdge(graph, path[index].edgeId).lengthM
    if (distM <= startM + lengthM || index === path.length - 1) {
      return { index, startM, alongM: clamp(distM - startM, 0, lengthM) }
    }
    startM += lengthM
  }
  throw new Error('unreachable')
}

export function locateOnPath(graph: TrackGraph, path: readonly RouteStep[], distM: number): HeadPosition {
  const { index, alongM } = locateStep(graph, path, distM)
  const step = path[index]
  const edge = getEdge(graph, step.edgeId)
  return { edgeId: step.edgeId, offsetM: offsetOnStep(edge, step.direction, alongM), direction: step.direction }
}

/** World-space polyline covering the path between two path distances (clamped to the path). */
export function pathPolyline(graph: TrackGraph, path: readonly RouteStep[], fromM: number, toM: number): Vec2[] {
  const total = pathLength(graph, path)
  const from = clamp(fromM, 0, total)
  const to = clamp(toM, from, total)
  const points: Vec2[] = []
  let startM = 0
  for (const step of path) {
    const edge = getEdge(graph, step.edgeId)
    const a = Math.max(from - startM, 0)
    const b = Math.min(to - startM, edge.lengthM)
    if (a <= b) {
      points.push(
        ...edgePolyline(edge, offsetOnStep(edge, step.direction, a), offsetOnStep(edge, step.direction, b)),
      )
    }
    startM += edge.lengthM
  }
  return points
}

/** Shortest distance from a point to a polyline. */
export function distanceToPolyline(p: Vec2, polyline: readonly Vec2[]): number {
  if (polyline.length === 1) return distance(p, polyline[0])
  let best = Infinity
  for (let i = 1; i < polyline.length; i++) {
    best = Math.min(best, distance(p, projectOnSegment(p, polyline[i - 1], polyline[i]).point))
  }
  return best
}

function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2 } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1) : 0
  return { t, point: { x: a.x + dx * t, y: a.y + dy * t } }
}

export interface NearestTrack extends TrackPosition {
  /** Distance from the query point, in the (possibly y-scaled) space the query was made in. */
  distance: number
}

/**
 * Closest point on any edge. `yScale` supports renderers that exaggerate the vertical axis:
 * pass the point in that scaled space and the track is scaled to match before measuring.
 */
export function nearestTrackPosition(
  graph: TrackGraph,
  p: Vec2,
  yScale = 1,
  include: (edgeId: string) => boolean = () => true,
): NearestTrack | null {
  let best: NearestTrack | null = null
  for (const edge of graph.edges.values()) {
    if (!include(edge.id)) continue
    const total = edge.cumulativeM[edge.cumulativeM.length - 1]
    for (let i = 1; i < edge.polyline.length; i++) {
      const a = edge.polyline[i - 1]
      const b = edge.polyline[i]
      const { t, point } = projectOnSegment(p, { x: a.x, y: a.y * yScale }, { x: b.x, y: b.y * yScale })
      const d = distance(p, point)
      if (best && d >= best.distance) continue
      // t is the same fraction of the segment in world space, so the offset needs no unscaling.
      const geometricM = edge.cumulativeM[i - 1] + t * (edge.cumulativeM[i] - edge.cumulativeM[i - 1])
      best = { edgeId: edge.id, offsetM: (geometricM / total) * edge.lengthM, distance: d }
    }
  }
  return best
}
