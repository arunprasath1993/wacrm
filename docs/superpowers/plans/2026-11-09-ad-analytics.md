# Ad Analytics (Meta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture Click-to-WhatsApp referral data with first-touch attribution, sync Meta ad spend, and show an Ad Analytics page (Overview + Facebook / Instagram / WhatsApp tabs) with spend → enquiries → bookings → won deals → revenue.

**Architecture:** Phase 1 ships capture alone (migration 069, referral stored on the message row, `contact_touches` + atomic `record_contact_touch`, debug-log referral fields) so no referral is lost while FB/IG URL patterns are confirmed. Phase 2 syncs Meta spend into local tables, triggered from code only (instrumentation timer, stale-on-open, Sync now). Phase 3 adds raw SQL report rows (migration 070) and a pure TS report builder (allocation, rollups, metrics) feeding the page.

**Tech Stack:** Next.js 16.3.8 (App Router, `after()`, `output: "standalone"`), Supabase (Postgres + RLS, supabase-js 2), Vitest 5, next-intl, recharts 3, lucide-react, shadcn UI components in `src/components/ui`.

**Spec:** `docs/superpowers/specs/2026-11-08-ad-analytics-design.md` (approved 2026-11-09). Read it alongside this plan; section refs below (§n) point into it.

## Global Constraints

- Branch `feature/10-ad-analytics`; push to the `nixie` remote; never merge to main without the owner saying so.
- Node ≥ 22.12; commands: `npm test` (vitest run), `npm run lint`, `npm run typecheck`.
- Graph API base `https://graph.facebook.com/v21.0` (same as `src/lib/whatsapp/meta-api.ts`); confirm v21.0 is still supported before Phase 2 ships, bump in one constant if not.
- Migrations: `069_ad_analytics.sql` (Phase 1, everything except report functions), `070_ad_analytics_report.sql` (Phase 3). Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`). Deviation from spec "069 only": report functions land in 070 because 069 is applied in production at Checkpoint A.
- Tenancy: every new table has `account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE`, RLS on, policies via `is_account_member(account_id[, min_role])` (migration 017).
- Internal SECURITY DEFINER functions: `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role` (migration 044 convention).
- Tokens encrypted with `encrypt`/`decrypt` from `@/lib/whatsapp/encryption`; never sent to the browser; never logged.
- Server routes use `getCurrentAccount()` / `requireRole('admin')` / `toErrorResponse` from `@/lib/auth/account`, and `supabaseAdmin()` from `@/lib/automations/admin-client` for privileged writes.
- UI strings via next-intl; add keys to `messages/en.json` and the same English text to `es.json`, `ko.json`, `pt.json`.
- No Hostinger hPanel cron or other manual server config (owner requirement).
- Thresholds (spec §3, Claude's calls): timer every 30 min, syncs accounts stale > 6 h; stale-on-open > 3 h; first backfill `backfill_days` default 90; later syncs re-pull last 3 days + gap; lock stale after 15 min; failure backoff 1 h.
- Unknown bucket label exactly "Meta (unknown placement)"; spend-only row "Other Meta placements"; post row "No ad (organic post)"; approx label "≈ approx".

## Review Focus

1. **Referral on a non-text message** (customer taps the ad and sends an image / voice note / sticker): the referral must still be stored and the touch recorded. → test in Task 5.
2. **Graph rate limit or token revoked mid-backfill** (error code 4 / 17 / 80004 / 190 on page 3 of insights): lock cleared, `last_sync_error` friendly, `last_synced_at` NOT advanced, rows already upserted kept. → test in Task 8.
3. **Date range with spend but zero enquiries, or enquiries but zero spend**: every ratio shows "—", no NaN / Infinity, rows still listed. → test in Task 11.
4. **Contact deleted after converting** (touches cascade away, deals/bookings may remain with that contact gone): report rows must not crash or double count; that contact simply disappears from the cohort. → test in Task 11 (builder input without the contact) and SQL check in Task 10.
5. **Never-connected account / non-admin viewer**: page renders the "connect in Settings" empty state for admins and a neutral empty state for non-admins, with no 500 and no token-bearing fields in any response. → test in Task 12.

---

## Phase 1 — Capture (deployable alone)

### Task 1: Debug log records referral fields

**Files:**
- Modify: `src/lib/whatsapp/webhook-inbound-log.ts` (`summarizeWebhook`, ~lines 65-96)
- Test: `src/lib/whatsapp/webhook-inbound-log.test.ts` (create if absent)

**Interfaces:**
- Produces: unchanged `summarizeWebhook(body: unknown, signatureOk: boolean): InboundLogRow[]`; `detail` gains `; referral[<message id>]=source_type:<t>|source_id:<id>|source_url:<url>` per message that carries a `referral` (messages from `value.messages` or `extractStandbyInbound`).

- [ ] **Step 1: Write failing tests**
  - `it('appends referral fields to detail for a message with referral')`: payload with one message `{ id: 'wamid.1', type: 'text', referral: { source_type: 'ad', source_id: '120', source_url: 'https://fb.me/abc' } }` → `rows[0].detail` contains `referral[wamid.1]=source_type:ad|source_id:120|source_url:https://fb.me/abc`, and still starts with the sorted value keys.
  - `it('leaves detail unchanged when no message has a referral')`.
  - `it('reads referral from standby-delivered messages')`.
