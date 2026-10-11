/** Speed held through the last few metres (inside the stop margin) so the head reaches the target. */
export const CREEP_SPEED_MPS = 1

export interface AdvanceInput {
  speedMps: number
  maxSpeedMps: number
  /** Distance from the head to the stop target; `null` = no stop ahead. */
  distanceRemainingM: number | null
  accelMps2: number
  decelMps2: number
  marginM: number
  dtS: number
}

export interface AdvanceResult {
  speedMps: number
  distanceM: number
}

export function brakingDistance(speedMps: number, decelMps2: number): number {
  return (speedMps * speedMps) / (2 * decelMps2)
}

/** Fastest speed from which a train can still brake to a stop within `distanceM`, margin included. */
export function safeSpeed(distanceM: number, decelMps2: number, marginM: number): number {
  return Math.sqrt(2 * decelMps2 * Math.max(0, distanceM - marginM))
}

/** One timestep for one train: accelerate, cruise or brake, and stop exactly on the target. */
export function advance(input: AdvanceInput): AdvanceResult {
  const { speedMps, maxSpeedMps, distanceRemainingM, accelMps2, decelMps2, marginM, dtS } = input
  if (distanceRemainingM !== null && distanceRemainingM <= 0) return { speedMps: 0, distanceM: 0 }

  const braking =
    distanceRemainingM !== null && distanceRemainingM <= brakingDistance(speedMps, decelMps2) + marginM

  let nextSpeed: number
  if (braking) {
    const creep = Math.min(CREEP_SPEED_MPS, maxSpeedMps)
    nextSpeed =
      speedMps < creep ? Math.min(creep, speedMps + accelMps2 * dtS) : Math.max(creep, speedMps - decelMps2 * dtS)
  } else {
    nextSpeed = Math.min(maxSpeedMps, speedMps + accelMps2 * dtS)
  }

  const distanceM = ((speedMps + nextSpeed) / 2) * dtS
  if (distanceRemainingM !== null && distanceM >= distanceRemainingM) {
    return { speedMps: 0, distanceM: distanceRemainingM }
  }
  return { speedMps: nextSpeed, distanceM }
}
