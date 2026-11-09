import type { SupabaseClient } from '@supabase/supabase-js'
import { callRpc } from './record-touch'
import type { WaReferral } from './types'

const PAGE_SIZE = 500
const MAX_SCAN_PAGES = 100

interface ReferralMessage {
  message_id: string | null
  conversation_id: string
  created_at: string
  referral: WaReferral
  conversations: { contact_id: string; account_id: string } | { contact_id: string; account_id: string }[]
}

function contactOf(m: ReferralMessage): string | null {
  const c = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
  return c?.contact_id ?? null
}

/**
 * Account-wide version of healMissingTouches: finds customer messages that
 * carry a referral but have no contact_touches row (lost webhook touch) and
 * records them, oldest first per contact. Bounded by `limit` messages.
 * Returns the number of touches recorded.
 */
export async function sweepLostTouches(
  db: SupabaseClient,
  accountId: string,
  limit = 200,
): Promise<number> {
  const orphans: ReferralMessage[] = []

  for (let page = 0; page < MAX_SCAN_PAGES && orphans.length < limit; page++) {
    const { data, error } = await db
      .from('messages')
      .select('message_id, conversation_id, created_at, referral, conversations!inner(contact_id, account_id)')
      .eq('conversations.account_id', accountId)
      .eq('sender_type', 'customer')
      .not('referral', 'is', null)
      .order('created_at', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw error
    const rows = ((data ?? []) as unknown as ReferralMessage[]).filter((m) => m.message_id && contactOf(m))
    const ids = rows.map((m) => m.message_id as string)
    if (ids.length > 0) {
      const { data: touches, error: tErr } = await db
        .from('contact_touches')
        .select('message_id')
        .eq('account_id', accountId)
        .in('message_id', ids)
      if (tErr) throw tErr
      const have = new Set((touches ?? []).map((t: { message_id: string }) => t.message_id))
      for (const m of rows) {
        if (!have.has(m.message_id as string)) orphans.push(m)
      }
    }
    if ((data ?? []).length < PAGE_SIZE) break
  }

  const batch = orphans.slice(0, limit)
  const byContact = new Map<string, ReferralMessage[]>()
  for (const m of batch) {
    const cid = contactOf(m) as string
    const list = byContact.get(cid) ?? []
    list.push(m)
    byContact.set(cid, list)
  }

  let recorded = 0
  for (const [contactId, msgs] of byContact) {
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at))
    for (const m of msgs) {
      await callRpc(db, {
        accountId,
        contactId,
        conversationId: m.conversation_id,
        messageId: m.message_id as string,
        touchedAt: m.created_at,
        referral: m.referral,
      })
      recorded++
    }
  }
  return recorded
}