- [ ] **Step 2:** `npx vitest run src/lib/whatsapp/webhook-inbound-log.test.ts` → FAIL.
- [ ] **Step 3: Implement** inside the existing loop; keep the key list first, append referral segments joined by `; `. Fix the file's doc comment (it records keys of each change's `value`).
- [ ] **Step 4:** re-run → PASS.
- [ ] **Step 5: Commit** `feat(webhook): log referral fields in debug inbound log`

### Task 2: Migration 069 (attribution + ads tables)

**Files:**
- Create: `supabase/migrations/069_ad_analytics.sql`
- Create: `supabase/manual-tests/069_ad_analytics.test.sql` (psql behaviour checks, style of `060_crm_apps.test.sql`)
- Create: `src/lib/ads/migration-069.test.ts` (static checks on the SQL text, style of `src/lib/auth/redeem-invitation-migration.test.ts`)

**Interfaces (Produces, used by Tasks 4, 5, 8, 9, 10):**
- `messages.referral jsonb NULL`; partial index `idx_messages_referral ON messages(conversation_id) WHERE referral IS NOT NULL`.
- `contact_touches(id uuid pk, account_id, contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, conversation_id uuid NULL REFERENCES conversations(id) ON DELETE SET NULL, message_id text NULL, touched_at timestamptz NOT NULL, source_type text CHECK IN ('ad','post','direct','pre_existing'), platform text NULL CHECK IN ('facebook','instagram','whatsapp','unknown'), ad_id text NULL, ctwa_clid text NULL, headline text NULL, referral jsonb NULL, created_at)`; unique index `(account_id, message_id) WHERE message_id IS NOT NULL`; index `(contact_id, touched_at)`. RLS: select for members; no write policies (service role only).
- `contacts` + `first_touch_id uuid NULL REFERENCES contact_touches(id) ON DELETE SET NULL`, `first_touch_at timestamptz`, `first_touch_source_type text`, `first_touch_platform text`, `first_touch_ad_id text`; index `(account_id, first_touch_source_type, first_touch_at)`.
- `recompute_contact_first_touch(p_account_id uuid, p_contact_id uuid) RETURNS void` — sets `first_touch_*` to the contact's touch ordered by `touched_at, (source_type rank: ad 0, post 1, direct 2, pre_existing 3), id`; NULLs all five if none.
- `record_contact_touch(p_account_id uuid, p_contact_id uuid, p_conversation_id uuid, p_message_id text, p_touched_at timestamptz, p_source_type text, p_platform text, p_ad_id text, p_ctwa_clid text, p_headline text, p_referral jsonb) RETURNS uuid` (touch id, existing id on conflict) — `SELECT 1 FROM contacts WHERE id = p_contact_id AND account_id = p_account_id FOR UPDATE` (raise if not found), insert `ON CONFLICT DO NOTHING`, then `recompute_contact_first_touch`.
- Both functions SECURITY DEFINER, `SET search_path = public`, revoke/grant per Global Constraints.
- Backfill: one `pre_existing` touch per contact with ≥1 `messages` row `sender_type = 'customer'` (via `conversations.contact_id`) and no existing touch; `touched_at = COALESCE(contacts.created_at, earliest customer message created_at)`; then recompute. Written as a re-runnable block (`NOT EXISTS` guard) and also wrapped as `backfill_pre_existing_touches() RETURNS integer` (service_role only) for the post-deploy re-run.
- `merge_duplicate_contacts`: `CREATE OR REPLACE` with its current body (copy from the latest definition in migrations 022/044) plus `UPDATE contact_touches SET contact_id = <survivor> WHERE contact_id = <loser>` before the loser is deleted, then `recompute_contact_first_touch` for the survivor. Keep its existing grants.
- `meta_ads_config(account_id uuid PRIMARY KEY, ad_account_id text NOT NULL CHECK (ad_account_id ~ '^act_[0-9]+$'), access_token text NULL, currency text, timezone text, backfill_days int NOT NULL DEFAULT 90 CHECK BETWEEN 1 AND 1095, last_synced_at, last_sync_error text, last_sync_failed_at, sync_started_at, created_at, updated_at)`. RLS select/insert/update/delete: `is_account_member(account_id, 'admin')`.
- `meta_ad_entities(account_id, ad_id text, ad_name, adset_id, adset_name, campaign_id, campaign_name, effective_status, updated_at; PRIMARY KEY (account_id, ad_id))`. RLS select for members.
- `meta_ad_insights_daily(account_id, date date, ad_id text, publisher_platform text, spend numeric(14,2) NOT NULL DEFAULT 0, impressions bigint, clicks bigint, meta_conversations int NOT NULL DEFAULT 0; PRIMARY KEY (account_id, date, ad_id, publisher_platform))`. RLS select for members.
- `get_meta_ads_status(p_account_id uuid) RETURNS TABLE(connected boolean, ad_account_id text, currency text, timezone text, last_synced_at timestamptz, last_sync_error text, syncing boolean)` — SECURITY DEFINER, raises unless `is_account_member(p_account_id)`; `syncing = sync_started_at > now() - interval '15 minutes'`; never returns `access_token`. GRANT EXECUTE to authenticated (it checks membership itself) and service_role.
- Last statement: `NOTIFY pgrst, 'reload schema';`

