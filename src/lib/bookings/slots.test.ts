import { describe, it, expect } from 'vitest'
import { checkSlot, freeSlots, loadTakenSlots } from './slots'
import { createFakeDb } from './test-db'
import type { BookingType } from './types'

const TZ = 'Asia/Kolkata'

const TYPE: BookingType = {
  id: 't1',
  key: 'demo',
  name: 'Demo',
  fields: [],
  time_mode: 'required',
  duration_minutes: 60,
  instructions: null,
  assignee_user_id: null,
  handoff_on_confirm: false,
  remind_minutes_before: 60,
  slot_capacity: 1,
  available_days: [1, 2, 3, 4, 5, 6],
  available_from: '09:00:00',
  available_to: '18:00:00',
}

// All in IST: Monday 2 Nov 2026.
const MON_11AM = '2026-11-02T05:30:00.000Z'
const MON_1130AM = '2026-11-02T06:00:00.000Z'
const MON_12PM = '2026-11-02T06:30:00.000Z'
const MON_8AM = '2026-11-02T02:30:00.000Z'
const MON_530PM = '2026-11-02T12:00:00.000Z'
const SUN_11AM = '2026-11-01T05:30:00.000Z'

describe('checkSlot', () => {
  it('accepts a free time inside working hours', () => {
    expect(checkSlot(TYPE, MON_11AM, [], TZ)).toBe('free')
  })

  it('refuses a day the business is closed', () => {
    expect(checkSlot(TYPE, SUN_11AM, [], TZ)).toBe('outside_hours')
  })

  it('refuses a time before opening', () => {
    expect(checkSlot(TYPE, MON_8AM, [], TZ)).toBe('outside_hours')
  })

  it('refuses a booking that would run past closing', () => {
    expect(checkSlot(TYPE, MON_530PM, [], TZ)).toBe('outside_hours')
  })

  it('refuses a slot at capacity', () => {
    expect(checkSlot(TYPE, MON_11AM, [MON_11AM], TZ)).toBe('full')
  })

  it('refuses a partial overlap', () => {
    expect(checkSlot(TYPE, MON_1130AM, [MON_11AM], TZ)).toBe('full')
  })

  it('allows a booking that starts when the last one ends', () => {
    expect(checkSlot(TYPE, MON_12PM, [MON_11AM], TZ)).toBe('free')
  })

  it('allows overlaps up to the capacity', () => {
    const crews = { ...TYPE, slot_capacity: 2 }
    expect(checkSlot(crews, MON_11AM, [MON_11AM], TZ)).toBe('free')
    expect(checkSlot(crews, MON_11AM, [MON_11AM, MON_11AM], TZ)).toBe('full')
  })

  it('never fills a type with no capacity limit', () => {
    const open = { ...TYPE, slot_capacity: null }
    expect(checkSlot(open, MON_11AM, [MON_11AM, MON_11AM, MON_11AM], TZ)).toBe('free')
  })
})

describe('freeSlots', () => {
  const SAT_NIGHT = new Date('2026-10-31T18:00:00.000Z')

  it('starts at the next open time and skips closed days', () => {
    expect(freeSlots(TYPE, [], TZ, SAT_NIGHT)[0].toISOString()).toBe('2026-11-02T03:30:00.000Z')
  })

  it('skips taken slots', () => {
    const slots = freeSlots(TYPE, ['2026-11-02T03:30:00.000Z'], TZ, SAT_NIGHT)
    expect(slots[0].toISOString()).toBe('2026-11-02T04:30:00.000Z')
  })

  it('never offers a time in the past', () => {
    const midday = new Date('2026-11-02T06:45:00.000Z')
    for (const slot of freeSlots(TYPE, [], TZ, midday)) {
      expect(slot.getTime()).toBeGreaterThan(midday.getTime())
    }
  })

  it('spreads offers across days', () => {
    const days = new Set(
      freeSlots(TYPE, [], TZ, SAT_NIGHT).map((s) => s.toISOString().slice(0, 10)),
    )
    expect(days.size).toBeGreaterThan(1)
  })

  it('returns nothing when no working day is set', () => {
    expect(freeSlots({ ...TYPE, available_days: [] }, [], TZ, SAT_NIGHT)).toEqual([])
  })
})

