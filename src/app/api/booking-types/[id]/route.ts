import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { isUuid } from '@/lib/api/v1/pagination'
import { validateBookingType } from '@/lib/bookings/validate'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

function notFound() {
  return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: t('common.invalidJson') }, { status: 400 })
  }
  if (!isUuid(id)) return notFound()

  const admin = supabaseAdmin()
  const { data: stored, error: loadError } = await admin
    .from('booking_types')
    .select('key')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .is('archived_at', null)
    .maybeSingle()
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
  if (!stored) return notFound()

  const validated = validateBookingType(body, stored)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  const { data, error } = await admin
    .from('booking_types')
    .update(validated.value)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select()
    .single()
  if (error) {
    const status = error.code === '23514' ? 400 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ booking_type: data })
}

// Archive rather than delete: existing bookings keep pointing at the type.
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
    .from('booking_types')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return notFound()
  return NextResponse.json({ ok: true })
}
