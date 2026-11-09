import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { friendlySyncError, graphGet } from './graph'
import { reclassifyUnknownTouches } from './reclassify'
import { sweepLostTouches } from './sweep'

export type SyncResult = { status: 'ok' | 'locked' | 'failed' | 'not_configured'; error?: string }

const LOCK_STALE_MS = 15 * 60_000
const BACKOFF_MS = 60 * 60_000
const MAX_PAGES = 200
const CHUNK = 500
const CONVERSATION_ACTION = 'onsite_conversion.messaging_conversation_started_7d'

interface ConfigRow {
  account_id: string
  ad_account_id: string
  access_token: string | null
  backfill_days: number
  last_synced_at: string | null
  timezone?: string | null
}

export function isSyncDue(
  cfg: { last_synced_at: string | null; last_sync_failed_at: string | null },
  maxAgeHours: number,
  now: Date,
  ignoreBackoff = false,
): boolean {
  const stale =
    cfg.last_synced_at === null || now.getTime() - new Date(cfg.last_synced_at).getTime() > maxAgeHours * 3600_000
  if (!stale) return false
  if (ignoreBackoff || cfg.last_sync_failed_at === null) return true
  return now.getTime() - new Date(cfg.last_sync_failed_at).getTime() >= BACKOFF_MS
}

/** YYYY-MM-DD of an instant in the given IANA time zone (falls back to UTC). */
function dateInZone(d: Date, timeZone: string): string {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
  }
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function shiftDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function insightsRange(
  cfg: { last_synced_at: string | null; backfill_days: number },
  now: Date,
  timeZone: string,
): { since: string; until: string } {
  const today = dateInZone(now, timeZone)
  if (!cfg.last_synced_at) return { since: shiftDays(today, -cfg.backfill_days), until: today }
  const recent = shiftDays(today, -3)
  const gap = shiftDays(dateInZone(new Date(cfg.last_synced_at), timeZone), -1)
  return { since: recent < gap ? recent : gap, until: today }
}

interface Page<T> {
  data?: T[]
  paging?: { cursors?: { after?: string }; next?: string }
}

/**
 * Walks a Graph edge page by page (cursor paging via graphGet), calling
 * `onPage` with each page's rows so they can be persisted before the next
 * request: a failure on a later page keeps earlier pages.
 */
async function forEachPage<T>(
  path: string,
  params: Record<string, string>,
  token: string,
  onPage: (rows: T[]) => Promise<void>,
): Promise<void> {
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await graphGet<Page<T>>(path, after ? { ...params, after } : params, token)
    await onPage(Array.isArray(body.data) ? body.data : [])
    after = body.paging?.next ? body.paging.cursors?.after : undefined
    if (!after) return
  }
  throw new Error('Graph pagination: too many pages')
}

async function upsertChunks(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict })
    if (error) throw error
  }
}

interface AdRow {
  id: string
  name?: string
  effective_status?: string
  adset?: { id?: string; name?: string }
  campaign?: { id?: string; name?: string }
}

interface InsightRow {
  date_start: string
  ad_id?: string
  ad_name?: string
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
  publisher_platform?: string
  spend?: string
  impressions?: string
  clicks?: string
  actions?: Array<{ action_type: string; value: string }>
}

