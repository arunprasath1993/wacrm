/**
 * WhatsApp API provider abstraction.
 *
 * The CRM talks to WhatsApp through ONE provider per account
 * (`whatsapp_config.provider`, migration 061). Today that is Meta's
 * official Cloud API; BSPs such as Gupshup, Interakt, AiSensy, Twilio
 * or 360dialog can be added later by implementing this interface and
 * registering the adapter — callers keep using the same calls.
 *
 * Adding a provider (see docs/whatsapp-providers.md):
 *   1. Implement `WhatsAppProviderAdapter` in providers/<id>.ts.
 *   2. Register it in registry.ts and flip `status` to "available".
 *   3. Add its credential fields to `credentialFields` so Settings →
 *      WhatsApp can render the form.
 *   4. Route its inbound webhook to /api/whatsapp/webhook/<id> and
 *      normalise payloads with `parseInbound`.
 */

export type ProviderId =
  | "meta_cloud"
  | "gupshup"
  | "interakt"
  | "aisensy"
  | "twilio"
  | "dialog360";

export type ProviderStatus = "available" | "planned";

export interface ProviderCredentials {
  /** Provider's id for the sending number (Meta: Phone Number ID). */
  senderId: string;
  /** Decrypted secret used to authenticate sends. */
  accessToken: string;
  /** Provider-specific extras (Meta: WABA id, app id …). */
  extra?: Record<string, string | undefined>;
}

export interface SendResult {
  /** Provider message id, used to match delivery/read receipts. */
  messageId: string;
}

export type ProviderMediaKind = "image" | "video" | "document" | "audio";

export interface WhatsAppProviderAdapter {
  id: ProviderId;
  sendText(
    creds: ProviderCredentials,
    args: { to: string; text: string; replyToMessageId?: string },
  ): Promise<SendResult>;
  sendMedia(
    creds: ProviderCredentials,
    args: {
      to: string;
      kind: ProviderMediaKind;
      link: string;
      caption?: string;
      filename?: string;
      replyToMessageId?: string;
    },
  ): Promise<SendResult>;
  sendTemplate(
    creds: ProviderCredentials,
    args: { to: string; templateName: string; language?: string; bodyParams?: string[] },
  ): Promise<SendResult>;
  /** True when an inbound webhook request is authentic. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** One line on what it is / why you'd pick it. */
  blurb: string;
  status: ProviderStatus;
  official: boolean;
  website: string;
  credentialFields: CredentialField[];
}
