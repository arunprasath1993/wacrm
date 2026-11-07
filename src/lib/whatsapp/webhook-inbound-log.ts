import type { SupabaseClient } from '@supabase/supabase-js'
import { extractStandbyInbound } from './standby'

/**
 * Opt-in diagnostic trail for the Meta webhook (migration 065).
 *
 * On hosts where runtime logs aren't readable, "the customer's message
 * never showed up" can mean Meta never delivered it, the signature
 * failed, or processing dropped it. With WEBHOOK_DEBUG_LOG=true every
 * webhook change and every inbound message's outcome lands in
 * `webhook_inbound_log`, so a SELECT tells the three apart.
 *
 * Every write is best-effort: a missing table or a failed insert must
 * never cost us the message itself.
 */

export type InboundOutcome =
  | 'received'
  | 'bad_signature'
  | 'config_error'
  | 'no_config'
  | 'multiple_configs'
  | 'token_undecryptable'
  | 'no_identity'
  | 'contact_failed'
  | 'conversation_failed'
  | 'reaction'
  | 'insert_failed'
  | 'duplicate'
  | 'inserted'
  | 'process_error'

export interface InboundLogRow {
  signature_ok: boolean
  field: string | null
  phone_number_id: string | null
  message_id: string | null
  message_type: string | null
  status_count: number
  outcome: InboundOutcome
  detail: string | null
}

export function inboundLogEnabled(): boolean {
  return process.env.WEBHOOK_DEBUG_LOG === 'true'
}

interface LooseChange {
  field?: unknown
  value?: {
    metadata?: { phone_number_id?: unknown }
    messages?: { id?: unknown; type?: unknown }[]
    statuses?: unknown[]
    [key: string]: unknown
  }
}

/**
 * One row per change in the payload. `detail` lists the keys the change
 * value carried, which is what shows an inbound arriving in a shape we
 * don't handle (no `messages`, no `contacts`, a different field).
 * Tolerates any JSON, because a payload that failed its signature check
 * is logged too.
 */
export function summarizeWebhook(
  body: unknown,
  signatureOk: boolean,
): InboundLogRow[] {
  const entries = (body as { entry?: unknown })?.entry
  if (!Array.isArray(entries)) {
    return [emptyRow(signatureOk, 'no entry array')]
  }

  const rows: InboundLogRow[] = []
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes as LooseChange[]) {
      const value = change?.value ?? {}
      const messages = Array.isArray(value.messages)
        ? value.messages
        : extractStandbyInbound<{ id?: unknown; type?: unknown }, unknown>(value).messages
      rows.push({
        signature_ok: signatureOk,
        field: typeof change?.field === 'string' ? change.field : null,
        phone_number_id: asText(value.metadata?.phone_number_id),
        message_id: messages.map((m) => asText(m?.id)).filter(Boolean).join(',') || null,
        message_type: messages.map((m) => asText(m?.type)).filter(Boolean).join(',') || null,
        status_count: Array.isArray(value.statuses) ? value.statuses.length : 0,
        outcome: signatureOk ? 'received' : 'bad_signature',
        detail: Object.keys(value).sort().join(','),
      })
    }
  }
  return rows.length > 0 ? rows : [emptyRow(signatureOk, 'no changes')]
}

export async function recordInboundLog(
  db: SupabaseClient,
  rows: InboundLogRow[],
): Promise<void> {
  if (rows.length === 0) return
  try {
    const { error } = await db.from('webhook_inbound_log').insert(rows)
    if (error) console.warn('[webhook] inbound log insert failed:', error.message)
  } catch (err) {
    console.warn('[webhook] inbound log insert failed:', err)
  }
}

/** A single message's outcome, as a row. */
export function outcomeRow(args: {
  phoneNumberId: string | null
  messageId?: string | null
  messageType?: string | null
  outcome: InboundOutcome
  detail?: string | null
}): InboundLogRow {
  return {
    signature_ok: true,
    field: 'messages',
    phone_number_id: args.phoneNumberId,
    message_id: args.messageId ?? null,
    message_type: args.messageType ?? null,
    status_count: 0,
    outcome: args.outcome,
    detail: args.detail ?? null,
  }
}

function emptyRow(signatureOk: boolean, detail: string): InboundLogRow {
  return {
    signature_ok: signatureOk,
    field: null,
    phone_number_id: null,
    message_id: null,
    message_type: null,
    status_count: 0,
    outcome: signatureOk ? 'received' : 'bad_signature',
    detail,
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}
