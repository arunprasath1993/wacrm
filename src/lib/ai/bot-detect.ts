import type { ChatMessage } from './types'

/**
 * Bot-loop guard for the AI auto-reply.
 *
 * When the "customer" on the other end is itself an automated responder
 * (a telecom IVR menu, another company's chatbot, an out-of-office
 * auto-reply), our AI and theirs answer each other forever and every
 * turn burns tokens on the account's key. This check runs before any
 * LLM call, on the transcript we already loaded, so spotting a bot costs
 * nothing.
 *
 * It is deliberately conservative — it only fires on phrasing a human
 * customer would not write to a business. Anything subtler is left to
 * the model, whose auto-reply prompt tells it to hand off when the other
 * side looks automated.
 *
 * Only the CURRENT turn is judged — the customer messages after our last
 * reply. Older messages are never re-flagged on their own, so when a
 * human re-enables AI replies after a pause (or after a false positive),
 * the next real message isn't paused again because of the old bot text
 * still sitting in the transcript.
 */

/** Cap on the current turn, and the size of the window of recent
 *  customer messages a repeat is looked for in. */
const RECENT_CUSTOMER_MESSAGES = 4

/** A repeated customer message must be at least this long to count —
 *  people resend short things ("hello?", "ok") all the time. */
const MIN_REPEAT_LENGTH = 40

/** Phrasing typical of automated responders. Each one alone is enough. */
const BOT_PHRASES: { pattern: RegExp; reason: string }[] = [
  {
    // "no." needs the period — "I will reply with no problem" is a person.
    pattern: /\breply with (the |an |a )?(option|menu)? ?(number\b|no\.)/i,
    reason: 'menu prompt ("reply with the option number")',
  },
  {
    // Only the instruction form — "I want to make a selection from your
    // range" is a customer.
    pattern: /\bto make (a |your )?selection,? (please )?(reply|type|press|enter|choose|select)\b/i,
    reason: 'menu prompt ("to make selection")',
  },
  {
    // No "send" — a customer writes "send 2 to Chennai".
    pattern: /\b(press|reply)\s+['"‘’“”]?\d{1,2}['"‘’“”]?\s+(for|to)\b/i,
    reason: 'menu prompt ("press 1 for …")',
  },
  {
    // "type"/"enter" only with a quoted digit — "type 2 for the kitchen"
    // is a customer naming a product type.
    pattern: /\b(type|enter)\s+['"‘’“”]\d{1,2}['"‘’“”]\s+(for|to)\b/i,
    reason: `menu prompt ("type '1' for …")`,
  },
  {
    pattern: /\b(please )?(select|choose|enter) (a |an )?valid (option|choice|number|input)\b/i,
    reason: 'menu error ("select a valid option")',
  },
  {
    pattern: /\binvalid (option|selection|choice|input|response)\b/i,
    reason: 'menu error ("invalid option")',
  },
  {
    pattern: /\bi can (only )?assist only with\b|\bi can only (assist|help) (you )?with\b/i,
    reason: 'scope-limited assistant ("I can assist only with …")',
  },
  {
    pattern: /\bthis is an? (automated|auto[- ]?generated|system[- ]generated) (message|response|reply)\b/i,
    reason: 'automated message notice',
  },
  {
    pattern: /\b(do not|don't|please don't|please do not) reply to this (message|number|chat)\b/i,
    reason: '"do not reply" notice',
  },
  {
    pattern: /\bthis (number|chat|inbox) is not monitored\b/i,
    reason: '"not monitored" notice',
  },
  {
    pattern: /\bi(?:'m| am) (an? )?(virtual|automated|ai|digital) (assistant|agent|bot)\b/i,
    reason: 'self-declared virtual assistant',
  },
]

export interface AutomatedSender {
  /** Short, human-readable why — goes into the internal handoff note. */
  reason: string
}

/**
 * Returns why the other side looks like a bot, or null when it reads as
 * a person. Only customer (`user`) messages are inspected, and only the
 * current turn — those after the last `assistant` message (or all of
 * them when we haven't replied yet), capped at RECENT_CUSTOMER_MESSAGES.
 */
export function detectAutomatedSender(
  messages: ChatMessage[],
): AutomatedSender | null {
  const lastAssistant = messages.map((m) => m.role).lastIndexOf('assistant')
  const currentTurn = customerMessages(messages.slice(lastAssistant + 1)).slice(
    -RECENT_CUSTOMER_MESSAGES,
  )
  if (currentTurn.length === 0) return null

  for (const message of currentTurn) {
    for (const { pattern, reason } of BOT_PHRASES) {
      if (pattern.test(message.content)) return { reason }
    }
  }

  // An automated responder answers every turn with the same canned text,
  // so our reply always sits between the copies: flag a current-turn
  // message that repeats a customer message from an EARLIER turn (before
  // our last reply) within the last RECENT_CUSTOMER_MESSAGES customer
  // messages. A person double-sending before we reply (both copies in the
  // current turn) doesn't count, nor does an old repeat followed by a new,
  // different message.
  const earlierTurns = new Set(
    customerMessages(messages)
      .slice(-RECENT_CUSTOMER_MESSAGES)
      .filter((m) => !currentTurn.includes(m))
      .map((m) => normalize(m.content)),
  )
  for (const message of currentTurn) {
    const normalized = normalize(message.content)
    if (normalized.length < MIN_REPEAT_LENGTH) continue
    if (earlierTurns.has(normalized)) {
      return { reason: 'the same long message was sent repeatedly' }
    }
  }

  return null
}

function customerMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role === 'user' && m.content.trim())
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}
