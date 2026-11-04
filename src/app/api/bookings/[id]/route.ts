import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { isUuid } from '@/lib/api/v1/pagination'
import { resolveTimeZone } from '@/lib/ai/usage-days'
import { resolveBookingPatch } from '@/lib/bookings/validate'
import { bookingWriteError } from '@/lib/bookings/api-errors'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

function notFound() {
  return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
}

// Update / delete a single booking. The service-role client bypasses
// RLS, so both the role check and the account scope are enforced here.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
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
  if (!isUuid(id)) return notFound()

  const { data: account } = await ctx.supabase
    .from('accounts')
    .select('time_zone')
    .eq('id', ctx.accountId)
    .maybeSingle()

  const patch = resolveBookingPatch(body, resolveTimeZone(account?.time_zone))
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 })
  if (Object.keys(patch.update).length === 0) return NextResponse.json({ ok: true })

  const { data, error } = await supabaseAdmin()
    .from('bookings')
    .update(patch.update)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id')
  if (error) return bookingWriteError(error)
  if (!data || data.length === 0) return notFound()
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  if (!isUuid(id)) return notFound()

  const { data, error } = await supabaseAdmin()
    .from('bookings')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return notFound()
  return NextResponse.json({ ok: true })
}
