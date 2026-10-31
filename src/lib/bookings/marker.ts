import type { BookingMarker } from './types'

const OPEN_TAG = '[[BOOKING]]'
const CLOSE_TAG = '[[/BOOKING]]'
const COMPLETE_MARKER = /\[\[BOOKING\]\]([\s\S]*?)\[\[\/BOOKING\]\]/g

const MAX_FIELDS = 30
const MAX_VALUE_LEN = 500

export interface MarkerExtraction {
  /** The reply with every trace of the marker removed. Safe to send. */
  text: string
  marker: BookingMarker | null
  /** The model tried to record a booking but it could not be read. */
  malformed: boolean
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_VALUE_LEN) : null
}

function cleanFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const fields: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value).slice(0, MAX_FIELDS)) {
    const cleaned = cleanString(raw)
    if (cleaned) fields[key] = cleaned
  }
  return fields
}

function parseMarker(body: string): BookingMarker | null {
  const json = body
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const raw = parsed as Record<string, unknown>
  const type = cleanString(raw.type)
  const action = raw.action ?? 'save'
  if (!type || (action !== 'save' && action !== 'cancel')) return null

  return {
    type,
    action,
    fields: cleanFields(raw.fields),
    scheduledLocal: cleanString(raw.scheduled_local),
    scheduledText: cleanString(raw.scheduled_text),
    onExisting:
      raw.on_existing === 'update' || raw.on_existing === 'replace' ? raw.on_existing : null,
  }
}

/**
 * Split the booking marker out of a raw model reply. Whatever the model
 * produced — several markers, broken JSON, a reply cut off mid-marker —
 * the returned `text` never carries any of it, because this text goes
 * straight to the customer. When several markers appear the last wins.
 */
export function extractBookingMarker(raw: string): MarkerExtraction {
  if (!raw.includes(OPEN_TAG) && !raw.includes(CLOSE_TAG)) {
    return { text: raw, marker: null, malformed: false }
  }

  const bodies = [...raw.matchAll(COMPLETE_MARKER)].map((m) => m[1])
  let text = raw.replace(COMPLETE_MARKER, '')

  const unterminatedAt = text.indexOf(OPEN_TAG)
  if (unterminatedAt !== -1) text = text.slice(0, unterminatedAt)
  text = text.split(CLOSE_TAG).join('').trim()

  const last = bodies.at(-1)
  const marker = last === undefined ? null : parseMarker(last)
  return { text, marker, malformed: marker === null && (bodies.length > 0 || unterminatedAt !== -1) }
}
