import { zonedTimeToUtc } from '@/lib/ai/usage-days'

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Turn the model's wall-clock `YYYY-MM-DDTHH:mm` into an instant in the
 * account's timezone. Null for anything that isn't a real, future time:
 * the caller keeps the customer's own words and flags the booking for a
 * human rather than saving a wrong time.
 */
export function parseScheduledLocal(
  value: string | null,
  timeZone: string,
  now: Date = new Date(),
): Date | null {
  const match = value?.match(WALL_CLOCK)
  if (!match) return null

  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((part) => Number(part ?? 0))

  // Date.UTC rolls Feb 30 over to March; catch it by reading it back.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  if (hour > 23 || minute > 59 || second > 59) return null

  const instant = zonedTimeToUtc({ year, month, day, hour, minute, second }, timeZone)
  return instant > now ? instant : null
}

/** An instant as the `YYYY-MM-DDTHH:mm` a datetime input expects. */
export function toScheduledLocal(instant: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant)
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

/** A booking time as an agent or customer would read it. */
export function formatBookingTime(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(typeof instant === 'string' ? new Date(instant) : instant)
}
