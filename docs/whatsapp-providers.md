# WhatsApp API providers

This fork sends through **one provider per account**, stored in
`whatsapp_config.provider` (migration `061_whatsapp_provider.sql`).

| id | Provider | Status |
| --- | --- | --- |
| `meta_cloud` | Meta Cloud API (official) | **In use** — default for every account |
| `gupshup` | Gupshup | Planned |
| `interakt` | Interakt | Planned |
| `aisensy` | AiSensy | Planned |
| `twilio` | Twilio | Planned |
| `dialog360` | 360dialog | Planned |

Settings → WhatsApp shows this list. Planned providers are visible but
cannot be selected until an adapter exists.

## Code layout

```
src/lib/whatsapp/providers/
  types.ts       WhatsAppProviderAdapter interface + ProviderInfo
  meta-cloud.ts  Adapter over src/lib/whatsapp/meta-api.ts
  registry.ts    PROVIDERS list, getProviderAdapter(id)
```

`getProviderAdapter(null | "")` returns Meta, matching the column
default for rows saved before 061. A listed-but-unimplemented id throws
`ProviderNotAvailableError` rather than quietly sending through Meta.

## Adding a provider (e.g. Gupshup)

1. **Adapter** — create `providers/gupshup.ts` implementing
   `sendText`, `sendMedia`, `sendTemplate` and `verifyWebhook`. Return
   the provider's message id as `messageId` so delivery/read receipts can
   be matched to `messages.whatsapp_message_id`.
2. **Register** — add it to `ADAPTERS` in `registry.ts` and set its
   `status` to `"available"`. The registry test fails if the two
   disagree.
3. **Credentials** — store the provider secret encrypted exactly like
   the Meta token (`src/lib/whatsapp/encryption.ts`), in
   `whatsapp_config.access_token`; put non-secret extras in new columns
   or a JSON column.
4. **Webhook** — add `src/app/api/whatsapp/webhook/<id>/route.ts` that
   verifies with the adapter and converts the provider payload into the
   same inserts the Meta webhook performs (messages, statuses).
5. **Call sites** — the send helpers (`send-message.ts`,
   `broadcast-core.ts`, `automations/meta-send.ts`, `flows/meta-send.ts`)
   call `meta-api.ts` directly today. Route them through
   `getProviderAdapter(config.provider)` as part of the same change, and
   keep the Meta path's tests green.
6. **Templates** — most BSPs proxy Meta template approval; map their
   template list into `message_templates` so broadcasts keep working.

The CRM's other features (contacts, apps, pipelines, automations, AI)
don't care which provider sent a message, so nothing else changes.
