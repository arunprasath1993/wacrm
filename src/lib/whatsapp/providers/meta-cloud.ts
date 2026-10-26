import {
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
} from "@/lib/whatsapp/meta-api";
import { verifyMetaWebhookSignature } from "@/lib/whatsapp/webhook-signature";
import type { WhatsAppProviderAdapter } from "./types";

/**
 * Meta WhatsApp Cloud API — the official provider and the default.
 * A thin adapter over the existing, battle-tested meta-api helpers, so
 * behaviour is identical to calling them directly.
 */
export const metaCloudProvider: WhatsAppProviderAdapter = {
  id: "meta_cloud",

  async sendText(creds, { to, text, replyToMessageId }) {
    return sendTextMessage({
      phoneNumberId: creds.senderId,
      accessToken: creds.accessToken,
      to,
      text,
      contextMessageId: replyToMessageId,
    });
  },

  async sendMedia(creds, { to, kind, link, caption, filename, replyToMessageId }) {
    return sendMediaMessage({
      phoneNumberId: creds.senderId,
      accessToken: creds.accessToken,
      to,
      kind,
      link,
      caption,
      filename,
      contextMessageId: replyToMessageId,
    });
  },

  async sendTemplate(creds, { to, templateName, language, bodyParams }) {
    return sendTemplateMessage({
      phoneNumberId: creds.senderId,
      accessToken: creds.accessToken,
      to,
      templateName,
      language,
      params: bodyParams,
    });
  },

  verifyWebhook(rawBody, headers) {
    return verifyMetaWebhookSignature(rawBody, headers.get("x-hub-signature-256"));
  },
};
