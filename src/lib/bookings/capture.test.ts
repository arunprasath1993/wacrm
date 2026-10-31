import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  generateReply: vi.fn(),
  loadBookingContext: vi.fn(),
  loadCustomerMemory: vi.fn(),
  saveBookingFromAi: vi.fn(),
  logAiUsage: vi.fn(),
  checkRateLimit: vi.fn(),
  conv: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/ai/context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: h.logAiUsage }))
vi.mock('./load', () => ({ loadBookingContext: h.loadBookingContext }))
vi.mock('./memory', () => ({ loadCustomerMemory: h.loadCustomerMemory }))
vi.mock('./save', () => ({ saveBookingFromAi: h.saveBookingFromAi }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  RATE_LIMITS: { bookingCapture: {}, aiAutoReplyAccount: {} },
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: h.conv, error: null }),
      }
      return chain
    },
  }),
}))

import { captureBookingFromAgentChat } from './capture'

const ARGS = { accountId: 'a1', conversationId: 'conv-1', noteUserId: 'agent-1' }
const TYPE = {
  id: 't1',
  key: 'installation',
  name: 'Installation',
  fields: [],
  time_mode: 'required',
  duration_minutes: 60,
  instructions: null,
  available_days: [1, 2, 3, 4, 5, 6],
  available_from: '09:00',
  available_to: '18:00',
}
const MARKER = { type: 'installation', action: 'save', fields: {} }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.conv = {
    contact_id: 'c1',
    assigned_agent_id: 'agent-1',
    ai_autoreply_disabled: false,
  }
  h.loadAiConfig.mockResolvedValue({
    provider: 'anthropic',
    model: 'haiku',
    autoReplyEnabled: true,
    handoffAgentId: null,
  })
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'ok 11 AM' }])
  h.loadBookingContext.mockResolvedValue({ types: [TYPE], timeZone: 'Asia/Kolkata' })
  h.loadCustomerMemory.mockResolvedValue(null)
  h.generateReply.mockResolvedValue({ text: '', booking: MARKER, bookingMalformed: false, usage: null })
  h.saveBookingFromAi.mockResolvedValue({ ok: true, outcome: 'created' })
  h.logAiUsage.mockResolvedValue(undefined)
  h.checkRateLimit.mockReturnValue({ success: true })
})

afterEach(() => vi.restoreAllMocks())

describe('captureBookingFromAgentChat', () => {
  it('records a booking agreed in a chat an agent owns', async () => {
    await captureBookingFromAgentChat(ARGS)

    expect(h.saveBookingFromAi).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'a1',
        contactId: 'c1',
        conversationId: 'conv-1',
        ownerUserId: 'agent-1',
        mode: 'agent_chat',
        marker: MARKER,
      }),
    )
  })

  it('runs where the bot was paused on this chat', async () => {
    h.conv = { contact_id: 'c1', assigned_agent_id: null, ai_autoreply_disabled: true }
    await captureBookingFromAgentChat(ARGS)
    expect(h.saveBookingFromAi).toHaveBeenCalledTimes(1)
  })

  it('runs for accounts that keep the auto-reply off', async () => {
    h.conv = { contact_id: 'c1', assigned_agent_id: null, ai_autoreply_disabled: false }
    h.loadAiConfig.mockResolvedValue({ autoReplyEnabled: false, handoffAgentId: null })
    await captureBookingFromAgentChat(ARGS)
    expect(h.saveBookingFromAi).toHaveBeenCalledTimes(1)
  })

  it('leaves chats the bot is handling to the bot', async () => {
    h.conv = { contact_id: 'c1', assigned_agent_id: null, ai_autoreply_disabled: false }
    await captureBookingFromAgentChat(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('spends nothing when the account has no booking types', async () => {
    h.loadBookingContext.mockResolvedValue({ types: [], timeZone: 'Asia/Kolkata' })
    await captureBookingFromAgentChat(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('spends nothing when AI is not set up', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await captureBookingFromAgentChat(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('stops when the chat has no contact', async () => {
    h.conv = { contact_id: null, assigned_agent_id: 'agent-1', ai_autoreply_disabled: false }
    await captureBookingFromAgentChat(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('backs off when throttled', async () => {
    h.checkRateLimit.mockReturnValue({ success: false })
    await captureBookingFromAgentChat(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('saves nothing when no booking was agreed', async () => {
    h.generateReply.mockResolvedValue({ text: 'NONE', booking: null, bookingMalformed: false, usage: null })
    await captureBookingFromAgentChat(ARGS)
    expect(h.saveBookingFromAi).not.toHaveBeenCalled()
  })

  it('uses the capture prompt rather than the reply prompt', async () => {
    await captureBookingFromAgentChat(ARGS)
    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).toContain('You do not reply')
  })

  it('logs the spend on the account key', async () => {
    await captureBookingFromAgentChat(ARGS)
    expect(h.logAiUsage).toHaveBeenCalledTimes(1)
  })

  it('never throws, so it cannot break a send or the webhook', async () => {
    h.generateReply.mockRejectedValue(new Error('provider down'))
    await expect(captureBookingFromAgentChat(ARGS)).resolves.toBeUndefined()
  })
})
