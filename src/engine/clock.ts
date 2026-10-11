/** Parses "HH:MM" into seconds since midnight. */
export function parseClock(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!match) throw new Error(`Invalid clock time "${hhmm}"`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error(`Invalid clock time "${hhmm}"`)
  return hours * 3600 + minutes * 60
}

/** Formats seconds since midnight as "HH:MM", or "HH:MM:SS" when `withSeconds` is set. */
export function formatClock(timeS: number, withSeconds = false): string {
  const total = Math.floor(timeS)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${pad(Math.floor(total / 3600) % 24)}:${pad(Math.floor(total / 60) % 60)}`
  return withSeconds ? `${hhmm}:${pad(total % 60)}` : hhmm
}
