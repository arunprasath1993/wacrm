import { isUuid } from '@/lib/api/v1/pagination'
import { getT } from '@/lib/i18n/translate'
import { parseScheduledLocal } from './time'
import type {
  BookingContactField,
  BookingFieldDef,
  BookingStatus,
  BookingTimeMode,
} from './types'

const t = getT('Api')

const MAX_NAME_LEN = 60
const MAX_FIELDS = 20
const MAX_INSTRUCTIONS_LEN = 1000
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/

const TIME_MODES: BookingTimeMode[] = ['required', 'optional', 'none']
const CONTACT_FIELDS: BookingContactField[] = ['name', 'email', 'company']
const STATUSES: BookingStatus[] = ['open', 'needs_review', 'done', 'cancelled']

export interface BookingTypeInput {
  name: string
  key: string
  fields: BookingFieldDef[]
  time_mode: BookingTimeMode
  duration_minutes: number
  instructions: string | null
  assignee_user_id: string | null
  handoff_on_confirm: boolean
  remind_minutes_before: number | null
  is_active: boolean
}

type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

function validateFields(raw: unknown): Validated<BookingFieldDef[]> {
  if (!Array.isArray(raw) || raw.length > MAX_FIELDS) {
    return { ok: false, error: t('bookings.fieldsInvalid', { max: String(MAX_FIELDS) }) }
  }

  const fields: BookingFieldDef[] = []
  const seen = new Set<string>()
  for (const [index, item] of raw.entries()) {
    const field = (item ?? {}) as Record<string, unknown>
    const label = typeof field.label === 'string' ? field.label.trim() : ''
    if (!label || label.length > MAX_NAME_LEN) {
      return { ok: false, error: t('bookings.fieldLabelRequired') }
    }
    const mapsTo = field.maps_to ?? null
    if (mapsTo !== null && !CONTACT_FIELDS.includes(mapsTo as BookingContactField)) {
      return { ok: false, error: t('bookings.fieldMappingInvalid') }
    }

    const sent = typeof field.key === 'string' && KEY_PATTERN.test(field.key) ? field.key : ''
    const base = sent || slugify(label) || `field_${index + 1}`
    let key = base
    for (let n = 2; seen.has(key); n += 1) key = `${base}_${n}`
    seen.add(key)

    fields.push({
      key,
      label,
      required: field.required === true,
      maps_to: mapsTo as BookingContactField | null,
    })
  }
  return { ok: true, value: fields }
}

/**
 * Validate a booking type from the settings form. `existing` keeps the
 * key stable across renames, because the model and stored prompts refer
 * to a type by it.
 */
export function validateBookingType(
  body: Record<string, unknown>,
  existing?: { key: string },
): Validated<BookingTypeInput> {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > MAX_NAME_LEN) {
    return { ok: false, error: t('bookings.nameInvalid', { max: String(MAX_NAME_LEN) }) }
  }

  const fields = validateFields(body.fields)
  if (!fields.ok) return fields

  if (!TIME_MODES.includes(body.time_mode as BookingTimeMode)) {
    return { ok: false, error: t('bookings.timeModeInvalid') }
  }
  if (!isIntegerBetween(body.duration_minutes, 5, 1440)) {
    return { ok: false, error: t('bookings.durationInvalid') }
  }

  const remind = body.remind_minutes_before ?? null
  if (remind !== null && !isIntegerBetween(remind, 0, 10080)) {
    return { ok: false, error: t('bookings.reminderInvalid') }
  }

  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : ''
  if (instructions.length > MAX_INSTRUCTIONS_LEN) {
    return {
      ok: false,
      error: t('bookings.instructionsTooLong', { max: String(MAX_INSTRUCTIONS_LEN) }),
    }
  }

  const assignee = body.assignee_user_id ?? null
  if (assignee !== null && !(typeof assignee === 'string' && isUuid(assignee))) {
    return { ok: false, error: t('bookings.assigneeInvalid') }
  }

  return {
    ok: true,
    value: {
      name,
      key: existing?.key ?? (slugify(name) || 'type'),
      fields: fields.value,
      time_mode: body.time_mode as BookingTimeMode,
      duration_minutes: body.duration_minutes as number,
      instructions: instructions || null,
      assignee_user_id: assignee as string | null,
      handoff_on_confirm: body.handoff_on_confirm === true,
      remind_minutes_before: remind as number | null,
      is_active: body.is_active !== false,
    },
  }
}

export type BookingPatch = { ok: true; update: Record<string, unknown> } | { ok: false; error: string }

/**
 * Pick the columns an agent may change out of a request body. Only
 * touches what was sent, so a status change can't clear the time.
 */
export function resolveBookingPatch(
  body: Record<string, unknown>,
  timeZone: string,
  now: Date = new Date(),
): BookingPatch {
  const update: Record<string, unknown> = {}

  if ('status' in body) {
    if (!STATUSES.includes(body.status as BookingStatus)) {
      return { ok: false, error: t('bookings.statusInvalid') }
    }
    update.status = body.status
  }

  if ('scheduled_local' in body) {
    const local = body.scheduled_local
    const parsed =
      typeof local === 'string' ? parseScheduledLocal(local, timeZone, now) : null
    if (local !== null && !parsed) {
      return { ok: false, error: t('bookings.timeInvalid') }
    }
    update.scheduled_at = parsed?.toISOString() ?? null
    update.scheduled_text = null
  }

  if ('assigned_to' in body) {
    const assignee = body.assigned_to
    if (assignee !== null && !(typeof assignee === 'string' && isUuid(assignee))) {
      return { ok: false, error: t('bookings.assigneeInvalid') }
    }
    update.assigned_to = assignee
  }

  if ('fields' in body) {
    const fields = body.fields
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return { ok: false, error: t('bookings.fieldsMustBeObject') }
    }
    update.fields = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => typeof value === 'string'),
    )
  }

  return { ok: true, update }
}
