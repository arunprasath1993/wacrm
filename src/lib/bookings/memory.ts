import type { SupabaseClient } from '@supabase/supabase-js'
import { formatBookingTime } from './time'
import type { BookingFieldDef, BookingStatus } from './types'

const RECENT_BOOKINGS = 5

export interface CustomerMemory {
  name: string | null
  company: string | null
  bookings: {
    typeName: string
    status: BookingStatus
    when: string | null
    details: { label: string; value: string }[]
  }[]
}

interface MemoryBookingRow {
  status: BookingStatus
  fields: Record<string, string> | null
  scheduled_at: string | null
  scheduled_text: string | null
  booking_type: { name: string; fields: BookingFieldDef[] | null } | null
}

/**
 * What the AI should remember about a customer across conversations.
 *
 * `contact_notes` are deliberately left out: agents write those for each
 * other, and anything in the prompt can end up in a reply to the
 * customer. Best-effort — null just means a reply without memory.
 */
export async function loadCustomerMemory(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  timeZone: string | null,
): Promise<CustomerMemory | null> {
  const [contactRes, bookingsRes] = await Promise.all([
    db
      .from('contacts')
      .select('name, company')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle(),
    db
      .from('bookings')
      .select(
        'status, fields, scheduled_at, scheduled_text, booking_type:booking_types(name, fields)',
      )
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(RECENT_BOOKINGS),
  ])
  if (contactRes.error || bookingsRes.error) return null

  const rows = (bookingsRes.data ?? []) as unknown as MemoryBookingRow[]
  return {
    name: (contactRes.data?.name as string | null) || null,
    company: (contactRes.data?.company as string | null) || null,
    bookings: rows.map((row) => {
      const labels = row.booking_type?.fields ?? []
      return {
        typeName: row.booking_type?.name ?? 'Booking',
        status: row.status,
        when:
          row.scheduled_at && timeZone
            ? formatBookingTime(row.scheduled_at, timeZone)
            : row.scheduled_text,
        details: Object.entries(row.fields ?? {}).map(([key, value]) => ({
          label: labels.find((f) => f.key === key)?.label ?? key,
          value,
        })),
      }
    }),
  }
}
