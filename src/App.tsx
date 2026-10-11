import { useEffect } from 'react'
import { useTapRouting } from './input/useTapRouting'
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

export function App() {
  const graph = useGameStore((s) => s.graph)
  const onTap = useTapRouting()
  useGameLoop()

  return (
    <main className="app">
      <svg className="map" viewBox={viewBox(graph)} preserveAspectRatio="xMidYMid meet" onClick={onTap}>
        <TrackLayer />
        <TrainLayer />
      </svg>
      <Hud />
    </main>
  )
}
