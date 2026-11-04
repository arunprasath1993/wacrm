import type { SupabaseClient } from '@supabase/supabase-js'
import { existingBookingNote, slotUnavailableNote } from './prompt'
import { checkSlot, freeSlots, loadTakenSlots, type SlotCheck } from './slots'
import { formatBookingTime, parseScheduledLocal } from './time'
import {
  OPEN_BOOKING_STATUSES,
  type BookingMarker,
  type BookingRow,
  type BookingStatus,
  type BookingType,
} from './types'

const BOOKING_COLUMNS = 'id, status, fields, scheduled_at, scheduled_text, assigned_to'
const UNIQUE_VIOLATION = '23505'
const SLOT_FULL = '23P01'
const CLOSED_LOOKBACK_MS = 30 * 86_400_000

export interface SaveBookingArgs {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  /** The account's WhatsApp config owner, the last-resort assignee. */
  ownerUserId: string
  handoffAgentId: string | null
  types: BookingType[]
  timeZone: string
  marker: BookingMarker
  now?: Date
  /**
   * `bot` is talking to the customer, so anything unresolved goes back to
   * them. `agent_chat` is only reading a chat a human runs: it can't ask
   * anyone, so it records what happened and flags problems for the agent.
   */
  mode?: 'bot' | 'agent_chat'
}

export type SaveBookingResult =
  | {
      ok: true
      outcome: 'created' | 'updated' | 'cancelled' | 'unchanged'
      booking: BookingRow | null
      type: BookingType
    }
  | {
      /** Nothing was saved; the bot must put this to the customer first. */
      ok: true
      outcome: 'needs_followup'
      instruction: string
      booking: null
      type: BookingType
    }
  | { ok: false }

type Scheduled = Pick<BookingRow, 'fields' | 'scheduled_at' | 'scheduled_text'>

function pickDefinedFields(type: BookingType, fields: Record<string, string>) {
  const picked: Record<string, string> = {}
  for (const { key } of type.fields) {
    if (fields[key]) picked[key] = fields[key]
  }
  return picked
}

function resolveSchedule(
  args: SaveBookingArgs,
  type: BookingType,
  existing: BookingRow | null,
): Pick<BookingRow, 'scheduled_at' | 'scheduled_text'> {
  if (type.time_mode === 'none') return { scheduled_at: null, scheduled_text: null }

  const { scheduledLocal, scheduledText } = args.marker
  if (!scheduledLocal && !scheduledText) {
    return {
      scheduled_at: existing?.scheduled_at ?? null,
      scheduled_text: existing?.scheduled_text ?? null,
    }
  }
  // A new time we can't read must not leave the old one looking valid.
  const parsed = parseScheduledLocal(scheduledLocal, args.timeZone, args.now)
  return { scheduled_at: parsed?.toISOString() ?? null, scheduled_text: scheduledText }
}

function buildNext(
  args: SaveBookingArgs,
  type: BookingType,
  base: BookingRow | null,
): Scheduled {
  return {
    fields: { ...base?.fields, ...pickDefinedFields(type, args.marker.fields) },
    ...resolveSchedule(args, type, base),
  }
}

function missingDetails(type: BookingType, booking: Scheduled): string[] {
  const missing = type.fields
    .filter((f) => f.required && !booking.fields[f.key])
    .map((f) => f.label)
  const needsTime =
    type.time_mode === 'required' ||
    (type.time_mode === 'optional' && Boolean(booking.scheduled_text))
  if (needsTime && !booking.scheduled_at) missing.push('time')
  return missing
}

function statusFor(type: BookingType, booking: Scheduled): BookingStatus {
  return missingDetails(type, booking).length > 0 ? 'needs_review' : 'open'
}

function describeTime(booking: Scheduled, timeZone: string): string | null {
  const formatted = booking.scheduled_at ? formatBookingTime(booking.scheduled_at, timeZone) : null
  if (booking.scheduled_text && formatted) return `${booking.scheduled_text} (${formatted})`
  return booking.scheduled_text ?? formatted
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b
  return new Date(a).getTime() === new Date(b).getTime()
}

function hasChanged(existing: BookingRow, next: Scheduled): boolean {
  const keys = new Set([...Object.keys(existing.fields), ...Object.keys(next.fields)])
  // With an exact time saved, the customer's wording of it is only
  // context; "11 AM" and "morning 11" are the same booking.
  const wordingMatters = !existing.scheduled_at && !next.scheduled_at
  return (
    [...keys].some((key) => existing.fields[key] !== next.fields[key]) ||
    !sameInstant(existing.scheduled_at, next.scheduled_at) ||
    (wordingMatters && existing.scheduled_text !== next.scheduled_text)
  )
}

