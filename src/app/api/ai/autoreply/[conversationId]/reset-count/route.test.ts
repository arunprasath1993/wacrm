import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  found: true,
  updateError: null as { message: string } | null,
  updates: [] as { patch: Record<string, unknown>; filters: [string, unknown][] }[],
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/auth/account', async () => {
  const { hasMinRole } = await import('@/lib/auth/roles')
  class ForbiddenError extends Error {}
  return {
    requireRole: async (min: string) => {
      if (!hasMinRole(h.role as never, min as never)) throw new ForbiddenError('forbidden')
      return {
        accountId: 'acc-1',
        userId: 'user-1',
        role: h.role,
        supabase: {
          from: (table: string) => {
            expect(table).toBe('conversations')
            return {
              update: (patch: Record<string, unknown>) => {
                const entry = { patch, filters: [] as [string, unknown][] }
                h.updates.push(entry)
                const chain = {
                  eq: (col: string, val: unknown) => {
                    entry.filters.push([col, val])
                    return chain
                  },
                  select: () => chain,
                  maybeSingle: async () => ({
                    data: h.found && !h.updateError ? { id: 'conv-1' } : null,
                    error: h.updateError,
                  }),
                }
                return chain
              },
            }
          },
        },
      }
    },
    toErrorResponse: (err: unknown) => ({
      body: { error: err instanceof Error ? err.message : 'error' },
      status: 403,
    }),
  }
})

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function reset(conversationId = 'conv-1') {
  return POST(new Request('http://t', { method: 'POST' }), {
    params: Promise.resolve({ conversationId }),
  }) as unknown as Promise<{ status: number; body: Record<string, unknown> }>
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.role = 'admin'
  h.found = true
  h.updateError = null
  h.updates = []
})

describe('POST /api/ai/autoreply/[conversationId]/reset-count', () => {
  it.each(['owner', 'admin'])('lets %s reset the counter to 0', async (role) => {
    h.role = role
    const res = await reset()
    expect(res.status).toBe(200)
    expect(h.updates).toHaveLength(1)
    // Only the counter changes — pause/assignment/handoff note untouched.
    expect(h.updates[0].patch).toEqual({ ai_reply_count: 0 })
    expect(h.updates[0].filters).toEqual([
      ['id', 'conv-1'],
      ['account_id', 'acc-1'],
    ])
  })

  it.each(['agent', 'viewer'])('forbids %s', async (role) => {
    h.role = role
    const res = await reset()
    expect(res.status).toBe(403)
    expect(h.updates).toHaveLength(0)
  })

  it('returns 404 for a conversation outside the account', async () => {
    h.found = false
    const res = await reset('other-conv')
    expect(res.status).toBe(404)
  })

  it('returns 500 on a database error', async () => {
    h.updateError = { message: 'boom' }
    const res = await reset()
    expect(res.status).toBe(500)
  })
})
