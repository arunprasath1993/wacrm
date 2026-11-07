import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { resolveConversationReplyCap } from './reply-cap-server'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPromptBlocks } from './defaults'
import { buildBotPauseSummary, buildHandoffSummary } from './handoff'
import { detectAutomatedSender } from './bot-detect'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveTimeZone } from './usage-days'
import { extractBookingFromChat } from '@/lib/bookings/capture'
import { loadBookingContext } from '@/lib/bookings/load'
import { loadCustomerMemory } from '@/lib/bookings/memory'
import { saveBookingFromAi } from '@/lib/bookings/save'
import { loadAvailability } from '@/lib/bookings/slots'
import {
  loadActiveBookingStep,
  settleBookingStep,
} from '@/lib/flows/engine'
import {
  appendSystemText,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type SystemPrompt,
} from './types'
import type { Automation } from '@/types'
import { triggerMatches } from '@/lib/automations/trigger-match'

/** Sent when the model recorded a booking but wrote no message with it. */
const BOOKING_SAVED_FALLBACK =
  'Thank you! Your details are saved and our team will be in touch.'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
  /** Text of the inbound message. When set, the bot stands down only for
   *  a message-level automation that actually matches it (a STOP
   *  keyword automation no longer silences the bot for "Hi"). When
   *  omitted, any active message-level automation stands it down. */
  inboundText?: string
  /** Button / list-row id (or template quick-reply payload) when the
   *  inbound is a tap. The bot then stands down only if an active
   *  `interactive_reply` automation matches this id. */
  interactiveReplyId?: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *   - the other side is an automated responder (also pauses the thread)
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
    inboundText,
    interactiveReplyId,
  } = args

  // Set once a booking is saved for a Flow's "Start booking" step, so a
  // failure after that point (a rejected RPC, a failed send) still lets
  // the flow continue instead of leaving it parked until the timeout.
  let resumeFlowOnError: (() => Promise<void>) | null = null

  // Every silent exit below logs why, so "the bot didn't answer" is
  // diagnosable from the server log (pm2 / host logs) without guessing.
  const skip = (reason: string): void => {
    console.info(`[ai auto-reply] skipped conversation ${conversationId}: ${reason}`)
  }

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    //
    // Only a responder that actually fires for THIS message counts: a
    // keyword automation (e.g. a STOP opt-out) used to silence the bot
    // for every inbound just by being active, even when the keyword
    // didn't match. `new_message_received` fires on everything, so it
    // still always stands the bot down.
    const { data: autoResponders } = await db
      .from('automations')
      .select('id, trigger_type, trigger_config')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', [
        'new_message_received',
        'keyword_match',
        'interactive_reply',
      ])
      .limit(50)
    const respondsToThisMessage = (autoResponders ?? []).some((a) => {
      if (a.trigger_type === 'interactive_reply') {
        // Only a button automation wired to THIS tap stands the bot down.
        return (
          !!interactiveReplyId &&
          triggerMatches(a as Automation, {
            interactive_reply_id: interactiveReplyId,
          })
        )
      }
      return (
        inboundText === undefined ||
        a.trigger_type !== 'keyword_match' ||
        triggerMatches(a as Automation, { message_text: inboundText })
      )
    })
    if (respondsToThisMessage) return skip('a matching automation handles this message')

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return skip('conversation not found')
    if (conv.assigned_agent_id) return skip('a human agent is assigned') // a human owns this thread
    if (conv.ai_autoreply_disabled) return skip('bot paused on this conversation') // handed off / turned off here
    // Testing numbers get their own cap; everyone else the customer cap.
    const replyCap = await resolveConversationReplyCap(
      db,
      {
        customerCap: config.autoReplyMaxPerConversation,
        testingCap: config.autoReplyMaxTesting,
        testingNumbers: config.testingNumbers,
      },
      contactId,
    )
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= replyCap) return skip(`reply cap reached (${conv.ai_reply_count}/${replyCap})`)

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return skip('no conversation context')

    // Bot-loop guard: the other side is an automated responder (an IVR
    // menu, another company's chatbot). Answering it would loop forever
    // on the owner's key, so pause the bot here before any LLM call. No
    // agent is assigned — there is no person to help — but the note
    // explains the pause to whoever opens the thread.
    const automated = detectAutomatedSender(messages)
    if (automated) {
      await settleBookingStep({ accountId, contactId, result: 'handed_off' })
      await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: true,
          ai_handoff_summary: buildBotPauseSummary({
            messages,
            reason: automated.reason,
          }),
        })
        .eq('id', conversationId)
      console.info(
        `[ai auto-reply] paused on conversation ${conversationId}: automated sender (${automated.reason}).`,
      )
      return
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Every gate has passed — we're committed to attempting a reply, so
    // show the customer "typing…" (and mark their message read) while the
    // retrieval + LLM round trips run. Meta clears the indicator after
    // 25 s or when our reply lands, whichever is first, so there's
    // nothing to undo on the handoff / no-text path. Strictly
    // best-effort: a failed indicator must never cost us the reply.
    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId)
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const { types: bookingTypes, timeZone } = await loadBookingContext(db, accountId)
    const customerMemory = await loadCustomerMemory(db, accountId, contactId, timeZone)
    const availability = timeZone
      ? await loadAvailability(db, accountId, bookingTypes, timeZone)
      : {}

    // A Flow's "Start booking" step parked its run and handed this chat
    // over — steer the reply toward that booking.
    const bookingStep =
      bookingTypes.length > 0
        ? await loadActiveBookingStep({ accountId, contactId })
        : null
    const bookingFocus = bookingStep
      ? {
          type:
            bookingTypes.find((type) => type.id === bookingStep.bookingTypeId) ??
            null,
          knownDetails: bookingStep.knownDetails,
        }
      : null

    const systemPrompt = buildSystemPromptBlocks({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      now: new Date(),
      timeZone,
      bookingTypes,
      availability,
      customerMemory,
      bookingFocus,
    })

    const {
      text,
      handoff,
      usage,
      booking: markerBooking,
      bookingMalformed,
    } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    const zone = resolveTimeZone(timeZone)

    // The model often confirms in words and forgets the marker, which
    // would tell the customer "booked" with nothing behind it. So a reply
    // without one is checked before it goes out. A question can't be a
    // confirmation, and skipping those avoids most of the extra call.
    const mayConfirm =
      bookingTypes.length > 0 &&
      !handoff &&
      !markerBooking &&
      Boolean(text) &&
      !text.trim().endsWith('?')
    const extraction = mayConfirm
      ? await extractBookingFromChat({
          config,
          types: bookingTypes,
          timeZone: zone,
          customerMemory,
          messages,
          draftReply: text,
        })
      : null
    if (extraction) {
      void logAiUsage(db, {
        accountId,
        conversationId,
        mode: 'auto_reply',
        provider: config.provider,
        model: config.model,
        usage: extraction.usage,
      })
    }
    const booking = markerBooking ?? extraction?.booking ?? null

    // Saved ahead of every exit below — a lost reply slot, a newer
    // inbound or a handoff must not lose what the customer just agreed.
    const savedBooking = booking
      ? await saveBookingFromAi({
          db,
          accountId,
          contactId,
          conversationId,
          ownerUserId: configOwnerUserId,
          handoffAgentId: config.handoffAgentId,
          types: bookingTypes,
          timeZone: zone,
          marker: booking,
        })
      : null
    // The slot was taken or the customer has to choose, so the reply the
    // model wrote is wrong. It writes a new one in the customer's language.
    const followUp =
      !handoff && savedBooking?.ok && savedBooking.outcome === 'needs_followup'
        ? await generateFollowUp({
            instruction: savedBooking.instruction,
            config,
            systemPrompt,
            messages,
            log: (followUpUsage) =>
              void logAiUsage(db, {
                accountId,
                conversationId,
                mode: 'auto_reply',
                provider: config.provider,
                model: config.model,
                usage: followUpUsage,
              }),
          })
        : null
    const needsFollowUp = savedBooking?.ok && savedBooking.outcome === 'needs_followup'

    // A booking was made or changed: a Flow parked on a "Start booking"
    // step continues from here. Called after the customer has the
    // confirmation where possible, so the flow's next message follows it.
    const booked =
      savedBooking?.ok === true &&
      (savedBooking.outcome === 'created' || savedBooking.outcome === 'updated')
    // Each path settles the flow step at most once.
    let flowSettled = false
    const settleFlow = async (result: 'booked' | 'handed_off') => {
      if (flowSettled || !bookingStep) return
      if (result === 'booked' && !booked) return
      flowSettled = true
      await settleBookingStep(
        result === 'booked'
          ? {
              accountId,
              contactId,
              result,
              bookingId: savedBooking?.ok ? (savedBooking.booking?.id ?? null) : null,
            }
          : { accountId, contactId, result },
      )
    }
    const resumeFlow = () => settleFlow('booked')
    resumeFlowOnError = resumeFlow

    // The reply says "booked", so it can only go out if that is true.
    const bookingFailed =
      (bookingMalformed && !booking) ||
      savedBooking?.ok === false ||
      (needsFollowUp && !followUp)

    if (handoff || bookingFailed || (!text && !savedBooking)) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      //
      // The Flow's booking step ends first, so a failure below can't
      // make the catch resume a flow this reply meant to hand off.
      await settleFlow('handed_off')
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)
      return skip(
        handoff
          ? 'model asked for a human handoff'
          : bookingFailed
            ? 'booking could not be saved'
            : 'model returned no text',
      )
    }

    if (
      inboundMessageId &&
      (await hasNewerInbound(db, conversationId, inboundMessageId))
    ) {
      await resumeFlow()
      return skip('a newer customer message arrived while generating')
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: replyCap,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      await resumeFlow()
      return
    }
    if (claimed !== true) {
      await resumeFlow()
      return skip(`reply slot not claimed (cap ${replyCap})`)
    }

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: followUp || text || BOOKING_SAVED_FALLBACK,
      aiGenerated: true,
    })

    // After the send, so the customer's last message from the bot is the
    // confirmation. Assigning fires `on_conversation_assigned` and stops
    // the bot in this thread, which is why it is opt-in per type.
    if (
      savedBooking?.ok &&
      savedBooking.type.handoff_on_confirm &&
      savedBooking.booking?.assigned_to &&
      (savedBooking.outcome === 'created' || savedBooking.outcome === 'updated')
    ) {
      await db
        .from('conversations')
        .update({ assigned_agent_id: savedBooking.booking.assigned_to })
        .eq('id', conversationId)
    }

    await resumeFlow()
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
    // settleBookingStep never throws, so this can't escape the catch.
    if (resumeFlowOnError) await resumeFlowOnError()
  }
}

/**
 * Rewrite the reply around a system note. Null when that fails or the
 * model bails, so the caller hands off instead of sending the original.
 * Any marker in the rewrite is ignored: the note tells the model nothing
 * was saved, so this turn only asks; the customer's answer books it.
 */
async function generateFollowUp(args: {
  instruction: string
  config: AiConfig
  systemPrompt: SystemPrompt
  messages: ChatMessage[]
  log: (usage: AiUsage | null) => void
}): Promise<string | null> {
  const { instruction, config, systemPrompt, messages, log } = args
  try {
    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt: appendSystemText(systemPrompt, instruction),
      messages,
    })
    log(usage)
    return handoff ? null : text || null
  } catch (err) {
    console.error('[ai auto-reply] booking follow-up failed:', err)
    return null
  }
}

async function hasNewerInbound(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  inboundMessageId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return false
  return data[0].message_id !== inboundMessageId
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}
