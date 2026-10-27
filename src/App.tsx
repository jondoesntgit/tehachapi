import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTapRouting } from './input/useTapRouting'
import { ArrivalLayer } from './render/ArrivalLayer'
import { Hud } from './render/Hud'
import { TrackLayer } from './render/TrackLayer'
import { TrainLayer } from './render/TrainLayer'
import { viewBox } from './render/view'
import { useGameStore } from './store'

function useGameLoop() {
  useEffect(() => {
    let frame = 0
    let last: number | null = null
    const loop = (now: number) => {
      if (last !== null) useGameStore.getState().tick((now - last) / 1000)
      last = now
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])
}

/** View units per CSS pixel of the map, kept current as the screen resizes or rotates. */
function useUnitsPerPx(svgRef: RefObject<SVGSVGElement | null>): number {
  const [unitsPerPx, setUnitsPerPx] = useState(1)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => {
      const ctm = svg.getScreenCTM()
      if (ctm && ctm.a > 0) setUnitsPerPx(1 / ctm.a)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    measure()
    return () => observer.disconnect()
  }, [svgRef])
  return unitsPerPx
}

export function App() {
  const graph = useGameStore((s) => s.graph)
  const page = useGameStore((s) => s.page)
  const onTap = useTapRouting()
  const svgRef = useRef<SVGSVGElement>(null)
  const unitsPerPx = useUnitsPerPx(svgRef)
  useGameLoop()

  return (
    <main className="app">
      <svg ref={svgRef} className="map" viewBox={viewBox(graph, page)} preserveAspectRatio="xMidYMid meet" onClick={onTap}>
        <TrackLayer unitsPerPx={unitsPerPx} />
        <TrainLayer />
        <ArrivalLayer />
      </svg>
      <Hud />
    </main>
  )
}
