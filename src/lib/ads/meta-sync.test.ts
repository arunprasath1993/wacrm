import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => 'dec:' + s }))
vi.mock('./reclassify', () => ({ reclassifyUnknownTouches: vi.fn(async () => 0) }))
vi.mock('./sweep', () => ({ sweepLostTouches: vi.fn(async () => 0) }))

import { syncMetaAds, isSyncDue, insightsRange } from './meta-sync'
import { reclassifyUnknownTouches } from './reclassify'
import { sweepLostTouches } from './sweep'

const NOW = new Date('2026-11-09T12:00:00.000Z')

interface Cfg {
  account_id: string
  ad_account_id: string
  access_token: string | null
  backfill_days: number
  last_synced_at: string | null
  timezone?: string | null
}

function makeDb(opts: { cfg: Cfg | null; locked?: boolean; waToken?: string | null }) {
  const configUpdates: Array<Record<string, unknown>> = []
  const upserts: Array<{ table: string; rows: Record<string, unknown>[]; onConflict?: string }> = []
  let claimed = false
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    let isClaim = false
    for (const m of ['eq', 'or', 'select']) chain[m] = () => chain
    chain.update = (p: Record<string, unknown>) => {
      if (table === 'meta_ads_config') {
        configUpdates.push(p)
        if (!claimed) {
          claimed = true
          isClaim = true
        }
      }
      return chain
    }
    chain.upsert = async (rows: Record<string, unknown>[], o?: { onConflict?: string }) => {
      upserts.push({ table, rows, onConflict: o?.onConflict })
      return { error: null }
    }
    chain.maybeSingle = async () => {
      if (table === 'whatsapp_config') return { data: opts.waToken ? { access_token: opts.waToken } : null, error: null }
      return { data: opts.cfg ? { account_id: opts.cfg.account_id } : null, error: null }
    }
    chain.then = (res: (v: unknown) => void) => {
      if (isClaim) res({ data: opts.cfg && !opts.locked ? [opts.cfg] : [], error: null })
      else res({ data: null, error: null })
    }
    return chain
  })
  return { db: { from } as unknown as SupabaseClient, configUpdates, upserts }
}

const cfgBase: Cfg = {
  account_id: 'acc',
  ad_account_id: 'act_1',
  access_token: 'enc-own',
  backfill_days: 90,
  last_synced_at: null,
}

function insightRow(date: string, ad: string, plat: string, spend: string, conv?: string) {
  return {
    date_start: date,
    ad_id: ad,
    ad_name: 'Name ' + ad,
    adset_id: 'as1',
    adset_name: 'Set',
    campaign_id: 'c1',
    campaign_name: 'Camp',
    publisher_platform: plat,
    spend,
    impressions: '100',
    clicks: '5',
    actions: conv ? [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: conv }] : [],
  }
}

