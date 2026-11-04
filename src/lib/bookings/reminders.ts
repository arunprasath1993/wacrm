import type { SupabaseClient } from '@supabase/supabase-js'
import { formatBookingTime } from './time'
import { OPEN_BOOKING_STATUSES } from './types'

const BATCH_SIZE = 100

interface DueBooking {
  id: string
  account_id: string
  contact_id: string | null
  conversation_id: string | null
  assigned_to: string | null
  scheduled_at: string
  booking_type: { name: string } | null
  contact: { name: string | null; phone: string | null } | null
  account: { time_zone: string } | null
}

/**
 * Notify assignees of bookings whose reminder time has arrived. Runs on
 * the automations cron. Each booking is claimed by a conditional update
 * first, so overlapping runs can't remind twice; a crash between the
 * claim and the insert loses one reminder rather than repeating it.
 * Returns how many were sent, and 0 on failure so the rest of the cron
 * still runs (including before migration 063 is applied).
 */
export async function sendDueBookingReminders(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const nowIso = now.toISOString()
  const { data, error } = await db
    .from('bookings')
    .select(
      'id, account_id, contact_id, conversation_id, assigned_to, scheduled_at, booking_type:booking_types(name), contact:contacts(name, phone), account:accounts(time_zone)',
    )
    .in('status', OPEN_BOOKING_STATUSES)
    .is('reminded_at', null)
    .lte('remind_at', nowIso)
    .gt('scheduled_at', nowIso)
    .limit(BATCH_SIZE)
  if (error || !data) {
    if (error) console.error('[bookings] reminder lookup failed:', error)
    return 0
  }

  let sent = 0
  for (const booking of data as unknown as DueBooking[]) {
    const { data: claimed } = await db
      .from('bookings')
      .update({ reminded_at: nowIso })
      .eq('id', booking.id)
      .is('reminded_at', null)
      .select('id')
    if (!claimed || claimed.length === 0 || !booking.assigned_to) continue

    const typeName = booking.booking_type?.name ?? 'Booking'
    const contactName = booking.contact?.name || booking.contact?.phone || 'a contact'
    const time = formatBookingTime(
      booking.scheduled_at,
      booking.account?.time_zone ?? 'UTC',
    )
    const { error: insertError } = await db.from('notifications').insert({
      account_id: booking.account_id,
      user_id: booking.assigned_to,
      type: 'booking_reminder',
      booking_id: booking.id,
      conversation_id: booking.conversation_id,
      contact_id: booking.contact_id,
      title: `Reminder: ${typeName}`,
      body: `${contactName}, ${time}`,
    })
    if (insertError) {
      console.error('[bookings] reminder insert failed:', insertError)
      continue
    }
    sent += 1
  }
  return sent
}