- [ ] **Step 1: Write failing static tests** (`migration-069.test.ts`): file exists; contains `REVOKE ALL ON FUNCTION public.record_contact_touch` and `GRANT EXECUTE ON FUNCTION public.record_contact_touch(...) TO service_role` (same for `recompute_contact_first_touch`, `backfill_pre_existing_touches`); `FOR UPDATE` inside `record_contact_touch`; `get_meta_ads_status` body does not mention `access_token`; every `CREATE TABLE` has `ENABLE ROW LEVEL SECURITY`; ends with `NOTIFY pgrst`.
- [ ] **Step 2:** `npx vitest run src/lib/ads/migration-069.test.ts` → FAIL.
- [ ] **Step 3: Write the migration** per the interface list.
- [ ] **Step 4: Write `069_ad_analytics.test.sql`** checks (each RAISEs on failure, final line prints `AD ANALYTICS 069 OK`):
  1. contact with a customer message → one `pre_existing` touch and `first_touch_source_type = 'pre_existing'`; contact with no messages → no touch.
  2. `record_contact_touch` direct at T2 then ad at T1 < T2 → first touch is the ad; ad at T3 > T2 → stays direct.
  3. same `p_message_id` twice → one row, same id returned.
  4. wrong `p_account_id` for contact → raises.
  5. as role `authenticated`: calling `record_contact_touch` → permission denied; `select * from meta_ads_config` as an agent → 0 rows; `get_meta_ads_status` for another account → raises.
  6. merge two contacts with touches → survivor owns all touches, first touch recomputed.
  7. `backfill_pre_existing_touches()` run twice → second run returns 0.
- [ ] **Step 5:** `npx vitest run src/lib/ads/migration-069.test.ts` → PASS. If Docker is available: `npx supabase db reset` then `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/manual-tests/069_ad_analytics.test.sql` → `AD ANALYTICS 069 OK`. If not, note it for CI (`migrations.yml` replays every migration on PR).
- [ ] **Step 6: Commit** `feat(db): migration 069 ad attribution and Meta ads tables`

### Task 3: `classifyReferral`

**Files:**
- Create: `src/lib/ads/types.ts`, `src/lib/ads/classify.ts`
- Test: `src/lib/ads/classify.test.ts`

**Interfaces (Produces):**
```ts
// types.ts
export type Platform = 'facebook' | 'instagram' | 'whatsapp' | 'unknown'
export type TouchSourceType = 'ad' | 'post' | 'direct' | 'pre_existing'
export interface WaReferral {
  source_url?: string; source_id?: string; source_type?: string
  headline?: string; body?: string; media_type?: string
  image_url?: string; video_url?: string; thumbnail_url?: string
  ctwa_clid?: string; welcome_message?: { text?: string }
}
export interface ClassifiedReferral { sourceType: 'ad' | 'post'; platform: Platform; adId: string | null }
// classify.ts
export const PLATFORM_PATTERNS: ReadonlyArray<{ host: RegExp; platform: Exclude<Platform, 'unknown'> }>
export function classifyReferral(referral: WaReferral): ClassifiedReferral
```
- `PLATFORM_PATTERNS` starts **empty** with a comment: fill only from captured payloads at Checkpoint A (spec §2 platform rule). Matching is on `new URL(source_url).hostname`; first match wins; invalid / missing URL → `unknown`.
- `sourceType`: `'ad'` only when `source_type === 'ad'` and `source_id` non-empty; everything else (post, missing, unrecognised, ad without id) → `'post'`. `adId = source_id` only for `'ad'`.

