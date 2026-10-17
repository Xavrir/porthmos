import { describe, expect, it } from 'vitest'
import { day } from './format'

describe('day', () => {
  it('formats a bare date, a full ISO timestamp from the service, and unix seconds alike', () => {
    expect(day('2026-10-31')).toBe(day('2026-10-31T12:00:00Z'))
    expect(day(Date.parse('2026-10-31T12:00:00Z') / 1000)).toBe(day('2026-10-31T12:00:00Z'))
  })
  it('never throws on a bad value', () => {
    expect(day('not a date')).toBe('not a date')
  })
})
