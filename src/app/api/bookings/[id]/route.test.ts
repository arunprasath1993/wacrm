import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  filters: [] as [string, unknown][],
  result: { data: [{ id: 'b' }], error: null } as {
    data: unknown[] | null
    error: { code?: string; message: string } | null
  },
}))

const client = vi.hoisted(() => ({
  from: (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        if (table === 'bookings') h.filters.push([column, value])
        return builder
      },
      update: (patch: Record<string, unknown>) => {
        h.updates.push(patch)
        return builder
      },
      delete: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: { time_zone: 'Asia/Kolkata' }, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(h.result),
    }
    return builder
  },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    supabase: client,
  })),
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth' }, { status: 403 })),
}))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => client }))

import { DELETE, PATCH } from './route'

const ID = '3f2b8c1e-9a4d-4e2f-b6a1-0c9d8e7f6a5b'
const params = (id = ID) => ({ params: Promise.resolve({ id }) })
const patch = (body: unknown) =>
  new Request(`http://localhost/api/bookings/${ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  h.updates = []
  h.filters = []
  h.result = { data: [{ id: ID }], error: null }
})

describe('PATCH /api/bookings/[id]', () => {
  it('updates within the caller account', async () => {
    const res = await PATCH(patch({ status: 'done' }), params())

    expect(res.status).toBe(200)
    expect(h.updates).toEqual([{ status: 'done' }])
    expect(h.filters).toContainEqual(['account_id', 'acc-1'])
  })

  it('returns 404 for a booking outside the account', async () => {
    h.result = { data: [], error: null }
    expect((await PATCH(patch({ status: 'done' }), params())).status).toBe(404)
  })

  it('rejects an invalid change without writing', async () => {
    const res = await PATCH(patch({ status: 'nonsense' }), params())
    expect(res.status).toBe(400)
    expect(h.updates).toEqual([])
  })

  it('returns 404 for a malformed id', async () => {
    expect((await PATCH(patch({ status: 'done' }), params('nope'))).status).toBe(404)
  })

  it('reports reopening onto an existing open booking as a conflict', async () => {
    h.result = { data: null, error: { code: '23505', message: 'duplicate' } }
    expect((await PATCH(patch({ status: 'open' }), params())).status).toBe(409)
  })

  it('reports a full slot as a conflict', async () => {
    h.result = { data: null, error: { code: '23P01', message: 'booking slot is full' } }
    expect((await PATCH(patch({ status: 'open' }), params())).status).toBe(409)
  })

  it('reports an assignee from another account as a bad request', async () => {
    h.result = { data: null, error: { code: '23514', message: 'guard' } }
    const res = await PATCH(patch({ assigned_to: ID }), params())
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/bookings/[id]', () => {
  it('deletes within the caller account', async () => {
    const req = new Request(`http://localhost/api/bookings/${ID}`, { method: 'DELETE' })
    expect((await DELETE(req, params())).status).toBe(200)
    expect(h.filters).toContainEqual(['account_id', 'acc-1'])
  })
})
