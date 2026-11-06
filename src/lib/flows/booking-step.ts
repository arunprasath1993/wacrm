/**
 * Flow → booking bridge helpers.
 *
 * A `start_booking` node parks the run and lets the AI auto-reply take
 * the booking. That only works if the AI will actually answer this
 * conversation, so before parking the engine asks `bookingAiBlocker`
 * — the same gates `dispatchInboundToAiReply` applies, read without
 * decrypting the API key. A blocker means the customer would be left
 * talking to nobody, so the engine hands off to a human instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConversationReplyCap } from "@/lib/ai/reply-cap-server";

export type BookingAiBlocker =
  | "ai_not_configured"
  | "ai_auto_reply_off"
  | "no_booking_types"
  | "message_automation_active"
  | "conversation_missing"
  | "lookup_failed"
  | "agent_assigned"
  | "ai_disabled_for_conversation"
  | "ai_reply_cap_reached";

/**
 * Why the AI auto-reply would NOT answer this conversation, or null
 * when it would. Mirrors the gates in `src/lib/ai/auto-reply.ts`; keep
 * the two in step.
 */
export async function bookingAiBlocker(
  db: SupabaseClient,
  accountId: string,
  conversationId: string | null,
): Promise<BookingAiBlocker | null> {
  const { data: config, error: configErr } = await db
    .from("ai_configs")
    .select(
      "is_active, auto_reply_enabled, api_key, auto_reply_max_per_conversation, auto_reply_max_testing, testing_numbers",
    )
    .eq("account_id", accountId)
    .maybeSingle();
  // Fail closed on a lookup error: parking the run on an unknown state
  // could strand the customer, while a handoff always reaches a human.
  // A distinct reason keeps a transient DB error visible in run events.
  if (configErr) return "lookup_failed";
  if (!config) return "ai_not_configured";
  const cfg = config as {
    is_active: boolean;
    auto_reply_enabled: boolean;
    api_key: string | null;
    auto_reply_max_per_conversation: number;
    auto_reply_max_testing: number | null;
    testing_numbers: string[] | null;
  };
  if (!cfg.is_active || !cfg.api_key) return "ai_not_configured";
  if (!cfg.auto_reply_enabled) return "ai_auto_reply_off";

  // The AI only gets the booking protocol when the account has an
  // active booking type (same filters as `src/lib/bookings/load.ts`).
  const { data: bookingTypes, error: typesErr } = await db
    .from("booking_types")
    .select("id")
    .eq("account_id", accountId)
    .eq("is_active", true)
    .is("archived_at", null)
    .limit(1);
  if (typesErr) return "lookup_failed";
  if (!bookingTypes || bookingTypes.length === 0) {
    return "no_booking_types";
  }

  // The AI stands down whenever a message-level automation is active.
  const { data: autoResponders } = await db
    .from("automations")
    .select("id")
    .eq("account_id", accountId)
    .eq("is_active", true)
    .in("trigger_type", ["new_message_received", "keyword_match"])
    .limit(1);
  if (autoResponders && autoResponders.length > 0) {
    return "message_automation_active";
  }

  if (!conversationId) return "conversation_missing";
  const { data: conv, error: convErr } = await db
    .from("conversations")
    .select("assigned_agent_id, ai_autoreply_disabled, ai_reply_count, contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) return "lookup_failed";
  if (!conv) return "conversation_missing";
  const c = conv as {
    assigned_agent_id: string | null;
    ai_autoreply_disabled: boolean | null;
    ai_reply_count: number | null;
    contact_id: string | null;
  };
  if (c.assigned_agent_id) return "agent_assigned";
  if (c.ai_autoreply_disabled) return "ai_disabled_for_conversation";
  // Same cap selection as the auto-reply: testing numbers get the
  // testing cap, everyone else the customer cap.
  const replyCap = await resolveConversationReplyCap(
    db,
    {
      customerCap: cfg.auto_reply_max_per_conversation,
      testingCap: cfg.auto_reply_max_testing,
      testingNumbers: cfg.testing_numbers,
    },
    c.contact_id,
  );
  if ((c.ai_reply_count ?? 0) >= replyCap) {
    return "ai_reply_cap_reached";
  }
  return null;
}

/**
 * Flow vars worth handing to the AI as details the customer already
 * gave (e.g. a name captured by `collect_input`). Only short scalar
 * values — anything else is noise in a prompt.
 */
export function bookingKnownDetails(
  vars: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) out[key] = text;
    }
    if (Object.keys(out).length >= 20) break;
  }
  return out;
}
