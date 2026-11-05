import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookingType } from './types'

const BASE_TYPE_COLUMNS =
  'id, key, name, fields, time_mode, duration_minutes, instructions, assignee_user_id, handoff_on_confirm, remind_minutes_before, slot_capacity, available_days, available_from, available_to'
// Added by migration 067. Read separately so a database that hasn't run
// it yet still takes bookings (without breaks) instead of losing them all.
const TYPE_COLUMNS = `${BASE_TYPE_COLUMNS}, break_from, break_to`

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

  const selectTypes = (columns: string) =>
    db
      .from('booking_types')
      .select(columns)
      .eq('account_id', accountId)
      .eq('is_active', true)
      .is('archived_at', null)
      .order('position')

  let { data: types, error: typesError } = await selectTypes(TYPE_COLUMNS)
  if (typesError) {
    console.warn(
      '[bookings] loading booking types with breaks failed (is migration 067 applied?) — retrying without breaks:',
      typesError.message,
    )
    ;({ data: types, error: typesError } = await selectTypes(BASE_TYPE_COLUMNS))
  }
  if (typesError || !types) return { types: [], timeZone }

  return {
    types: (types as unknown as BookingType[]).map((type) => ({
      ...type,
      fields: Array.isArray(type.fields) ? type.fields : [],
    })),
    timeZone,
  }
}
