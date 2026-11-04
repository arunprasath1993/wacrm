import { describe, it, expect } from 'vitest'
import { loadCustomerMemory } from './memory'
import { createFakeDb } from './test-db'

const NOTE = 'Internal: this customer is difficult'

function seed() {
  return createFakeDb({
    contacts: [{ id: 'c1', account_id: 'a1', name: 'Ramu', company: 'NixAqua' }],
    contact_notes: [{ id: 'n1', account_id: 'a1', contact_id: 'c1', note_text: NOTE }],
    booking_types: [
      {
        id: 't1',
        account_id: 'a1',
        name: 'Online Demo',
        fields: [{ key: 'business', label: 'Business', required: true, maps_to: null }],
      },
    ],
    bookings: [
      {
        id: 'b1',
        account_id: 'a1',
        contact_id: 'c1',
        booking_type_id: 't1',
        status: 'open',
        fields: { business: 'NixAqua' },
        scheduled_at: '2026-11-01T05:30:00.000Z',
        scheduled_text: 'Tomorrow at 11 AM',
        booking_type: { name: 'Online Demo', fields: [{ key: 'business', label: 'Business' }] },
      },
    ],
  })
}

describe('loadCustomerMemory', () => {
  it('returns the contact and their bookings in the account timezone', async () => {
    const memory = await loadCustomerMemory(seed().client, 'a1', 'c1', 'Asia/Kolkata')

    expect(memory).toMatchObject({ name: 'Ramu', company: 'NixAqua' })
    expect(memory?.bookings).toHaveLength(1)
    expect(memory?.bookings[0]).toMatchObject({
      typeName: 'Online Demo',
      status: 'open',
      details: [{ label: 'Business', value: 'NixAqua' }],
    })
    expect(memory?.bookings[0].when).toContain('11:00 am')
  })

  it('never includes internal contact notes', async () => {
    const memory = await loadCustomerMemory(seed().client, 'a1', 'c1', 'Asia/Kolkata')
    expect(JSON.stringify(memory)).not.toContain(NOTE)
  })

  it('falls back to the customer words when no time is set', async () => {
    const db = seed()
    db.tables.bookings[0].scheduled_at = null
    const memory = await loadCustomerMemory(db.client, 'a1', 'c1', 'Asia/Kolkata')
    expect(memory?.bookings[0].when).toBe('Tomorrow at 11 AM')
  })

  it('scopes bookings to the account', async () => {
    const db = seed()
    db.tables.bookings[0].account_id = 'other'
    const memory = await loadCustomerMemory(db.client, 'a1', 'c1', 'Asia/Kolkata')
    expect(memory?.bookings).toEqual([])
  })

  it('returns null instead of failing the reply when the lookup errors', async () => {
    const db = seed()
    db.failNext('bookings', 'select')
    expect(await loadCustomerMemory(db.client, 'a1', 'c1', 'Asia/Kolkata')).toBeNull()
  })
})
