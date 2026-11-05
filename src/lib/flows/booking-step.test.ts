import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeTables } from "./fake-db.test-helper";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  sendText: vi.fn(async () => ({ whatsapp_message_id: "wamid.text" })),
}));

vi.mock("./admin-client", async () => {
  const { createFakeDb } = await import("./fake-db.test-helper");
  return { supabaseAdmin: () => createFakeDb(h.tables as FakeTables) };
});

vi.mock("./meta-send", () => ({
  engineSendText: h.sendText,
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.media" })),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: "wamid.buttons" })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wamid.list" })),
}));

import {
  dispatchInboundToFlows,
  isSuspending,
  loadActiveBookingStep,
  settleBookingStep,
} from "./engine";
import { bookingKnownDetails } from "./booking-step";
import type { ParsedInbound } from "./types";

const FLOW = {
  id: "flow-1",
  account_id: "acct-1",
  user_id: "u-1",
  status: "active",
  trigger_type: "manual",
  trigger_config: {},
  entry_node_id: "menu",
  fallback_policy: {},
  created_at: "2026-01-01T00:00:00Z",
};

function nodes(bookingNext = "thanks") {
  return [
    {
      flow_id: "flow-1",
      node_key: "menu",
      node_type: "send_buttons",
      config: {
        text: "What can we do?",
        buttons: [{ reply_id: "book", title: "Book", next_node_key: "booking" }],
      },
    },
    {
      flow_id: "flow-1",
      node_key: "booking",
      node_type: "start_booking",
      config: {
        booking_type_id: "bt-1",
        text: "Sure {{vars.name}}, which day suits you?",
        next_node_key: bookingNext,
      },
    },
    {
      flow_id: "flow-1",
      node_key: "thanks",
      node_type: "send_message",
      config: { text: "See you soon!", next_node_key: "done" },
    },
    { flow_id: "flow-1", node_key: "done", node_type: "end", config: {} },
  ];
}

function setup(opts: {
  currentNode?: string;
  bookingNext?: string;
  autoReply?: boolean;
  assignedAgent?: string | null;
} = {}) {
  h.tables = {
    flows: [structuredClone(FLOW)],
    flow_nodes: nodes(opts.bookingNext ?? "thanks"),
    flow_runs: [
      {
        id: "run-1",
        flow_id: "flow-1",
        account_id: "acct-1",
        user_id: "u-1",
        contact_id: "ct-1",
        conversation_id: "cv-1",
        status: "active",
        current_node_key: opts.currentNode ?? "menu",
        transition_seq: 0,
        vars: { name: "Asha", ignored: { nested: true } },
        reprompt_count: 0,
        started_at: new Date().toISOString(),
        last_advanced_at: new Date().toISOString(),
      },
    ],
    flow_run_events: [],
    messages: [],
    ai_configs: [
      {
        account_id: "acct-1",
        is_active: true,
        api_key: "enc",
        auto_reply_enabled: opts.autoReply ?? true,
        auto_reply_max_per_conversation: 10,
      },
    ],
    booking_types: [
      { id: "bt-1", account_id: "acct-1", is_active: true, archived_at: null },
    ],
    automations: [],
    conversations: [
      {
        id: "cv-1",
        status: "open",
        assigned_agent_id: opts.assignedAgent ?? null,
        ai_autoreply_disabled: false,
        ai_reply_count: 0,
      },
    ],
  };
}

const run = () => h.tables.flow_runs[0];
const conversation = () => h.tables.conversations[0];

function dispatch(message: ParsedInbound) {
  return dispatchInboundToFlows({
    accountId: "acct-1",
    userId: "u-1",
    contactId: "ct-1",
    conversationId: "cv-1",
    message,
    isFirstInboundMessage: false,
  });
}

const tapBook: ParsedInbound = {
  kind: "interactive_reply",
  reply_id: "book",
  reply_title: "Book",
  meta_message_id: "m-tap",
};

beforeEach(() => {
  h.sendText.mockClear();
});

