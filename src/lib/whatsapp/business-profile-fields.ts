/**
 * Field limits for the WhatsApp Business Profile — the photo, "About"
 * line, description, address, email, websites and category that
 * customers see when they open the business's chat info. Mirrors Meta's
 * Cloud API reference:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/business-profiles
 *
 * Pure constants with no imports so the server validator
 * (`business-profile.ts`) and the settings card share one source of
 * truth for "what does Meta accept here".
 *
 * The display name is NOT part of this profile: renaming the number
 * goes through Meta's display-name review in WhatsApp Manager.
 */

export const BUSINESS_PROFILE_LIMITS = {
  about: 139,
  address: 256,
  description: 512,
  email: 128,
  website: 256,
  maxWebsites: 2,
} as const

/** Meta's `vertical` enum — the business category shown on the profile. */
export const BUSINESS_VERTICALS = [
  'OTHER',
  'ALCOHOL',
  'APPAREL',
  'AUTO',
  'BEAUTY',
  'EDU',
  'ENTERTAIN',
  'EVENT_PLAN',
  'FINANCE',
  'GOVT',
  'GROCERY',
  'HEALTH',
  'HOTEL',
  'NONPROFIT',
  'ONLINE_GAMBLING',
  'OTC_DRUGS',
  'PHYSICAL_GAMBLING',
  'PROF_SERVICES',
  'RESTAURANT',
  'RETAIL',
  'TRAVEL',
] as const

export type BusinessVertical = (typeof BUSINESS_VERTICALS)[number]

/** Profile photo: Meta takes JPEG or PNG up to 5 MB; 640×640 square looks best. */
export const PROFILE_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024

/** The editable text fields, as Meta names them. */
export interface BusinessProfileFields {
  about: string
  address: string
  description: string
  email: string
  websites: string[]
  vertical: BusinessVertical | ''
}

/** What GET /api/whatsapp/business-profile returns for a connected number. */
export interface BusinessProfile extends BusinessProfileFields {
  profilePictureUrl: string | null
}