const SLOT_LOST_LINE = '⚠️ That time is already full, so no time was saved. Agree a free slot.'

function reviewLines(type: BookingType, booking: Scheduled, slotLost: boolean): string[] {
  const lines = slotLost ? [SLOT_LOST_LINE] : []
  const missing = missingDetails(type, booking)
  if (missing.length > 0) lines.push(`⚠️ Needs review, missing: ${missing.join(', ')}`)
  return lines
}

function createdNote(
  args: SaveBookingArgs,
  type: BookingType,
  booking: Scheduled,
  slotLost: boolean,
): string {
  const source = args.mode === 'agent_chat' ? 'from the chat' : 'by the AI agent'
  const lines = [`🤖 ${type.name} booked ${source}.`]
  for (const { key, label } of type.fields) {
    if (booking.fields[key]) lines.push(`${label}: ${booking.fields[key]}`)
  }
  const time = describeTime(booking, args.timeZone)
  if (time) lines.push(`Time: ${time}`)
  return [...lines, ...reviewLines(type, booking, slotLost)].join('\n')
}

function updatedNote(
  args: SaveBookingArgs,
  type: BookingType,
  before: BookingRow,
  after: Scheduled,
  slotLost: boolean,
): string {
  const source = args.mode === 'agent_chat' ? 'from the chat' : 'by the AI agent'
  const lines = [`🤖 ${type.name} updated ${source}.`]
  for (const { key, label } of type.fields) {
    if (before.fields[key] !== after.fields[key]) {
      lines.push(`${label}: ${before.fields[key] ?? '(empty)'} → ${after.fields[key]}`)
    }
  }
  const [was, now] = [describeTime(before, args.timeZone), describeTime(after, args.timeZone)]
  if (was !== now) lines.push(`Time: ${was ?? '(none)'} → ${now ?? '(none)'}`)
  return [...lines, ...reviewLines(type, after, slotLost)].join('\n')
}

async function resolveAssignee(args: SaveBookingArgs, type: BookingType): Promise<string | null> {
  const candidates = [type.assignee_user_id, args.handoffAgentId, args.ownerUserId].filter(
    (id): id is string => Boolean(id),
  )
  const { data } = await args.db
    .from('profiles')
    .select('user_id')
    .eq('account_id', args.accountId)
    .in('user_id', candidates)
  const members = new Set((data ?? []).map((row) => row.user_id as string))
  return candidates.find((id) => members.has(id)) ?? null
}

async function findOpenBooking(args: SaveBookingArgs, type: BookingType) {
  return args.db
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('booking_type_id', type.id)
    .in('status', OPEN_BOOKING_STATUSES)
    .maybeSingle()
}

// An agent chat is re-read on every message, so the agreement behind a
// booking that is already finished stays in view for a while.
async function wasAlreadyClosed(
  args: SaveBookingArgs,
  type: BookingType,
  next: Scheduled,
): Promise<boolean> {
  const { data } = await args.db
    .from('bookings')
    .select('scheduled_at, created_at')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('booking_type_id', type.id)
    .in('status', ['done', 'cancelled'])
  const cutoff = (args.now ?? new Date()).getTime() - CLOSED_LOOKBACK_MS
  return (data ?? []).some(
    (row) =>
      sameInstant(row.scheduled_at as string | null, next.scheduled_at) &&
      new Date(row.created_at as string).getTime() >= cutoff,
  )
}

// The two writes below are conveniences on top of the saved booking, so
// they log and carry on rather than failing it.
async function addNote(args: SaveBookingArgs, noteText: string): Promise<void> {
  const { error } = await args.db.from('contact_notes').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    user_id: args.ownerUserId,
    note_text: noteText,
  })
  if (error) console.error('[bookings] auto note failed:', error)
}

async function fillEmptyContactColumns(
  args: SaveBookingArgs,
  type: BookingType,
  fields: Record<string, string>,
): Promise<void> {
  const mapped = type.fields.filter((f) => f.maps_to && fields[f.key])
  if (mapped.length === 0) return

  const { data: contact } = await args.db
    .from('contacts')
    .select('name, email, company')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (!contact) return

  const patch: Record<string, string> = {}
  for (const field of mapped) {
    const column = field.maps_to!
    if (!contact[column]) patch[column] = fields[field.key]
  }
  if (Object.keys(patch).length === 0) return

  const { error } = await args.db
    .from('contacts')
    .update(patch)
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
  if (error) console.error('[bookings] contact update failed:', error)
}

function followUp(type: BookingType, instruction: string): SaveBookingResult {
  return { ok: true, outcome: 'needs_followup', instruction, booking: null, type }
}

