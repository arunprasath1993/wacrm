import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { syncMetaAds } from '@/lib/ads/scheduler'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ads/sync  (admin+)
 *
 * Manual sync trigger. Kicks off a sync for this account immediately,
 * bypassing the stale/backoff checks (but still respects the lock).
 * Returns the sync result.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ads-sync:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const adminDb = supabaseAdmin()
    const result = await syncMetaAds(adminDb, accountId, { now: new Date() })

    if (result.status === 'locked') {
      return NextResponse.json(
        { error: t('ads.syncLocked') },
        { status: 409 },
      )
    }
    if (result.status === 'not_configured') {
      return NextResponse.json(
        { error: t('ads.notConfigured') },
        { status: 400 },
      )
    }
    if (result.status === 'failed') {
      return NextResponse.json(
        { error: result.error ?? t('ads.syncFailed') },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, status: result.status })
  } catch (err) {
    return toErrorResponse(err)
  }
}