- [ ] **Step 1: Write failing tests**: ad with id → `{ sourceType: 'ad', adId: '120', platform: 'unknown' }` (patterns empty); `source_type: 'post'` → post, adId null; missing source_type → post; `source_type: 'ad'` without source_id → post; invalid URL → unknown; with a test-injected pattern list (export `classifyReferralWith(referral, patterns)` used by `classifyReferral`): `www.instagram.com` → instagram, `m.facebook.com` → facebook, a host in two entries for different platforms → unknown (shared pattern rule).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(ads): classifyReferral with confirmed-pattern rule`

### Task 4: `recordTouch` + self-heal

**Files:**
- Create: `src/lib/ads/record-touch.ts`
- Test: `src/lib/ads/record-touch.test.ts`

**Interfaces:**
- Consumes: `record_contact_touch` RPC (Task 2), `classifyReferral` (Task 3).
- Produces:
```ts
export interface TouchInput {
  accountId: string; contactId: string; conversationId: string
  messageId: string            // Meta wamid
  touchedAt: string            // ISO; pass the webhook's existing `receivedAt` (Meta timestamp, route.ts ~762)
  referral: WaReferral | null
}
export async function recordTouch(db: SupabaseClient, input: TouchInput): Promise<void>
export async function healMissingTouches(db: SupabaseClient, accountId: string, contactId: string): Promise<number>
```
- `recordTouch`: referral → classify → `rpc('record_contact_touch', …)` with `p_touched_at = input.touchedAt`. No referral → read `contacts.first_touch_source_type`; if NULL or `'direct'` → `healMissingTouches`; then if still NULL → rpc with `p_source_type 'direct'`, platform/ad null. Never throws (catch, `console.error('[ads] recordTouch failed', code)`).
- `healMissingTouches`: select customer messages with `referral` not null for the contact (join `conversations!inner(contact_id, account_id)`, `sender_type = 'customer'`), minus message ids already in `contact_touches` for that account; rpc each with the message's `created_at` as `touched_at` (confirmed: the webhook writes `created_at: receivedAt`, Meta's timestamp) and its `message_id` (wamid). Returns number healed.

- [ ] **Step 1: Write failing tests** with a mocked client (`rpc` spy + chainable `from` stub, or extend `src/lib/bookings/test-db.ts` pattern): referral message → rpc called once with `p_source_type 'ad'`, `p_touched_at` = input `touchedAt`; plain message, first touch NULL, no stored referrals → rpc `direct`; plain message, first touch NULL, one stored referral without touch → rpc for that referral first, then (first touch now set) no direct; plain message, first touch `'ad'` → no rpc, no heal query; rpc error → resolves, logs, no throw.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(ads): recordTouch with self-heal`

### Task 5: Webhook stores referral and records touches

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts` (`WhatsAppMessage` ~line 64; messages upsert ~772-800; replay check ~808)
- Test: `src/app/api/whatsapp/webhook/route.test.ts`

**Interfaces:**
- Consumes: `recordTouch` (Task 4), `WaReferral` (Task 3).
- Produces: `messages.referral` populated (fallback retry is on **any** upsert error while referral is set, so no column-error classifier is needed).

- [ ] **Step 1: Write failing tests** (extend existing mocks):
  - text message with `referral` → upsert payload contains `referral`, `recordTouch` called with that referral and the conversation's contact/account.
  - **image** message with `referral` → same (Review Focus 1).
  - upsert with referral returns `{ error: { code: 'PGRST204' } }` → second upsert without `referral` succeeds, message processed normally, warning logged.
  - upsert with referral returns `{ error: { code: '22P02' } }` (non-column) → also retried without referral.
  - upsert without referral errors → behaves exactly as today (`insert_failed`), no retry.
  - replay (empty `insertedRows`) with referral → `recordTouch` still called, result is `duplicate`, no downstream fan-out.
  - plain message → `recordTouch` called with `referral: null`.
  - standby-delivered message with referral → captured.
  - `recordTouch` rejecting → message outcome unchanged.
- [ ] **Step 2:** `npx vitest run src/app/api/whatsapp/webhook/route.test.ts` → new tests FAIL.
- [ ] **Step 3: Implement**: add `referral?: WaReferral` to `WhatsAppMessage`; include `referral: message.referral ?? null` only when present; on error with referral set, `console.warn('[webhook] message upsert with referral failed, retrying without', code)` and retry once without it; call `await recordTouch(supabaseAdmin(), …)` right after a successful upsert, **before** the `insertedRows` duplicate return (inside the existing `after()` processing, wrapped so it can't throw).
- [ ] **Step 4:** run the file → PASS; `npm test` → all green.
- [ ] **Step 5: Commit** `feat(webhook): store referral and record attribution touches`

### Checkpoint A — owner deploy + pattern capture (manual, not a code task)

1. Apply 068 if still pending, then 069 in Supabase SQL editor. Deploy branch build to Hostinger (owner decides whether to merge to main first). Run `select backfill_pre_existing_touches();` once after the deploy.
2. Set `WEBHOOK_DEBUG_LOG=true`, click one real FB ad and one real IG ad (and a WhatsApp Status ad if running) from a test phone, send a message.
3. `select received_at, detail from webhook_inbound_log where detail like '%referral[%' order by received_at desc;` — paste results into the session.
4. Turn the flag off; `truncate webhook_inbound_log;`.

### Task 6: Confirmed platform patterns + reclassification

**Files:**
- Modify: `src/lib/ads/classify.ts` (`PLATFORM_PATTERNS` + comment citing the captured `source_url` examples)
- Create: `src/lib/ads/reclassify.ts`
- Test: `src/lib/ads/classify.test.ts`, `src/lib/ads/reclassify.test.ts`

**Interfaces:**
- Produces: `export async function reclassifyUnknownTouches(db: SupabaseClient, accountId: string): Promise<number>` — for touches with `platform = 'unknown'` and `referral` not null, re-run `classifyReferral`; if the platform changed, update the touch and call `rpc('recompute_contact_first_touch', …)`. Called at the start of every sync (Task 8), so no manual step.

- [ ] **Step 1:** add tests with the **real captured URLs**: each maps as observed; any host seen for two platforms → `unknown`. reclassify test: unknown touch whose URL now matches → updated + recompute called; still unknown → untouched.
- [ ] **Step 2:** run → FAIL. **Step 3:** fill patterns, implement reclassify. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(ads): confirmed referral platform patterns and reclassification`

