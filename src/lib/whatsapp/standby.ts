/**
 * Inbound messages delivered on the `standby` webhook field.
 *
 * When another responder holds control of a WhatsApp number's threads —
 * most commonly Meta Business Agent (Meta's own AI) once it is switched
 * on for the number — Meta stops sending customer messages to this app
 * on the `messages` field. They arrive on `standby` instead, while
 * delivery / read statuses for messages WE sent keep arriving on
 * `messages`. The webhook used to look only at `value.messages`, so the
 * inbox silently went quiet the moment the agent was enabled.
 *
 * Meta's docs don't pin the exact shape of `value.standby`, so this
 * accepts every shape we can reasonably expect:
 *   - an array of message objects                 { id, type, from, ... }
 *   - an array of value-like envelopes            { messages: [...], contacts: [...] }
 *   - an array of single-message envelopes        { message: {...} }
 *   - a single object of any of the above shapes
 *
 * Copies of the agent's OWN outgoing messages also land on standby (so
 * a standby app can keep its transcript in sync). Those must not be
 * recorded as customer messages, so anything that carries a `to`, has
 * no sender, or was sent from the business number itself is dropped.
 */

export interface StandbyInbound<M, C> {
  messages: M[]
  contacts: C[]
}

type Loose = Record<string, unknown>

function isObject(v: unknown): v is Loose {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function looksLikeMessage(v: unknown): v is Loose {
  return isObject(v) && typeof v.id === 'string' && typeof v.type === 'string'
}

function digits(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : ''
}

export function extractStandbyInbound<M, C>(
  value: unknown,
): StandbyInbound<M, C> {
  const out: StandbyInbound<M, C> = { messages: [], contacts: [] }
  if (!isObject(value)) return out

  const raw = value.standby
  const items: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : []
  const businessNumber = digits(
    isObject(value.metadata) ? value.metadata.display_phone_number : undefined,
  )

  const messages: Loose[] = []
  const contacts: unknown[] = Array.isArray(value.contacts) ? [...value.contacts] : []

  for (const item of items) {
    if (looksLikeMessage(item)) {
      messages.push(item)
      continue
    }
    if (!isObject(item)) continue
    if (Array.isArray(item.messages)) {
      messages.push(...item.messages.filter(looksLikeMessage))
    }
    if (looksLikeMessage(item.message)) {
      messages.push(item.message)
    }
    if (Array.isArray(item.contacts)) contacts.push(...item.contacts)
  }

  for (const m of messages) {
    // Agent / business echoes, not customer messages.
    if (m.to !== undefined) continue
    const from = digits(m.from)
    if (!from && typeof m.from_user_id !== 'string') continue
    if (businessNumber && from === businessNumber) continue
    out.messages.push(m as M)
  }
  out.contacts = contacts as C[]
  return out
}
