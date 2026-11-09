import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reclassifyUnknownTouchesWith, reclassifyUnknownTouches } from './reclassify'
import type { ClassifiedReferral, WaReferral } from './types'

interface Row {
  id: string
  account_id: string
  contact_id: string
  platform: string
  referral: WaReferral | null
}

function makeDb(rows: Row[], opts: { failUpdateIds?: string[] } = {}) {
  const selectFilters: Array<[string, string, unknown]> = []
  const updateFilters: Array<[string, unknown]> = []
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    return { data: null, error: null }
  })
  const from = vi.fn((table: string) => {
    if (table !== 'contact_touches') throw new Error('unexpected table ' + table)
    const f: Array<[string, string, unknown]> = []
    let limit = Infinity
    const sel: Record<string, unknown> = {
      select: () => sel,
      eq: (c: string, v: unknown) => (f.push(['eq', c, v]), sel),
      not: (c: string, op: string, v: unknown) => (f.push([op === 'is' ? 'notnull' : op, c, v]), sel),
      gt: (c: string, v: unknown) => (f.push(['gt', c, v]), sel),
      order: () => sel,
      limit: (n: number) => ((limit = n), sel),
      then: (res: (v: unknown) => void) => {
        selectFilters.push(...f)
        let out = rows.filter((r) => r.referral !== null)
        for (const [op, c, v] of f) {
          if (op === 'eq') out = out.filter((r) => (r as unknown as Record<string, unknown>)[c] === v)
          if (op === 'gt') out = out.filter((r) => String((r as unknown as Record<string, unknown>)[c]) > (v as string))
        }
        out = out.sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit)
        res({ data: out, error: null })
      },
    }
    return {
      select: sel.select,
      update: (patch: Record<string, unknown>) => {
        const uf: Array<[string, unknown]> = []
        const u: Record<string, unknown> = {
          eq: (c: string, v: unknown) => (uf.push([c, v]), u),
          then: (res: (v: unknown) => void) => {
            updateFilters.push(...uf)
            const id = uf.find(([c]) => c === 'id')?.[1] as string
            updates.push({ id, patch })
            if (opts.failUpdateIds?.includes(id)) {
              res({ error: { code: 'XX000', message: 'secret detail' } })
              return
            }
            const row = rows.find((r) => r.id === id)
            if (row) Object.assign(row, patch)
            res({ error: null })
          },
        }
        return u
      },
    }
  })
  return { db: { from, rpc } as unknown as SupabaseClient, selectFilters, updateFilters, updates, rpcCalls }
}

const row = (id: string, contact: string, platform = 'unknown', account = 'acc'): Row => ({
  id,
  account_id: account,
  contact_id: contact,
  platform,
  referral: { source_url: 'https://x.test/' + id, source_type: 'ad', source_id: 'ad1' },
})
const toIg = (): ClassifiedReferral => ({ sourceType: 'ad', platform: 'instagram', adId: 'ad1' })
const stillUnknown = (): ClassifiedReferral => ({ sourceType: 'ad', platform: 'unknown', adId: 'ad1' })

describe('reclassifyUnknownTouchesWith', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errSpy.mockRestore())

  it('updates platform only and recomputes first touch for the contact', async () => {
    const m = makeDb([row('t1', 'c1')])
    const n = await reclassifyUnknownTouchesWith(m.db, 'acc', toIg)
    expect(n).toBe(1)
    expect(m.updates).toEqual([{ id: 't1', patch: { platform: 'instagram' } }])
    expect(m.rpcCalls).toEqual([
      { fn: 'recompute_contact_first_touch', args: { p_account_id: 'acc', p_contact_id: 'c1' } },
    ])
  })

  it('leaves still-unknown touches untouched and does not recompute', async () => {
    const m = makeDb([row('t1', 'c1')])
    const n = await reclassifyUnknownTouchesWith(m.db, 'acc', stillUnknown)
    expect(n).toBe(0)
    expect(m.updates).toEqual([])
    expect(m.rpcCalls).toEqual([])
  })

  it('recomputes once per contact when several touches change', async () => {
    const m = makeDb([row('t1', 'c1'), row('t2', 'c1'), row('t3', 'c2')])
    const n = await reclassifyUnknownTouchesWith(m.db, 'acc', toIg)
    expect(n).toBe(3)
    const contacts = m.rpcCalls.map((c) => c.args.p_contact_id).sort()
    expect(contacts).toEqual(['c1', 'c2'])
  })

  it('only reads and updates rows of the given account', async () => {
    const m = makeDb([row('t1', 'c1'), row('t2', 'c2', 'unknown', 'other')])
    const n = await reclassifyUnknownTouchesWith(m.db, 'acc', toIg)
    expect(n).toBe(1)
    expect(m.selectFilters).toContainEqual(['eq', 'account_id', 'acc'])
    expect(m.selectFilters).toContainEqual(['eq', 'platform', 'unknown'])
    expect(m.updateFilters).toContainEqual(['account_id', 'acc'])
    expect(m.updates.map((u) => u.id)).toEqual(['t1'])
  })

  it('logs update errors by code only and continues without throwing', async () => {
    const m = makeDb([row('t1', 'c1'), row('t2', 'c2')], { failUpdateIds: ['t1'] })
    const n = await reclassifyUnknownTouchesWith(m.db, 'acc', toIg)
    expect(n).toBe(1)
    expect(m.rpcCalls.map((c) => c.args.p_contact_id)).toEqual(['c2'])
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errSpy.mock.calls)).toContain('XX000')
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('secret detail')
  })

  it('pages through more than one batch', async () => {
    const rows = Array.from({ length: 1203 }, (_, i) => row('t' + String(i).padStart(5, '0'), 'c' + (i % 7)))
    const m = makeDb(rows)
    const n = await reclassifyUnknownTouchesWith(m.db, 'acc', toIg)
    expect(n).toBe(1203)
    expect(m.rpcCalls).toHaveLength(7)
  })

  it('default export uses the real classifier (no patterns, nothing changes)', async () => {
    const m = makeDb([row('t1', 'c1')])
    expect(await reclassifyUnknownTouches(m.db, 'acc')).toBe(0)
  })
})
