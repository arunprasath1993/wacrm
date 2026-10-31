import type { SupabaseClient } from '@supabase/supabase-js'
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
}

export type SaveBookingResult =
  | {
      ok: true
      outcome: 'created' | 'updated' | 'cancelled' | 'unchanged'
      booking: BookingRow | null
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
  return (
    [...keys].some((key) => existing.fields[key] !== next.fields[key]) ||
    !sameInstant(existing.scheduled_at, next.scheduled_at) ||
    existing.scheduled_text !== next.scheduled_text
  )
}

function createdNote(type: BookingType, booking: Scheduled, timeZone: string): string {
  const lines = [`🤖 ${type.name} booked by the AI agent.`]
  for (const { key, label } of type.fields) {
    if (booking.fields[key]) lines.push(`${label}: ${booking.fields[key]}`)
  }
  const time = describeTime(booking, timeZone)
  if (time) lines.push(`Time: ${time}`)
  const missing = missingDetails(type, booking)
  if (missing.length > 0) lines.push(`⚠️ Needs review, missing: ${missing.join(', ')}`)
  return lines.join('\n')
}

function updatedNote(
  type: BookingType,
  before: BookingRow,
  after: Scheduled,
  timeZone: string,
): string {
  const lines = [`🤖 ${type.name} updated by the AI agent.`]
  for (const { key, label } of type.fields) {
    if (before.fields[key] !== after.fields[key]) {
      lines.push(`${label}: ${before.fields[key] ?? '(empty)'} → ${after.fields[key]}`)
    }
  }
  const [was, now] = [describeTime(before, timeZone), describeTime(after, timeZone)]
  if (was !== now) lines.push(`Time: ${was ?? '(none)'} → ${now ?? '(none)'}`)
  const missing = missingDetails(type, after)
  if (missing.length > 0) lines.push(`⚠️ Needs review, missing: ${missing.join(', ')}`)
  return lines.join('\n')
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

async function updateBooking(
  args: SaveBookingArgs,
  type: BookingType,
  existing: BookingRow,
): Promise<SaveBookingResult> {
  const next: Scheduled = {
    fields: { ...existing.fields, ...pickDefinedFields(type, args.marker.fields) },
    ...resolveSchedule(args, type, existing),
  }
  if (!hasChanged(existing, next)) {
    return { ok: true, outcome: 'unchanged', booking: existing, type }
  }

  const { data, error } = await args.db
    .from('bookings')
    .update({ ...next, status: statusFor(type, next) })
    .eq('id', existing.id)
    .eq('account_id', args.accountId)
    .select(BOOKING_COLUMNS)
    .single()
  if (error || !data) {
    console.error('[bookings] update failed:', error)
    return { ok: false }
  }

  await addNote(args, updatedNote(type, existing, next, args.timeZone))
  await fillEmptyContactColumns(args, type, next.fields)
  return { ok: true, outcome: 'updated', booking: data as BookingRow, type }
}

async function insertBooking(
  args: SaveBookingArgs,
  type: BookingType,
): Promise<SaveBookingResult> {
  const next: Scheduled = {
    fields: pickDefinedFields(type, args.marker.fields),
    ...resolveSchedule(args, type, null),
  }

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

  if (error?.code === UNIQUE_VIOLATION) {
    // A concurrent inbound got there first; its row is the one to update.
    const { data: winner, error: lookupError } = await findOpenBooking(args, type)
    if (lookupError || !winner) return { ok: false }
    return updateBooking(args, type, winner as BookingRow)
  }
  if (error || !data) {
    console.error('[bookings] insert failed:', error)
    return { ok: false }
  }

  await addNote(args, createdNote(type, next, args.timeZone))
  await fillEmptyContactColumns(args, type, next.fields)
  return { ok: true, outcome: 'created', booking: data as BookingRow, type }
}

async function cancelBooking(
  args: SaveBookingArgs,
  type: BookingType,
  existing: BookingRow,
): Promise<SaveBookingResult> {
  const { data, error } = await args.db
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', existing.id)
    .eq('account_id', args.accountId)
    .select(BOOKING_COLUMNS)
    .single()
  if (error || !data) {
    console.error('[bookings] cancel failed:', error)
    return { ok: false }
  }

  await addNote(args, `🤖 ${type.name} cancelled by the customer on WhatsApp.`)
  return { ok: true, outcome: 'cancelled', booking: data as BookingRow, type }
}

/**
 * Persist what the model recorded. A contact has at most one open
 * booking per type, so a repeat updates it and a change of time is a
 * reschedule. Never throws: `{ ok: false }` tells the caller nothing was
 * saved, so it must not send the customer a confirmation.
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
    return existing
      ? await updateBooking(args, type, existing)
      : await insertBooking(args, type)
  } catch (err) {
    console.error('[bookings] save failed:', err)
    return { ok: false }
  }
}
