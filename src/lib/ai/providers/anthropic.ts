import {
  AiError,
  type ChatMessage,
  type ProviderResult,
  type SystemPrompt,
} from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'
import { getT } from '@/lib/i18n/translate'

const t = getT('LibErrors')

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

interface AnthropicSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

/**
 * Turn our system prompt into Anthropic text blocks. A block marked
 * `cache` gets a `cache_control` breakpoint, so the stable prefix up to
 * it is cached and later requests read it back at a fraction of the
 * price. A plain string is one block, cached whole (callers that pass a
 * string — the key check — send the same text every time). Empty blocks
 * are dropped: the API rejects empty text blocks.
 */
export function toAnthropicSystem(prompt: SystemPrompt): AnthropicSystemBlock[] {
  const blocks = typeof prompt === 'string' ? [{ text: prompt, cache: true }] : prompt
  return blocks
    .filter((b) => b.text.length > 0)
    .map((b) =>
      b.cache
        ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text: b.text },
    )
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: toAnthropicSystem(systemPrompt),
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: normalizeForAnthropic(messages),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Anthropic', res)
  }

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null

  // Cache hit check: cache_read > 0 on repeat calls means the cached
  // prefix was reused; cache_creation > 0 means it was (re)written.
  const raw = data?.usage
  console.info('[ai anthropic] usage', {
    model,
    input_tokens: raw?.input_tokens ?? 0,
    cache_creation_input_tokens: raw?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: raw?.cache_read_input_tokens ?? 0,
    output_tokens: raw?.output_tokens ?? 0,
  })

  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError(t('ai.emptyResponse', { provider: 'Anthropic' }), {
      code: 'empty_response',
    })
  }
  // With caching, `input_tokens` counts only the uncached tail; the
  // cached prefix is reported separately. Add them back so the prompt
  // count logged to ai_usage_log stays the full prompt, as before.
  // Anthropic reports input/output but no total — normalizeUsage sums.
  const promptTokens =
    (raw?.input_tokens ?? 0) +
    (raw?.cache_creation_input_tokens ?? 0) +
    (raw?.cache_read_input_tokens ?? 0)
  const usage = normalizeUsage({
    prompt: promptTokens,
    completion: raw?.output_tokens,
  })
  return { text, usage }
}
