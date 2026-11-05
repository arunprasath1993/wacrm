import type { SupabaseClient } from '@supabase/supabase-js'
import { zonedDayKey, zonedTimeToUtc } from '@/lib/ai/usage-days'
import { formatBookingTime, toScheduledLocal } from './time'
import { OPEN_BOOKING_STATUSES, type BookingType } from './types'

/** How far ahead the AI can see and offer free times. */
export const AVAILABILITY_DAYS = 14

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
const MAX_OFFERS = 6
const MAX_OFFERS_PER_DAY = 2

export type SlotCheck = 'free' | 'outside_hours' | 'full'

function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number)
  return hours * 60 + minutes
}

/** Whether `[startMinutes, startMinutes + duration)` touches the type's break. */
function overlapsBreak(type: BookingType, startMinutes: number): boolean {
  if (!type.break_from || !type.break_to) return false
  const breakStart = toMinutes(type.break_from)
  const breakEnd = toMinutes(type.break_to)
  if (breakEnd <= breakStart) return false
  return startMinutes < breakEnd && startMinutes + type.duration_minutes > breakStart
}

/** Minute of the day the type's break ends, or null when it has no valid break. */
function breakEndMinutes(type: BookingType): number | null {
  if (!type.break_from || !type.break_to) return null
  const breakEnd = toMinutes(type.break_to)
  return breakEnd > toMinutes(type.break_from) ? breakEnd : null
}

/** ISO weekday (1 = Monday) of a `YYYY-MM-DD` calendar date. */
function isoWeekday(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00.000Z`).getUTCDay() || 7
}

function isFull(type: BookingType, start: Date, taken: string[]): boolean {
  if (type.slot_capacity === null) return false
  const durationMs = type.duration_minutes * MINUTE_MS
  const overlapping = taken.filter((other) => {
    const otherStart = new Date(other).getTime()
    return otherStart < start.getTime() + durationMs && otherStart + durationMs > start.getTime()
  })
  return overlapping.length >= type.slot_capacity
}

/** Whether a booking of `type` can start at `instant`. */
export function checkSlot(
  type: BookingType,
  instant: string | Date,
  taken: string[],
  timeZone: string,
): SlotCheck {
  const start = typeof instant === 'string' ? new Date(instant) : instant
  const local = toScheduledLocal(start, timeZone)
  const startMinutes = toMinutes(local.slice(11, 16))

  const open =
    type.available_days.includes(isoWeekday(local.slice(0, 10))) &&
    startMinutes >= toMinutes(type.available_from) &&
    startMinutes + type.duration_minutes <= toMinutes(type.available_to) &&
    !overlapsBreak(type, startMinutes)
  if (!open) return 'outside_hours'

  return isFull(type, start, taken) ? 'full' : 'free'
}

/** The next free start times, spread over several days to give a real choice. */
export function freeSlots(
  type: BookingType,
  taken: string[],
  timeZone: string,
  now: Date = new Date(),
): Date[] {
  const today = new Date(`${zonedDayKey(now, timeZone)}T00:00:00.000Z`)
  const from = toMinutes(type.available_from)
  const to = toMinutes(type.available_to)
  const offers: Date[] = []

  for (let i = 0; i < AVAILABILITY_DAYS && offers.length < MAX_OFFERS; i += 1) {
    const dayKey = new Date(today.getTime() + i * DAY_MS).toISOString().slice(0, 10)
    if (!type.available_days.includes(isoWeekday(dayKey))) continue

    const [year, month, day] = dayKey.split('-').map(Number)
    let offeredToday = 0
    for (
      let minutes = from;
      minutes + type.duration_minutes <= to && offeredToday < MAX_OFFERS_PER_DAY;
      minutes += type.duration_minutes
    ) {
      const start = zonedTimeToUtc(
        { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
        timeZone,
      )
      if (overlapsBreak(type, minutes)) {
        // Resume exactly at the break end; the loop step adds the duration back.
        const breakEnd = breakEndMinutes(type)
        if (breakEnd !== null && breakEnd - type.duration_minutes > minutes) {
          minutes = breakEnd - type.duration_minutes
        }
        continue
      }
      if (start <= now || isFull(type, start, taken)) continue
      offers.push(start)
      offeredToday += 1
    }
  }
  return offers.slice(0, MAX_OFFERS)
}

/**
 * Start times already held for a type. Null when the lookup fails:
 * callers must not treat that as "everything is free".
 */
export async function loadTakenSlots(
  db: SupabaseClient,
  accountId: string,
  typeId: string,
  now: Date = new Date(),
  excludeBookingId?: string,
): Promise<string[] | null> {
  let query = db
    .from('bookings')
    .select('scheduled_at')
    .eq('account_id', accountId)
    .eq('booking_type_id', typeId)
    .in('status', OPEN_BOOKING_STATUSES)
    .gte('scheduled_at', new Date(now.getTime() - DAY_MS).toISOString())
  if (excludeBookingId) query = query.neq('id', excludeBookingId)

  const { data, error } = await query
  if (error) {
    console.error('[bookings] slot lookup failed:', error)
    return null
  }
  return (data ?? []).map((row) => row.scheduled_at as string)
}

/**
 * Free times to put in front of the model, by type key. Types whose
 * lookup fails are left out; the save still checks any time it books.
 */
export async function loadAvailability(
  db: SupabaseClient,
  accountId: string,
  types: BookingType[],
  timeZone: string,
  now: Date = new Date(),
): Promise<Record<string, string[]>> {
  const availability: Record<string, string[]> = {}
  for (const type of types) {
    if (type.time_mode === 'none') continue
    const taken = await loadTakenSlots(db, accountId, type.id, now)
    if (!taken) continue
    availability[type.key] = freeSlots(type, taken, timeZone, now).map((slot) =>
      formatBookingTime(slot, timeZone),
    )
  }
  return availability
}
