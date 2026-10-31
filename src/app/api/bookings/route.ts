import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { isUuid } from '@/lib/api/v1/pagination'
import { resolveTimeZone } from '@/lib/ai/usage-days'
import { resolveBookingPatch } from '@/lib/bookings/validate'
import { bookingWriteError } from '@/lib/bookings/api-errors'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

const MAX_ROWS = 500

// Bookings — one row is both the task in the list and, once it has a
// time, the calendar event. GET lists; POST lets an agent add one by
// hand for chats the bot isn't handling. RLS-scoped read via the user
// client, service-role write after an explicit role check.

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)
    const statuses = url.searchParams.get('status')?.split(',').filter(Boolean)
    const contactId = url.searchParams.get('contact_id')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    // RLS (bookings_select) scopes to the caller's account.
    let query = supabase
      .from('bookings')
      .select(
        '*, booking_type:booking_types(id, name, fields, duration_minutes), contact:contacts(id, name, phone)',
      )
      .order('scheduled_at', { ascending: true, nullsFirst: true })
      .limit(MAX_ROWS)
    if (statuses?.length) query = query.in('status', statuses)
    if (contactId && isUuid(contactId)) query = query.eq('contact_id', contactId)
    if (from) query = query.gte('scheduled_at', from)
    if (to) query = query.lt('scheduled_at', to)

    const [{ data, error }, { data: account }] = await Promise.all([
      query,
      supabase.from('accounts').select('time_zone').eq('id', accountId).maybeSingle(),
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      bookings: data ?? [],
      // Times are shown in the business's zone, not the viewer's browser.
      time_zone: resolveTimeZone(account?.time_zone),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: t('common.invalidJson') }, { status: 400 })
  }

  const { booking_type_id: typeId, contact_id: contactId } = body
  if (
    typeof typeId !== 'string' ||
    !isUuid(typeId) ||
    typeof contactId !== 'string' ||
    !isUuid(contactId)
  ) {
    return NextResponse.json({ error: t('bookings.typeAndContactRequired') }, { status: 400 })
  }

  const { data: account } = await ctx.supabase
    .from('accounts')
    .select('time_zone')
    .eq('id', ctx.accountId)
    .maybeSingle()

  const patch = resolveBookingPatch(body, resolveTimeZone(account?.time_zone))
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 })

  const { data, error } = await supabaseAdmin()
    .from('bookings')
    .insert({
      status: 'open',
      ...patch.update,
      account_id: ctx.accountId,
      booking_type_id: typeId,
      contact_id: contactId,
      source: 'manual',
      created_by: ctx.userId,
    })
    .select()
    .single()

  if (error) return bookingWriteError(error)
  return NextResponse.json({ booking: data }, { status: 201 })
}
