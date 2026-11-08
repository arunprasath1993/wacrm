// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

import type { BookingMarker } from '@/lib/bookings/types'

export type AiProvider = 'openai' | 'anthropic' | 'openai_compatible'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  /** Base URL for OpenAI-compatible providers; null for native providers. */
  baseUrl: string | null
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  /** Reply cap for customer conversations (any whole number >= 1). */
  autoReplyMaxPerConversation: number
  /** Reply cap when the contact is on `testingNumbers`. */
  autoReplyMaxTesting: number
  /** Admin-managed testing numbers, E.164 (`+919876543210`). */
  testingNumbers: string[]
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * One section of a system prompt. `cache: true` marks the end of a
 * prefix that stays byte-identical across requests (fixed scaffold, the
 * account's own instructions), so Anthropic can cache everything up to
 * and including it. Per-request content (time, availability, memory,
 * knowledge) goes in later blocks without `cache`.
 */
export interface SystemBlock {
  text: string
  cache?: boolean
}

/** A plain string, or ordered blocks (stable first, per-request last). */
export type SystemPrompt = string | SystemBlock[]

/** The prompt as one string, for providers that take a single system
 *  message. Blocks join exactly as the old single-string prompt did. */
export function systemPromptText(prompt: SystemPrompt): string {
  if (typeof prompt === 'string') return prompt
  return prompt
    .map((b) => b.text)
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/** Append a per-request section (e.g. a booking follow-up note) after
 *  everything else, leaving the cached prefix untouched. */
export function appendSystemText(prompt: SystemPrompt, text: string): SystemPrompt {
  if (typeof prompt === 'string') return `${prompt}\n\n${text}`
  return [...prompt, { text }]
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
  /** The booking the model recorded this turn, if any. */
  booking: BookingMarker | null
  /** The model tried to record a booking but it could not be read. */
  bookingMalformed: boolean
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