function jsonRes(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

describe('syncMetaAds', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(reclassifyUnknownTouches).mockClear()
    vi.mocked(sweepLostTouches).mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    errSpy.mockRestore()
  })

  it('returns locked without fetching when the lock is held', async () => {
    const { db } = makeDb({ cfg: cfgBase, locked: true })
    expect(await syncMetaAds(db, 'acc', { now: NOW })).toEqual({ status: 'locked' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns not_configured without fetching when there is no config row', async () => {
    const { db } = makeDb({ cfg: null })
    expect((await syncMetaAds(db, 'acc', { now: NOW })).status).toBe('not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  function routeFetch(insightsPage2: () => Response) {
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url)
      if (u.pathname.endsWith('/insights')) {
        if (u.searchParams.get('after') === 'CUR1') return insightsPage2()
        return jsonRes({
          data: [insightRow('2026-11-08', 'ad1', 'facebook', '12.50', '3'), insightRow('2026-11-08', 'ad1', 'instagram', '1.00')],
          paging: { cursors: { after: 'CUR1' }, next: 'https://graph.facebook.com/next' },
        })
      }
      if (u.pathname.endsWith('/ads')) {
        return jsonRes({
          data: [{ id: 'ad1', name: 'Ad One', effective_status: 'ACTIVE', adset: { id: 'as1', name: 'Set' }, campaign: { id: 'c1', name: 'Camp' } }],
        })
      }
      return jsonRes({ currency: 'INR', timezone_name: 'Asia/Kolkata' })
    })
  }

  it('happy path: upserts rows, entity names, heartbeats and sets last_synced_at', async () => {
    routeFetch(() => jsonRes({ data: [insightRow('2026-11-09', 'ad2', 'facebook', '7')] }))
    const { db, configUpdates, upserts } = makeDb({ cfg: cfgBase })
    const r = await syncMetaAds(db, 'acc', { now: NOW })
    expect(r).toEqual({ status: 'ok' })
    const dailyUpserts = upserts.filter((u) => u.table === 'meta_ad_insights_daily')
    const daily = dailyUpserts.flatMap((u) => u.rows)
    expect(daily).toHaveLength(3)
    expect(daily[0]).toMatchObject({
      account_id: 'acc',
      ad_id: 'ad1',
      publisher_platform: 'facebook',
      spend: 12.5,
      meta_conversations: 3,
      date: '2026-11-08',
    })
    expect(daily[1].meta_conversations).toBe(0)
    expect(dailyUpserts[0].onConflict).toBe('account_id,date,ad_id,publisher_platform')
    const ents = upserts.filter((u) => u.table === 'meta_ad_entities').flatMap((u) => u.rows)
    expect(ents.find((e) => e.ad_id === 'ad2')).toMatchObject({ ad_name: 'Name ad2', campaign_name: 'Camp' })
    expect(ents.find((e) => e.ad_id === 'ad2')).not.toHaveProperty('effective_status')
    expect(ents.find((e) => e.ad_id === 'ad1' && 'effective_status' in e)).toMatchObject({ effective_status: 'ACTIVE' })
    // heartbeat after each page: 1 ads page + 2 insights pages
    const heartbeats = configUpdates.slice(1).filter((u) => Object.keys(u).length === 1 && typeof u.sync_started_at === 'string')
    expect(heartbeats.length).toBe(3)
    expect(configUpdates.some((u) => u.currency === 'INR' && u.timezone === 'Asia/Kolkata')).toBe(true)
    const done = configUpdates.find((u) => 'last_synced_at' in u)
    expect(done).toMatchObject({ last_synced_at: NOW.toISOString(), last_sync_error: null, last_sync_failed_at: null })
    expect(configUpdates[configUpdates.length - 1]).toEqual({ sync_started_at: null })
    expect(reclassifyUnknownTouches).toHaveBeenCalledWith(db, 'acc')
    expect(sweepLostTouches).toHaveBeenCalledWith(db, 'acc')
  })

  it('fails on page 2 rate limit: friendly error, page 1 kept, last_synced_at untouched, lock cleared', async () => {
    routeFetch(() => jsonRes({ error: { message: 'x', code: 17 } }, 400))
    const { db, configUpdates, upserts } = makeDb({ cfg: cfgBase })
    const r = await syncMetaAds(db, 'acc', { now: NOW })
    expect(r.status).toBe('failed')
    expect(r.error).toBe('Meta rate limit reached. Will retry automatically.')
    expect(upserts.filter((u) => u.table === 'meta_ad_insights_daily').flatMap((u) => u.rows)).toHaveLength(2)
    const fail = configUpdates.find((u) => 'last_sync_error' in u)
    expect(fail).toMatchObject({ last_sync_error: r.error, last_sync_failed_at: NOW.toISOString() })
    expect(configUpdates.some((u) => 'last_synced_at' in u)).toBe(false)
    expect(configUpdates[configUpdates.length - 1]).toEqual({ sync_started_at: null })
    expect(reclassifyUnknownTouches).not.toHaveBeenCalled()
  })

  it('prefers the separate Meta token over the WhatsApp token', async () => {
    routeFetch(() => jsonRes({ data: [] }))
    const { db } = makeDb({ cfg: cfgBase, waToken: 'enc-wa' })
    await syncMetaAds(db, 'acc', { now: NOW })
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('access_token=dec%3Aenc-own'))).toBe(true)
  })

  it('falls back to the WhatsApp token', async () => {
    routeFetch(() => jsonRes({ data: [] }))
    const { db } = makeDb({ cfg: { ...cfgBase, access_token: null }, waToken: 'enc-wa' })
    await syncMetaAds(db, 'acc', { now: NOW })
    expect(String(fetchMock.mock.calls[0][0])).toContain('access_token=dec%3Aenc-wa')
  })

  it('does not fail the sync when sweep throws', async () => {
    routeFetch(() => jsonRes({ data: [] }))
    vi.mocked(sweepLostTouches).mockRejectedValueOnce({ code: 'X' })
    const { db } = makeDb({ cfg: cfgBase })
    expect((await syncMetaAds(db, 'acc', { now: NOW })).status).toBe('ok')
  })
})

describe('isSyncDue', () => {
  const h = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString()
  it('NULL last_synced_at is due', () => {
    expect(isSyncDue({ last_synced_at: null, last_sync_failed_at: null }, 6, NOW)).toBe(true)
  })
  it('2h old with 6h max is not due', () => {
    expect(isSyncDue({ last_synced_at: h(2), last_sync_failed_at: null }, 6, NOW)).toBe(false)
  })
  it('7h old is due', () => {
    expect(isSyncDue({ last_synced_at: h(7), last_sync_failed_at: null }, 6, NOW)).toBe(true)
  })
  it('failed 30 min ago is not due (backoff)', () => {
    expect(isSyncDue({ last_synced_at: h(10), last_sync_failed_at: h(0.5) }, 6, NOW)).toBe(false)
  })
  it('failed 30 min ago is due with ignoreBackoff', () => {
    expect(isSyncDue({ last_synced_at: h(10), last_sync_failed_at: h(0.5) }, 6, NOW, true)).toBe(true)
  })
  it('failed 2h ago is due', () => {
    expect(isSyncDue({ last_synced_at: h(10), last_sync_failed_at: h(2) }, 6, NOW)).toBe(true)
  })
})

describe('insightsRange', () => {
  it('first sync backfills backfill_days', () => {
    expect(insightsRange({ last_synced_at: null, backfill_days: 90 }, NOW, 'UTC')).toEqual({ since: '2026-08-11', until: '2026-11-09' })
  })
  it('recent sync re-pulls the last 3 days', () => {
    expect(insightsRange({ last_synced_at: '2026-11-09T06:00:00Z', backfill_days: 90 }, NOW, 'UTC')).toEqual({ since: '2026-11-06', until: '2026-11-09' })
  })
  it('a gap since last sync extends since', () => {
    expect(insightsRange({ last_synced_at: '2026-11-01T06:00:00Z', backfill_days: 90 }, NOW, 'UTC')).toEqual({ since: '2026-10-31', until: '2026-11-09' })
  })
  it('uses the ad account time zone (IST crosses midnight)', () => {
    const now = new Date('2026-11-09T20:00:00Z') // 2026-11-10 01:30 IST
    expect(insightsRange({ last_synced_at: null, backfill_days: 10 }, now, 'Asia/Kolkata')).toEqual({ since: '2026-10-31', until: '2026-11-10' })
    expect(insightsRange({ last_synced_at: null, backfill_days: 10 }, now, 'UTC').until).toBe('2026-11-09')
  })
})
