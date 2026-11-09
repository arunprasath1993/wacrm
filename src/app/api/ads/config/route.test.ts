import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const MOCK_ACCOUNT_ID = 'acc-1'
const MOCK_USER_ID = 'user-1'

function makeMockSupabase(opts: { config?: Record<string, unknown> | null; upsertError?: unknown } = {}) {
  const chain: Record<string, vi.Mock> = {}
  const methods = ['eq', 'maybeSingle', 'single', 'select', 'upsert', 'update', 'or', 'throw']
  for (const m of methods) chain[m] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: opts.config ?? null, error: null })
  chain.single = vi.fn().mockResolvedValue({ data: opts.config ?? null, error: null })
  chain.upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
  chain.update = vi.fn().mockResolvedValue({ error: null })
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.or = vi.fn(() => chain)
  chain.throw = vi.fn()
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient
}

let adminDb: SupabaseClient
let userDb: SupabaseClient
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
  createClient: vi.fn(async () => makeSupabaseMock(userDb)),
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
vi.mock('@/lib/ads/scheduler', () => ({
  syncMetaAds: vi.fn(),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: vi.fn((s: string) => 'enc:' + s),
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}))

import { GET, PUT, POST } from './route'
import { getCurrentAccount, requireRole, ForbiddenError } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { testMetaConnection } from '@/lib/ads/graph'
import { syncMetaAds } from '@/lib/ads/scheduler'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

describe('ads config route', () => {
  let getCurrentAccountMock: ReturnType<typeof vi.fn>
  let requireRoleMock: ReturnType<typeof vi.fn>
  let supabaseAdminMock: ReturnType<typeof vi.fn>
  let testMetaConnectionMock: ReturnType<typeof vi.fn>
  let syncMetaAdsMock: ReturnType<typeof vi.fn>
  let encryptMock: ReturnType<typeof vi.fn>
  let decryptMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    callerRole = 'admin'
    signedIn = true
    adminDb = makeMockSupabase()
    userDb = makeMockSupabase()
    supabaseAdminMock = vi.mocked(supabaseAdmin)
    supabaseAdminMock.mockReturnValue(adminDb)
    getCurrentAccountMock = vi.mocked(getCurrentAccount)
    requireRoleMock = vi.mocked(requireRole)
    testMetaConnectionMock = vi.mocked(testMetaConnection)
    syncMetaAdsMock = vi.mocked(syncMetaAds)
    encryptMock = vi.mocked(encrypt)
    decryptMock = vi.mocked(decrypt)
    encryptMock.mockImplementation((s: string) => 'enc:' + s)
    decryptMock.mockImplementation((s: string) => s.replace('enc:', ''))
    // Default: requireRole rejects with ForbiddenError for agent tests
    requireRoleMock.mockRejectedValue(new ForbiddenError())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  describe('GET /api/ads/config', () => {
    it('returns 403 for agent (non-admin)', async () => {
      callerRole = 'agent'
      getCurrentAccountMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'agent', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      // requireRole already mocks rejection in beforeEach

      const res = await GET(new Request('http://localhost/api/ads/config'))
      expect(res.status).toBe(403)
    })

    it('returns config for admin', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      adminDb.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { ad_account_id: 'act_123', backfill_days: 90, access_token: 'enc-token' }, error: null }),
          }),
        }),
      }))

      const res = await GET(new Request('http://localhost/api/ads/config'))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ad_account_id).toBe('act_123')
      expect(json.backfill_days).toBe(90)
      expect(json.uses_whatsapp_token).toBe(true) // access_token is not null
      expect(json).not.toHaveProperty('access_token') // never returns token
    })
  })

  describe('PUT /api/ads/config', () => {
    it('returns 403 for agent', async () => {
      callerRole = 'agent'
      // requireRole already mocks rejection in beforeEach
      const res = await PUT(new Request('http://localhost/api/ads/config', { method: 'PUT', body: JSON.stringify({ ad_account_id: 'act_123' }) }))
      expect(res.status).toBe(403)
    })

    it('returns 400 for invalid ad_account_id format', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: false, error: 'Invalid' })

      const res = await PUT(new Request('http://localhost/api/ads/config', { method: 'PUT', body: JSON.stringify({ ad_account_id: 'invalid', token: null, use_whatsapp_token: true, backfill_days: 90 }) }))
      expect(res.status).toBe(400)
    })

    it('returns 400 when testMetaConnection fails', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: false, error: 'Token invalid' })

      const res = await PUT(new Request('http://localhost/api/ads/config', { method: 'PUT', body: JSON.stringify({ ad_account_id: 'act_123', token: 'bad', use_whatsapp_token: false, backfill_days: 90 }) }))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('Token invalid')
    })

    it('saves config and triggers sync on success', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: true, name: 'Test', currency: 'INR', timezone: 'Asia/Kolkata' })
      adminDb.from.mockImplementation(() => ({
        upsert: () => ({ error: null }),
        update: () => ({ eq: () => ({ error: null }) }),
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { ad_account_id: 'act_123', access_token: 'enc-token' }, error: null }),
          }),
        }),
      }))
      syncMetaAdsMock.mockResolvedValue({ status: 'ok' })

      const res = await PUT(new Request('http://localhost/api/ads/config', { method: 'PUT', body: JSON.stringify({ ad_account_id: 'act_123', token: 'mytoken', use_whatsapp_token: false, backfill_days: 90 }) }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      // Check upsert was called with encrypted token
      expect(encryptMock).toHaveBeenCalledWith('mytoken')
      // Run timers to flush the setTimeout
      await vi.runAllTimersAsync()
    })
  })

  describe('POST /api/ads/test', () => {
    it('returns 403 for agent', async () => {
      callerRole = 'agent'
      // requireRole already mocks rejection in beforeEach
      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123' }) }))
      expect(res.status).toBe(403)
    })

    it('tests with provided token', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: true, name: 'Test', currency: 'INR', timezone: 'Asia/Kolkata' })

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123', token: 'testtoken' }) }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(testMetaConnectionMock).toHaveBeenCalledWith('act_123', 'testtoken')
    })

    it('tests with WhatsApp token when token not provided', async () => {
      getCurrentAccountMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      requireRoleMock.mockResolvedValue({ supabase: userDb, userId: MOCK_USER_ID, accountId: MOCK_ACCOUNT_ID, role: 'admin', account: { id: MOCK_ACCOUNT_ID, name: 'Test' } })
      testMetaConnectionMock.mockResolvedValue({ ok: true, name: 'Test', currency: 'INR', timezone: 'Asia/Kolkata' })
      adminDb.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { access_token: 'enc:wa-token' }, error: null }),
          }),
        }),
      }))

      const res = await POST(new Request('http://localhost/api/ads/test', { method: 'POST', body: JSON.stringify({ ad_account_id: 'act_123' }) }))
      expect(res.status).toBe(200)
      expect(testMetaConnectionMock).toHaveBeenCalledWith('act_123', 'wa-token') // decrypted
    })
  })
})