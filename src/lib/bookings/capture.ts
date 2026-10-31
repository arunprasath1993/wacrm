import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateReply } from '@/lib/ai/generate'
import { resolveTimeZone } from '@/lib/ai/usage-days'
import { logAiUsage } from '@/lib/ai/usage'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { loadBookingContext } from './load'
import { loadCustomerMemory } from './memory'
import { agentChatCapturePrompt } from './prompt'
import { saveBookingFromAi } from './save'

/**
 * Record a booking agreed in a chat the bot isn't running, so a human
 * taking over doesn't mean bookings stop being tracked. Called after
 * each message in the chat. It reads the conversation and saves what was
 * agreed; it never sends anything to the customer.
 *
 * Costs one model call per message on the account's own key, which is
 * why it needs booking types configured and is throttled. Like the
 * auto-reply it owns its try/catch and NEVER throws: this runs behind a
 * webhook and an agent's send, and neither may fail because of it.
 */
export async function captureBookingFromAgentChat(args: {
  accountId: string
  conversationId: string
  /** Author of the auto note: the agent, or the config owner on inbound. */
  noteUserId: string
}): Promise<void> {
  const { accountId, conversationId, noteUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config) return

    const { data: conv } = await db
      .from('conversations')
      .select('contact_id, assigned_agent_id, ai_autoreply_disabled')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!conv?.contact_id) return

    // The bot records its own bookings; this is only for where it's off.
    const humanRuns =
      Boolean(conv.assigned_agent_id) ||
      Boolean(conv.ai_autoreply_disabled) ||
      !config.autoReplyEnabled
    if (!humanRuns) return

    const { types, timeZone } = await loadBookingContext(db, accountId)
    if (types.length === 0) return

    const conversationLimit = checkRateLimit(
      `booking-capture:${conversationId}`,
      RATE_LIMITS.bookingCapture,
    )
    const accountLimit = checkRateLimit(
      `booking-capture-acct:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!conversationLimit.success || !accountLimit.success) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    const zone = resolveTimeZone(timeZone)
    const customerMemory = await loadCustomerMemory(db, accountId, conv.contact_id, timeZone)

    const { booking, usage } = await generateReply({
      config,
      systemPrompt: agentChatCapturePrompt({
        types,
        now: new Date(),
        timeZone: zone,
        customerMemory,
      }),
      messages,
    })

    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (!booking) return

    await saveBookingFromAi({
      db,
      accountId,
      contactId: conv.contact_id,
      conversationId,
      ownerUserId: noteUserId,
      handoffAgentId: conv.assigned_agent_id ?? config.handoffAgentId,
      types,
      timeZone: zone,
      marker: booking,
      mode: 'agent_chat',
    })
  } catch (err) {
    console.error('[bookings] agent chat capture failed:', err)
  }
}
