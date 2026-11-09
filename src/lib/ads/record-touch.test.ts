import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordTouch, healMissingTouches } from './record-touch'

interface StoredMsg {
  message_id: string
  conversation_id: string
  created_at: string
  referral: Record<string, unknown>
}

function makeDb(opts: {
  firstTouch: string | null
  messages?: StoredMsg[]
  touchedIds?: string[]
  rpcError?: { code: string; message: string }
}) {
  const state = { firstTouch: opts.firstTouch }
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const queried: string[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    if (opts.rpcError) return { data: null, error: opts.rpcError }
    if (state.firstTouch === null) state.firstTouch = args.p_source_type as string
    return { data: 'touch-id', error: null }
  })
  const from = vi.fn((table: string) => {
    queried.push(table)
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['select', 'eq', 'not']) chain[m] = self
    if (table === 'contacts') {
      chain.maybeSingle = async () => ({
        data: { first_touch_source_type: state.firstTouch },
        error: null,
      })
    } else if (table === 'messages') {
      chain.then = (res: (v: unknown) => void) =>
        res({ data: opts.messages ?? [], error: null })
    } else if (table === 'contact_touches') {
      chain.then = (res: (v: unknown) => void) =>
        res({ data: (opts.touchedIds ?? []).map((message_id) => ({ message_id })), error: null })
    }
    return chain
  })
  return { db: { rpc, from } as unknown as SupabaseClient, rpcCalls, queried, state }
}

const base = {
  accountId: 'acc',
  contactId: 'con',
  conversationId: 'conv',
  messageId: 'wamid.NEW',
  touchedAt: '2026-11-09T10:00:00.000Z',
}

describe('recordTouch', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errSpy.mockRestore())

  it('records an ad referral touch with the webhook timestamp', async () => {
    const { db, rpcCalls } = makeDb({ firstTouch: null })
    const referral = { source_type: 'ad', source_id: 'AD1', headline: 'Hi', ctwa_clid: 'clid' }
    await recordTouch(db, { ...base, referral })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe('record_contact_touch')
    expect(rpcCalls[0].args).toMatchObject({
      p_account_id: 'acc',
      p_contact_id: 'con',
      p_conversation_id: 'conv',
      p_message_id: 'wamid.NEW',
      p_touched_at: base.touchedAt,
      p_source_type: 'ad',
      p_ad_id: 'AD1',
      p_ctwa_clid: 'clid',
      p_headline: 'Hi',
      p_referral: referral,
    })
  })

  it('records direct when no referral, no first touch, no stored referrals', async () => {
    const { db, rpcCalls } = makeDb({ firstTouch: null })
    await recordTouch(db, { ...base, referral: null })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].args).toMatchObject({
      p_source_type: 'direct',
      p_platform: null,
      p_ad_id: null,
      p_ctwa_clid: null,
      p_headline: null,
      p_referral: null,
    })
  })

  it('heals a stored referral first and then skips direct', async () => {
    const { db, rpcCalls } = makeDb({
      firstTouch: null,
      messages: [
        {
          message_id: 'wamid.OLD',
          conversation_id: 'conv',
          created_at: '2026-11-01T00:00:00.000Z',
          referral: { source_type: 'ad', source_id: 'AD9' },
        },
      ],
    })
    await recordTouch(db, { ...base, referral: null })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].args).toMatchObject({
      p_message_id: 'wamid.OLD',
      p_touched_at: '2026-11-01T00:00:00.000Z',
      p_source_type: 'ad',
      p_ad_id: 'AD9',
    })
  })

  it('does nothing when first touch is already ad', async () => {
    const { db, rpcCalls, queried } = makeDb({ firstTouch: 'ad' })
    await recordTouch(db, { ...base, referral: null })
    expect(rpcCalls).toHaveLength(0)
    expect(queried).not.toContain('messages')
  })

  it('heals when first touch is direct and does not add another direct', async () => {
    const { db, rpcCalls } = makeDb({
      firstTouch: 'direct',
      messages: [
        {
          message_id: 'wamid.OLD',
          conversation_id: 'conv',
          created_at: '2026-11-01T00:00:00.000Z',
          referral: { source_type: 'post', source_id: 'P1' },
        },
      ],
    })
    await recordTouch(db, { ...base, referral: null })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].args.p_source_type).toBe('post')
  })

  it('resolves and logs when the rpc errors', async () => {
    const { db } = makeDb({ firstTouch: null, rpcError: { code: 'P0001', message: 'boom' } })
    await expect(recordTouch(db, { ...base, referral: null })).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
  })
})

describe('healMissingTouches', () => {
  it('skips messages that already have a touch and returns the healed count', async () => {
    const mk = (id: string): StoredMsg => ({
      message_id: id,
      conversation_id: 'conv',
      created_at: '2026-11-01T00:00:00.000Z',
      referral: { source_type: 'ad', source_id: 'A' },
    })
    const { db, rpcCalls } = makeDb({
      firstTouch: null,
      messages: [mk('w1'), mk('w2')],
      touchedIds: ['w1'],
    })
    const n = await healMissingTouches(db, 'acc', 'con')
    expect(n).toBe(1)
    expect(rpcCalls.map((c) => c.args.p_message_id)).toEqual(['w2'])
  })
})
