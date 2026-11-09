import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toErrorResponse } from '@/lib/auth/account'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * GET /api/ads/status
 *
 * Any account member can read the sync status (non-secret).
 * Returns the result of get_meta_ads_status() which never returns access_token.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!profile?.account_id) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: t('common.profileNotLinked') },
        { status: 200 },
      )
    }

    const { data, error } = await supabase.rpc('get_meta_ads_status', {
      p_account_id: profile.account_id,
    })

    if (error) {
      console.error('[ads/status] rpc error:', error)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: t('common.internalServerError') },
        { status: 500 },
      )
    }

    const row = (data as Array<{
      connected: boolean
      ad_account_id: string | null
      currency: string | null
      timezone: string | null
      last_synced_at: string | null
      last_sync_error: string | null
      syncing: boolean
    }>)[0]

    if (!row) {
      return NextResponse.json(
        { connected: false, ad_account_id: null, currency: null, timezone: null, last_synced_at: null, last_sync_error: null, syncing: false },
        { status: 200 },
      )
    }

    return NextResponse.json(row)
  } catch (err) {
    return toErrorResponse(err)
  }
}