import { getT } from '@/lib/i18n/translate'
import {
  BUSINESS_PROFILE_LIMITS,
  BUSINESS_VERTICALS,
  PROFILE_PHOTO_MAX_BYTES,
  type BusinessProfile,
  type BusinessProfileFields,
  type BusinessVertical,
} from './business-profile-fields'

/**
 * Server-side checks for a WhatsApp Business Profile update. Meta
 * rejects an over-long or malformed field with a bare "Invalid
 * parameter", so we catch each case here and say which field is wrong.
 */

const t = getT('Validation.businessProfile')

// Same rough shape check as the CRM profile form; Meta is the real validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type BusinessProfileUpdate = Partial<BusinessProfileFields>

export type ParseResult =
  | { ok: true; value: BusinessProfileUpdate }
  | { ok: false; error: string }

/** Meta's GET shape — every field is optional and absent when unset. */
export interface MetaBusinessProfile {
  about?: string
  address?: string
  description?: string
  email?: string
  websites?: string[]
  vertical?: string
  profile_picture_url?: string
}

const TEXT_FIELDS = ['about', 'address', 'description', 'email'] as const

function isVertical(value: string): value is BusinessVertical {
  return (BUSINESS_VERTICALS as readonly string[]).includes(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validate a partial update. Only the keys present are sent to Meta, so
 * the settings card sends just the fields the user changed. Unknown keys
 * are dropped.
 */
export function parseBusinessProfileUpdate(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: t('invalidBody') }
  }
  const input = raw as Record<string, unknown>
  const value: BusinessProfileUpdate = {}

  for (const field of TEXT_FIELDS) {
    if (!(field in input)) continue
    const v = input[field]
    if (typeof v !== 'string') return { ok: false, error: t('notText', { field }) }
    const trimmed = v.trim()
    const max = BUSINESS_PROFILE_LIMITS[field]
    if (trimmed.length > max) return { ok: false, error: t('tooLong', { field, max }) }
    value[field] = trimmed
  }

  if (value.about !== undefined && value.about.length === 0) {
    return { ok: false, error: t('aboutRequired') }
  }
  if (value.email && !EMAIL_RE.test(value.email)) {
    return { ok: false, error: t('invalidEmail') }
  }

  if ('websites' in input) {
    const v = input.websites
    if (!Array.isArray(v) || v.some((w) => typeof w !== 'string')) {
      return { ok: false, error: t('invalidWebsites') }
    }
    const websites = (v as string[]).map((w) => w.trim()).filter(Boolean)
    if (websites.length > BUSINESS_PROFILE_LIMITS.maxWebsites) {
      return { ok: false, error: t('tooManyWebsites', { max: BUSINESS_PROFILE_LIMITS.maxWebsites }) }
    }
    for (const w of websites) {
      if (w.length > BUSINESS_PROFILE_LIMITS.website) {
        return { ok: false, error: t('tooLong', { field: 'website', max: BUSINESS_PROFILE_LIMITS.website }) }
      }
      if (!isHttpUrl(w)) return { ok: false, error: t('invalidWebsite', { url: w }) }
    }
    value.websites = websites
  }

  if ('vertical' in input) {
    const v = input.vertical
    if (typeof v !== 'string' || !isVertical(v)) {
      return { ok: false, error: t('invalidVertical') }
    }
    value.vertical = v
  }

  return { ok: true, value }
}

/**
 * Identify a profile photo by its magic bytes rather than trusting the
 * browser-supplied Content-Type. Returns the MIME type Meta should be
 * told, or null when the bytes are neither JPEG nor PNG.
 */
export function sniffProfilePhoto(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  return null
}

/** Returns an error message, or null when the photo is acceptable. */
export function checkProfilePhoto(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return t('photoEmpty')
  if (bytes.byteLength > PROFILE_PHOTO_MAX_BYTES) {
    return t('photoTooLarge', { max: PROFILE_PHOTO_MAX_BYTES / 1024 / 1024 })
  }
  if (!sniffProfilePhoto(bytes)) return t('photoWrongType')
  return null
}

/** Normalise Meta's sparse GET shape into the form the settings card edits. */
export function toBusinessProfile(meta: MetaBusinessProfile): BusinessProfile {
  return {
    about: meta.about ?? '',
    address: meta.address ?? '',
    description: meta.description ?? '',
    email: meta.email ?? '',
    websites: Array.isArray(meta.websites) ? meta.websites : [],
    vertical: meta.vertical && isVertical(meta.vertical) ? meta.vertical : '',
    profilePictureUrl: meta.profile_picture_url || null,
  }
}
