import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
  validateCalls: [] as { provider: string; apiKey: string; baseUrl: string | null }[],
  updates: [] as Record<string, unknown>[],
  minRoles: [] as string[],
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => {
    throw new Error('not used')
  },
  requireRole: async (min: string) => (h.minRoles.push(min), {
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: h.stored, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            h.updates.push(patch)
            return { error: null }
          },
        }),
      }),
    },
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 403,
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => `plain:${value}`,
  encrypt: (value: string) => `enc:${value}`,
}))

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: async (cfg: { provider: string; apiKey: string; baseUrl: string | null }) => {
    h.validateCalls.push({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl })
  },
}))

vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: async () => [],
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://t/api/ai/config', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.validateCalls = []
  h.updates = []
  h.minRoles = []
  h.stored = {
    id: 'cfg-1',
    provider: 'openai_compatible',
    model: 'm',
    base_url: 'https://8.8.8.8/v1',
    api_key: 'enc-key',
  }
})

describe('POST /api/ai/config stored key reuse', () => {
  it('keeps the stored key when only non-credential fields change', async () => {
    const res = await post({
      provider: 'openai_compatible',
      model: 'm',
      base_url: 'https://8.8.8.8/v1',
      system_prompt: 'Be brief',
    })
    expect(res.status).toBe(200)
    expect(h.validateCalls).toHaveLength(0)
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]).not.toHaveProperty('api_key')
  })

  it('reuses the stored key when the model changes on the same endpoint', async () => {
    const res = await post({ provider: 'openai_compatible', model: 'm2', base_url: 'https://8.8.8.8/v1/' })
    expect(res.status).toBe(200)
    expect(h.validateCalls).toEqual([
      { provider: 'openai_compatible', apiKey: 'plain:enc-key', baseUrl: 'https://8.8.8.8/v1/' },
    ])
  })

  it('refuses to move the stored key to a new base URL', async () => {
    const res = await post({ provider: 'openai_compatible', model: 'm', base_url: 'https://1.1.1.1/v1' })
    expect(res.status).toBe(400)
    expect(h.validateCalls).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
  })

  it('refuses to move the stored key to a new provider', async () => {
    const res = await post({ provider: 'anthropic', model: 'claude' })
    expect(res.status).toBe(400)
    expect(h.validateCalls).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
  })

  it('saves a new base URL together with a freshly entered key', async () => {
    const res = await post({
      provider: 'openai_compatible',
      model: 'm',
      base_url: 'https://1.1.1.1/v1',
      api_key: 'new-key',
    })
    expect(res.status).toBe(200)
    expect(h.validateCalls).toEqual([
      { provider: 'openai_compatible', apiKey: 'new-key', baseUrl: 'https://1.1.1.1/v1' },
    ])
    expect(h.updates[0]).toMatchObject({ base_url: 'https://1.1.1.1/v1', api_key: 'enc:new-key' })
  })
})

describe('POST /api/ai/config reply caps and testing numbers', () => {
  const base = { provider: 'openai_compatible', model: 'm', base_url: 'https://8.8.8.8/v1' }

  it('requires admin+ (owner/admin) to save', async () => {
    await post({ ...base, auto_reply_max_per_conversation: 50 })
    expect(h.minRoles).toEqual(['admin'])
  })

  it.each([21, 1000, 10000, 20000])('stores a customer cap of %i unclamped', async (cap) => {
    const res = await post({ ...base, auto_reply_max_per_conversation: cap })
    expect(res.status).toBe(200)
    expect(h.updates[0]).toMatchObject({ auto_reply_max_per_conversation: cap })
  })

  it.each([0, -5, 2.5, 'ten', null])('rejects a customer cap of %j instead of clamping', async (cap) => {
    const res = await post({ ...base, auto_reply_max_per_conversation: cap })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('stores the testing cap', async () => {
    const res = await post({ ...base, auto_reply_max_testing: 20000 })
    expect(res.status).toBe(200)
    expect(h.updates[0]).toMatchObject({ auto_reply_max_testing: 20000 })
  })

  it('rejects an invalid testing cap', async () => {
    const res = await post({ ...base, auto_reply_max_testing: 0 })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('leaves caps and testing numbers untouched when not sent', async () => {
    const res = await post(base)
    expect(res.status).toBe(200)
    expect(h.updates[0]).not.toHaveProperty('auto_reply_max_per_conversation')
    expect(h.updates[0]).not.toHaveProperty('auto_reply_max_testing')
    expect(h.updates[0]).not.toHaveProperty('testing_numbers')
  })

  it('normalizes testing numbers to E.164', async () => {
    const res = await post({
      ...base,
      testing_numbers: ['98765 43210', '+1 (415) 555-1212', ''],
    })
    expect(res.status).toBe(200)
    expect(h.updates[0]).toMatchObject({
      testing_numbers: ['+919876543210', '+14155551212'],
    })
  })

  it('rejects duplicate testing numbers', async () => {
    const res = await post({ ...base, testing_numbers: ['+919876543210', '09876543210'] })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('rejects an invalid testing number', async () => {
    const res = await post({ ...base, testing_numbers: ['12'] })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('clears the testing list with an empty array', async () => {
    const res = await post({ ...base, testing_numbers: [] })
    expect(res.status).toBe(200)
    expect(h.updates[0]).toMatchObject({ testing_numbers: [] })
  })
})
