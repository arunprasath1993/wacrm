import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('./meta-sync', () => ({
  syncMetaAds: vi.fn(async () => ({ status: 'ok' })),
  isSyncDue: vi.fn(),
}))
vi.mock('./graph', () => ({
  testMetaConnection: vi.fn(async () => ({ ok: true, name: 'Test', currency: 'INR', timezone: 'Asia/Kolkata' })),
}))

import { runDueSyncs, startAdsScheduler } from './scheduler'
import { syncMetaAds, isSyncDue } from './meta-sync'
import { testMetaConnection } from './graph'

const NOW = new Date('2026-11-09T12:00:00.000Z')

function makeDb(opts: { configs: Array<{ account_id: string; last_synced_at: string | null; last_sync_failed_at: string | null }> }) {
  let callIndex = 0
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['eq', 'or', 'select']) chain[m] = () => chain
    chain.maybeSingle = async () => {
      if (table === 'meta_ads_config') {
        const cfg = opts.configs[callIndex++]
        return { data: cfg, error: null }
      }
      return { data: null, error: null }
    }
    chain.then = (res: (v: unknown) => void) => {
      res({ data: opts.configs, error: null })
    }
    return chain
  })
  return { db: { from } as unknown as SupabaseClient }
}

describe('scheduler', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let errSpy: ReturnType<typeof vi.spyOn>
  let intervalSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(syncMetaAds).mockClear()
    vi.mocked(isSyncDue).mockClear()
    vi.mocked(testMetaConnection).mockClear()
    intervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(() => 0 as unknown as NodeJS.Timeout)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    errSpy.mockRestore()
    intervalSpy.mockRestore()
  })

  it('calls syncMetaAds only for due accounts', async () => {
    vi.mocked(isSyncDue)
      .mockReturnValueOnce(true)  // acc1 due
      .mockReturnValueOnce(false) // acc2 not due
    const { db } = makeDb({
      configs: [
        { account_id: 'acc1', last_synced_at: '2026-11-08T12:00:00.000Z', last_sync_failed_at: null },
        { account_id: 'acc2', last_synced_at: '2026-11-09T10:00:00.000Z', last_sync_failed_at: null },
      ],
    })
    await runDueSyncs(db, NOW)
    expect(syncMetaAds).toHaveBeenCalledTimes(1)
    expect(syncMetaAds).toHaveBeenCalledWith(db, 'acc1', { now: NOW })
  })

  it('does not call sync for accounts with recent failure (backoff)', async () => {
    vi.mocked(isSyncDue).mockReturnValue(false)
    const { db } = makeDb({
      configs: [
        { account_id: 'acc1', last_synced_at: '2026-11-08T12:00:00.000Z', last_sync_failed_at: '2026-11-09T11:30:00.000Z' }, // failed 30 min ago
      ],
    })
    await runDueSyncs(db, NOW)
    expect(syncMetaAds).not.toHaveBeenCalled()
  })

  it('idempotent: calling startAdsScheduler twice does not create two intervals', () => {
    startAdsScheduler()
    startAdsScheduler()
    expect(intervalSpy).toHaveBeenCalledTimes(1)
  })
})