> If the captured URLs do not distinguish FB from IG, `PLATFORM_PATTERNS` keeps only the unique ones (possibly none) and the §6 fallback allocation in Task 11 carries the split. Do not guess.

## Phase 2 — Meta sync

### Task 7: Graph client helpers

**Files:**
- Create: `src/lib/ads/graph.ts`
- Test: `src/lib/ads/graph.test.ts`

**Interfaces (Produces):**
```ts
export const GRAPH_BASE = 'https://graph.facebook.com/v21.0'
export class GraphError extends Error { code?: number; subcode?: number; type?: string; fbtraceId?: string }
export function redactGraphUrl(url: string): string            // strips access_token, appsecret_proof, after, before
export function friendlySyncError(err: unknown): string         // sanitised text for last_sync_error
export async function graphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T>
export async function graphGetAll<T>(path: string, params: Record<string, string>, token: string, onPage?: () => Promise<void>): Promise<T[]>
```
- `friendlySyncError` mapping: code 190 → "Meta token expired or invalid. Update it in Settings → Meta Ads."; 10 / 200 / 294 → "This token needs the ads_read permission and access to this ad account."; 100 with "ad account" → "Ad account not found. Check the Ad Account ID."; 4 / 17 / 80004 / 613 → "Meta rate limit reached. Will retry automatically."; anything else → "Meta sync failed (error <code or 'network'>)." Never includes URLs or response bodies.
- `graphGetAll` follows `paging.next`, calls `onPage` after each page (heartbeat hook), logs only `redactGraphUrl` output and error code/type/fbtrace_id.

- [ ] **Step 1: Write failing tests** with `vi.stubGlobal('fetch', …)`: redaction removes token/cursors and keeps path + other params; each mapping above; a thrown error whose message contains `access_token=SECRET` → friendly text has no `SECRET`; pagination over 3 pages calls `onPage` 3 times and concatenates `data`; console spy never sees `SECRET`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(ads): Graph client with redaction and friendly errors`

### Task 8: `syncMetaAds`

**Files:**
- Create: `src/lib/ads/meta-sync.ts`, `src/lib/ads/sweep.ts`
- Test: `src/lib/ads/meta-sync.test.ts`, `src/lib/ads/sweep.test.ts`

**Interfaces:**
- Consumes: Task 7 helpers, Task 6 `reclassifyUnknownTouches`, Task 4 `healMissingTouches`, tables from Task 2.
- Produces:
```ts
export type SyncResult = { status: 'ok' | 'locked' | 'failed' | 'not_configured'; error?: string }
export async function syncMetaAds(db: SupabaseClient, accountId: string, opts?: { now?: Date }): Promise<SyncResult>
export function isSyncDue(cfg: { last_synced_at: string | null; last_sync_failed_at: string | null }, maxAgeHours: number, now: Date, ignoreBackoff?: boolean): boolean
export function insightsRange(cfg: { last_synced_at: string | null; backfill_days: number }, now: Date, timeZone: string): { since: string; until: string }
export async function sweepLostTouches(db: SupabaseClient, accountId: string, limit?: number): Promise<number>   // default limit 200
```
- `db` is always the service-role client. Steps (spec §3): claim lock (update … returning; none → `locked`); resolve token (`meta_ads_config.access_token` else `whatsapp_config.access_token`, decrypt); `GET /{act}?fields=currency,timezone_name` → store; `/ads` (fields per spec, all pages) upsert entities; `/insights` (fields incl. names, `level=ad`, `time_increment=1`, `breakdowns=publisher_platform`, `time_range` from `insightsRange`) upsert daily rows (spend number, `meta_conversations` = value of action `onsite_conversion.messaging_conversation_started_7d` or 0) and upsert entity names from the rows; heartbeat `sync_started_at = now()` via `onPage`; then `reclassifyUnknownTouches` and `sweepLostTouches`; success → `last_synced_at = now`, clear error + failed_at; failure → `friendlySyncError`, `last_sync_failed_at = now`; `finally` clear `sync_started_at`.
- `insightsRange`: dates in the ad account's time zone; first sync `since = today − backfill_days`; else `since = min(today − 3, date(last_synced_at) − 1)`; `until = today`.
- `isSyncDue`: true when `last_synced_at` is NULL or older than `maxAgeHours`, and (unless `ignoreBackoff`) `last_sync_failed_at` is NULL or older than 1 h.
- `sweepLostTouches`: same query as `healMissingTouches` but account-wide, bounded by `limit`, grouped per contact.

- [ ] **Step 1: Write failing tests** (mock fetch + fake db): lock held → `locked`, no fetch; no config → `not_configured`; happy path with 2 insight pages → rows upserted, entity names from insights, heartbeat written twice, `last_synced_at` set; error on page 2 (code 17, Review Focus 2) → status `failed`, `last_sync_error` = rate-limit text, `last_synced_at` unchanged, `sync_started_at` cleared, page-1 rows kept; separate token preferred over WhatsApp token; `isSyncDue` table (NULL → due; 2 h old with 6 h → not due; failed 30 min ago → not due; failed 30 min ago with ignoreBackoff → due); `insightsRange` first sync 90 days, incremental gap, IST time zone boundary; sweep records touches for orphan referrals up to the limit.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(ads): Meta spend sync with lock, heartbeat, backoff and sweep`

