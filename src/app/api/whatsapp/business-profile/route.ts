import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  getBusinessProfile,
  updateBusinessProfile,
  resolveMetaAppId,
  uploadResumableMedia,
} from '@/lib/whatsapp/meta-api'
import {
  checkProfilePhoto,
  parseBusinessProfileUpdate,
  sniffProfilePhoto,
  toBusinessProfile,
} from '@/lib/whatsapp/business-profile'
import { PROFILE_PHOTO_MAX_BYTES } from '@/lib/whatsapp/business-profile-fields'
import {
  explainMetaError,
  metaErrorPayload,
  type MetaConnectStep,
} from '@/lib/whatsapp/meta-error-explain'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

/**
 * WhatsApp Business Profile — the photo, About line, description,
 * address, email, websites and category customers see in the chat info
 * of the connected number. Distinct from the CRM user's own avatar
 * (Settings → Your profile), which never leaves wacrm.
 *
 *   GET  — any member: the live profile, read from Meta.
 *   POST — admins: multipart form with `fields` (JSON of only the
 *          changed keys) and an optional `photo` (JPEG/PNG, ≤ 5 MB).
 */

const t = getT('Api.businessProfile')

type SupabaseLike = Awaited<ReturnType<typeof getCurrentAccount>>['supabase']

async function loadConnectedNumber(supabase: SupabaseLike, accountId: string) {
  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!config || config.status !== 'connected' || !config.phone_number_id) return null
  return config as { phone_number_id: string; access_token: string }
}

function metaFailure(err: unknown, step: MetaConnectStep, phoneNumberId: string) {
  const explained = explainMetaError(err, step, { phoneNumberId })
  console.error(`[whatsapp/business-profile] Meta ${step} failed:`, explained.metaMessage, {
    code: explained.code,
    fbtrace_id: explained.fbtraceId,
  })
  return NextResponse.json(
    { error: explained.summary, meta: metaErrorPayload(explained) },
    { status: explained.httpStatus },
  )
}

export async function GET() {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()

    const limit = checkRateLimit(`whatsapp-business-profile:${userId}`, RATE_LIMITS.whatsappHealth)
    if (!limit.success) return rateLimitResponse(limit)

    const config = await loadConnectedNumber(supabase, accountId)
    if (!config) return NextResponse.json({ state: 'disconnected' })

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({ state: 'unavailable', message: t('tokenCorrupted') })
    }

    try {
      const meta = await getBusinessProfile({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({ state: 'connected', profile: toBusinessProfile(meta) })
    } catch (err) {
      const explained = explainMetaError(err, 'business_profile', {
        phoneNumberId: config.phone_number_id,
      })
      console.error('[whatsapp/business-profile] lookup failed:', explained.metaMessage)
      return NextResponse.json({ state: 'unavailable', message: explained.summary })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`whatsapp-admin:${userId}`, RATE_LIMITS.whatsappAdmin)
    if (!limit.success) return rateLimitResponse(limit)

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return NextResponse.json({ error: t('invalidBody') }, { status: 400 })
    }

    let rawFields: unknown = {}
    const fieldsEntry = form.get('fields')
    if (typeof fieldsEntry === 'string') {
      try {
        rawFields = JSON.parse(fieldsEntry)
      } catch {
        return NextResponse.json({ error: t('invalidBody') }, { status: 400 })
      }
    } else if (fieldsEntry !== null) {
      return NextResponse.json({ error: t('invalidBody') }, { status: 400 })
    }
    const parsed = parseBusinessProfileUpdate(rawFields)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    let photo: { bytes: Uint8Array; mimeType: 'image/jpeg' | 'image/png' } | null = null
    const photoEntry = form.get('photo')
    if (photoEntry instanceof File) {
      // Size check before buffering, so an oversized upload is refused cheaply.
      if (photoEntry.size > PROFILE_PHOTO_MAX_BYTES) {
        return NextResponse.json(
          { error: t('photoTooLarge', { max: PROFILE_PHOTO_MAX_BYTES / 1024 / 1024 }) },
          { status: 400 },
        )
      }
      const bytes = new Uint8Array(await photoEntry.arrayBuffer())
      const photoError = checkProfilePhoto(bytes)
      if (photoError) return NextResponse.json({ error: photoError }, { status: 400 })
      photo = { bytes, mimeType: sniffProfilePhoto(bytes)! }
    } else if (photoEntry !== null) {
      return NextResponse.json({ error: t('invalidBody') }, { status: 400 })
    }

    if (!photo && Object.keys(parsed.value).length === 0) {
      return NextResponse.json({ error: t('nothingToUpdate') }, { status: 400 })
    }

    const config = await loadConnectedNumber(supabase, accountId)
    if (!config) return NextResponse.json({ error: t('notConnected') }, { status: 409 })

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({ error: t('tokenCorrupted') }, { status: 409 })
    }
    const phoneNumberId = config.phone_number_id

    // The Resumable Upload API is app-scoped — same requirement as
    // template media headers.
    const appId = photo ? await resolveMetaAppId(accessToken) : null
    if (photo && !appId) {
      return NextResponse.json({ error: t('metaAppIdRequired') }, { status: 500 })
    }

    let profilePictureHandle: string | undefined
    if (photo) {
      try {
        const ext = photo.mimeType === 'image/png' ? 'png' : 'jpg'
        const { handle } = await uploadResumableMedia({
          appId: appId!,
          accessToken,
          fileName: `profile.${ext}`,
          mimeType: photo.mimeType,
          bytes: photo.bytes,
        })
        profilePictureHandle = handle
      } catch (err) {
        return metaFailure(err, 'profile_photo_upload', phoneNumberId)
      }
    }

    try {
      await updateBusinessProfile({
        phoneNumberId,
        accessToken,
        fields: parsed.value,
        profilePictureHandle,
      })
    } catch (err) {
      return metaFailure(err, 'business_profile', phoneNumberId)
    }

    // Read back so the card shows Meta's new photo URL. The update has
    // already succeeded, so a failed read-back is not an error.
    let profile = null
    try {
      profile = toBusinessProfile(await getBusinessProfile({ phoneNumberId, accessToken }))
    } catch (err) {
      console.error(
        '[whatsapp/business-profile] read-back failed:',
        err instanceof Error ? err.message : err,
      )
    }
    return NextResponse.json({ success: true, profile })
  } catch (err) {
    return toErrorResponse(err)
  }
}
