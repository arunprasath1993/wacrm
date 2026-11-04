import { MEDIA_MAX_BYTES, buildMediaPath } from '@/lib/storage/upload-media'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { MEDIA_HEADER_SPECS, type MediaHeaderKind } from './media-header-types'
import { MIRROR_BUCKET, type MirrorStorage } from './mirror-inbound-media'

/**
 * Copies a synced template's media header sample into the `chat-media`
 * bucket and returns a durable public URL for `header_media_url`.
 *
 * A template created on Meta's side reaches us through sync with only
 * `example.header_handle`: a signed CDN URL that expires. The send builder
 * needs a stable link on every send (see `template-send-builder.ts`), so
 * without this copy the template can never be sent from the inbox.
 *
 * BEST EFFORT, like `mirrorInboundMedia`: returns `null` rather than
 * throwing, so one bad sample doesn't abort the sync of every other
 * template. The caller reports the `null`.
 */

/**
 * Second path segment for mirrored samples. RLS only matches on the FIRST
 * segment (`account-<id>`, migration 023), so an extra level is free.
 */
const MIRROR_FOLDER = 'template-headers'

export interface MirrorTemplateHeaderArgs {
  /** `supabase.storage`. Writes must land under the caller's account. */
  storage: MirrorStorage
  /** Tenant. Drives the account-scoped path the bucket's policies expect. */
  accountId: string
  /** Meta's template id. Makes the object path deterministic. */
  metaTemplateId: string
  kind: MediaHeaderKind
  /** `example.header_handle[0]` from Meta's template payload. */
  sampleUrl: string
}

export async function mirrorTemplateHeaderMedia(
  args: MirrorTemplateHeaderArgs,
): Promise<string | null> {
  const { storage, accountId, metaTemplateId, kind, sampleUrl } = args
  const spec = MEDIA_HEADER_SPECS[kind]

  try {
    if (!(await isDeliverableUrl(sampleUrl))) {
      console.warn(`[template-header-mirror] refused sample URL for ${metaTemplateId}`)
      return null
    }

    // Do NOT follow redirects, same reasoning as `ensureMediaHeaderHandle`:
    // a 3xx could bounce to an internal address and defeat the guard above.
    const res = await fetch(sampleUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn(`[template-header-mirror] ${metaTemplateId}: sample returned ${res.status}`)
      return null
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (contentType && !spec.mimeTypes.includes(contentType)) {
      console.warn(`[template-header-mirror] ${metaTemplateId}: unexpected type ${contentType}`)
      return null
    }

    // Documents are bounded by the bucket's 16 MB limit, not Meta's 100 MB.
    const maxBytes = Math.min(spec.maxBytes, MEDIA_MAX_BYTES)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
      console.warn(`[template-header-mirror] ${metaTemplateId}: unusable size ${bytes.byteLength}`)
      return null
    }

    // A sample served without a Content-Type is assumed to be the kind's
    // most common format (JPEG / MP4 / PDF).
    const mimeType = contentType || spec.mimeTypes[0]

    // `null` suppresses the wall-clock stamp, and `upsert` rewrites the same
    // key: a repeated sync must not orphan a second copy of the sample.
    const path = buildMediaPath(
      accountId,
      `${metaTemplateId}.${spec.extensions[mimeType]}`,
      null,
      MIRROR_FOLDER,
    )
    const { error } = await storage.from(MIRROR_BUCKET).upload(path, bytes, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: true,
    })
    if (error) {
      console.warn(`[template-header-mirror] upload failed for ${metaTemplateId}:`, error.message)
      return null
    }

    const {
      data: { publicUrl },
    } = storage.from(MIRROR_BUCKET).getPublicUrl(path)
    return publicUrl || null
  } catch (error) {
    console.warn(
      `[template-header-mirror] could not mirror ${metaTemplateId}:`,
      error instanceof Error ? error.message : error,
    )
    return null
  }
}
