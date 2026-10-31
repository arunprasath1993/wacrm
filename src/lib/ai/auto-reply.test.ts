import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  loadAccountMetaCredentials: vi.fn(),
  sendTypingIndicator: vi.fn(),
  loadBookingContext: vi.fn(),
  loadCustomerMemory: vi.fn(),
  saveBookingFromAi: vi.fn(),
  loadAvailability: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    latestInbound: [] as { message_id: string }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  loadAccountMetaCredentials: h.loadAccountMetaCredentials,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTypingIndicator: h.sendTypingIndicator,
}))
vi.mock('@/lib/bookings/load', () => ({ loadBookingContext: h.loadBookingContext }))
vi.mock('@/lib/bookings/memory', () => ({ loadCustomerMemory: h.loadCustomerMemory }))
vi.mock('@/lib/bookings/save', () => ({ saveBookingFromAi: h.saveBookingFromAi }))
vi.mock('@/lib/bookings/slots', () => ({ loadAvailability: h.loadAvailability }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'messages') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.latestInbound, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  inboundMessageId: 'wamid.inbound-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    baseUrl: null,
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.latestInbound = [{ message_id: 'wamid.inbound-1' }]
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.loadAccountMetaCredentials.mockResolvedValue({
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
  })
  h.sendTypingIndicator.mockResolvedValue(undefined)
  h.loadBookingContext.mockResolvedValue({ types: [], timeZone: null })
  h.loadCustomerMemory.mockResolvedValue(null)
  __resetRateLimitForTests()
  h.saveBookingFromAi.mockReset()
  h.generateReply.mockReset()
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.loadAvailability.mockResolvedValue({})
})

