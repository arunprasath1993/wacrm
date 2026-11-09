import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const MOCK_ACCOUNT_ID = 'acc-1'
const MOCK_USER_ID = 'user-1'

function makeMockSupabase() {
  const chain: Record<string, vi.Mock> = {}
  const methods = ['eq', 'maybeSingle', 'single', 'select', 'upsert', 'update', 'or', 'throw']
  for (const m of methods) chain[m] = vi.fn(() => chain)
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
vi.mock('@/lib/ads/scheduler', () => ({
  syncMetaAds: vi.fn(),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true, remaining: 29, reset: Date.now() + 60000, limit: 30 })),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60000 } },
}))
vi.mock('@/lib/i18n/translate', () => ({
  getT: () => (key: string) => key,
}))

import { POST } from './route'
import { getCurrentAccount, requireRole, ForbiddenError } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { syncMetaAds } from '@/lib/ads/scheduler'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

describe('ads sync route', () => {
  let getCurrentAccountMock: ReturnType<typeof vi.fn>
  let requireRoleMock: ReturnType<typeof vi.fn>
  let supabaseAdminMock: ReturnType<typeof vi.fn>
  let syncMetaAdsMock: ReturnType<typeof vi.fn>
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
    syncMetaAdsMock = vi.mocked(syncMetaAds)
    checkRateLimitMock = vi.mocked(checkRateLimit)
    rateLimitResponseMock = vi.mocked(rateLimitResponse)
    checkRateLimitMock.mockReturnValue({ success: true, remaining: 29, reset: Date.now() + 60000, limit: 30 })
    // Default: requireRole rejects with ForbiddenError for agent tests
    requireRoleMock.mockRejectedValue(new ForbiddenError())
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('POST /api/ads/sync', () => {
    it('returns 403 for agent', async () => {
      callerRole = 'agent'
      // requireRole already mocks rejection in beforeEach
      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(403)
    })

    it('returns 429 when rate limited', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      checkRateLimitMock.mockReturnValue({ success: false, remaining: 0, reset: Date.now() + 60000, limit: 30 })
      rateLimitResponseMock.mockReturnValue(new Response(JSON.stringify({ error: 'Rate limit exceeded', retry_after_seconds: 60 }), { status: 429, headers: { 'Retry-After': '60' } }))

      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(429)
    })

    it('returns 409 when sync is locked', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      syncMetaAdsMock.mockResolvedValue({ status: 'locked', error: 'Sync already in progress' })

      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toBe('ads.syncLocked')
    })

    it('returns 400 when not configured', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      syncMetaAdsMock.mockResolvedValue({ status: 'not_configured', error: 'No config' })

      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('ads.notConfigured')
    })

    it('returns 500 when sync fails', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      syncMetaAdsMock.mockResolvedValue({ status: 'failed', error: 'Sync failed' })

      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(500)
      const json = await res.json()
      expect(json.error).toBe('Sync failed')
    })

    it('returns 500 when sync fails without error message', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      syncMetaAdsMock.mockResolvedValue({ status: 'failed' })

      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(500)
      const json = await res.json()
      expect(json.error).toBe('ads.syncFailed')
    })

    it('returns success on completed sync', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      syncMetaAdsMock.mockResolvedValue({ status: 'completed', synced: 10, spend: 5000 })

      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.status).toBe('completed')
    })

    it('returns success on up_to_date sync', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      syncMetaAdsMock.mockResolvedValue({ status: 'up_to_date' })

      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.status).toBe('up_to_date')
    })

    it('calls syncMetaAds with adminDb, accountId and now', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDbMock, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      syncMetaAdsMock.mockResolvedValue({ status: 'completed' })

      const res = await POST(new Request('http://localhost/api/ads/sync', { method: 'POST' }))
      expect(res.status).toBe(200)
      expect(syncMetaAdsMock).toHaveBeenCalledWith(adminDbMock, MOCK_ACCOUNT_ID, { now: expect.any(Date) })
    })
  })
})