### Task 9: Sync triggers and Meta Ads API routes

**Files:**
- Create: `src/instrumentation.ts`, `src/lib/ads/scheduler.ts`
- Create: `src/app/api/ads/config/route.ts` (GET admin config view, PUT save), `src/app/api/ads/test/route.ts` (POST), `src/app/api/ads/sync/route.ts` (POST), `src/app/api/ads/status/route.ts` (GET)
- Test: `src/lib/ads/scheduler.test.ts`, `src/app/api/ads/config/route.test.ts`, `src/app/api/ads/sync/route.test.ts`, `src/app/api/ads/status/route.test.ts`

**Interfaces:**
- Consumes: `syncMetaAds`, `isSyncDue` (Task 8), `graphGet`, `friendlySyncError` (Task 7), `get_meta_ads_status` (Task 2).
- Produces:
```ts
// types.ts (add)
export interface MetaAdsStatus { connected: boolean; ad_account_id: string | null; currency: string | null; timezone: string | null;
  last_synced_at: string | null; last_sync_error: string | null; syncing: boolean }
// scheduler.ts
export async function runDueSyncs(db: SupabaseClient, now?: Date): Promise<void>   // all configured accounts, isSyncDue(cfg, 6, now)
export function startAdsScheduler(): void                                         // idempotent via globalThis.__adsSchedulerStarted; setInterval 30 min; first run after 60 s
export async function testMetaConnection(adAccountId: string, token: string): Promise<{ ok: true; name: string; currency: string; timezone: string } | { ok: false; error: string }>
```
- `instrumentation.ts`: `export async function register() { if (process.env.NEXT_RUNTIME === 'nodejs') (await import('@/lib/ads/scheduler')).startAdsScheduler() }`.
- Routes (all JSON, errors via `toErrorResponse`):
  - `GET /api/ads/status` — any member: returns `get_meta_ads_status(accountId)` row; never `access_token`.
  - `GET /api/ads/config` — admin: `{ ad_account_id, uses_whatsapp_token: access_token IS NULL, backfill_days }`.
  - `POST /api/ads/test` — admin: body `{ ad_account_id, token? }`; token absent → WhatsApp token; returns `testMetaConnection` result.
  - `PUT /api/ads/config` — admin: body `{ ad_account_id, token?: string | null, use_whatsapp_token: boolean, backfill_days }`; validates `^act_\d+$` and 1-1095; **re-runs `testMetaConnection` server-side**, 400 with its error if not ok; upserts (encrypt token or set NULL), stores currency/timezone; then `after(() => syncMetaAds(admin, accountId))`; returns 200 `{ ok: true }`.
  - `POST /api/ads/sync` — admin: claims via `syncMetaAds` in `after()`; responds 202 `{ status: 'started' }` or 200 `{ status: 'already_syncing' }` when status shows `syncing`.

