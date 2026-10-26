import { metaCloudProvider } from "./meta-cloud";
import type { ProviderId, ProviderInfo, WhatsAppProviderAdapter } from "./types";

export const DEFAULT_PROVIDER: ProviderId = "meta_cloud";

/**
 * Every provider the Settings screen knows about. Only "available"
 * ones can be connected; "planned" ones are listed so the team can see
 * what's coming and so adding one is a code change, not a redesign.
 */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "meta_cloud",
    name: "Meta Cloud API",
    blurb: "Official WhatsApp Business Platform, hosted by Meta. No middleman fees.",
    status: "available",
    official: true,
    website: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    credentialFields: [
      { key: "phone_number_id", label: "Phone Number ID", required: true },
      { key: "waba_id", label: "WhatsApp Business Account ID", required: true },
      { key: "access_token", label: "Permanent access token", secret: true, required: true },
      { key: "verify_token", label: "Webhook verify token", required: true },
    ],
  },
  {
    id: "gupshup",
    name: "Gupshup",
    blurb: "Indian BSP with local billing and support.",
    status: "planned",
    official: false,
    website: "https://www.gupshup.io",
    credentialFields: [
      { key: "app_name", label: "App name", required: true },
      { key: "api_key", label: "API key", secret: true, required: true },
      { key: "source_number", label: "Source number", required: true },
    ],
  },
  {
    id: "interakt",
    name: "Interakt",
    blurb: "Indian BSP popular with small businesses.",
    status: "planned",
    official: false,
    website: "https://www.interakt.shop",
    credentialFields: [{ key: "api_key", label: "API key", secret: true, required: true }],
  },
  {
    id: "aisensy",
    name: "AiSensy",
    blurb: "Indian BSP focused on broadcasts and campaigns.",
    status: "planned",
    official: false,
    website: "https://aisensy.com",
    credentialFields: [{ key: "api_key", label: "API key", secret: true, required: true }],
  },
  {
    id: "twilio",
    name: "Twilio",
    blurb: "Global CPaaS; WhatsApp alongside SMS and voice.",
    status: "planned",
    official: false,
    website: "https://www.twilio.com/whatsapp",
    credentialFields: [
      { key: "account_sid", label: "Account SID", required: true },
      { key: "auth_token", label: "Auth token", secret: true, required: true },
      { key: "from_number", label: "WhatsApp sender", required: true },
    ],
  },
  {
    id: "dialog360",
    name: "360dialog",
    blurb: "Low-cost BSP passing through Meta's Cloud API.",
    status: "planned",
    official: false,
    website: "https://www.360dialog.com",
    credentialFields: [{ key: "api_key", label: "D360 API key", secret: true, required: true }],
  },
];

const ADAPTERS: Partial<Record<ProviderId, WhatsAppProviderAdapter>> = {
  meta_cloud: metaCloudProvider,
};

export function providerInfo(id: string | null | undefined): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export class ProviderNotAvailableError extends Error {
  constructor(public readonly providerId: string) {
    super(`WhatsApp provider "${providerId}" is not available in this build`);
    this.name = "ProviderNotAvailableError";
  }
}

/**
 * Adapter for a stored provider id. Null/empty means the default (Meta),
 * matching the column default for rows saved before migration 061.
 * Throws for a provider that is listed but not implemented yet, so a
 * misconfigured account fails loudly instead of sending through Meta.
 */
export function getProviderAdapter(id: string | null | undefined): WhatsAppProviderAdapter {
  const key = (id || DEFAULT_PROVIDER) as ProviderId;
  const adapter = ADAPTERS[key];
  if (!adapter) throw new ProviderNotAvailableError(key);
  return adapter;
}

export function isProviderAvailable(id: string): boolean {
  return !!ADAPTERS[id as ProviderId];
}