async function slotFollowUp(
  args: Pick<SaveBookingArgs, 'db' | 'accountId' | 'timeZone' | 'now'>,
  type: BookingType,
  next: Scheduled,
  reason: Exclude<SlotCheck, 'free'>,
  excludeBookingId?: string,
): Promise<SaveBookingResult> {
  const taken = await loadTakenSlots(
    args.db,
    args.accountId,
    type.id,
    args.now,
    excludeBookingId,
  )
  if (!taken) return { ok: false }

  const free = freeSlots(type, taken, args.timeZone, args.now)
  // Nothing to offer: only a human can sort this out.
  if (free.length === 0) return { ok: false }

  return followUp(
    type,
    slotUnavailableNote({
      when: describeTime(next, args.timeZone),
      reason,
      free: free.map((slot) => formatBookingTime(slot, args.timeZone)),
    }),
  )
}

async function setStatus(args: SaveBookingArgs, id: string, status: BookingStatus) {
  return args.db
    .from('bookings')
    .update({ status })
    .eq('id', id)
    .eq('account_id', args.accountId)
    .select(BOOKING_COLUMNS)
    .single()
}

async function updateBooking(
  args: SaveBookingArgs,
  type: BookingType,
  existing: BookingRow,
  next: Scheduled,
  slotLost = false,
): Promise<SaveBookingResult> {
  const { data, error } = await args.db
    .from('bookings')
    .update({ ...next, status: statusFor(type, next) })
    .eq('id', existing.id)
    .eq('account_id', args.accountId)
    .select(BOOKING_COLUMNS)
    .single()

  if (error?.code === SLOT_FULL) {
    if (args.mode === 'agent_chat') {
      return updateBooking(args, type, existing, { ...next, scheduled_at: null }, true)
    }
    return slotFollowUp(args, type, next, 'full', existing.id)
  }
  if (error || !data) {
    console.error('[bookings] update failed:', error)
    return { ok: false }
  }

  await addNote(args, updatedNote(args, type, existing, next, slotLost))
  await fillEmptyContactColumns(args, type, next.fields)
  return { ok: true, outcome: 'updated', booking: data as BookingRow, type }
}

async function insertBooking(
  args: SaveBookingArgs,
  type: BookingType,
  next: Scheduled,
  { replaced = null, slotLost = false }: { replaced?: BookingRow | null; slotLost?: boolean } = {},
): Promise<SaveBookingResult> {
  const { data, error } = await args.db
    .from('bookings')
    .insert({
      account_id: args.accountId,
      booking_type_id: type.id,
      contact_id: args.contactId,
      conversation_id: args.conversationId,
      assigned_to: await resolveAssignee(args, type),
      status: statusFor(type, next),
      source: 'ai',
      ...next,
    })
    .select(BOOKING_COLUMNS)
    .single()

  if (error) {
    // The old booking was closed for this one; don't leave the customer
    // with neither.
    if (replaced) await setStatus(args, replaced.id, replaced.status)
  }

  if (error?.code === UNIQUE_VIOLATION) {
    // A concurrent inbound got there first; its row is the one to update.
    const { data: winner, error: lookupError } = await findOpenBooking(args, type)
    if (lookupError || !winner) return { ok: false }
    const row = winner as BookingRow
    return updateBooking(args, type, row, buildNext(args, type, row))
  }
  if (error?.code === SLOT_FULL) {
    if (args.mode === 'agent_chat') {
      return insertBooking(args, type, { ...next, scheduled_at: null }, { slotLost: true })
    }
    return slotFollowUp(args, type, next, 'full', replaced?.id)
  }
  if (error || !data) {
    console.error('[bookings] insert failed:', error)
    return { ok: false }
  }

  if (replaced) {
    const when = describeTime(replaced, args.timeZone)
    await addNote(
      args,
      `🤖 Closed the earlier ${type.name}${when ? ` (${when})` : ''} at the customer's request.`,
    )
  }
  await addNote(args, createdNote(args, type, next, slotLost))
  await fillEmptyContactColumns(args, type, next.fields)
  return { ok: true, outcome: 'created', booking: data as BookingRow, type }
}

async function cancelBooking(
  args: SaveBookingArgs,
  type: BookingType,
  existing: BookingRow,
): Promise<SaveBookingResult> {
  const { data, error } = await setStatus(args, existing.id, 'cancelled')
  if (error || !data) {
    console.error('[bookings] cancel failed:', error)
    return { ok: false }
  }

  await addNote(args, `🤖 ${type.name} cancelled by the customer on WhatsApp.`)
  return { ok: true, outcome: 'cancelled', booking: data as BookingRow, type }
}