- [ ] **Step 1: Write failing tests**: scheduler calls sync only for due accounts and not twice when `startAdsScheduler` is called twice; status route as agent → 200 without `access_token` key; config GET/PUT as agent → 403; PUT with bad id → 400; PUT when test fails → 400 friendly error, nothing saved; PUT ok → encrypted token saved, `after` scheduled; sync POST as agent → 403; sync POST when syncing → `already_syncing`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(ads): in-app sync scheduler and Meta Ads API routes`

### Task 10: Settings → Meta Ads section

**Files:**
- Create: `src/components/settings/meta-ads-settings.tsx`
- Modify: `src/components/settings/settings-sections.ts` (add `'meta-ads'` to `SETTINGS_SECTIONS` after `'whatsapp'`; `SECTION_META['meta-ads'] = { id: 'meta-ads', label: 'Meta Ads', icon: Megaphone, group: 'workspace' }`), `src/app/(dashboard)/settings/page.tsx` (map `'meta-ads'` → `<MetaAdsSettings />`, admin-gated the same way `booking-types` / `whatsapp` are), `messages/*.json` (`Settings.metaAds.*`)
- Test: `src/components/settings/settings-sections.test.ts` (extend if present) — `resolveSection('meta-ads')` returns `'meta-ads'`.

**Interfaces:** Consumes the Task 9 routes.

- Form: Ad Account ID (placeholder `act_1234567890`), "Use my WhatsApp token" switch (default on) / password field for a separate token, Backfill days (number, 90), buttons **Test connection**, **Save** (disabled until a successful test with the current values), **Sync now**; status line from `/api/ads/status` ("Last synced …", syncing spinner polling every 5 s while `syncing`, error text).
- Help text (exact copy, en): "The token needs the **ads_read** permission. If you use your WhatsApp System User token, regenerate it in Meta Business Settings with ads_read added and assign this ad account to that System User — or paste a separate token that has ads_read."

- [ ] **Step 1:** failing section test. **Step 2:** FAIL. **Step 3:** implement component + wiring + i18n keys in all four message files. **Step 4:** tests PASS, `npm run lint`, `npm run typecheck`. **Step 5:** manual check in `npm run dev`: section visible for admin, hidden/blocked for agent.
- [ ] **Step 6: Commit** `feat(settings): Meta Ads connection section`

## Phase 3 — Analytics

### Task 11: Report SQL rows (migration 070) + report builder

**Files:**
- Create: `supabase/migrations/070_ad_analytics_report.sql`, `src/lib/ads/report.ts`
- Test: `src/lib/ads/report.test.ts`, extend `supabase/manual-tests/069_ad_analytics.test.sql` (or add `070_…test.sql`)

**Interfaces:**
- SQL (SECURITY INVOKER, so RLS applies; `GRANT EXECUTE` to authenticated, service_role):
  - `ad_spend_rows(p_from date, p_to date) RETURNS TABLE(ad_id text, publisher_platform text, spend numeric, impressions bigint, clicks bigint, meta_conversations bigint)` — sum of `meta_ad_insights_daily` in range, caller's account.
  - `ad_enquiry_rows(p_from date, p_to date, p_time_zone text) RETURNS TABLE(contact_id uuid, platform text, ad_id text, first_touch_at timestamptz, booked boolean, won_deals bigint, revenue numeric, deal_currencies text[])` — contacts with `first_touch_source_type IN ('ad','post')` and `(first_touch_at AT TIME ZONE p_time_zone)::date BETWEEN p_from AND p_to`; `booked` = exists booking status ≠ `cancelled` and `created_at >= first_touch_at`; won deals `status = 'won' AND closed_at >= first_touch_at`.
  - `ad_entity_names() RETURNS TABLE(ad_id, ad_name, adset_name, campaign_id, campaign_name)` — or select `meta_ad_entities` directly from the route (members can read it).
- TS:
```ts
export type PlatformKey = 'facebook' | 'instagram' | 'whatsapp'
export interface Metrics { spend: number; enquiries: number; metaConversations: number; bookings: number; wonDeals: number; revenue: number;
  costPerEnquiry: number | null; costPerSale: number | null; roas: number | null; approx: boolean }
export interface AdRow extends Metrics { adId: string | null; adName: string; adsetName: string | null }   // adId null = "No ad (organic post)"
export interface CampaignRow extends Metrics { campaignId: string | null; campaignName: string; ads: AdRow[] }
export interface PlatformReport { kpis: Metrics; campaigns: CampaignRow[] }
export interface AdReport {
  overview: { kpis: Metrics; platforms: Array<{ key: PlatformKey | 'unknown' | 'other'; label: string } & Metrics>; allPlatforms: CampaignRow[]; dailyEnquiries: Array<{ date: string } & Record<PlatformKey | 'unknown', number>> }
  tabs: Record<PlatformKey, PlatformReport>
  currencyMismatch: boolean
}
export function buildAdReport(input: { spend: SpendRow[]; enquiries: EnquiryRow[]; entities: EntityRow[]; currency: string | null; timeZone: string }): AdReport
```
`SpendRow`, `EnquiryRow`, `EntityRow` are exported from `report.ts` and mirror the SQL return columns above in camelCase (numeric → `number`).
- Rules (spec §5, §6): enquiries/bookings count contacts, won deals count deal rows, revenue sums; ratios null on zero denominator; `unknown`-platform enquiries allocated per enquiry across facebook/instagram/whatsapp by that ad's `meta_conversations` on those three (sum 0 or none → evenly across those of the three with spend; none or no ad → stays `unknown`), fractional, `approx: true` on any row that received an allocation; messenger/audience_network spend → `other` row only; `allPlatforms` is exact (no allocation, groups by ad across platforms); every campaign table ends with the "No ad (organic post)" row when post enquiries exist (in `allPlatforms` all post enquiries; in a tab, post enquiries of that platform); missing entity name → ID; `currencyMismatch` when any `deal_currencies` element ≠ `currency`.

- [ ] **Step 1: Write failing tests** for `buildAdReport`: exact FB/IG classification sums; spend with zero enquiries → ratios null, no NaN (Review Focus 3); enquiries with zero spend → costPerEnquiry null, roas null; unknown enquiry on an ad with FB 3 / IG 1 conversations → 0.75 / 0.25, `approx` true on those rows, `allPlatforms` unchanged (exact); conversations sum 0 → even split across platforms with spend; no spend on the three → stays unknown; messenger spend → `other` only; post enquiry → "No ad (organic post)" row, table totals == KPIs (assert for each tab and overview); missing entity → ad name equals id; currency mismatch flag; contact absent from enquiries input (deleted) → not counted (Review Focus 4).
- [ ] **Step 2:** run → FAIL. **Step 3:** write migration 070 and `report.ts`. **Step 4:** run → PASS; add SQL checks: post-first-touch booking counted, pre-first-touch won deal not counted, `pre_existing`/`direct` excluded, other account's rows invisible as `authenticated`.
- [ ] **Step 5: Commit** `feat(ads): report rows (migration 070) and report builder`

### Task 12: Analytics API with stale-on-open

**Files:**
- Create: `src/app/api/ads/analytics/route.ts`
- Test: `src/app/api/ads/analytics/route.test.ts`

**Interfaces:**
- Consumes: `get_meta_ads_status`, `ad_spend_rows`, `ad_enquiry_rows`, `meta_ad_entities`, `buildAdReport`, `isSyncDue`, `syncMetaAds`.
- Produces: `GET /api/ads/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` (default last 30 days in the ad account time zone; max range 400 days; 400 on bad dates) → `{ status: MetaAdsStatus, report: AdReport | null, syncTriggered: boolean }`.
- Any member. Reads via the caller's RLS client. If connected and `isSyncDue(cfg, 3, now)` (status gives `last_synced_at`; failed-at read via service role) → `after(() => syncMetaAds(supabaseAdmin(), accountId))`, `syncTriggered: true`. Not connected → `report: null`.

- [ ] **Step 1: Write failing tests**: agent gets report and status without any token field (Review Focus 5); not connected → `report: null`, 200; stale (NULL) → sync scheduled once; fresh → not scheduled; failed 30 min ago → not scheduled; bad `from` → 400; unauthenticated → 401.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(ads): analytics API with stale-on-open sync`

### Task 13: Ad Analytics page + sidebar

**Files:**
- Create: `src/app/(dashboard)/ad-analytics/page.tsx`, `src/components/ad-analytics/kpi-cards.tsx`, `src/components/ad-analytics/platform-table.tsx`, `src/components/ad-analytics/campaign-table.tsx`, `src/components/ad-analytics/enquiry-trend.tsx` (recharts)
- Modify: `src/components/layout/sidebar.tsx` (`groupCampaigns` items: `{ href: "/ad-analytics", labelKey: "adAnalytics", icon: ChartNoAxesCombined }` first in the group), `messages/*.json` (`Sidebar.adAnalytics`, `AdAnalytics.*`)
- Test: `src/components/ad-analytics/format.test.ts` for a small `formatMetric(value, kind, currency)` helper in `src/components/ad-analytics/format.ts` (null → "—", approx prefix "≈ ", currency via existing `src/lib/currency.ts`).

**Interfaces:** Consumes `GET /api/ads/analytics`, `POST /api/ads/sync`, `GET /api/ads/status`, `AdReport`.

- Layout per approved mockup B (`.superpowers/brainstorm/*/content/ad-analytics-layout.html`): header (title, date range picker default last 30 days, "Last synced …", Sync now for admins only via `canEditSettings(role)`, "Syncing…" while status `syncing`, polling 5 s), error banner from `last_sync_error`, currency-mismatch warning, empty states (admin: link to `/settings?tab=meta-ads`; non-admin: "Ask an admin to connect Meta Ads"). Tabs: **Overview** (4 KPI cards: total spend, enquiries, won deals, ROAS; platform table with rows Facebook / Instagram / WhatsApp / Meta (unknown placement) / Other Meta placements; daily enquiries trend; "All platforms" campaign table), **Facebook / Instagram / WhatsApp** (8 KPI cards: Spend, Enquiries, Cost/enquiry, Bookings, Won deals, Revenue, Cost/sale, ROAS; campaign table expanding to ads with ad set name). Rows with `approx` show "≈ approx" with a tooltip explaining the split.

- [ ] **Step 1:** failing `format.test.ts` (null → "—", approx prefix, INR formatting). **Step 2:** FAIL. **Step 3:** implement helper, components, page, sidebar, i18n in all four files. **Step 4:** tests PASS, `npm run lint`, `npm run typecheck`.
- [ ] **Step 5: Manual check** in `npm run dev` with seeded rows: four tabs render, totals match, non-admin sees no Sync now, empty state when not connected, phone width (375 px) has no horizontal page scroll (tables scroll inside their card).
- [ ] **Step 6: Commit** `feat(ads): Ad Analytics page and sidebar entry`

### Task 14: Docs and full verification

**Files:**
- Modify: `docs/DEPLOY-HOSTINGER-TAMIL.md` (new section "Meta Ads analytics": apply 068 → 069 → 070, `NOTIFY pgrst` already in 069, post-deploy `select backfill_pre_existing_touches();`, token needs `ads_read`, no cron needed)

- [ ] **Step 1:** write the doc section (Tanglish, matching the file).
- [ ] **Step 2:** `npm test` → all pass; `npm run lint` → clean; `npm run typecheck` → clean; `npm run build` → success.
- [ ] **Step 3: Commit** `docs: Meta Ads analytics deploy steps`; push branch to `nixie`; open PR against nixieChatBot `main` (do not merge).
