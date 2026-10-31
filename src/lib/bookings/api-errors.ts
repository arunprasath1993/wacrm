import { NextResponse } from 'next/server'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/** Translate the database's own booking guards into API responses. */
export function bookingWriteError(error: { code?: string; message: string }) {
  if (error.code === '23505') {
    return NextResponse.json({ error: t('bookings.alreadyOpen') }, { status: 409 })
  }
  if (error.code === '23P01') {
    return NextResponse.json({ error: t('bookings.slotTaken') }, { status: 409 })
  }
  if (error.code === '23514') {
    return NextResponse.json({ error: t('bookings.notInAccount') }, { status: 400 })
  }
  return NextResponse.json({ error: error.message }, { status: 500 })
}
