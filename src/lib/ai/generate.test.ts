import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    baseUrl: null,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    autoReplyMaxTesting: 1000,
    testingNumbers: [],
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseGeneration — booking marker', () => {
  const MARKER =
    '[[BOOKING]]{"type":"online_demo","action":"save","fields":{"name":"Ramu"}}[[/BOOKING]]'

  it('returns the booking and removes the marker from the text', () => {
    const result = parseGeneration(`Booked!\n${MARKER}`)
    expect(result.text).toBe('Booked!')
    expect(result.booking?.type).toBe('online_demo')
    expect(result.bookingMalformed).toBe(false)
  })

  it('flags a marker it cannot read, without leaking it', () => {
    const result = parseGeneration('Booked!\n[[BOOKING]]{broken')
    expect(result.text).toBe('Booked!')
    expect(result.booking).toBeNull()
    expect(result.bookingMalformed).toBe(true)
  })

  it('handles a marker alongside a handoff', () => {
    const result = parseGeneration(`${MARKER}\n[[HANDOFF]]`)
    expect(result.text).toBe('')
    expect(result.handoff).toBe(true)
    expect(result.booking?.type).toBe('online_demo')
  })

  it('reports no booking for a plain reply', () => {
    const result = parseGeneration('Hello')
    expect(result.booking).toBeNull()
    expect(result.bookingMalformed).toBe(false)
  })
})

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toMatchObject({
      text: 'Hello there',
      handoff: false,
      usage: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toMatchObject({
      text: '',
      handoff: true,
      usage: null,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toMatchObject({
      text: 'Let me get a human',
      handoff: true,
      usage: null,
    })
  })

  it('converts Markdown formatting to WhatsApp formatting', () => {
    expect(parseGeneration('**Step by step:**\n## Plans').text).toBe(
      '*Step by step:*\n*Plans*',
    )
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toMatchObject({
      text: 'Hi',
      handoff: false,
      usage,
    })
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toMatchObject({
      text: 'Sure — happy to help!',
      handoff: false,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Anthropic reports input/output only — total is summed by normalizeUsage.
    expect(res).toMatchObject({
      text: 'Hi there!',
      handoff: false,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: '[[HANDOFF]]' }] }),
      ),
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })

  it('sends system blocks with cache_control only on the stable ones', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: [
        { text: 'scaffold', cache: true },
        { text: 'business', cache: true },
        { text: 'time + memory' },
        { text: '' },
      ],
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toEqual([
      { type: 'text', text: 'scaffold', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'business', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'time + memory' },
    ])
  })

  it('sends a plain string prompt as one cached block', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toEqual([
      { type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('counts cached tokens in the prompt total and logs the cache usage', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          content: [{ type: 'text', text: 'Hi' }],
          usage: {
            input_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 4000,
            output_tokens: 10,
          },
        }),
      ),
    )

    const res = await generateReply({
      config: config({ provider: 'anthropic', model: 'claude-test' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res.usage).toEqual({ promptTokens: 4050, completionTokens: 10, totalTokens: 4060 })
    expect(info).toHaveBeenCalledWith('[ai anthropic] usage', {
      model: 'claude-test',
      input_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 4000,
      output_tokens: 10,
    })
    info.mockRestore()
  })
})

describe('generateReply — OpenAI system blocks', () => {
  it('joins blocks into one system message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'ok' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: [{ text: 'a', cache: true }, { text: 'b' }],
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'a\n\nb' })
  })
})


describe('generateReply — OpenAI-compatible', () => {
  it('uses the configured endpoint and max_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Gateway reply' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateReply({
      config: config({
        provider: 'openai_compatible',
        model: 'llama-3.3-70b',
        baseUrl: 'https://8.8.8.8/v1/',
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(result).toMatchObject({
      text: 'Gateway reply',
      handoff: false,
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://8.8.8.8/v1/chat/completions')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(opts.body).max_tokens).toBe(1024)
    expect(opts.redirect).toBe('manual')
  })

  it('blocks private hosts unless the operator explicitly allow-lists them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const previous = process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    try {
      await expect(
        generateReply({
          config: config({
            provider: 'openai_compatible',
            baseUrl: 'https://127.0.0.1:11434/v1',
          }),
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toMatchObject({ code: 'blocked_url', status: 400 })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
      else process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = previous
    }
  })

  it('allows an operator-approved private host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Local reply' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const previous = process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1'
    try {
      const result = await generateReply({
        config: config({
          provider: 'openai_compatible',
          model: 'llama3.2',
          baseUrl: 'http://127.0.0.1:11434/v1',
        }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      })
      expect(result.text).toBe('Local reply')
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
      else process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = previous
    }
  })

  it('does not follow redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateReply({
        config: config({
          provider: 'openai_compatible',
          baseUrl: 'https://8.8.8.8/v1',
        }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'provider_error' })

    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
  })
})
