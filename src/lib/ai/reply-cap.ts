// ============================================================
// Per-conversation AI reply cap: validation and runtime selection.
//
// An account has two caps:
//   - the customer cap (`auto_reply_max_per_conversation`), and
//   - a testing cap (`auto_reply_max_testing`) that applies when the
//     conversation's contact is on the account's testing-number list.
//
// Neither cap has a business upper limit — choosing a sensible value is
// the admin's call. The only ceiling is the Postgres `integer` column
// that stores it (and the `claim_ai_reply_slot` RPC parameter).
//
// Pure module (no server imports) so the settings form can use the same
// normalization the API applies.
// ============================================================

/** Largest value a Postgres `integer` can hold — the storage ceiling. */
export const REPLY_CAP_STORAGE_MAX = 2_147_483_647

/** Default testing cap for accounts that never set one (matches the DB default). */
export const DEFAULT_TESTING_REPLY_CAP = 1000

/** Country code assumed when a testing number is typed without one. */
const DEFAULT_COUNTRY_CODE = '91'

/**
 * Parse a reply cap from user input. Accepts a number or a numeric
 * string; returns the integer, or null when it is not a whole number
 * >= 1 (or would not fit the integer column). Never clamps.
 */
export function parseReplyCap(value: unknown): number | null {
  let n: number
  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) {
    n = Number(value.trim())
  } else {
    return null
  }
  if (!Number.isInteger(n) || n < 1 || n > REPLY_CAP_STORAGE_MAX) return null
  return n
}

/**
 * Normalize a WhatsApp number to E.164 (`+<digits>`), or null when it
 * isn't a plausible phone number.
 *
 *   "+91 98765-43210"  → "+919876543210"   (explicit country code)
 *   "0091 9876543210"  → "+919876543210"   (00 international prefix)
 *   "9876543210"       → "+919876543210"   (10 digits: +91 assumed)
 *   "09876543210"      → "+919876543210"   (trunk 0 dropped, +91 assumed)
 *   "919876543210"     → "+919876543210"   (already has a country code)
 *
 * Without a `+`/`00` prefix, a 10-digit national number gets +91; a
 * longer one is taken to already include its country code (the form
 * Meta's `wa_id` uses).
 */
export function normalizeTestingNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const compact = raw.trim().replace(/[\s().\-]/g, '')
  if (!compact) return null

  let digits: string
  if (compact.startsWith('+')) {
    digits = compact.slice(1)
  } else if (compact.startsWith('00')) {
    digits = compact.slice(2)
  } else {
    if (!/^\d+$/.test(compact)) return null
    const national = compact.replace(/^0+/, '')
    digits = national.length === 10 ? DEFAULT_COUNTRY_CODE + national : national
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) return null
  return `+${digits}`
}

export type TestingNumbersResult =
  | { ok: true; numbers: string[] }
  | { ok: false; error: 'invalid'; value: string }
  | { ok: false; error: 'duplicate'; value: string }

/**
 * Normalize an admin-entered testing-number list. Blank entries are
 * dropped; an invalid or duplicate (after normalization) entry rejects
 * the whole list so the admin sees exactly which one to fix.
 */
export function normalizeTestingNumbers(input: unknown): TestingNumbersResult {
  if (!Array.isArray(input)) return { ok: true, numbers: [] }
  const seen = new Set<string>()
  const numbers: string[] = []
  for (const entry of input) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    const e164 = normalizeTestingNumber(entry)
    if (!e164) return { ok: false, error: 'invalid', value: entry.trim() }
    if (seen.has(e164)) return { ok: false, error: 'duplicate', value: entry.trim() }
    seen.add(e164)
    numbers.push(e164)
  }
  return { ok: true, numbers }
}

/**
 * Convert a stored contact phone to E.164, or null when implausible.
 *
 * Contact phones are always international: Meta's digits-only `wa_id`
 * (`919876543210`) or `+`-prefixed manual entry. So unlike
 * `normalizeTestingNumber`, no national-number heuristic is applied —
 * a 10-digit contact like Singapore's `6591234567` stays `+6591234567`.
 */
export function contactPhoneToE164(phone: string | null | undefined): string | null {
  if (!phone) return null
  const compact = phone.trim().replace(/[\s().\-]/g, '')
  const digits = compact.startsWith('+') ? compact.slice(1) : compact
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null
  return `+${digits}`
}

/**
 * True when the contact `phone` is on the testing list (compared in
 * E.164). The contact phone is read as international
 * (`contactPhoneToE164`); list entries were admin input and go through
 * `normalizeTestingNumber`.
 */
export function isTestingNumber(
  phone: string | null | undefined,
  testingNumbers: readonly string[] | null | undefined,
): boolean {
  if (!phone || !testingNumbers || testingNumbers.length === 0) return false
  const e164 = contactPhoneToE164(phone)
  if (!e164) return false
  return testingNumbers.some((n) => normalizeTestingNumber(n) === e164)
}

export interface ReplyCapSettings {
  customerCap: number
  testingCap: number | null | undefined
  testingNumbers: readonly string[] | null | undefined
}

/**
 * The reply cap that applies to a conversation, chosen by its contact's
 * phone: the testing cap for a testing number, else the customer cap.
 * A contact with no phone (BSUID-only) always gets the customer cap.
 */
export function resolveReplyCap(
  settings: ReplyCapSettings,
  contactPhone: string | null | undefined,
): number {
  if (isTestingNumber(contactPhone, settings.testingNumbers)) {
    return settings.testingCap ?? DEFAULT_TESTING_REPLY_CAP
  }
  return settings.customerCap
}
