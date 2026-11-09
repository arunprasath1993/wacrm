import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sweepLostTouches } from './sweep'

function msg(id: string, contact: string, at: string) {
  return {
    message_id: id,
    conversation_id: 'conv-' + contact,
    created_at: at,
    referral: { source_type: 'ad', source_id: '123' },
    conversations: { contact_id: contact, account_id: 'acc' },
  }
}

function makeDb(messages: ReturnType<typeof msg>[], touched: string[]) {
  const rpcCalls: Array<Record<string, unknown>> = []
  const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
    rpcCalls.push(args)
    return { data: 'id', error: null }
  })
  const from = vi.fn((table: string) => {
    let range: [number, number] = [0, 9999]
    let inIds: string[] = []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'order']) chain[m] = () => chain
    chain.range = (a: number, b: number) => ((range = [a, b]), chain)
    chain.in = (_c: string, ids: string[]) => ((inIds = ids), chain)
    chain.then = (res: (v: unknown) => void) => {
      if (table === 'messages') res({ data: messages.slice(range[0], range[1] + 1), error: null })
      else res({ data: touched.filter((t) => inIds.includes(t)).map((message_id) => ({ message_id })), error: null })
    }
    return chain
  })
  return { db: { rpc, from } as unknown as SupabaseClient, rpcCalls }
}

describe('sweepLostTouches', () => {
  it('records only orphan referrals, oldest first per contact', async () => {
    const { db, rpcCalls } = makeDb(
      [
        msg('w1', 'c1', '2026-11-01T00:00:00Z'),
        msg('w2', 'c1', '2026-11-02T00:00:00Z'),
        msg('w3', 'c2', '2026-11-03T00:00:00Z'),
      ],
      ['w1'],
    )
    expect(await sweepLostTouches(db, 'acc')).toBe(2)
    expect(rpcCalls.map((c) => c.p_message_id)).toEqual(['w2', 'w3'])
    expect(rpcCalls[0].p_contact_id).toBe('c1')
  })

  it('stops at the limit', async () => {
    const msgs = ['a', 'b', 'c', 'd'].map((id, i) => msg(id, 'c1', `2026-11-0${i + 1}T00:00:00Z`))
    const { db, rpcCalls } = makeDb(msgs, [])
    expect(await sweepLostTouches(db, 'acc', 3)).toBe(3)
    expect(rpcCalls.map((c) => c.p_message_id)).toEqual(['a', 'b', 'c'])
  })

  it('returns 0 when nothing is orphaned', async () => {
    const { db } = makeDb([msg('w1', 'c1', '2026-11-01T00:00:00Z')], ['w1'])
    expect(await sweepLostTouches(db, 'acc')).toBe(0)
  })
})
