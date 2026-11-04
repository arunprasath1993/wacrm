// ============================================================
// Shared types for Booking Types: per-account definitions of what the
// AI agent collects, and the bookings it records. Mirrors migration 063.
// ============================================================

export type BookingTimeMode = 'required' | 'optional' | 'none'

export type BookingStatus = 'open' | 'needs_review' | 'done' | 'cancelled'

/** Statuses covered by the one-open-booking-per-contact-and-type index. */
export const OPEN_BOOKING_STATUSES: BookingStatus[] = ['open', 'needs_review']

/** Contact columns a captured detail can fill in. */
export type BookingContactField = 'name' | 'email' | 'company'

export interface BookingFieldDef {
  key: string
  label: string
  required: boolean
  /** Contact column to fill when it is empty. */
  maps_to: BookingContactField | null
}

export interface BookingType {
  id: string
  key: string
  name: string
  fields: BookingFieldDef[]
  time_mode: BookingTimeMode
  duration_minutes: number
  instructions: string | null
  assignee_user_id: string | null
  handoff_on_confirm: boolean
  remind_minutes_before: number | null
  /** Bookings that may overlap. Null means no limit. */
  slot_capacity: number | null
  /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
  available_days: number[]
  /** `HH:mm` or `HH:mm:ss` in the account's timezone. */
  available_from: string
  available_to: string
}

export interface BookingRow {
  id: string
  status: BookingStatus
  fields: Record<string, string>
  scheduled_at: string | null
  scheduled_text: string | null
  assigned_to: string | null
}

/** What the model asked for, parsed out of its reply. Untrusted. */
export interface BookingMarker {
  type: string
  action: 'save' | 'cancel'
  fields: Record<string, string>
  /** Wall-clock time in the account's timezone, `YYYY-MM-DDTHH:mm`. */
  scheduledLocal: string | null
  scheduledText: string | null
  /**
   * What the customer chose to do with their open booking of this type:
   * change it, or close it and book afresh. Null when they weren't asked.
   */
  onExisting: 'update' | 'replace' | null
}
