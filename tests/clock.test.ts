import { describe, expect, it } from 'vitest'
import { formatClock, parseClock } from '../src/engine/clock'

describe('clock', () => {
  it('parses HH:MM into seconds since midnight', () => {
    expect(parseClock('09:53')).toBe(9 * 3600 + 53 * 60)
    expect(parseClock('0:00')).toBe(0)
  })

  it('rejects malformed times', () => {
    expect(() => parseClock('9.53')).toThrow()
    expect(() => parseClock('24:00')).toThrow()
    expect(() => parseClock('10:60')).toThrow()
  })

  it('formats back to HH:MM, with seconds on request', () => {
    expect(formatClock(parseClock('10:32'))).toBe('10:32')
    expect(formatClock(parseClock('10:32') + 59.9)).toBe('10:32')
    expect(formatClock(parseClock('10:32') + 7, true)).toBe('10:32:07')
  })
})
