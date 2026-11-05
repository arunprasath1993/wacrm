import { describe, it, expect, vi } from 'vitest'
import { loadBookingContext } from './load'
import { createFakeDb } from './test-db'

const row = (id: string, overrides = {}) => ({
  id,
  account_id: 'a1',
  key: id,
  name: id,
  fields: [],
  time_mode: 'none',
  duration_minutes: 30,
  instructions: null,
  assignee_user_id: null,
  handoff_on_confirm: false,
  remind_minutes_before: null,
  is_active: true,
  archived_at: null,
  ...overrides,
})

describe('loadBookingContext', () => {
  it('returns active types and the account timezone', async () => {
    const db = createFakeDb({
      accounts: [{ id: 'a1', time_zone: 'Asia/Dubai' }],
      booking_types: [
        row('live'),
        row('off', { is_active: false }),
        row('gone', { archived_at: '2026-01-01T00:00:00Z' }),
        row('elsewhere', { account_id: 'a2' }),
      ],
    })

    const context = await loadBookingContext(db.client, 'a1')

    expect(context.timeZone).toBe('Asia/Dubai')
    expect(context.types.map((t) => t.key)).toEqual(['live'])
  })

  it('falls back to no bookings so replies keep working before the migration runs', async () => {
    const db = createFakeDb({ accounts: [{ id: 'a1' }], booking_types: [] })
    db.failNext('accounts', 'select')

    expect(await loadBookingContext(db.client, 'a1')).toEqual({ types: [], timeZone: null })
  })

  it('still returns the timezone when only the types lookup fails', async () => {
    const db = createFakeDb({ accounts: [{ id: 'a1', time_zone: 'Asia/Kolkata' }] })
    db.failNext('booking_types', 'select')

    expect(await loadBookingContext(db.client, 'a1')).toEqual({
      types: [],
      timeZone: 'Asia/Kolkata',
    })
  })
})

describe('loadBookingContext before migration 067', () => {
  it('retries without the break columns instead of dropping every type', async () => {
    const db = createFakeDb({
      accounts: [{ id: 'a1', time_zone: 'Asia/Kolkata' }],
      booking_types: [row('live')],
    })
    db.failNext('booking_types', 'select')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const context = await loadBookingContext(db.client, 'a1')
    warn.mockRestore()

    expect(context.types.map((t) => t.key)).toEqual(['live'])
  })
})
