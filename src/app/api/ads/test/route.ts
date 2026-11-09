import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { testMetaConnection } from '@/lib/ads/graph'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ads/test  (admin+)
 *
 * "Test connection" button: validate a candidate ad_account_id + token
 * against Meta Graph API WITHOUT saving. When `token` is omitted the
 * stored token (or WhatsApp token fallback) is used, so an admin can
 * re-test an existing config. Returns `{ ok: true, name, currency, timezone }`
 * on success, 400 with error on failure.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ads-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    }

    const adAccountId = typeof body.ad_account_id === 'string' ? body.ad_account_id.trim() : ''
    if (!adAccountId) {
      return NextResponse.json({ error: t('ads.adAccountIdRequired') }, { status: 400 })
    }
    if (!/^act_[0-9]+$/.test(adAccountId)) {
      return NextResponse.json({ error: t('ads.adAccountIdFormat') }, { status: 400 })
    }

    const rawToken = typeof body.token === 'string' ? body.token.trim() : ''
    const useWhatsAppToken = body.use_whatsapp_token === true

    let token: string

    if (rawToken) {
      token = rawToken
    } else {
      // Fetch stored config to get the encrypted token
      const adminDb = supabaseAdmin()
      const { data: config, error } = await adminDb
        .from('meta_ads_config')
        .select('access_token')
        .eq('account_id', accountId)
        .maybeSingle()

      if (error) {
        console.error('[ads/test] fetch config error:', error)
        return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
      }

      let encrypted = config?.access_token ?? null

      // Fallback to WhatsApp config token if no ads-specific token
      if (!encrypted && useWhatsAppToken) {
        const { data: wa } = await adminDb
          .from('whatsapp_config')
          .select('access_token')
          .eq('account_id', accountId)
          .maybeSingle()
        encrypted = (wa as { access_token?: string | null } | null)?.access_token ?? null
      }

      if (!encrypted) {
        return NextResponse.json(
          { error: t('ads.noTokenConfigured') },
          { status: 400 },
        )
      }

      try {
        token = decrypt(encrypted)
      } catch {
        return NextResponse.json(
          { error: t('ads.tokenCorrupted') },
          { status: 400 },
        )
      }
    }

    const result = await testMetaConnection(adAccountId, token)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ ...result, ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}