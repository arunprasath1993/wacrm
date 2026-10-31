import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { saveBookingFromAi } from './save'
import { createFakeDb, type FakeDb } from './test-db'
import type { BookingMarker, BookingType } from './types'

const NOW = new Date('2026-10-31T18:00:00.000Z')

const DEMO: BookingType = {
  id: 'type-demo',
  key: 'online_demo',
  name: 'Online Demo',
  fields: [
    { key: 'name', label: 'Name', required: true, maps_to: 'name' },
    { key: 'business', label: 'Business', required: true, maps_to: 'company' },
    { key: 'notes', label: 'Notes', required: false, maps_to: null },
  ],
  time_mode: 'required',
  duration_minutes: 30,
  instructions: null,
  assignee_user_id: 'agent-1',
  handoff_on_confirm: false,
  remind_minutes_before: 60,
}

const CALLBACK: BookingType = {
  ...DEMO,
  id: 'type-callback',
  key: 'callback',
  name: 'Callback',
  fields: [],
  time_mode: 'none',
  assignee_user_id: null,
}

function marker(overrides: Partial<BookingMarker> = {}): BookingMarker {
  return {
    type: 'online_demo',
    action: 'save',
    fields: { name: 'Ramu', business: 'NixAqua' },
    scheduledLocal: '2026-11-01T11:00',
    scheduledText: 'Tomorrow at 11 AM',
    ...overrides,
  }
}

let db: FakeDb

function save(m: BookingMarker, overrides: Record<string, unknown> = {}) {
  return saveBookingFromAi({
    db: db.client,
    accountId: 'acct-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    ownerUserId: 'owner-1',
    handoffAgentId: 'handoff-1',
    types: [DEMO, CALLBACK],
    timeZone: 'Asia/Kolkata',
    marker: m,
    now: NOW,
    ...overrides,
  })
}

