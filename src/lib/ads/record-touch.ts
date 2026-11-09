import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyReferral } from './classify'
import type { WaReferral } from './types'

export interface TouchInput {
  accountId: string
  contactId: string
  conversationId: string
  messageId: string // Meta wamid
  touchedAt: string // ISO; the webhook's receivedAt (Meta timestamp)
  referral: WaReferral | null
}

interface RpcTouch {
  accountId: string
  contactId: string
  conversationId: string
  messageId: string
  touchedAt: string
  referral: WaReferral | null
}

async function callRpc(db: SupabaseClient, t: RpcTouch): Promise<void> {
  const c = t.referral ? classifyReferral(t.referral) : null
  const { error } = await db.rpc('record_contact_touch', {
    p_account_id: t.accountId,
    p_contact_id: t.contactId,
    p_conversation_id: t.conversationId,
    p_message_id: t.messageId,
    p_touched_at: t.touchedAt,
    p_source_type: c ? c.sourceType : 'direct',
    p_platform: c ? c.platform : null,
    p_ad_id: c ? c.adId : null,
    p_ctwa_clid: t.referral?.ctwa_clid ?? null,
    p_headline: t.referral?.headline ?? null,
    p_referral: t.referral ?? null,
  })
  if (error) throw error
}

async function readFirstTouch(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('contacts')
    .select('first_touch_source_type')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return (data?.first_touch_source_type as string | null | undefined) ?? null
}

interface StoredReferralMessage {
  message_id: string | null
  conversation_id: string
  created_at: string
  referral: WaReferral
}

async function heal(db: SupabaseClient, accountId: string, contactId: string): Promise<number> {
  const { data: msgs, error } = await db
    .from('messages')
    .select('message_id, conversation_id, created_at, referral, conversations!inner(contact_id, account_id)')
    .eq('conversations.contact_id', contactId)
    .eq('conversations.account_id', accountId)
    .eq('sender_type', 'customer')
    .not('referral', 'is', null)
  if (error) throw error
  const candidates = ((msgs ?? []) as unknown as StoredReferralMessage[]).filter((m) => m.message_id)
  if (candidates.length === 0) return 0

  const { data: touches, error: tErr } = await db
    .from('contact_touches')
    .select('message_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
  if (tErr) throw tErr
  const have = new Set((touches ?? []).map((t: { message_id: string }) => t.message_id))

  let healed = 0
  for (const m of candidates) {
    if (have.has(m.message_id as string)) continue
    await callRpc(db, {
      accountId,
      contactId,
      conversationId: m.conversation_id,
      messageId: m.message_id as string,
      touchedAt: m.created_at,
      referral: m.referral,
    })
    healed++
  }
  return healed
}

export async function healMissingTouches(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<number> {
  return heal(db, accountId, contactId)
}

export async function recordTouch(db: SupabaseClient, input: TouchInput): Promise<void> {
  try {
    if (input.referral) {
      await callRpc(db, input)
      return
    }
    let first = await readFirstTouch(db, input.accountId, input.contactId)
    if (first === null || first === 'direct') {
      const healed = await heal(db, input.accountId, input.contactId)
      if (healed > 0) first = await readFirstTouch(db, input.accountId, input.contactId)
    }
    if (first === null) await callRpc(db, input)
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? 'unknown'
    console.error('[ads] recordTouch failed', code)
  }
}