export async function syncMetaAds(
  db: SupabaseClient,
  accountId: string,
  opts: { now?: Date } = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()

  const { data: claimed, error: claimErr } = await db
    .from('meta_ads_config')
    .update({ sync_started_at: nowIso })
    .eq('account_id', accountId)
    .or(`sync_started_at.is.null,sync_started_at.lt.${new Date(now.getTime() - LOCK_STALE_MS).toISOString()}`)
    .select('*')
  if (claimErr) {
    console.error('[ads] sync lock claim failed', (claimErr as { code?: string }).code ?? 'unknown')
    return { status: 'failed', error: 'Meta sync failed (error unknown).' }
  }
  if (!claimed || claimed.length === 0) {
    const { data: exists } = await db.from('meta_ads_config').select('account_id').eq('account_id', accountId).maybeSingle()
    return { status: exists ? 'locked' : 'not_configured' }
  }
  const cfg = claimed[0] as ConfigRow

  const heartbeat = async () => {
    await db.from('meta_ads_config').update({ sync_started_at: new Date().toISOString() }).eq('account_id', accountId)
  }

  try {
    let encrypted = cfg.access_token
    if (!encrypted) {
      const { data: wa } = await db.from('whatsapp_config').select('access_token').eq('account_id', accountId).maybeSingle()
      encrypted = (wa as { access_token?: string | null } | null)?.access_token ?? null
    }
    if (!encrypted) throw new Error('No Meta access token configured')
    const token = decrypt(encrypted)

    const info = await graphGet<{ currency?: string; timezone_name?: string }>(
      `/${cfg.ad_account_id}`,
      { fields: 'currency,timezone_name' },
      token,
    )
    const timeZone = info.timezone_name ?? cfg.timezone ?? 'UTC'
    await db
      .from('meta_ads_config')
      .update({ currency: info.currency ?? null, timezone: info.timezone_name ?? null })
      .eq('account_id', accountId)

    await forEachPage<AdRow>(
      `/${cfg.ad_account_id}/ads`,
      { fields: 'id,name,effective_status,adset{id,name},campaign{id,name}', limit: '500' },
      token,
      async (ads) => {
        const rows = ads.map((a) => ({
          account_id: accountId,
          ad_id: a.id,
          ad_name: a.name ?? null,
          adset_id: a.adset?.id ?? null,
          adset_name: a.adset?.name ?? null,
          campaign_id: a.campaign?.id ?? null,
          campaign_name: a.campaign?.name ?? null,
          effective_status: a.effective_status ?? null,
          updated_at: nowIso,
        }))
        await upsertChunks(db, 'meta_ad_entities', rows, 'account_id,ad_id')
        await heartbeat()
      },
    )

    const range = insightsRange(cfg, now, timeZone)
    await forEachPage<InsightRow>(
      `/${cfg.ad_account_id}/insights`,
      {
        level: 'ad',
        time_increment: '1',
        breakdowns: 'publisher_platform',
        fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions',
        time_range: JSON.stringify(range),
        limit: '500',
      },
      token,
      async (items) => {
        const daily: Record<string, unknown>[] = []
        const names = new Map<string, Record<string, unknown>>()
        for (const r of items) {
          if (!r.ad_id) continue
          const conv = r.actions?.find((a) => a.action_type === CONVERSATION_ACTION)
          daily.push({
            account_id: accountId,
            date: r.date_start,
            ad_id: r.ad_id,
            publisher_platform: r.publisher_platform ?? 'unknown',
            spend: Number(r.spend ?? 0) || 0,
            impressions: Number(r.impressions ?? 0) || 0,
            clicks: Number(r.clicks ?? 0) || 0,
            meta_conversations: conv ? Number(conv.value) || 0 : 0,
          })
          // effective_status intentionally omitted so the /ads value is not overwritten.
          names.set(r.ad_id, {
            account_id: accountId,
            ad_id: r.ad_id,
            ad_name: r.ad_name ?? null,
            adset_id: r.adset_id ?? null,
            adset_name: r.adset_name ?? null,
            campaign_id: r.campaign_id ?? null,
            campaign_name: r.campaign_name ?? null,
            updated_at: nowIso,
          })
        }
        await upsertChunks(db, 'meta_ad_insights_daily', daily, 'account_id,date,ad_id,publisher_platform')
        await upsertChunks(db, 'meta_ad_entities', [...names.values()], 'account_id,ad_id')
        await heartbeat()
      },
    )

    try {
      await reclassifyUnknownTouches(db, accountId)
    } catch (err) {
      console.error('[ads] reclassify after sync failed', (err as { code?: string } | null)?.code ?? 'unknown')
    }
    try {
      await sweepLostTouches(db, accountId)
    } catch (err) {
      console.error('[ads] sweep after sync failed', (err as { code?: string } | null)?.code ?? 'unknown')
    }

    await db
      .from('meta_ads_config')
      .update({ last_synced_at: nowIso, last_sync_error: null, last_sync_failed_at: null })
      .eq('account_id', accountId)
    return { status: 'ok' }
  } catch (err) {
    const error = err instanceof Error && err.message === 'No Meta access token configured'
      ? 'No access token available. Add one in Settings → Meta Ads.'
      : friendlySyncError(err)
    console.error('[ads] sync failed', (err as { code?: number | string } | null)?.code ?? 'unknown')
    try {
      await db
        .from('meta_ads_config')
        .update({ last_sync_error: error, last_sync_failed_at: nowIso })
        .eq('account_id', accountId)
    } catch {
      /* best effort */
    }
    return { status: 'failed', error }
  } finally {
    try {
      await db.from('meta_ads_config').update({ sync_started_at: null }).eq('account_id', accountId)
    } catch {
      /* best effort */
    }
  }
}