beforeEach(() => {
  db = createFakeDb({
    bookings: [],
    contact_notes: [],
    profiles: [
      { user_id: 'agent-1', account_id: 'acct-1' },
      { user_id: 'handoff-1', account_id: 'acct-1' },
      { user_id: 'owner-1', account_id: 'acct-1' },
      { user_id: 'outsider', account_id: 'acct-2' },
    ],
    contacts: [
      { id: 'contact-1', account_id: 'acct-1', name: '', email: null, company: 'Existing Co' },
    ],
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('saveBookingFromAi — new booking', () => {
  it('records an open booking with the parsed time', async () => {
    const result = await save(marker())

    expect(result).toMatchObject({ ok: true, outcome: 'created' })
    expect(db.tables.bookings).toHaveLength(1)
    expect(db.tables.bookings[0]).toMatchObject({
      account_id: 'acct-1',
      booking_type_id: 'type-demo',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      assigned_to: 'agent-1',
      status: 'open',
      source: 'ai',
      fields: { name: 'Ramu', business: 'NixAqua' },
      scheduled_at: '2026-11-01T05:30:00.000Z',
      scheduled_text: 'Tomorrow at 11 AM',
    })
  })

  it('drops fields the type does not define', async () => {
    await save(marker({ fields: { name: 'Ramu', business: 'N', role: 'admin' } }))
    expect(db.tables.bookings[0].fields).toEqual({ name: 'Ramu', business: 'N' })
  })

  it('flags a booking missing a required field for review, and still saves it', async () => {
    const result = await save(marker({ fields: { name: 'Ramu' } }))
    expect(result).toMatchObject({ ok: true, outcome: 'created' })
    expect(db.tables.bookings[0].status).toBe('needs_review')
  })

  it('keeps the customer words and flags review when the time cannot be parsed', async () => {
    await save(marker({ scheduledLocal: 'evening', scheduledText: 'tomorrow evening' }))
    expect(db.tables.bookings[0]).toMatchObject({
      status: 'needs_review',
      scheduled_at: null,
      scheduled_text: 'tomorrow evening',
    })
  })

  it('flags a past time for review rather than saving it', async () => {
    await save(marker({ scheduledLocal: '2026-10-01T11:00' }))
    expect(db.tables.bookings[0]).toMatchObject({ status: 'needs_review', scheduled_at: null })
  })

  it('stores no time for a type that does not use one', async () => {
    await save(marker({ type: 'callback', fields: {} }))
    expect(db.tables.bookings[0]).toMatchObject({
      status: 'open',
      scheduled_at: null,
      scheduled_text: null,
    })
  })

  it('falls back to the handoff agent when the type has no assignee', async () => {
    await save(marker({ type: 'callback', fields: {} }))
    expect(db.tables.bookings[0].assigned_to).toBe('handoff-1')
  })

  it('falls back to the owner when no other assignee is available', async () => {
    await save(marker({ type: 'callback', fields: {} }), { handoffAgentId: null })
    expect(db.tables.bookings[0].assigned_to).toBe('owner-1')
  })

  it('skips an assignee who left the account', async () => {
    const types = [{ ...DEMO, assignee_user_id: 'outsider' }]
    await save(marker(), { types })
    expect(db.tables.bookings[0].assigned_to).toBe('handoff-1')
  })

  it('leaves a note the agent can read', async () => {
    await save(marker())
    expect(db.tables.contact_notes).toHaveLength(1)
    const note = db.tables.contact_notes[0]
    expect(note).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      user_id: 'owner-1',
    })
    expect(note.note_text).toContain('Online Demo')
    expect(note.note_text).toContain('Ramu')
    expect(note.note_text).toContain('NixAqua')
    expect(note.note_text).toContain('Tomorrow at 11 AM')
  })

  it('fills empty contact columns without overwriting existing ones', async () => {
    await save(marker())
    expect(db.tables.contacts[0]).toMatchObject({ name: 'Ramu', company: 'Existing Co' })
  })
})

describe('saveBookingFromAi — existing open booking', () => {
  it('updates it on reschedule instead of adding a second one', async () => {
    await save(marker())
    const result = await save(
      marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM' }),
    )

    expect(result).toMatchObject({ ok: true, outcome: 'updated' })
    expect(db.tables.bookings).toHaveLength(1)
    expect(db.tables.bookings[0]).toMatchObject({
      scheduled_at: '2026-11-02T09:30:00.000Z',
      scheduled_text: 'Monday 3 PM',
    })
  })

  it('records the previous time in a note', async () => {
    await save(marker())
    await save(marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM' }))

    expect(db.tables.contact_notes).toHaveLength(2)
    expect(db.tables.contact_notes[1].note_text).toContain('Tomorrow at 11 AM')
    expect(db.tables.contact_notes[1].note_text).toContain('Monday 3 PM')
  })

  it('does nothing when the model repeats the same details', async () => {
    await save(marker())
    const result = await save(marker())

    expect(result).toMatchObject({ ok: true, outcome: 'unchanged' })
    expect(db.tables.contact_notes).toHaveLength(1)
  })

  it('keeps earlier details the new marker omits', async () => {
    await save(marker())
    await save(marker({ fields: { notes: 'Bring pricing' } }))
    expect(db.tables.bookings[0].fields).toEqual({
      name: 'Ramu',
      business: 'NixAqua',
      notes: 'Bring pricing',
    })
  })

  it('moves out of review once the missing detail arrives', async () => {
    await save(marker({ fields: { name: 'Ramu' } }))
    await save(marker({ fields: { business: 'NixAqua' } }))
    expect(db.tables.bookings[0].status).toBe('open')
  })

  it('keeps the saved time when an update has no usable one', async () => {
    await save(marker())
    await save(marker({ scheduledLocal: null, scheduledText: null, fields: { notes: 'x' } }))
    expect(db.tables.bookings[0]).toMatchObject({
      status: 'open',
      scheduled_at: '2026-11-01T05:30:00.000Z',
      scheduled_text: 'Tomorrow at 11 AM',
    })
  })

  it('does not reassign a booking an agent already owns', async () => {
    await save(marker())
    db.tables.bookings[0].assigned_to = 'owner-1'
    await save(marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM' }))
    expect(db.tables.bookings[0].assigned_to).toBe('owner-1')
  })

  it('falls back to updating when a concurrent insert wins the unique index', async () => {
    await save(marker())
    const realFrom = db.client.from.bind(db.client)
    let lookups = 0
    db.client.from = ((table: string) => {
      const builder = realFrom(table) as unknown as Record<string, unknown>
      if (table !== 'bookings') return builder
      const maybeSingle = builder.maybeSingle as () => Promise<unknown>
      builder.maybeSingle = async () => {
        await maybeSingle()
        lookups += 1
        // First lookup misses, as if the other inbound hadn't committed.
        return lookups === 1 ? { data: null, error: null } : maybeSingle()
      }
      return builder
    }) as unknown as typeof db.client.from
    db.failNext('bookings', 'insert', '23505')

    const result = await save(
      marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM' }),
    )

    expect(result).toMatchObject({ ok: true, outcome: 'updated' })
    expect(db.tables.bookings).toHaveLength(1)
  })
})

describe('saveBookingFromAi — cancel', () => {
  it('cancels the open booking and notes it', async () => {
    await save(marker())
    const result = await save(marker({ action: 'cancel' }))

    expect(result).toMatchObject({ ok: true, outcome: 'cancelled' })
    expect(db.tables.bookings[0].status).toBe('cancelled')
    expect(db.tables.contact_notes[1].note_text).toContain('cancelled')
  })

  it('is a no-op when there is nothing to cancel', async () => {
    const result = await save(marker({ action: 'cancel' }))
    expect(result).toMatchObject({ ok: true, outcome: 'unchanged' })
    expect(db.tables.bookings).toHaveLength(0)
  })
})

describe('saveBookingFromAi — failures', () => {
  it('refuses a type the account does not offer', async () => {
    const result = await save(marker({ type: 'free_money' }))
    expect(result.ok).toBe(false)
    expect(db.tables.bookings).toHaveLength(0)
  })

  it('reports failure when the booking cannot be stored', async () => {
    db.failNext('bookings', 'insert')
    const result = await save(marker())
    expect(result.ok).toBe(false)
  })

  it('reports failure when the lookup errors, without writing', async () => {
    db.failNext('bookings', 'select')
    const result = await save(marker())
    expect(result.ok).toBe(false)
    expect(db.tables.bookings).toHaveLength(0)
  })

  it('still succeeds when only the note fails', async () => {
    db.failNext('contact_notes', 'insert')
    const result = await save(marker())
    expect(result).toMatchObject({ ok: true, outcome: 'created' })
  })

  it('still succeeds when filling the contact fails', async () => {
    db.failNext('contacts', 'update')
    const result = await save(marker())
    expect(result).toMatchObject({ ok: true, outcome: 'created' })
  })
})
