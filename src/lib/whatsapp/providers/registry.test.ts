import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp/meta-api", () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: "wamid.text" })),
  sendMediaMessage: vi.fn(async () => ({ messageId: "wamid.media" })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: "wamid.tpl" })),
}));
vi.mock("@/lib/whatsapp/webhook-signature", () => ({
  verifyMetaWebhookSignature: vi.fn(() => true),
}));

import { sendTemplateMessage, sendTextMessage } from "@/lib/whatsapp/meta-api";
import { verifyMetaWebhookSignature } from "@/lib/whatsapp/webhook-signature";
import {
  getProviderAdapter,
  isProviderAvailable,
  PROVIDERS,
  ProviderNotAvailableError,
  providerInfo,
} from "./registry";

beforeEach(() => vi.clearAllMocks());

describe("provider registry", () => {
  it("defaults to Meta Cloud API for empty / legacy rows", () => {
    expect(getProviderAdapter(null).id).toBe("meta_cloud");
    expect(getProviderAdapter("").id).toBe("meta_cloud");
    expect(providerInfo(undefined).id).toBe("meta_cloud");
  });

  it("refuses planned providers instead of silently using Meta", () => {
    expect(() => getProviderAdapter("gupshup")).toThrow(ProviderNotAvailableError);
    expect(isProviderAvailable("gupshup")).toBe(false);
  });

  it("marks exactly the implemented providers as available", () => {
    for (const p of PROVIDERS) {
      expect(isProviderAvailable(p.id), p.id).toBe(p.status === "available");
    }
  });

  it("uses ids that satisfy the DB check from migration 061", () => {
    for (const p of PROVIDERS) expect(p.id).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
  });
});

describe("meta_cloud adapter", () => {
  const creds = { senderId: "pnid-1", accessToken: "tok" };

  it("maps sendText onto the Meta helper", async () => {
    const res = await getProviderAdapter("meta_cloud").sendText(creds, {
      to: "+919876543210",
      text: "Vanakkam",
      replyToMessageId: "wamid.prev",
    });
    expect(res.messageId).toBe("wamid.text");
    expect(sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: "pnid-1",
      accessToken: "tok",
      to: "+919876543210",
      text: "Vanakkam",
      contextMessageId: "wamid.prev",
    });
  });

  it("maps sendTemplate onto the Meta helper", async () => {
    await getProviderAdapter("meta_cloud").sendTemplate(creds, {
      to: "+91",
      templateName: "welcome",
      language: "ta",
      bodyParams: ["Arun"],
    });
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: "welcome", language: "ta", params: ["Arun"] }),
    );
  });

  it("verifies webhooks with the X-Hub-Signature-256 header", () => {
    const headers = new Headers({ "x-hub-signature-256": "sha256=abc" });
    expect(getProviderAdapter("meta_cloud").verifyWebhook("{}", headers)).toBe(true);
    expect(verifyMetaWebhookSignature).toHaveBeenCalledWith("{}", "sha256=abc");
  });
});
