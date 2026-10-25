/**
 * Game codes: short, shareable names for a game's random seed. Two players who start the same code
 * get the same timetable, starting sidings and work trains, so their scores can be compared
 * (tournament mode).
 *
 * A code is any text a person can read out or type. `normalizeGameCode` folds case and drops spaces
 * and punctuation, so "k7q-2mx", "K7Q 2MX" and "K7Q2MX" are the same game; organizers can also pick
 * a word, such as "FRIDAYFINAL". The seed also reads O as 0 and I/L as 1 (Crockford's base 32), so
 * mistyping a look-alike still deals the same game.
 */

/** Crockford base 32: digits and letters with no I, L, O or U, so codes are easy to read aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Length of a code made by `randomGameCode` (30 bits). */
export const GAME_CODE_LENGTH = 6

/** Longest code accepted, after normalizing. */
export const MAX_GAME_CODE_LENGTH = 24

/** The canonical form of a code, or null if nothing usable is left. */
export function normalizeGameCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return code.length > 0 && code.length <= MAX_GAME_CODE_LENGTH ? code : null
}

/**
 * The 32-bit seed for a normalized code: look-alikes folded (O→0, I/L→1), then FNV-1a with a final
 * mix so similar codes differ widely.
 */
export function seedFromGameCode(normalized: string): number {
  const code = normalized.replace(/O/g, '0').replace(/[IL]/g, '1')
  let h = 0x811c9dc5
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A fresh `GAME_CODE_LENGTH`-character code, drawing from `random` (values in [0, 1)). */
export function randomGameCode(random: () => number): string {
  let code = ''
  for (let i = 0; i < GAME_CODE_LENGTH; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return code
}
