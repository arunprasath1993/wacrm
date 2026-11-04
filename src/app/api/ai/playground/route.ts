import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { resolveTimeZone } from '@/lib/ai/usage-days'
import { loadBookingContext } from '@/lib/bookings/load'
import { previewSlotCheck } from '@/lib/bookings/save'
import { loadAvailability } from '@/lib/bookings/slots'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider — so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: t('ai.messagesRequired') }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: t('ai.sendMessageToTest') },
        { status: 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError(t('ai.storedKeyUndecryptable'), {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: t('ai.noAgentConfigured'),
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )
    const { types: bookingTypes, timeZone } = await loadBookingContext(supabase, accountId)
    const availability = timeZone
      ? await loadAvailability(supabase, accountId, bookingTypes, timeZone)
      : {}

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      now: new Date(),
      timeZone,
      bookingTypes,
      availability,
    })

    const { text, handoff, booking, bookingMalformed } = await generateReply({
      config,
      systemPrompt,
      messages,
    })
    // A real chat is refused at the save and rewritten, or handed to a
    // human, so show that here rather than a confirmation no customer
    // would get.
    const slot = booking
      ? await previewSlotCheck({
          db: supabase,
          accountId,
          types: bookingTypes,
          timeZone: resolveTimeZone(timeZone),
          marker: booking,
        })
      : null
    const handoffResponse = () =>
      NextResponse.json({ reply: '', handoff: true, booking: null, booking_malformed: false })
    if (slot?.outcome === 'handoff') return handoffResponse()
    // The bot already chose to hand off, so it never writes a follow-up.
    if (handoff && slot?.outcome === 'needs_followup') return handoffResponse()
    if (slot?.outcome === 'needs_followup') {
      let followUp
      try {
        followUp = await generateReply({
          config,
          systemPrompt: `${systemPrompt}\n\n${slot.instruction}`,
          messages,
        })
      } catch (err) {
        console.error('[ai/playground] booking follow-up failed:', err)
        return handoffResponse()
      }
      if (followUp.handoff || !followUp.text) return handoffResponse()
      return NextResponse.json({
        reply: followUp.text,
        handoff: false,
        booking: null,
        booking_malformed: false,
      })
    }

    // A preview only: there is no customer here, so nothing is saved.
    return NextResponse.json({
      reply: text,
      handoff,
      booking,
      booking_malformed: bookingMalformed,
    })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
