import { describe, expect, it } from 'vitest'
import {
  GAME_CODE_LENGTH,
  MAX_GAME_CODE_LENGTH,
  normalizeGameCode,
  randomGameCode,
  seedFromGameCode,
} from '../src/engine/gameCode'
import { seededRandom } from '../src/engine/random'
import { createInitialState, FIXED_DT_S, step } from '../src/engine/simulation'
import { graph1 } from './helpers'

describe('game codes', () => {
  it('normalizes case, spacing and punctuation', () => {
    expect(normalizeGameCode('k7q-2mx')).toBe('K7Q2MX')
    expect(normalizeGameCode('  K7Q 2MX ')).toBe('K7Q2MX')
    expect(normalizeGameCode('Friday Final!')).toBe('FRIDAYFINAL')
  })

  it('deals the same game for look-alike letters and digits', () => {
    expect(seedFromGameCode('F00L')).toBe(seedFromGameCode('FOO1'))
    expect(seedFromGameCode('K7Q2M0')).toBe(seedFromGameCode('K7Q2MO'))
    expect(seedFromGameCode('ABCI')).toBe(seedFromGameCode('ABCL'))
  })

  it('rejects empty and overlong codes', () => {
    expect(normalizeGameCode('')).toBeNull()
    expect(normalizeGameCode(' -- ')).toBeNull()
    expect(normalizeGameCode('A'.repeat(MAX_GAME_CODE_LENGTH))).not.toBeNull()
    expect(normalizeGameCode('A'.repeat(MAX_GAME_CODE_LENGTH + 1))).toBeNull()
  })

  it('maps a code to the same 32-bit seed every time, and nearby codes far apart', () => {
    const seed = seedFromGameCode('K7Q2MX')
    expect(seed).toBe(seedFromGameCode('K7Q2MX'))
    expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true)
    const neighbours = ['K7Q2MY', 'K7Q2MW', 'J7Q2MX'].map(seedFromGameCode)
    for (const other of neighbours) expect(other).not.toBe(seed)
  })

  it('makes readable random codes that are normalized already', () => {
    const random = seededRandom(42)
    const codes = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const code = randomGameCode(random)
      expect(code).toHaveLength(GAME_CODE_LENGTH)
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/)
      expect(normalizeGameCode(code)).toBe(code)
      codes.add(code)
    }
    expect(codes.size).toBe(500)
  })

  it('gives two players of the same code the same game, and different codes different games', () => {
    // Two hours with nobody dispatching: the timetable, starting sidings and work trains all come from the seed.
    const play = (code: string) => {
      let state = createInitialState(graph1, seedFromGameCode(code))
      for (let i = 0; i < 7200 / FIXED_DT_S && !state.stalled && !state.deadlocked; i++) {
        state = step(graph1, state, FIXED_DT_S)
      }
      return JSON.stringify(state)
    }
    expect(play('K7Q2MX')).toBe(play(normalizeGameCode('k7q-2mx')!))
    const starts = new Set(['K7Q2MX', 'A1B2C3', 'FRIDAYFINAL', 'ZZZZZZ'].map((c) => JSON.stringify(createInitialState(graph1, seedFromGameCode(c)))))
    expect(starts.size).toBe(4)
  })
})
