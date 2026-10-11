import { describe, expect, it } from 'vitest'
import { advance, brakingDistance, CREEP_SPEED_MPS, safeSpeed } from '../src/engine/physics'

const base = { maxSpeedMps: 18, accelMps2: 0.25, decelMps2: 0.35, marginM: 5, dtS: 0.1 }

function drive(startSpeed: number, distanceM: number) {
  let speed = startSpeed
  let travelled = 0
  let peak = speed
  let speedBeforeStop = speed
  for (let i = 0; i < 100_000; i++) {
    const r = advance({ ...base, speedMps: speed, distanceRemainingM: distanceM - travelled })
    if (r.speedMps === 0 && r.distanceM === 0) return { travelled, peak, speedBeforeStop, steps: i }
    if (r.speedMps === 0) speedBeforeStop = speed
    speed = r.speedMps
    travelled += r.distanceM
    peak = Math.max(peak, speed)
    expect(travelled).toBeLessThanOrEqual(distanceM + 1e-9)
  }
  throw new Error('never stopped')
}

describe('physics', () => {
  it('computes braking distance as v² / 2a', () => {
    expect(brakingDistance(14, 0.35)).toBeCloseTo(280)
  })

  it('accelerates to max speed, cruises, and stops exactly on the target', () => {
    const run = drive(0, 3000)
    expect(run.travelled).toBeCloseTo(3000, 6)
    expect(run.peak).toBe(18)
  })

  it('arrives at creep speed rather than slamming to a halt', () => {
    expect(drive(0, 3000).speedBeforeStop).toBeLessThanOrEqual(CREEP_SPEED_MPS)
    expect(drive(18, 600).speedBeforeStop).toBeLessThanOrEqual(CREEP_SPEED_MPS)
  })

  it('never reaches max speed on a short hop but still stops exactly', () => {
    const run = drive(0, 200)
    expect(run.travelled).toBeCloseTo(200, 6)
    expect(run.peak).toBeLessThan(18)
  })

  it('still reaches a target that starts inside the stop margin', () => {
    expect(drive(0, 2).travelled).toBeCloseTo(2, 6)
  })

  it('stays put once at the target', () => {
    expect(advance({ ...base, speedMps: 0, distanceRemainingM: 0 })).toEqual({ speedMps: 0, distanceM: 0 })
  })

  it('keeps accelerating to max speed with no stop ahead', () => {
    let speed = 0
    for (let i = 0; i < 2000; i++) speed = advance({ ...base, speedMps: speed, distanceRemainingM: null }).speedMps
    expect(speed).toBe(18)
  })

  it('safeSpeed is a speed the train can stop from', () => {
    const v = safeSpeed(980, 0.35, 5)
    expect(brakingDistance(v, 0.35) + 5).toBeCloseTo(980)
    expect(drive(Math.min(v, 18), 980).travelled).toBeCloseTo(980, 6)
  })
})