describe('loadTakenSlots', () => {
  const NOW = new Date('2026-10-31T18:00:00.000Z')
  const row = (overrides: Record<string, unknown>) => ({
    id: 'b',
    account_id: 'a1',
    booking_type_id: 't1',
    status: 'open',
    scheduled_at: MON_11AM,
    ...overrides,
  })

  it('counts open and review bookings for the type', async () => {
    const db = createFakeDb({
      bookings: [
        row({ id: 'b1' }),
        row({ id: 'b2', status: 'needs_review', scheduled_at: MON_12PM }),
        row({ id: 'b3', status: 'done' }),
        row({ id: 'b4', status: 'cancelled' }),
        row({ id: 'b5', booking_type_id: 't2' }),
        row({ id: 'b6', account_id: 'a2' }),
      ],
    })
    expect(await loadTakenSlots(db.client, 'a1', 't1', NOW)).toEqual([MON_11AM, MON_12PM])
  })

  it('can leave out the booking being changed', async () => {
    const db = createFakeDb({ bookings: [row({ id: 'b1' })] })
    expect(await loadTakenSlots(db.client, 'a1', 't1', NOW, 'b1')).toEqual([])
  })

  it('returns null when the lookup fails', async () => {
    const db = createFakeDb({ bookings: [] })
    db.failNext('bookings', 'select')
    expect(await loadTakenSlots(db.client, 'a1', 't1', NOW)).toBeNull()
  })
})

describe('daily break', () => {
  // Monday 2 Nov 2026, IST. Lunch 13:00-14:00, 60-minute bookings.
  const LUNCH: BookingType = { ...TYPE, break_from: '13:00:00', break_to: '14:00:00' }
  const MON_1PM = '2026-11-02T07:30:00.000Z'
  const MON_1230PM = '2026-11-02T07:00:00.000Z'
  const MON_2PM = '2026-11-02T08:30:00.000Z'
  const MON_205PM = '2026-11-02T08:35:00.000Z'
  const MON_1215PM = '2026-11-02T06:45:00.000Z'

  it('accepts 2:05 pm, after a 1-2 pm lunch break', () => {
    expect(checkSlot(LUNCH, MON_205PM, [], TZ)).toBe('free')
  })

  it('accepts a booking that starts exactly when the break ends', () => {
    expect(checkSlot(LUNCH, MON_2PM, [], TZ)).toBe('free')
  })

  it('accepts a booking that ends exactly when the break starts', () => {
    expect(checkSlot({ ...LUNCH, available_from: '09:00' }, '2026-11-02T06:30:00.000Z', [], TZ)).toBe('free')
  })

  it('refuses a booking that starts during the break', () => {
    expect(checkSlot(LUNCH, MON_1PM, [], TZ)).toBe('outside_hours')
  })

  it('refuses a booking that runs into the break', () => {
    expect(checkSlot(LUNCH, MON_1230PM, [], TZ)).toBe('outside_hours')
    expect(checkSlot(LUNCH, MON_1215PM, [], TZ)).toBe('outside_hours')
  })

  it('changes nothing for a type without a break', () => {
    expect(checkSlot(TYPE, MON_1PM, [], TZ)).toBe('free')
    expect(checkSlot({ ...TYPE, break_from: null, break_to: null }, MON_1PM, [], TZ)).toBe('free')
  })

  it('never offers a time that overlaps the break', () => {
    const SAT_NIGHT = new Date('2026-10-31T18:00:00.000Z')
    const slots = freeSlots({ ...LUNCH, available_from: '12:00' }, [], TZ, SAT_NIGHT)
    expect(slots.slice(0, 2).map((s) => s.toISOString())).toEqual([
      '2026-11-02T06:30:00.000Z', // 12:00, ends as lunch starts
      MON_2PM, // 13:00 is skipped
    ])
  })

  it('offers the break end even when the duration does not line up with it', () => {
    const SAT_NIGHT = new Date('2026-10-31T18:00:00.000Z')
    const slots = freeSlots({ ...LUNCH, duration_minutes: 45, available_from: '12:00' }, [], TZ, SAT_NIGHT)
    expect(slots.slice(0, 2).map((s) => s.toISOString())).toEqual([
      '2026-11-02T06:30:00.000Z', // 12:00-12:45
      MON_2PM, // 12:45 and 13:30 overlap lunch; resumes at 14:00, not 14:15
    ])
  })
})