describe('dispatchInboundToAiReply — bookings', () => {
  const TYPE = {
    id: 'type-1',
    key: 'online_demo',
    name: 'Online Demo',
    fields: [],
    time_mode: 'required',
    duration_minutes: 30,
    instructions: null,
    assignee_user_id: 'agent-1',
    handoff_on_confirm: false,
    remind_minutes_before: 60,
    slot_capacity: 1,
    available_days: [1, 2, 3, 4, 5, 6],
    available_from: '09:00',
    available_to: '18:00',
  }
  const MARKER = {
    type: 'online_demo',
    action: 'save',
    fields: { name: 'Ramu' },
    scheduledLocal: '2026-11-01T11:00',
    scheduledText: 'Tomorrow at 11 AM',
  }

  function saved(overrides: Record<string, unknown> = {}) {
    return {
      ok: true,
      outcome: 'created',
      booking: { id: 'b1', assigned_to: 'agent-1' },
      type: TYPE,
      ...overrides,
    }
  }

  beforeEach(() => {
    h.loadBookingContext.mockResolvedValue({ types: [TYPE], timeZone: 'UTC' })
    h.generateReply.mockResolvedValue({
      text: 'Confirmed!',
      handoff: false,
      booking: MARKER,
      bookingMalformed: false,
    })
    h.saveBookingFromAi.mockResolvedValue(saved())
  })

  it('saves the booking and sends the reply', async () => {
    await dispatchInboundToAiReply(ARGS)

    expect(h.saveBookingFromAi).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        ownerUserId: 'user-1',
        timeZone: 'UTC',
        marker: MARKER,
      }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Confirmed!' }),
    )
  })

  it('does not call the save path for an ordinary reply', async () => {
    h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
    await dispatchInboundToAiReply(ARGS)
    expect(h.saveBookingFromAi).not.toHaveBeenCalled()
  })

  it('never tells the customer it is booked when the save failed', async () => {
    h.saveBookingFromAi.mockResolvedValue({ ok: false })
    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('hands off when the marker could not be read', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Confirmed!',
      handoff: false,
      booking: null,
      bookingMalformed: true,
    })
    await dispatchInboundToAiReply(ARGS)

    expect(h.saveBookingFromAi).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('keeps the lead when the reply slot is lost', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)

    expect(h.saveBookingFromAi).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('keeps the lead when a newer inbound supersedes the reply', async () => {
    h.state.latestInbound = [{ message_id: 'wamid.inbound-2' }]
    await dispatchInboundToAiReply(ARGS)

    expect(h.saveBookingFromAi).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('keeps the lead when the model also asks for a human', async () => {
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: true,
      booking: MARKER,
      bookingMalformed: false,
    })
    await dispatchInboundToAiReply(ARGS)

    expect(h.saveBookingFromAi).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('still confirms to the customer when the model sent only the marker', async () => {
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: false,
      booking: MARKER,
      bookingMalformed: false,
    })
    await dispatchInboundToAiReply(ARGS)

    const sent = h.engineSendText.mock.calls[0][0].text as string
    expect(sent.trim()).not.toBe('')
    expect(h.state.updatePayload).toBeNull()
  })

  it('keeps the bot in the chat by default', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
  })

  it('assigns the chat after confirming when the type asks for it', async () => {
    h.saveBookingFromAi.mockResolvedValue(
      saved({ type: { ...TYPE, handoff_on_confirm: true } }),
    )
    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.state.updatePayload).toEqual({ assigned_agent_id: 'agent-1' })
  })

  it('does not assign the chat for an unchanged repeat', async () => {
    h.saveBookingFromAi.mockResolvedValue(
      saved({ outcome: 'unchanged', type: { ...TYPE, handoff_on_confirm: true } }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
  })

  it('gives the model the date, the booking types and the customer memory', async () => {
    h.loadCustomerMemory.mockResolvedValue({
      name: 'Ramu',
      company: null,
      bookings: [],
    })
    await dispatchInboundToAiReply(ARGS)

    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).toContain('Current date and time')
    expect(prompt).toContain('"online_demo"')
    expect(prompt).toContain('Ramu')
  })

  it('offers the model only the free times', async () => {
    h.loadAvailability.mockResolvedValue({ online_demo: ['Mon, 2 Nov, 9:00 am'] })
    await dispatchInboundToAiReply(ARGS)

    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).toContain('Mon, 2 Nov, 9:00 am')
  })

  describe('when the booking needs the customer first', () => {
    const FOLLOW_UP = 'System note: that slot is taken.'

    beforeEach(() => {
      h.saveBookingFromAi.mockResolvedValue({
        ok: true,
        outcome: 'needs_followup',
        instruction: FOLLOW_UP,
        booking: null,
        type: { ...TYPE, handoff_on_confirm: true },
      })
      h.generateReply
        .mockResolvedValueOnce({
          text: 'Confirmed for 11!',
          handoff: false,
          booking: MARKER,
          bookingMalformed: false,
        })
        .mockResolvedValueOnce({
          text: 'That time is taken. Is 12 ok?',
          handoff: false,
          booking: null,
          bookingMalformed: false,
        })
    })

    it('replaces the false confirmation with the follow-up', async () => {
      await dispatchInboundToAiReply(ARGS)

      expect(h.engineSendText).toHaveBeenCalledTimes(1)
      expect(h.engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'That time is taken. Is 12 ok?' }),
      )
    })

    it('tells the model what to ask', async () => {
      await dispatchInboundToAiReply(ARGS)
      const retry = h.generateReply.mock.calls[1][0].systemPrompt as string
      expect(retry).toContain(FOLLOW_UP)
    })

    it('does not act on a marker in the follow-up', async () => {
      h.generateReply.mockReset()
      h.generateReply.mockResolvedValue({
        text: 'Is 12 ok?',
        handoff: false,
        booking: MARKER,
        bookingMalformed: false,
      })
      await dispatchInboundToAiReply(ARGS)
      expect(h.saveBookingFromAi).toHaveBeenCalledTimes(1)
    })

    it('does not hand the chat over, since nothing was booked', async () => {
      await dispatchInboundToAiReply(ARGS)
      expect(h.state.updatePayload).toBeNull()
    })

    it('hands off rather than confirming if the follow-up fails', async () => {
      h.generateReply.mockReset()
      h.generateReply
        .mockResolvedValueOnce({
          text: 'Confirmed for 11!',
          handoff: false,
          booking: MARKER,
          bookingMalformed: false,
        })
        .mockRejectedValueOnce(new Error('provider down'))
      await dispatchInboundToAiReply(ARGS)

      expect(h.engineSendText).not.toHaveBeenCalled()
      expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    })

    it('hands off if the follow-up comes back empty', async () => {
      h.generateReply.mockReset()
      h.generateReply
        .mockResolvedValueOnce({
          text: 'Confirmed for 11!',
          handoff: false,
          booking: MARKER,
          bookingMalformed: false,
        })
        .mockResolvedValueOnce({
          text: '',
          handoff: true,
          booking: null,
          bookingMalformed: false,
        })
      await dispatchInboundToAiReply(ARGS)

      expect(h.engineSendText).not.toHaveBeenCalled()
      expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    })
  })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the slot claim is refused after a human takeover', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('leaves the reply to the newer run when another inbound arrived', async () => {
    h.state.latestInbound = [{ message_id: 'wamid.inbound-2' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('replies when the triggering inbound is still the latest', async () => {
    h.state.latestInbound = [{ message_id: 'wamid.inbound-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — typing indicator (#527)', () => {
  it('shows "typing…" on the inbound wamid before calling the LLM', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadAccountMetaCredentials).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
    )
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
    expect(h.sendTypingIndicator).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      messageId: 'wamid.inbound-1',
    })
    // Ordering: the indicator goes out while the customer waits on the
    // model, not after the reply is already generated.
    const typingOrder = h.sendTypingIndicator.mock.invocationCallOrder[0]
    const llmOrder = h.generateReply.mock.invocationCallOrder[0]
    expect(typingOrder).toBeLessThan(llmOrder)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('still sends the reply when the indicator request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.sendTypingIndicator.mockRejectedValue(new Error('Meta API error: 400'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('typing indicator failed'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('still sends the reply when the WhatsApp credentials cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.loadAccountMetaCredentials.mockRejectedValue(
      new Error('WhatsApp not configured for this account'),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('skips the indicator when no inbound wamid is supplied', async () => {
    const { inboundMessageId: _omit, ...legacyArgs } = ARGS
    void _omit
    await dispatchInboundToAiReply(legacyArgs)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.loadAccountMetaCredentials).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('does not fire when a gate short-circuits before the LLM', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.loadAccountMetaCredentials).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})
