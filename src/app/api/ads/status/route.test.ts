import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const MOCK_ACCOUNT_ID = 'acc-1'
const MOCK_USER_ID = 'user-1'

function makeMockSupabase(opts: { profile?: { account_id: string } | null; rpcResult?: Array<{ connected: boolean; ad_account_id: string | null; currency: string | null; timezone: string | null; last_synced_at: string | null; last_sync_error: string | null; syncing: boolean }> | null; rpcError?: unknown; authError?: unknown } = {}) {
  const chain: Record<string, vi.Mock> = {}
  const methods = ['eq', 'maybeSingle', 'single', 'select', 'rpc', 'auth']
  for (const m of methods) chain[m] = vi.fn(() => chain)

  chain.auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: opts.authError ? null : { id: MOCK_USER_ID } }, error: opts.authError ?? null }),
  }

  chain.from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.profile ?? null, error: null }),
      })),
    })),
  }))

  chain.rpc = vi.fn().mockResolvedValue({ data: opts.rpcResult ?? null, error: opts.rpcError ?? null })

  return { ...chain } as unknown as SupabaseClient
}

let supabaseMock: SupabaseClient

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: vi.fn((e: unknown) => new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Internal' }), { status: e instanceof Error && 'status' in e ? (e as { status: number }).status : 500 })),
}))

vi.mock('@/lib/i18n/translate', () => ({
  getT: () => (key: string) => key,
}))

import { GET } from './route'

describe('ads status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock = makeMockSupabase()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('GET /api/ads/status', () => {
    it('returns 401 when no user session', async () => {
      supabaseMock = makeMockSupabase({ authError: { message: 'No session' } })

      const res = await GET(new Request('http://localhost/api/ads/status'))
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('common.unauthorized')
    })

    it('returns not connected when no profile', async () => {
      supabaseMock = makeMockSupabase({ profile: null })

      const res = await GET(new Request('http://localhost/api/ads/status'))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.connected).toBe(false)
      expect(json.reason).toBe('no_account')
    })

    it('returns status from rpc when profile exists', async () => {
      supabaseMock = makeMockSupabase({
        profile: { account_id: MOCK_ACCOUNT_ID },
        rpcResult: [{ connected: true, ad_account_id: 'act_123', currency: 'INR', timezone: 'Asia/Kolkata', last_synced_at: '2024-01-01T00:00:00Z', last_sync_error: null, syncing: false }],
      })

      const res = await GET(new Request('http://localhost/api/ads/status'))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.connected).toBe(true)
      expect(json.ad_account_id).toBe('act_123')
      expect(json.currency).toBe('INR')
      expect(json.timezone).toBe('Asia/Kolkata')
      expect(json.last_synced_at).toBe('2024-01-01T00:00:00Z')
      expect(json.syncing).toBe(false)
    })

    it('returns empty status when rpc returns no data', async () => {
      supabaseMock = makeMockSupabase({
        profile: { account_id: MOCK_ACCOUNT_ID },
        rpcResult: [],
      })

      const res = await GET(new Request('http://localhost/api/ads/status'))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.connected).toBe(false)
      expect(json.ad_account_id).toBeNull()
    })

    it('returns 500 on rpc error', async () => {
      supabaseMock = makeMockSupabase({
        profile: { account_id: MOCK_ACCOUNT_ID },
        rpcError: { message: 'RPC failed' },
      })

      const res = await GET(new Request('http://localhost/api/ads/status'))
      expect(res.status).toBe(500)
      const json = await res.json()
      expect(json.reason).toBe('db_error')
    })
  })
})