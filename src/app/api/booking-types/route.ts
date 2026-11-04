import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { validateBookingType } from '@/lib/bookings/validate'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

// Booking types — what the AI agent collects, per account. Settings
// class: any member reads, admins write.

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    // RLS (booking_types_select) scopes to the caller's account.
    const { data, error } = await supabase
      .from('booking_types')
      .select('*')
      .is('archived_at', null)
      .order('position')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ booking_types: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
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

  const validated = validateBookingType(body)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  // Archived types keep their key, so they count here too.
  const admin = supabaseAdmin()
  const { data: existing, error: loadError } = await admin
    .from('booking_types')
    .select('key')
    .eq('account_id', ctx.accountId)
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })

  const taken = new Set((existing ?? []).map((row) => row.key as string))
  let key = validated.value.key
  for (let n = 2; taken.has(key); n += 1) key = `${validated.value.key}_${n}`

  const { data, error } = await admin
    .from('booking_types')
    .insert({
      ...validated.value,
      key,
      account_id: ctx.accountId,
      created_by: ctx.userId,
      position: taken.size,
    })
    .select()
    .single()

  if (error) {
    const status = error.code === '23514' ? 400 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ booking_type: data }, { status: 201 })
}
