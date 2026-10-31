import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookingType } from './types'

const TYPE_COLUMNS =
  'id, key, name, fields, time_mode, duration_minutes, instructions, assignee_user_id, handoff_on_confirm, remind_minutes_before'

export interface BookingContext {
  types: BookingType[]
  timeZone: string | null
}

/**
 * What the AI needs to take bookings for an account. Best-effort: a
 * failed lookup (including migration 063 not being applied yet) means
 * no booking protocol this turn, never a failed customer reply.
 */
export async function loadBookingContext(
  db: SupabaseClient,
  accountId: string,
): Promise<BookingContext> {
  const { data: account, error: accountError } = await db
    .from('accounts')
    .select('time_zone')
    .eq('id', accountId)
    .maybeSingle()
  if (accountError || !account) return { types: [], timeZone: null }
  const timeZone = (account.time_zone as string | null) ?? null

  const { data: types, error: typesError } = await db
    .from('booking_types')
    .select(TYPE_COLUMNS)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .is('archived_at', null)
    .order('position')
  if (typesError || !types) return { types: [], timeZone }

  return {
    types: (types as unknown as BookingType[]).map((type) => ({
      ...type,
      fields: Array.isArray(type.fields) ? type.fields : [],
    })),
    timeZone,
  }
}
