import { useCallback, type MouseEvent } from 'react'
import { distance, distanceToPolyline, getEdge, nearestTrackPosition, pathPolyline } from '../engine/trackGraph'
import type { TrackPosition, Vec2 } from '../engine/types'
import { edgePage, toView, trainPage, Y_SCALE } from '../render/view'
import { useGameStore } from '../store'

/** Half of a 44 pt touch target. */
const TAP_RADIUS_PX = 22
/** Track is a thin line, so a tap may land a little further from it than from a train. */
const TRACK_RADIUS_PX = 34

/**
 * Tap handler for the map: tap a train to select it, then tap the track (or a terminal) to send
 * it there. Tapping empty space clears the selection.
 */
export function useTapRouting() {
  return useCallback((event: MouseEvent<SVGSVGElement>) => {
    const ctm = event.currentTarget.getScreenCTM()
    if (!ctm) return
    const tap: Vec2 = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
    const unitsPerPx = 1 / ctm.a
    const { graph, game, page, selectedTrainId, selectTrain, routeSelectedTo } = useGameStore.getState()

    let tapped: { id: string; d: number } | null = null
    for (const train of game.trains) {
      if (trainPage(graph, train) !== page) continue
      const body = pathPolyline(graph, train.path, train.headM - graph.level.trainLengthM, train.headM)
      const d = distanceToPolyline(tap, body.map(toView))
      if (d <= TAP_RADIUS_PX * unitsPerPx && (!tapped || d < tapped.d)) tapped = { id: train.id, d }
    }
    if (tapped) {
      selectTrain(tapped.id)
      return
    }
    if (!selectedTrainId) return

    // A tap on a terminal means "leave through it", so aim at the very end of its track.
    for (const node of graph.nodes.values()) {
      const edgeId = graph.edgesAt.get(node.id)?.[0]
      if (node.kind !== 'terminal' || !edgeId || (node.page ?? 1) !== page) continue
      if (distance(tap, toView(node)) <= TRACK_RADIUS_PX * unitsPerPx) {
        const edge = getEdge(graph, edgeId)
        routeSelectedTo({ edgeId, offsetM: edge.from === node.id ? 0 : edge.lengthM })
        return
      }
    }

    const nearest = nearestTrackPosition(graph, tap, Y_SCALE, (id) => edgePage(graph, id) === page)
    if (nearest && nearest.distance <= TRACK_RADIUS_PX * unitsPerPx) {
      const target: TrackPosition = { edgeId: nearest.edgeId, offsetM: nearest.offsetM }
      routeSelectedTo(target)
    } else {
      selectTrain(null)
    }
  }, [])
}
