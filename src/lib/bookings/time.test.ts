import { describe, it, expect } from 'vitest'
import { formatBookingTime, parseScheduledLocal } from './time'

const NOW = new Date('2026-10-31T18:00:00.000Z') // 23:30 on Oct 31 in IST

describe('parseScheduledLocal', () => {
  it('converts account wall-clock time to the correct instant', () => {
    expect(
      parseScheduledLocal('2026-11-01T11:00', 'Asia/Kolkata', NOW)?.toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z')
  })

  it('honours daylight saving in zones that have it', () => {
    expect(
      parseScheduledLocal('2026-11-02T09:00', 'America/New_York', NOW)?.toISOString(),
    ).toBe('2026-11-02T14:00:00.000Z')
  })

  it('accepts a seconds component', () => {
    expect(
      parseScheduledLocal('2026-11-01T11:00:00', 'Asia/Kolkata', NOW)?.toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z')
  })

  it('rejects a time in the past', () => {
    expect(parseScheduledLocal('2026-10-31T23:00', 'Asia/Kolkata', NOW)).toBeNull()
  })

  it('rejects a date that does not exist', () => {
    expect(parseScheduledLocal('2026-02-30T11:00', 'Asia/Kolkata', NOW)).toBeNull()
  })

  it('rejects anything that is not a wall-clock timestamp', () => {
    expect(parseScheduledLocal('tomorrow 11 AM', 'Asia/Kolkata', NOW)).toBeNull()
    expect(parseScheduledLocal('2026-11-01T11:00:00Z', 'Asia/Kolkata', NOW)).toBeNull()
    expect(parseScheduledLocal(null, 'Asia/Kolkata', NOW)).toBeNull()
  })
})

describe('formatBookingTime', () => {
  it('renders the instant in the account timezone', () => {
    const formatted = formatBookingTime('2026-11-01T05:30:00.000Z', 'Asia/Kolkata')
    expect(formatted).toContain('1 Nov')
    expect(formatted).toContain('11:00 am')
  })
})
