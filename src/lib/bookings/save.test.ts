import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { previewSlotCheck, saveBookingFromAi } from './save'
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
  slot_capacity: 1,
  available_days: [1, 2, 3, 4, 5, 6, 7],
  available_from: '09:00',
  available_to: '18:00',
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
    onExisting: null,
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
      marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM', onExisting: 'update' }),
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
    await save(marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM', onExisting: 'update' }))

    expect(db.tables.contact_notes).toHaveLength(2)
    expect(db.tables.contact_notes[1].note_text).toContain('Tomorrow at 11 AM')
    expect(db.tables.contact_notes[1].note_text).toContain('Monday 3 PM')
  })

  it('treats the same time in other words as no change', async () => {
    await save(marker())
    const result = await save(marker({ scheduledText: 'Sunday 11' }))

    expect(result).toMatchObject({ ok: true, outcome: 'unchanged' })
    expect(db.tables.contact_notes).toHaveLength(1)
  })

  it('does nothing when the model repeats the same details', async () => {
    await save(marker())
    const result = await save(marker())

    expect(result).toMatchObject({ ok: true, outcome: 'unchanged' })
    expect(db.tables.contact_notes).toHaveLength(1)
  })

  it('keeps earlier details the new marker omits', async () => {
    await save(marker())
    await save(marker({ fields: { notes: 'Bring pricing' }, onExisting: 'update' }))
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
    await save(
      marker({ scheduledLocal: null, scheduledText: null, fields: { notes: 'x' }, onExisting: 'update' }),
    )
    expect(db.tables.bookings[0]).toMatchObject({
      status: 'open',
      scheduled_at: '2026-11-01T05:30:00.000Z',
      scheduled_text: 'Tomorrow at 11 AM',
    })
  })

  it('does not reassign a booking an agent already owns', async () => {
    await save(marker())
    db.tables.bookings[0].assigned_to = 'owner-1'
    await save(marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM', onExisting: 'update' }))
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
      marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM', onExisting: 'update' }),
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

describe('previewSlotCheck', () => {
  const preview = (m: BookingMarker, types = [DEMO, CALLBACK]) =>
    previewSlotCheck({
      db: db.client,
      accountId: 'acct-1',
      types,
      timeZone: 'Asia/Kolkata',
      marker: m,
      now: NOW,
    })

  it('flags a taken slot without saving anything', async () => {
    db.tables.bookings.push({
      id: 'held',
      account_id: 'acct-1',
      contact_id: 'someone-else',
      booking_type_id: 'type-demo',
      status: 'open',
      fields: {},
      scheduled_at: '2026-11-01T05:30:00.000Z',
      scheduled_text: null,
    })

    const result = await preview(marker())
    expect(result).toMatchObject({ outcome: 'needs_followup' })
    expect(result.outcome === 'needs_followup' ? result.instruction : '').toContain(
      'already booked',
    )
    expect(db.tables.bookings).toHaveLength(1)
  })

  it('flags a time outside working hours', async () => {
    const closedSunday = { ...DEMO, available_days: [1, 2, 3, 4, 5, 6] }
    const result = await preview(marker(), [closedSunday])
    expect(result).toMatchObject({ outcome: 'needs_followup' })
    expect(result.outcome === 'needs_followup' ? result.instruction : '').toContain(
      'outside the available',
    )
  })

  it('passes a free slot', async () => {
    expect(await preview(marker())).toEqual({ outcome: 'free' })
  })

  it('ignores cancels and types with no time', async () => {
    expect(await preview(marker({ action: 'cancel' }))).toEqual({ outcome: 'free' })
    expect(await preview(marker({ type: 'callback' }))).toEqual({ outcome: 'free' })
  })

  it('hands off when there is no free time to offer', async () => {
    expect(await preview(marker(), [{ ...DEMO, available_days: [] }])).toEqual({
      outcome: 'handoff',
    })
  })

  it('hands off when the slot lookup fails', async () => {
    db.failNext('bookings', 'select')
    expect(await preview(marker())).toEqual({ outcome: 'handoff' })
  })
})

describe('saveBookingFromAi — availability', () => {
  const closedSunday = { ...DEMO, available_days: [1, 2, 3, 4, 5, 6] }

  function holdSlot(scheduledAt: string) {
    db.tables.bookings.push({
      id: 'held',
      account_id: 'acct-1',
      contact_id: 'someone-else',
      booking_type_id: 'type-demo',
      status: 'open',
      fields: {},
      scheduled_at: scheduledAt,
      scheduled_text: null,
    })
  }

  it('does not book a taken slot, and asks the model to offer free times', async () => {
    holdSlot('2026-11-01T05:30:00.000Z')
    const result = await save(marker())

    expect(result).toMatchObject({ ok: true, outcome: 'needs_followup' })
    expect(db.tables.bookings).toHaveLength(1)
    expect(db.tables.contact_notes).toHaveLength(0)
    const instruction = result.ok && result.outcome === 'needs_followup' ? result.instruction : ''
    expect(instruction).toContain('Do not')
    expect(instruction).toMatch(/\d{1,2}:\d{2}/)
  })

  it('does not book outside working hours', async () => {
    const result = await save(marker(), { types: [closedSunday] })
    expect(result).toMatchObject({ ok: true, outcome: 'needs_followup' })
    expect(db.tables.bookings).toHaveLength(0)
  })

  it('reports failure when there is no free time to offer', async () => {
    const result = await save(marker(), { types: [{ ...DEMO, available_days: [] }] })
    expect(result.ok).toBe(false)
  })

  it('fails closed when availability cannot be read', async () => {
    const realFrom = db.client.from.bind(db.client)
    let selects = 0
    db.client.from = ((table: string) => {
      if (table === 'bookings' && ++selects === 2) db.failNext('bookings', 'select')
      return realFrom(table)
    }) as unknown as typeof db.client.from

    const result = await save(marker())
    expect(result.ok).toBe(false)
    expect(db.tables.bookings).toHaveLength(0)
  })

  it('does not re-check the slot when only the details change', async () => {
    await save(marker())
    const result = await save(marker({ fields: { notes: 'x' }, onExisting: 'update' }))
    expect(result).toMatchObject({ ok: true, outcome: 'updated' })
  })

  it('lets a booking move within its own slot length', async () => {
    await save(marker())
    const result = await save(
      marker({ scheduledLocal: '2026-11-01T11:15', scheduledText: '11.15', onExisting: 'update' }),
    )
    expect(result).toMatchObject({ ok: true, outcome: 'updated' })
  })

  it('offers free times when the database refuses a slot taken at the last moment', async () => {
    db.failNext('bookings', 'insert', '23P01')
    const result = await save(marker())
    expect(result).toMatchObject({ ok: true, outcome: 'needs_followup' })
  })
})

describe('saveBookingFromAi — customer with an open booking', () => {
  const secondVisit = {
    scheduledLocal: '2026-11-02T15:00',
    scheduledText: 'Monday 3 PM',
  }

  it('asks before touching it', async () => {
    await save(marker())
    const result = await save(marker(secondVisit))

    expect(result).toMatchObject({ ok: true, outcome: 'needs_followup' })
    expect(db.tables.bookings[0].scheduled_text).toBe('Tomorrow at 11 AM')
    const instruction = result.ok && result.outcome === 'needs_followup' ? result.instruction : ''
    expect(instruction).toContain('Online Demo')
    expect(instruction).toContain('Tomorrow at 11 AM')
  })

  it('closes it and books afresh when the customer chooses that', async () => {
    await save(marker())
    const result = await save(marker({ ...secondVisit, onExisting: 'replace' }))

    expect(result).toMatchObject({ ok: true, outcome: 'created' })
    expect(db.tables.bookings).toHaveLength(2)
    expect(db.tables.bookings[0].status).toBe('cancelled')
    expect(db.tables.bookings[1]).toMatchObject({ status: 'open', scheduled_text: 'Monday 3 PM' })
    expect(db.tables.contact_notes.map((n) => n.note_text).join('\n')).toContain('Closed')
  })

  it('starts the new booking clean rather than inheriting old details', async () => {
    await save(marker({ fields: { name: 'Ramu', business: 'Old', notes: 'old note' } }))
    await save(
      marker({ ...secondVisit, fields: { name: 'Ramu', business: 'New' }, onExisting: 'replace' }),
    )
    expect(db.tables.bookings[1].fields).toEqual({ name: 'Ramu', business: 'New' })
  })

  it('restores the old booking when the new slot is lost at the last moment', async () => {
    await save(marker())
    db.failNext('bookings', 'insert', '23P01')
    const result = await save(marker({ ...secondVisit, onExisting: 'replace' }))

    expect(result).toMatchObject({ ok: true, outcome: 'needs_followup' })
    expect(db.tables.bookings[0].status).toBe('open')
  })

  it('restores the old booking when the new one cannot be stored', async () => {
    await save(marker())
    db.failNext('bookings', 'insert')
    const result = await save(marker({ ...secondVisit, onExisting: 'replace' }))

    expect(result.ok).toBe(false)
    expect(db.tables.bookings[0].status).toBe('open')
  })

  it('checks the slot before closing anything', async () => {
    await save(marker())
    db.tables.bookings.push({
      id: 'held',
      account_id: 'acct-1',
      contact_id: 'someone-else',
      booking_type_id: 'type-demo',
      status: 'open',
      fields: {},
      scheduled_at: '2026-11-02T09:30:00.000Z',
    })
    const result = await save(marker({ ...secondVisit, onExisting: 'replace' }))

    expect(result).toMatchObject({ ok: true, outcome: 'needs_followup' })
    expect(db.tables.bookings[0].status).toBe('open')
  })

  it('does not ask again while filling in a booking under review', async () => {
    await save(marker({ fields: { name: 'Ramu' } }))
    const result = await save(marker({ fields: { business: 'NixAqua' } }))
    expect(result).toMatchObject({ ok: true, outcome: 'updated' })
  })
})

describe('saveBookingFromAi — chats handled by an agent', () => {
  const agentChat = { mode: 'agent_chat' }

  function holdSlot() {
    db.tables.bookings.push({
      id: 'held',
      account_id: 'acct-1',
      contact_id: 'someone-else',
      booking_type_id: 'type-demo',
      status: 'open',
      fields: {},
      scheduled_at: '2026-11-01T05:30:00.000Z',
    })
  }

  it('records what the agent agreed', async () => {
    const result = await save(marker(), agentChat)
    expect(result).toMatchObject({ ok: true, outcome: 'created' })
    expect(db.tables.bookings[0].status).toBe('open')
  })

  it('flags a clash for the agent without holding the slot', async () => {
    holdSlot()
    const result = await save(marker(), agentChat)

    expect(result).toMatchObject({ ok: true, outcome: 'created' })
    expect(db.tables.bookings[1]).toMatchObject({
      status: 'needs_review',
      scheduled_at: null,
      scheduled_text: 'Tomorrow at 11 AM',
    })
    expect(db.tables.contact_notes[0].note_text).toContain('already full')
  })

  it('flags a clash the database catches at the last moment', async () => {
    db.failNext('bookings', 'insert', '23P01')
    const result = await save(marker(), agentChat)

    expect(result).toMatchObject({ ok: true, outcome: 'created' })
    expect(db.tables.bookings[0]).toMatchObject({ status: 'needs_review', scheduled_at: null })
  })

  it('trusts the agent on working hours', async () => {
    const types = [{ ...DEMO, available_days: [1, 2, 3, 4, 5, 6] }]
    await save(marker(), { ...agentChat, types })
    expect(db.tables.bookings[0]).toMatchObject({
      status: 'open',
      scheduled_at: '2026-11-01T05:30:00.000Z',
    })
  })

  it('updates an open booking without asking anyone', async () => {
    await save(marker(), agentChat)
    const result = await save(
      marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM' }),
      agentChat,
    )
    expect(result).toMatchObject({ ok: true, outcome: 'updated' })
    expect(db.tables.bookings).toHaveLength(1)
  })

  it('honours a choice the chat shows the customer made', async () => {
    await save(marker(), agentChat)
    const result = await save(
      marker({
        scheduledLocal: '2026-11-02T15:00',
        scheduledText: 'Monday 3 PM',
        onExisting: 'replace',
      }),
      agentChat,
    )

    expect(result).toMatchObject({ ok: true, outcome: 'created' })
    expect(db.tables.bookings[0].status).toBe('cancelled')
    expect(db.tables.bookings).toHaveLength(2)
  })

  it('does not recreate a booking already closed, from old messages', async () => {
    await save(marker(), agentChat)
    db.tables.bookings[0].status = 'done'
    db.tables.bookings[0].created_at = NOW.toISOString()

    const result = await save(marker(), agentChat)

    expect(result).toMatchObject({ ok: true, outcome: 'unchanged' })
    expect(db.tables.bookings).toHaveLength(1)
  })

  it('records a new time after an earlier booking was closed', async () => {
    await save(marker(), agentChat)
    db.tables.bookings[0].status = 'done'
    db.tables.bookings[0].created_at = NOW.toISOString()

    await save(
      marker({ scheduledLocal: '2026-11-02T15:00', scheduledText: 'Monday 3 PM' }),
      agentChat,
    )
    expect(db.tables.bookings).toHaveLength(2)
  })
})
