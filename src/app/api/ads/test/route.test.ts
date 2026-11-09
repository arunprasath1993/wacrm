import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const MOCK_ACCOUNT_ID = 'acc-1'
const MOCK_USER_ID = 'user-1'

function makeMockSupabase(opts: { config?: { access_token: string | null } | null; waConfig?: { access_token: string | null } | null; configError?: unknown } = {}) {
  const chain: Record<string, vi.Mock> = {}
  const methods = ['eq', 'maybeSingle', 'single', 'select', 'upsert', 'update', 'or', 'throw']
  for (const m of methods) chain[m] = vi.fn(() => chain)

  let configCallCount = 0
  chain.from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: vi.fn().mockImplementation(async () => {
          configCallCount++
          if (configCallCount === 1) {
            return { data: opts.config ?? null, error: opts.configError ?? null }
          }
          return { data: opts.waConfig ?? null, error: null }
        }),
      }),
    }),
  }))

  return { ...chain } as unknown as SupabaseClient
}

let adminDbMock: SupabaseClient
let userDbMock: SupabaseClient
let callerRole = 'admin'
let signedIn = true

function makeSupabaseMock(db: SupabaseClient) {
  return {
    auth: {
      getUser: vi.fn(async () =>
        signedIn
          ? { data: { user: { id: MOCK_USER_ID } }, error: null }
          : { data: { user: null }, error: { message: 'no session' } },
      ),
    },
    from: vi.fn(() => db),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => makeSupabaseMock(userDbMock)),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  toErrorResponse: vi.fn((e: unknown) => new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Internal' }), { status: e instanceof Error && 'status' in e ? (e as { status: number }).status : 500 })),
  ForbiddenError: class ForbiddenError extends Error {
    readonly status = 403 as const
    constructor(message = 'Forbidden') {
      super(message)
      this.name = 'ForbiddenError'
    }
  },
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: vi.fn(),
}))
vi.mock('@/lib/ads/graph', () => ({
  testMetaConnection: vi.fn(),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Rate limit exceeded', retry_after_seconds: 60 }), { status: 429, headers: { 'Retry-After': '60' } })),
  RATE_LIMITS: { adminAction: { max: 10, window: '1m' } },
}))
vi.mock('@/lib/i18n/translate', () => ({
  getT: () => (key: string) => key,
}))

import { POST } from './route'
import { getCurrentAccount, requireRole, ForbiddenError } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { testMetaConnection } from '@/lib/ads/graph'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

describe('ads test route', () => {
  let getCurrentAccountMock: ReturnType<typeof vi.fn>
  let requireRoleMock: ReturnType<typeof vi.fn>
  let supabaseAdminMock: ReturnType<typeof vi.fn>
  let testMetaConnectionMock: ReturnType<typeof vi.fn>
  let decryptMock: ReturnType<typeof vi.fn>
  let checkRateLimitMock: ReturnType<typeof vi.fn>
  let rateLimitResponseMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    callerRole = 'admin'
    signedIn = true
    adminDbMock = makeMockSupabase()
    userDbMock = makeMockSupabase()
    supabaseAdminMock = vi.mocked(supabaseAdmin)
    supabaseAdminMock.mockReturnValue(adminDbMock)
    getCurrentAccountMock = vi.mocked(getCurrentAccount)
    requireRoleMock = vi.mocked(requireRole)
    testMetaConnectionMock = vi.mocked(testMetaConnection)
    decryptMock = vi.mocked(decrypt)
    checkRateLimitMock = vi.mocked(checkRateLimit)
    rateLimitResponseMock = vi.mocked(rateLimitResponse)
    checkRateLimitMock.mockReturnValue({ success: true })
    decryptMock.mockImplementation((s: string) => s.replace('enc:', ''))
    // Default: requireRole rejects with ForbiddenError for agent tests
    requireRoleMock.mockRejectedValue(new ForbiddenError())
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('POST /api/ads/test', () => {
    it('returns 403 for agent', async () => {
      callerRole = 'agent'
      // requireRole already mocks rejection in beforeEach
      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123' }) }))
      expect(res.status).toBe(403)
    })

    it('returns 429 when rate limited', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      checkRateLimitMock.mockReturnValue({ success: false, remaining: 0, reset: Date.now() + 60000, limit: 30 })
      const { rateLimitResponse } = await import('@/lib/rate-limit')
      vi.mocked(rateLimitResponse).mockReturnValue(new Response(JSON.stringify({ error: 'Rate limit exceeded', retry_after_seconds: 60 }), { status: 429, headers: { 'Retry-After': '60' } }))

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123', token: 'test' }) }))
      expect(res.status).toBe(429)
    })

    it('returns 400 for missing ad_account_id', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ token: 'test' }) }))
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid ad_account_id format', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'invalid', token: 'test' }) }))
      expect(res.status).toBe(400)
    })

    it('tests with provided token', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: true, name: 'Test', currency: 'INR', timezone: 'Asia/Kolkata' })

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123', token: 'testtoken' }) }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(testMetaConnectionMock).toHaveBeenCalledWith('act_123', 'testtoken')
    })

    it('returns 400 when testMetaConnection fails with provided token', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: false, error: 'Token invalid' })

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123', token: 'bad' }) }))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('Token invalid')
    })

    it('tests with stored ads token when token not provided', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: true, name: 'Test', currency: 'INR', timezone: 'Asia/Kolkata' })
      adminDbMock.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { access_token: 'enc:stored-token' }, error: null }),
          }),
        }),
      }))

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123' }) }))
      expect(res.status).toBe(200)
      expect(testMetaConnectionMock).toHaveBeenCalledWith('act_123', 'stored-token')
    })

    it('tests with WhatsApp token when no ads token and use_whatsapp_token=true', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: true, name: 'Test', currency: 'INR', timezone: 'Asia/Kolkata' })
      let callCount = 0
      adminDbMock.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              callCount++
              if (callCount === 1) return { data: { access_token: null }, error: null }
              return { data: { access_token: 'enc:wa-token' }, error: null }
            },
          }),
        }),
      }))

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123', use_whatsapp_token: true }) }))
      expect(res.status).toBe(200)
      expect(testMetaConnectionMock).toHaveBeenCalledWith('act_123', 'wa-token')
    })

    it('returns 400 when no token configured and no whatsapp fallback', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      adminDbMock.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { access_token: null }, error: null }),
          }),
        }),
      }))

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123' }) }))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('ads.noTokenConfigured')
    })

    it('returns 400 when decrypt fails', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      decryptMock.mockImplementation(() => { throw new Error('Decrypt failed') })
      adminDbMock.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { access_token: 'enc:bad' }, error: null }),
          }),
        }),
      }))

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123' }) }))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('ads.tokenCorrupted')
    })

    it('returns 500 on config fetch error', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      adminDbMock.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      }))

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123' }) }))
      expect(res.status).toBe(500)
    })
  })
})