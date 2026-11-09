import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { testMetaConnection } from '@/lib/ads/graph'
import { syncMetaAds } from '@/lib/ads/scheduler'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * GET /api/ads/config  (admin+)
 *
 * Returns the admin-facing config view (never returns access_token).
 * Shows whether config exists and uses_whatsapp_token flag.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const adminDb = supabaseAdmin()
    const { data: config, error } = await adminDb
      .from('meta_ads_config')
      .select('ad_account_id, backfill_days, access_token, currency, timezone, last_synced_at, last_sync_error, sync_started_at')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ads/config GET] fetch error:', error)
      return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
    }

    if (!config) {
      return NextResponse.json({
        configured: false,
        ad_account_id: null,
        backfill_days: 90,
        uses_whatsapp_token: false,
        currency: null,
        timezone: null,
        last_synced_at: null,
        last_sync_error: null,
        syncing: false,
      })
    }

    return NextResponse.json({
      configured: true,
      ad_account_id: config.ad_account_id,
      backfill_days: config.backfill_days,
      uses_whatsapp_token: config.access_token !== null,
      currency: config.currency,
      timezone: config.timezone,
      last_synced_at: config.last_synced_at,
      last_sync_error: config.last_sync_error,
      syncing: config.sync_started_at ? new Date(config.sync_started_at) > new Date(Date.now() - 15 * 60 * 1000) : false,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT /api/ads/config  (admin+)
 *
 * Saves or updates the Meta Ads config for the account.
 * Validates the ad_account_id format, tests the connection with Meta,
 * then encrypts and stores. Triggers an initial sync via after().
 */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ads-config:${userId}`, RATE_LIMITS.adminAction)
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
    const backfillDays = typeof body.backfill_days === 'number' ? body.backfill_days : 90

    if (backfillDays < 1 || backfillDays > 1095) {
      return NextResponse.json({ error: t('ads.backfillDaysRange') }, { status: 400 })
    }

    // Determine token to test with
    let testToken: string
    if (rawToken) {
      testToken = rawToken
    } else if (useWhatsAppToken) {
      // Will fetch from WhatsApp config in testMetaConnection fallback
      const adminDb = supabaseAdmin()
      const { data: wa } = await adminDb
        .from('whatsapp_config')
        .select('access_token')
        .eq('account_id', accountId)
        .maybeSingle()
      const encrypted = (wa as { access_token?: string | null } | null)?.access_token ?? null
      if (!encrypted) {
        return NextResponse.json({ error: t('ads.noWhatsAppToken') }, { status: 400 })
      }
      try {
        testToken = decrypt(encrypted)
      } catch {
        return NextResponse.json({ error: t('ads.tokenCorrupted') }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: t('ads.tokenOrWhatsAppRequired') }, { status: 400 })
    }

    // Test connection before saving
    const testResult = await testMetaConnection(adAccountId, testToken)
    if (!testResult.ok) {
      return NextResponse.json({ error: testResult.error }, { status: 400 })
    }

    // Encrypt token for storage (if provided)
    let encryptedToken: string | null = null
    if (rawToken) {
      encryptedToken = encrypt(rawToken)
    }
    // If useWhatsAppToken is true and no rawToken, we store NULL to signal "use WhatsApp token"

    const adminDb = supabaseAdmin()
    const now = new Date().toISOString()

    // Upsert config
    const { error: upsertError } = await adminDb
      .from('meta_ads_config')
      .upsert({
        account_id: accountId,
        ad_account_id: adAccountId,
        access_token: encryptedToken,
        currency: testResult.currency,
        timezone: testResult.timezone,
        backfill_days: backfillDays,
        updated_at: now,
      }, { onConflict: 'account_id' })

    if (upsertError) {
      console.error('[ads/config PUT] upsert error:', upsertError)
      return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
    }

    // Trigger initial sync in background (non-blocking)
    // Using Next.js 15's `after()` would be ideal, but for compatibility
    // we'll use setTimeout to fire after response
    setTimeout(() => {
      syncMetaAds(adminDb, accountId).catch((err) => {
        console.error('[ads] initial sync failed', err instanceof Error ? err.message : 'unknown')
      })
    }, 0)

    return NextResponse.json({ ...testResult, ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

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