async function saveBooking(
  args: SaveBookingArgs,
  type: BookingType,
  existing: BookingRow | null,
): Promise<SaveBookingResult> {
  const fromBot = args.mode !== 'agent_chat'
  const replacing = existing !== null && args.marker.onExisting === 'replace'
  const base = replacing ? null : existing
  const next = buildNext(args, type, base)

  if (existing && !replacing) {
    if (!hasChanged(existing, next)) {
      return { ok: true, outcome: 'unchanged', booking: existing, type }
    }
    // A booking under review is still being completed, so filling it in
    // isn't a change the customer needs to weigh up.
    if (fromBot && existing.status === 'open' && !args.marker.onExisting) {
      return followUp(
        type,
        existingBookingNote(type.name, describeTime(existing, args.timeZone)),
      )
    }
  }
  if (!existing && !fromBot && (await wasAlreadyClosed(args, type, next))) {
    return { ok: true, outcome: 'unchanged', booking: null, type }
  }

  let slotLost = false
  if (next.scheduled_at && !sameInstant(next.scheduled_at, base?.scheduled_at ?? null)) {
    const taken = await loadTakenSlots(
      args.db,
      args.accountId,
      type.id,
      args.now,
      existing?.id,
    )
    if (!taken) return { ok: false }

    const slot = checkSlot(type, next.scheduled_at, taken, args.timeZone)
    if (fromBot && slot !== 'free') {
      return slotFollowUp(args, type, next, slot, existing?.id)
    }
    // Hours are the agent's call; a full slot is not, as the database
    // would refuse it. Keep the booking but hold no time.
    if (!fromBot && slot === 'full') {
      next.scheduled_at = null
      slotLost = true
    }
  }

  if (replacing && existing) {
    const { error } = await setStatus(args, existing.id, 'cancelled')
    if (error) {
      console.error('[bookings] closing earlier booking failed:', error)
      return { ok: false }
    }
    return insertBooking(args, type, next, { replaced: existing })
  }
  return base
    ? updateBooking(args, type, base, next, slotLost)
    : insertBooking(args, type, next, { slotLost })
}

export type SlotPreview =
  | { outcome: 'free' }
  | { outcome: 'needs_followup'; instruction: string }
  | { outcome: 'handoff' }

/**
 * How the save would treat this time, for previews that must not write.
 * `free` when nothing about the slot would stop it, `needs_followup` with
 * what the bot would be told, and `handoff` when the save would fail and
 * the real bot would leave the chat to a human.
 */
export async function previewSlotCheck(
  args: Pick<SaveBookingArgs, 'db' | 'accountId' | 'types' | 'timeZone' | 'marker' | 'now'>,
): Promise<SlotPreview> {
  const { marker } = args
  const type = args.types.find((t) => t.key === marker.type)
  if (!type || type.time_mode === 'none' || marker.action !== 'save') return { outcome: 'free' }

  const start = parseScheduledLocal(marker.scheduledLocal, args.timeZone, args.now)
  if (!start) return { outcome: 'free' }

  const taken = await loadTakenSlots(args.db, args.accountId, type.id, args.now)
  if (!taken) return { outcome: 'handoff' }

  const slot = checkSlot(type, start, taken, args.timeZone)
  if (slot === 'free') return { outcome: 'free' }

  const result = await slotFollowUp(
    args,
    type,
    { fields: {}, scheduled_at: start.toISOString(), scheduled_text: marker.scheduledText },
    slot,
  )
  return result.ok && result.outcome === 'needs_followup'
    ? { outcome: 'needs_followup', instruction: result.instruction }
    : { outcome: 'handoff' }
}

/**
 * Persist what the model recorded. A contact has at most one open
 * booking per type, and nothing is confirmed into a slot that isn't
 * free. Never throws: `{ ok: false }` tells the caller nothing was
 * saved, so it must not send the customer a confirmation, and
 * `needs_followup` tells it to ask the customer instead.
 *
 * The marker is untrusted model output. Its type must be one of the
 * account's active types, only that type's fields are kept, and the
 * assignee comes from configuration, never from the model.
 */
export async function saveBookingFromAi(args: SaveBookingArgs): Promise<SaveBookingResult> {
  try {
    const type = args.types.find((t) => t.key === args.marker.type)
    if (!type) {
      console.error(`[bookings] unknown booking type "${args.marker.type}"`)
      return { ok: false }
    }

    const { data, error } = await findOpenBooking(args, type)
    if (error) {
      console.error('[bookings] lookup failed:', error)
      return { ok: false }
    }
    const existing = data as BookingRow | null

    if (args.marker.action === 'cancel') {
      if (!existing) return { ok: true, outcome: 'unchanged', booking: null, type }
      return await cancelBooking(args, type, existing)
    }
    return await saveBooking(args, type, existing)
  } catch (err) {
    console.error('[bookings] save failed:', err)
    return { ok: false }
  }
}