describe("start_booking node", () => {
  it("is a suspending node", () => {
    expect(isSuspending("start_booking")).toBe(true);
  });

  it("sends the opening message and parks the run on the booking step", async () => {
    setup();
    const result = await dispatch(tapBook);

    expect(result).toMatchObject({ consumed: true, outcome: "advanced" });
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(h.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Sure Asha, which day suits you?" }),
    );
    expect(run()).toMatchObject({ status: "active", current_node_key: "booking" });
  });

  it("lets customer replies fall through to the AI while parked", async () => {
    setup({ currentNode: "booking" });
    const result = await dispatch({
      kind: "text",
      text: "Tomorrow at 5pm",
      meta_message_id: "m-1",
    });

    expect(result).toMatchObject({ consumed: false, outcome: "deferred_to_booking" });
    expect(h.sendText).not.toHaveBeenCalled();
    expect(run()).toMatchObject({ status: "active", current_node_key: "booking" });
    // No reprompt counting — the fallback policy never sees these.
    expect(run().reprompt_count).toBe(0);
  });

  it("treats a Meta retry of a deferred message as already handled", async () => {
    setup({ currentNode: "booking" });
    const msg: ParsedInbound = { kind: "text", text: "5pm", meta_message_id: "m-dup" };
    await dispatch(msg);
    const retry = await dispatch(msg);
    expect(retry).toMatchObject({ consumed: true, outcome: "duplicate_inbound_ignored" });
  });

  it("hands off to a human when the AI auto-reply is off", async () => {
    setup({ autoReply: false });
    const result = await dispatch(tapBook);

    expect(result).toMatchObject({ consumed: true, outcome: "handed_off" });
    expect(h.sendText).not.toHaveBeenCalled();
    expect(run()).toMatchObject({
      status: "handed_off",
      end_reason: "booking_ai_unavailable",
    });
    expect(conversation().status).toBe("pending");
  });

  it("hands off when an agent already owns the conversation", async () => {
    setup({ assignedAgent: "agent-1" });
    await dispatch(tapBook);
    expect(run()).toMatchObject({ status: "handed_off" });
  });

  it("hands off when a message-level automation would silence the AI", async () => {
    setup();
    h.tables.automations.push({
      id: "auto-1",
      account_id: "acct-1",
      is_active: true,
      trigger_type: "keyword_match",
    });
    await dispatch(tapBook);
    expect(run()).toMatchObject({ status: "handed_off" });
  });

  it("hands off when the account has no active booking types", async () => {
    setup();
    h.tables.booking_types[0].is_active = false;
    const result = await dispatch(tapBook);

    expect(result).toMatchObject({ consumed: true, outcome: "handed_off" });
    expect(h.sendText).not.toHaveBeenCalled();
    expect(run()).toMatchObject({
      status: "handed_off",
      end_reason: "booking_ai_unavailable",
    });
  });
});

describe("loadActiveBookingStep", () => {
  it("returns the focus for a run parked on a booking step", async () => {
    setup({ currentNode: "booking" });
    await expect(
      loadActiveBookingStep({ accountId: "acct-1", contactId: "ct-1" }),
    ).resolves.toEqual({
      flowRunId: "run-1",
      bookingTypeId: "bt-1",
      knownDetails: { name: "Asha" },
    });
  });

  it("returns null when the run is elsewhere", async () => {
    setup({ currentNode: "menu" });
    await expect(
      loadActiveBookingStep({ accountId: "acct-1", contactId: "ct-1" }),
    ).resolves.toBeNull();
  });
});

describe("settleBookingStep", () => {
  it("continues the flow from the next node once the booking is saved", async () => {
    setup({ currentNode: "booking" });
    await settleBookingStep({
      accountId: "acct-1",
      contactId: "ct-1",
      result: "booked",
      bookingId: "bk-1",
    });

    expect(h.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "See you soon!" }),
    );
    expect(run()).toMatchObject({ status: "completed", end_reason: "end_node" });
  });

  it("completes the run when the booking step has no next node", async () => {
    setup({ currentNode: "booking", bookingNext: "" });
    await settleBookingStep({ accountId: "acct-1", contactId: "ct-1", result: "booked" });

    expect(h.sendText).not.toHaveBeenCalled();
    expect(run()).toMatchObject({ status: "completed", end_reason: "booking_saved" });
  });

  it("ends the run as handed off when the AI hands the chat to a human", async () => {
    setup({ currentNode: "booking" });
    await settleBookingStep({ accountId: "acct-1", contactId: "ct-1", result: "handed_off" });
    expect(run()).toMatchObject({ status: "handed_off", end_reason: "booking_handoff" });
  });

  it("does nothing when the run is not on a booking step", async () => {
    setup({ currentNode: "menu" });
    await settleBookingStep({ accountId: "acct-1", contactId: "ct-1", result: "booked" });
    expect(run()).toMatchObject({ status: "active", current_node_key: "menu" });
    expect(h.sendText).not.toHaveBeenCalled();
  });
});

describe("bookingKnownDetails", () => {
  it("keeps short scalar vars only", () => {
    expect(
      bookingKnownDetails({ name: " Asha ", age: 31, empty: "", obj: { a: 1 }, list: [1] }),
    ).toEqual({ name: "Asha", age: "31" });
  });

  it("handles missing vars", () => {
    expect(bookingKnownDetails(null)).toEqual({});
  });
});
