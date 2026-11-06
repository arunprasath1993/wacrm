import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveReplyCap, type ReplyCapSettings } from './reply-cap'

/**
 * The reply cap for one conversation, chosen by its contact's phone
 * (testing cap for a testing number, else the customer cap).
 *
 * Skips the contact lookup entirely when the account has no testing
 * numbers. A failed lookup falls back to the customer cap — the
 * stricter, normal behaviour — rather than throwing.
 */
export async function resolveConversationReplyCap(
  db: SupabaseClient,
  settings: ReplyCapSettings,
  contactId: string | null | undefined,
): Promise<number> {
  if (!contactId || !settings.testingNumbers || settings.testingNumbers.length === 0) {
    return settings.customerCap
  }
  try {
    const { data, error } = await db
      .from('contacts')
      .select('phone')
      .eq('id', contactId)
      .maybeSingle()
    if (error || !data) return settings.customerCap
    return resolveReplyCap(settings, (data as { phone: string | null }).phone)
  } catch {
    return settings.customerCap
  }
}
