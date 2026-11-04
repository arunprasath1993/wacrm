import { describe, it, expect } from 'vitest'
import { sendDueBookingReminders } from './reminders'
import { createFakeDb } from './test-db'

const NOW = new Date('2026-11-01T05:00:00.000Z')

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    account_id: 'a1',
    contact_id: 'c1',
    conversation_id: 'conv-1',
    assigned_to: 'agent-1',
    status: 'open',
    scheduled_at: '2026-11-01T05:30:00.000Z',
    remind_at: '2026-11-01T04:30:00.000Z',
    reminded_at: null,
    booking_type: { name: 'Online Demo' },
    contact: { name: 'Ramu', phone: '919000000000' },
    account: { time_zone: 'Asia/Kolkata' },
    ...overrides,
  }
}

function seed(rows: Record<string, unknown>[]) {
  return createFakeDb({ bookings: rows, notifications: [] })
}

describe('sendDueBookingReminders', () => {
  it('notifies the assignee of a due booking', async () => {
    const db = seed([booking()])

    expect(await sendDueBookingReminders(db.client, NOW)).toBe(1)

    expect(db.tables.notifications).toHaveLength(1)
    const notification = db.tables.notifications[0]
    expect(notification).toMatchObject({
      account_id: 'a1',
      user_id: 'agent-1',
      type: 'booking_reminder',
      booking_id: 'b1',
      conversation_id: 'conv-1',
      contact_id: 'c1',
    })
    expect(notification.title).toContain('Online Demo')
    expect(notification.body).toContain('Ramu')
    expect(notification.body).toContain('11:00 am')
  })

  it('reminds only once across runs', async () => {
    const db = seed([booking()])
    await sendDueBookingReminders(db.client, NOW)
    await sendDueBookingReminders(db.client, NOW)
    expect(db.tables.notifications).toHaveLength(1)
  })

  it('reminds only once across overlapping runs', async () => {
    const db = seed([booking()])
    await Promise.all([
      sendDueBookingReminders(db.client, NOW),
      sendDueBookingReminders(db.client, NOW),
    ])
    expect(db.tables.notifications).toHaveLength(1)
  })

  it.each([
    ['not due yet', { remind_at: '2026-11-01T05:10:00.000Z' }],
    ['already over', { scheduled_at: '2026-11-01T04:00:00.000Z' }],
    ['done', { status: 'done' }],
    ['cancelled', { status: 'cancelled' }],
    ['with no reminder', { remind_at: null }],
  ])('skips a booking that is %s', async (_name, overrides) => {
    const db = seed([booking(overrides)])
    expect(await sendDueBookingReminders(db.client, NOW)).toBe(0)
    expect(db.tables.notifications).toHaveLength(0)
  })

  it('marks an unassigned booking without notifying anyone', async () => {
    const db = seed([booking({ assigned_to: null })])
    await sendDueBookingReminders(db.client, NOW)
    expect(db.tables.notifications).toHaveLength(0)
    expect(db.tables.bookings[0].reminded_at).not.toBeNull()
  })

  it('returns 0 rather than failing the cron when the lookup errors', async () => {
    const db = seed([booking()])
    db.failNext('bookings', 'select')
    expect(await sendDueBookingReminders(db.client, NOW)).toBe(0)
  })
})
