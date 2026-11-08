# Ad Analytics (Meta: Facebook / Instagram / WhatsApp) — design

Date: 2026-11-08 · Branch: `feature/10-ad-analytics` · Status: approved 2026-11-09

## Intent

The business (today only Aquanets runs ads) spends on Meta ads that open a
WhatsApp chat (Click-to-WhatsApp, "CTWA"). Enquiries land in the CRM inbox
with no record of where they came from, so the owner can't tell which
platform, campaign or ad brings leads that turn into bookings and sales.

They want an **Ad Analytics** page that answers, per platform and per
campaign/ad: how much we spent, how many enquiries came, how many booked,
how many bought, how much revenue, and what each enquiry and each sale cost.
The goal is to move budget towards what works.

## Goals

1. Capture the ad source of every inbound WhatsApp enquiry from Meta's
   `referral` object (today the webhook drops it).
2. **First-touch attribution**: a contact's source is their earliest touch
   (by message time). Later touches are kept in history but never change it.
3. Connect the Meta **ad account** and sync campaign / ad set / ad names and
   daily spend, impressions, clicks and Meta-reported conversations, split
   by platform.
4. A new **Ad Analytics** page with 4 tabs: **Overview** (platform
   comparison), **Facebook**, **Instagram**, **WhatsApp** (campaign → ad
   drill-down). Layout approved as "Option B" in the visual mockup.
5. Funnel per row: Spend → Enquiries → Cost/enquiry → Bookings → Won deals →
   Revenue → Cost/sale → ROAS.
6. Sync runs **from code only**: no Hostinger hPanel cron or other manual
   server config.

## Non-goals

- YouTube / Google Ads. That comes on the next branch (`feature/11-…`):
  Google Ads connection plus prefilled-code matching for `wa.me` links.
- Per-app (CRM Apps switcher) filtering. Only one advertiser today; the
  connection is per CRM account, so a second client is a separate account.
- Editing campaigns or budgets from the CRM. This is read-only.
- Multi-touch or data-driven attribution models.
- Recovering the source of enquiries received before this ships (see
  Constraints).

## Anti-goals (would make it a failure even if it "works")

- Analytics page that hangs or errors when Meta is slow or the token is
  bad. The page must always render from stored data and show the sync
  problem as a banner.
- Silently dropping enquiries whose platform we can't classify. They go in
  a visible **"Meta (unknown placement)"** bucket.
- Any change that slows the webhook ack or risks the inbound message
  insert. Referral capture must not be able to fail the message path.

## Constraints

- **Referral arrives once.** Meta sends `messages[].referral` only on the
  message the customer sends from the ad. Enquiries before deploy have no
  stored referral, so contact → booking → sale linkage starts at deploy.
  Spend, names and Meta's own conversation counts *can* be backfilled.
- Referral shape (Cloud API): `source_url`, `source_id` (ad id for
  `source_type: "ad"`, post id for `"post"`), `source_type`, `headline`,
  `body`, `media_type`, `image_url` / `video_url`, `thumbnail_url`,
  `ctwa_clid`, sometimes `welcome_message`. **There is no platform field.**
  Platform is inferred from `source_url` host, and only patterns confirmed
  from real payloads are trusted (§2, §6). Today `WEBHOOK_DEBUG_LOG`
  (migration 065, `summarizeWebhook` in
  `src/lib/whatsapp/webhook-inbound-log.ts`) records only the payload's
  top-level keys, so it must be extended to log referral fields first (§6).
  The raw referral is stored so we can reclassify later without data loss.
- Hosting is a Hostinger Node.js web app (`next start`, `output:
  "standalone"`). The process can be idled/restarted, so an in-process timer
  alone is not reliable.
- Tenancy: every new table carries `account_id` with RLS via
  `is_account_member(account_id, min_role)` like migrations 017 / 060 / 063.
- Tokens are stored encrypted with `@/lib/whatsapp/encryption` (`encrypt` /
  `decrypt`), never returned to the browser.
- Graph API version: follow the existing `meta-api.ts` base (`v21.0`).
- Next migration number: **069**.
- **Prerequisites:** migrations 017 (accounts / `is_account_member`), 059
  (`deals.closed_at`), 063 (bookings) and 065 (`webhook_inbound_log`) must
  be applied; per the owner's notes 068 may still be pending and should be
  applied before 069.
- **Deploy order:** apply migration 069 in Supabase before deploying the
  code to Hostinger. The settings page, analytics page and sync read the
  new tables. The webhook must keep working even if 069 is missing or
  rolled back (see §2 "Message insert safety"): touch capture is
  try/catch-wrapped and only logs, and the message insert falls back to
  writing without `referral`.

## Approaches considered

How spend data gets from Meta into the page:

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Scheduled sync into local tables; page reads the DB. | Fast page, SQL joins spend with contacts/bookings/deals, survives token outages, supports backfill. Costs a sync job and data up to a few hours old (mitigated by "Sync now"). |
| B | Live Graph API calls on every page load. | Always fresh and no spend tables, but slow page, rate limits, blank page on token errors, and the deals/bookings join has to happen in JS. |
| C (dropped) | Live fetch + in-memory cache. | Complexity of both, benefits of neither; cache lost on every restart. |

The owner picked **A**. They also asked that scheduling live in the codebase
rather than Hostinger cron, which gives the trigger design below.

## Design

### 1. Data model (migration `069_ad_analytics.sql`)

**`meta_ads_config`**: one row per account.
- `account_id` (PK / unique), `ad_account_id` text (`act_…`),
  `access_token` text NULL (encrypted; NULL = reuse the WhatsApp config
  token), `currency` text (from the ad account), `backfill_days` int default
  90, `last_synced_at`, `last_sync_error` text, `last_sync_failed_at`, `sync_started_at`
  (lock), `created_at`, `updated_at`.
- `last_sync_error` holds a **sanitised, human-readable** message only
  (e.g. "Token lacks ads_read permission", "Ad account not found", "Meta
  rate limit, will retry"), mapped from the Graph error code. Never store
  raw Graph URLs, paging cursors, response bodies or anything containing
  `access_token`.
- **Server logs too:** Graph `paging.next` URLs and some error objects
  carry `access_token`. Every log line from the Meta client logs only the
  Graph error `code`, `type`, `error_subcode`, `fbtrace_id` and the path
  with query params stripped; one shared `redactGraphUrl()` helper removes
  `access_token`, `after`/`before` cursors and `appsecret_proof` from any
  URL that must be logged. Unit-tested.
- RLS: select and write for admin+ only (it holds the encrypted token).
  Non-admin members get sync status for the page banner
  (`last_synced_at`, `last_sync_error`, syncing flag, `currency`,
  connected yes/no) through a server route or a `SECURITY DEFINER`
  function that returns only non-secret fields — never `access_token`.

**`meta_ad_entities`**: names and hierarchy, one row per ad.
- `account_id`, `ad_id` (unique per account), `ad_name`, `adset_id`,
  `adset_name`, `campaign_id`, `campaign_name`, `effective_status`,
  `updated_at`.

**`meta_ad_insights_daily`**: one row per ad × day × platform.
- `account_id`, `date`, `ad_id`, `publisher_platform` text (`facebook`,
  `instagram`, `whatsapp`, `messenger`, `audience_network`, …),
  `spend` numeric, `impressions` bigint, `clicks` bigint,
  `meta_conversations` int (action
  `onsite_conversion.messaging_conversation_started_7d`).
- Unique `(account_id, date, ad_id, publisher_platform)`; upsert on sync.

**`contact_touches`**: every ad/organic touch, append-only history.
- `id`, `account_id`, `contact_id`, `conversation_id`, `message_id` text
  NULL = Meta's message id (the wamid, same value as `messages.message_id`,
  **not** `messages.id`); unique `(account_id, message_id)` where not NULL,
  so webhook replays are idempotent. `touched_at` = the WhatsApp message's
  own `timestamp` from Meta (not processing time), `contacts.created_at` for
  `pre_existing`.
  `source_type` (`ad` | `post` | `direct` | `pre_existing`), `platform` (`facebook` |
  `instagram` | `whatsapp` | `unknown` | NULL for `direct` and `pre_existing`), `ad_id` NULL,
  `ctwa_clid` NULL, `headline` NULL, `referral` jsonb NULL (raw).

**`messages` addition**: `referral` jsonb NULL, the raw referral, written
in the **same insert** as the inbound message. This is the durable copy:
Meta sends a referral once, and the webhook acks before processing, so a
failed touch write is never retried by Meta. With the referral on the
message row, a lost touch can always be rebuilt (see §2 self-heal).

**`contacts` additions**: `first_touch_id` uuid NULL → `contact_touches`,
plus denormalised `first_touch_at`, `first_touch_source_type`,
`first_touch_platform`, `first_touch_ad_id` for cheap aggregation. These
always point at the contact's touch with the **earliest `touched_at`**
(ties broken by `id`), maintained only by the `record_contact_touch`
function below.

**`record_contact_touch(...)` SQL function** (called with the service-role
client): in **one transaction** it first locks the contact row (`SELECT 1
FROM contacts WHERE id = p_contact_id AND account_id = p_account_id FOR
UPDATE`), inserts the touch (`ON CONFLICT (account_id, message_id) DO
NOTHING`), then sets the contact's `first_touch_*` columns to the earliest
touch of that contact. The row lock serialises overlapping calls for the
same contact, so a later `direct` can't overwrite an earlier ad touch.
`SECURITY DEFINER` with `SET search_path = public`, and per the repo
convention (migration 044): `REVOKE ALL ... FROM PUBLIC, anon,
authenticated; GRANT EXECUTE ... TO service_role`. Logged-in users can
never call it over RPC. Touch insert
and first-touch update can never half-succeed, and because "first" is
decided by Meta's message timestamp, processing order doesn't matter: a
referral message processed after a later plain message still wins.

**Pre-existing contacts backfill (owner decided):** the migration inserts
one `pre_existing` touch (`touched_at = contacts.created_at`, no message)
and sets it as first touch, **only for contacts that already have at least
one customer message** (`EXISTS` a `messages` row with `sender_type =
'customer'` in a conversation whose `contact_id` is the contact). A
returning customer who later clicks an ad gets that ad touch in history but
is **not** counted as a new enquiry (their `pre_existing` touch is
earlier). Contacts that never messaged (imported, API-created, broadcast-
only) get no backfill touch, so if their first message comes from an ad,
that counts as a new ad enquiry. `pre_existing` contacts never appear in
Ad Analytics.

### 2. Capture (webhook)

- Add `referral?: {...}` to `WhatsAppMessage` in
  `src/app/api/whatsapp/webhook/route.ts`.
- New `src/lib/ads/attribution.ts`:
  - `classifyReferral(referral) → { sourceType, platform, adId }`. Pure
    function, unit-tested.
    **Platform rule:** a `source_url` pattern maps to a platform **only if
    the plan-step-1 payload capture (§6) shows that pattern is used by that
    platform alone**. A pattern seen on more than one platform (e.g. if IG
    ads also arrive as `fb.me/…`) maps to `unknown`, so the §6 fallback
    handles it. Anything not confirmed → `unknown`. Expected candidates to
    confirm: `*facebook.com` → facebook, `*instagram.com` → instagram,
    `fb.me` (shared?), WhatsApp Status patterns. The confirmed table lives
    in one constant with a comment citing the captured payloads.
    `adId` is set only when `source_type = "ad"`. For `"post"` it is NULL
    (the `source_id` is a post id, kept in the raw `referral` jsonb), so
    posts never join to spend and show under their platform with no ad.
    **Missing or unrecognised `source_type`, or `source_type = "ad"` with
    no `source_id`:** a referral still means the customer came from a Meta
    surface, so it counts as an enquiry. Treat it as `post` (no `adId`,
    lands in the "No ad (organic post)" row); the raw referral is kept so
    it can be reclassified later.
  - `recordTouch(db, {...})`: classifies (TS) and calls
    `record_contact_touch` (SQL, atomic, see §1).
- **Message insert safety:** store the raw referral in `messages.referral`
  as part of the existing inbound message upsert (`route.ts`, the
  `messages` upsert before the `insertedRows` check). If that upsert fails
  for **any** reason while `referral` is set (missing column `42703` /
  `PGRST204` because 069 isn't applied, a jsonb rejection, anything),
  **retry the same upsert once without `referral`** and log a loud
  warning with the error code. The inbound message must always be saved;
  only attribution is lost in that case. (Errors when `referral` is not
  set behave exactly as today.)
- Call `recordTouch` after the inbound message upsert, on **both** the new
  path and the replay path (before the `insertedRows` duplicate return);
  the unique `(account_id, message_id)` makes a second call a no-op.
  Record a touch:
  - when the message carries a `referral` (any contact), or
  - when there's no referral and the contact's first touch is NULL or
    `direct` → run self-heal below; then, if the first touch is still
    NULL, record a `direct` touch.
  This no longer depends on `claimFirstInboundMessage`, so contacts
  created between the migration and the deploy (or whose conversation's
  first inbound was already claimed) still get a first touch.
- **Self-heal:** when the current message has no referral and the
  contact's first touch is NULL or `direct`, look for that contact's
  customer messages that carry a referral but have no touch row:
  `messages m JOIN conversations c ON c.id = m.conversation_id WHERE
  c.contact_id = $contact AND m.sender_type = 'customer' AND m.referral IS
  NOT NULL AND NOT EXISTS (touch with message_id = m.message_id)`. (The
  `messages` table has no `contact_id` or direction column; inbound is
  `sender_type = 'customer'`.) For each, classify and call
  `record_contact_touch` with the original message id and timestamp. Since
  the earliest touch wins, a recovered earlier ad touch replaces a later
  `direct`. This repairs any touch lost to a failed `recordTouch`.
- Wrapped in try/catch with logging; it never changes the message outcome.

**First-touch rule (owner decided):** the contact's **earliest touch by
message time** wins. A contact whose earliest touch is `direct` keeps
`direct` even if they click an ad later; that ad touch is still in
history. A referral that arrives at the server late (race, retry,
self-heal) still wins if its message was sent earlier.

**Contact merge:** the existing `merge_duplicate_contacts` function
(migrations 022 / 044) repoints conversations and deals from the loser to
the survivor. Migration 069 updates it to also repoint `contact_touches`
(`UPDATE contact_touches SET contact_id = survivor WHERE contact_id =
loser`) and then recompute the survivor's `first_touch_*` (earliest touch
wins, same logic as `record_contact_touch`). `contacts.first_touch_id`
uses `ON DELETE SET NULL`; `contact_touches.contact_id` uses `ON DELETE
CASCADE`.

**Known gap:** contacts who message between applying migration 069 and
deploying the code are handled by the old code (no referral stored, no
backfill touch). Deploy right after the migration to keep this window
small.

### 3. Meta sync

New `src/lib/ads/meta-sync.ts`:
1. **Claim the lock**: `UPDATE meta_ads_config SET sync_started_at = now()
   WHERE account_id = $1 AND (sync_started_at IS NULL OR sync_started_at <
   now() - interval '15 minutes') RETURNING …`. No row = someone else is
   syncing; return. **Heartbeat:** while running, the sync refreshes
   `sync_started_at = now()` after each Graph page it processes, so a long
   backfill never looks abandoned and a second sync can't take over.
2. Resolve token (own or WhatsApp config's), decrypt.
3. Fetch ad account currency (`GET /act_{id}?fields=currency`).
4. Entities: `GET /act_{id}/ads?fields=id,name,effective_status,adset{id,name},campaign{id,name}`
   (paginate). Upsert `meta_ad_entities`. This call skips ARCHIVED /
   DELETED ads by default, so it is a supplement for `effective_status`;
   names come from the insights rows too (step 5).
5. Insights: `GET /act_{id}/insights?level=ad&time_increment=1&breakdowns=publisher_platform&fields=ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions&time_range=…`
   (paginate). Range = `backfill_days` on first sync; afterwards the last 3
   days (spend settles late) plus any gap since `last_synced_at`. Upsert,
   and also upsert `meta_ad_entities` names / hierarchy from these rows so
   backfilled old ads still have names. The analytics function LEFT JOINs
   entities and falls back to the ID when a name is missing.
6. On success set `last_synced_at`, clear `last_sync_error` and
   `last_sync_failed_at`; on failure store a sanitised `last_sync_error`
   (§1) and `last_sync_failed_at`. Always clear `sync_started_at`.
   **Backoff:** the timer and stale-on-open skip an account whose
   `last_sync_failed_at` is within the last 1 h (so a bad token doesn't
   hit Meta on every tick or page view). Sync now and Save ignore the
   backoff. Add `last_sync_failed_at` to `meta_ads_config` in §1.

**Triggers (no manual server config):**
- **In-process timer**: new file `src/instrumentation.ts` `register()` (guarded by
  `process.env.NEXT_RUNTIME === 'nodejs'`) starts a `setInterval` (~30 min)
  that syncs each configured account whose `last_synced_at` is older than
  6 h. Best-effort: it doesn't run while Hostinger has the process idle.
- **Stale-on-open**: when the Ad Analytics page loads and `last_synced_at`
  is older than 3 h, start a sync in the background (`after()`), render the
  stored data now, and show "Syncing…". Any member's page view can trigger
  it on purpose: it only runs when data is >3 h old and the lock prevents
  duplicates. Only the manual Sync now is admin+.
- **Sync now** button (admin+), same function. The API claims the lock,
  starts the sync in `after()` and returns immediately (202 / "already
  syncing"); the UI polls the sync status (`sync_started_at` /
  `last_synced_at` / `last_sync_error`) until it finishes. A 90-day
  backfill can exceed the host/proxy request timeout.
- The lock makes concurrent triggers safe.
- **Never-synced accounts:** `last_synced_at IS NULL` counts as stale for
  both the timer and stale-on-open (write the check as `last_synced_at IS
  NULL OR last_synced_at < now() - interval …`). Saving the Meta Ads
  settings with a valid ad account starts the first sync (the
  `backfill_days` backfill) in `after()` straight away, so data starts
  filling before anyone opens the page.
- **Who runs the sync:** every trigger runs `meta-sync.ts` server-side with
  the service-role client, never the viewer's session (members can't read
  or write `meta_ads_config`). The page / route first checks the caller:
  stale-on-open requires `is_account_member(account_id)` (any role);
  Sync now requires admin+. The sync is always scoped to that one
  `account_id`.

### 4. Settings → "Meta Ads" section (admin only)

New section in `settings-sections.ts` / `settings-rail.tsx`, component
`src/components/settings/meta-ads-settings.tsx`, API under
`src/app/api/ads/…`.
- Fields: Ad Account ID (`act_…`), "Use WhatsApp token" toggle (default
  on) or a separate token (needs `ads_read`), backfill days.
- **Test connection** (fetch account name + currency), **Save**, **Sync
  now**, last sync time / error.
- Test connection uses whichever token is selected (WhatsApp config token
  by default, or the separate one) and calls `GET /act_{id}?fields=name,currency`
  plus one small insights call. A permission error is shown as a clear
  message: "This token needs the `ads_read` permission and access to this
  ad account", rather than a raw Graph error. Save is allowed only after a
  successful test.
- Help text covers **both** token paths: the WhatsApp System User token
  usually has only `whatsapp_business_*` permissions, so the owner must
  regenerate it with `ads_read` added (and assign the ad account to that
  System User in Business Settings), or paste a separate token that has
  `ads_read`.

### 5. Ad Analytics page

- Route `src/app/(dashboard)/ad-analytics/page.tsx`. Sidebar item under the
  `groupCampaigns` group (with i18n label).
- Date range picker (default last 30 days), "Last synced …" + Sync now
  (Sync now shown to admin+ only; non-admins see "Last synced …" only),
  error banner when `last_sync_error` is set, empty state with a link to
  Settings when not connected.
- **Overview tab**: KPI cards (total spend, enquiries, won deals, ROAS)
  and a platform comparison table (Facebook / Instagram / WhatsApp /
  Meta (unknown placement) / Other Meta placements — spend only, no tab, so
  totals reconcile): Spend, Enquiries, Meta conversations, Cost/enquiry,
  Bookings, Won, Revenue, Cost/sale, ROAS. Plus an enquiries-per-day trend
  by platform, and an exact "All platforms" campaign → ad table (see §6).
- **Facebook / Instagram / WhatsApp tabs**: 8 KPI cards (Spend, Enquiries,
  Cost/enquiry, Bookings, Won deals, Revenue, Cost/sale, ROAS) and a
  campaign table that expands to ads (ad set name shown on the ad row).
- Data from one SQL function, e.g. `ad_analytics(p_from date, p_to date)`
  (`SECURITY INVOKER`, member-scoped), returning rows at platform ×
  campaign × ad grain that the UI rolls up.

**Metric definitions:**
- *Spend / impressions / clicks / Meta conversations*: sum of
  `meta_ad_insights_daily` for `date` in range and platform.
- *Enquiries*: contacts whose first touch has `first_touch_source_type IN
  ('ad','post')` and `first_touch_at` in range, grouped by
  `first_touch_platform` / `first_touch_ad_id`. Contacts with a `direct` or
  `pre_existing` first touch are excluded from Ad Analytics.
- Bookings, Won deals and Revenue are computed over that same cohort only.
- **Units:** *Enquiries* and *Bookings* count **contacts**; *Won deals*
  counts **deal rows** (a repeat purchase is another sale); *Revenue* sums
  those deals' `value`. Cost/sale = spend ÷ won deals. *(Claude's call.)*
- *Bookings*: those same contacts that have ≥1 booking with status ≠
  `cancelled` and `created_at >= first_touch_at`.
- *Won deals / Revenue*: those same contacts' deals with `status = 'won'`
  and `closed_at >= first_touch_at` (`deals.closed_at`, migration 059);
  revenue = sum of `deals.value`. *(Claude's call: stops old deals from
  being credited to an ad.)*
- That makes the funnel **cohort-based**: spend in range is compared with
  the outcomes of enquiries that arrived in range, whenever they converted.
- Cost/enquiry = spend ÷ enquiries; Cost/sale = spend ÷ won deals;
  ROAS = revenue ÷ spend. Show "—" on divide by zero.
- "Meta (unknown placement)" bucket has enquiries but no spend (spend is always known
  per platform from the breakdown).
- **Enquiries with no ad** (`source_type = 'post'`, so `first_touch_ad_id`
  is NULL): they count in their platform's row and KPIs, and every
  campaign → ad table (platform tabs and the Overview "All platforms"
  table) ends with a **"No ad (organic post)"** row carrying their
  enquiries, bookings, won deals and revenue with no spend. Table totals
  then equal the KPI cards. In the §6 fallback, a post enquiry with
  `unknown` platform has no ad to allocate by, so it stays in
  "Meta (unknown placement)" in the platform table; in the Overview "All
  platforms" table (which has no platform split) it is in the "No ad
  (organic post)" row like any other post enquiry. On platform tabs it
  appears nowhere (it belongs to no platform), which matches that tab's
  KPI cards.

### 6. Platform split for enquiries (owner decided)

Spend splits exactly by `publisher_platform`. Enquiries only split if
`source_url` tells FB, IG and WhatsApp apart, and one ad can run on all
three (Advantage+ placements).

- **Plan step 1, before building the UI.** Because Meta sends a referral
  only once, **capture ships first, classification later**: step 1's
  deploy already includes migration 069's `messages.referral`, the
  `contact_touches` table, `record_contact_touch`, and `recordTouch` in
  the webhook, with `classifyReferral` returning platform `unknown` for
  everything until patterns are confirmed. No referral is lost while we
  wait for test clicks; once patterns are confirmed, a one-off
  reclassification updates existing touches from their raw `referral`.
  1. Extend the debug log: in `summarizeWebhook`
     (`src/lib/whatsapp/webhook-inbound-log.ts`), for each message that has
     a `referral`, append `source_type`, `source_id` and `source_url` (full
     URL, it holds no customer data) to the row's `detail`. Still off
     unless `WEBHOOK_DEBUG_LOG=true`; unit-test the new output.
  2. Deploy that alone, turn the flag on, click a real FB ad and a real IG
     ad (and a WhatsApp Status ad if one runs) from a test phone, and read
     the `webhook_inbound_log` rows.
  3. Record the observed `source_url` patterns in `classifyReferral`'s
     constant (with the captured examples in a comment) and its tests.
- **If the URL distinguishes the platforms:** use it. Numbers are exact.
- **If it doesn't (fallback):** the fallback applies per enquiry, only to
  enquiries whose platform is `unknown`; enquiries classified as facebook /
  instagram / whatsapp keep their platform (so a partial case, e.g. FB/IG
  distinguishable but WhatsApp not, works without special handling). Each
  `unknown` enquiry is allocated across **facebook / instagram / whatsapp
  only** in proportion to its ad's `meta_conversations` on those three
  platforms over the selected range (no conversations data, or the three
  sum to 0 → evenly across
  those of the three the ad had spend on; no spend on any of the three, or
  no ad at all → stays in "Meta (unknown placement)"). Nothing is ever
  allocated to messenger / audience_network ("Other Meta placements" stays
  spend only). Enquiries, bookings, won
  deals and revenue on the platform tabs and the Overview platform table
  are then fractional and shown with a **"≈ approx"** label and tooltip.
- **Campaign / ad totals stay exact.** *(Claude's call:)* the Overview tab
  also gets an "All platforms" campaign → ad table with no allocation, so
  the owner always has exact per-ad numbers to judge ads by.
- Classification stays reversible: raw `referral` is stored and the
  allocation happens at query time, so a better rule later just
  re-classifies.

## Claude's calls (owner to check)

- Booking / won-deal counted only when after the contact's first touch.
- (Owner approved) First touch = earliest touch by message time, kept
  atomic by one SQL function; `pre_existing` only for contacts that have
  messaged before.
- Won deals counted as deal rows (repeat purchases count), not customers;
  Enquiries and Bookings counted as contacts.
- Referral with missing / unrecognised `source_type` counts as an enquiry,
  treated as `post` (no ad).
- "All platforms" exact campaign table on the Overview tab.
- Page visible to all account members (like the dashboard); Meta Ads
  settings and Sync now are admin+.
- Sync cadence: timer every ~30 min syncing accounts older than 6 h;
  stale-on-open threshold 3 h; first backfill 90 days.

## Implementation checklist (from spec review, owner agreed)

The plan must carry these as tasks or test cases:

- **Lost-touch sweep:** the sync timer also finds customer messages with
  `referral IS NOT NULL` and no touch row (per account, bounded batch) and
  records them, so a lost touch is repaired even if the contact never
  messages again.
- **Post-deploy backfill re-run:** the `pre_existing` backfill SQL is
  idempotent; re-run it once right after the code deploy to cover contacts
  who messaged in the migration-to-deploy window.
- Tie-break on equal `touched_at`: prefer `ad` > `post` > `direct`, then
  `id`.
- `contacts.created_at` is nullable: `pre_existing` `touched_at` =
  `COALESCE(created_at, earliest customer message time)`.
- After applying 069, `NOTIFY pgrst, 'reload schema'` so PostgREST sees
  `messages.referral` (otherwise the insert fallback silently drops it).
- Partial index on `messages (conversation_id) WHERE referral IS NOT
  NULL`; self-heal `NOT EXISTS` also matches `account_id`.
- Save route re-runs the connection test server-side (don't trust the
  client).
- The non-admin status function checks `is_account_member(p_account_id)`
  inside.
- Confirm Graph API `v21.0` is still supported at build time; bump if not.
- Debug log wording: it records the keys of each change's `value`.
- Tests: `ad` with no `source_id` → `post`; merge repoints touches and
  recomputes first touch; `redactGraphUrl`; `record_contact_touch` not
  callable by `authenticated`; insert fallback on a non-column error.

## Builder's calls (decide during implementation)

- Currency: show the ad account currency; if won deals use a different
  `deals.currency`, show a warning rather than converting.
- Timezone for date buckets: the ad account's timezone for spend, the same
  zone for `first_touch_at` bucketing.
- `messenger` / `audience_network` spend: include in Overview totals as
  "Other Meta placements"; no tab of their own.

- Exact column types, index set, function shape and component breakdown.
- Chart library: reuse what the dashboard already uses.
- Graph pagination / retry / rate-limit handling details.
- Copy and i18n strings.

## Testing

- Unit: `classifyReferral` (FB / IG / unknown / post; a pattern shared by
  two platforms → `unknown`; missing / unrecognised `source_type` →
  `post` with no `adId`; missing `source_url` → `unknown`),
  first touch (idempotent, earliest by message time wins, pre-existing
  never replaced), sync range calculation, lock claim, metric maths (zero
  divisions), fallback allocation (proportional, even, stays unknown,
  never to messenger / audience_network, classified enquiries untouched),
  stale check treats NULL `last_synced_at` as stale, conversations summing
  to 0 → even split, lock heartbeat keeps a long sync's claim alive.
- Webhook route test: message with referral → touch recorded and first
  touch set; contact with no first touch and an existing conversation →
  direct touch claimed; replay → no duplicate; referral error → message
  still stored; `messages.referral` saved in the same insert; touch write
  fails on first delivery → the contact's next plain message self-heals
  to the ad touch (not `direct`); replay after a failed touch write →
  touch recorded; unrecorded referral + concurrent plain message → ad
  touch wins.
- Sync backoff: failure within 1 h → timer / stale-on-open skip; Sync now
  and Save still run; success clears `last_sync_failed_at`.
- Message insert safety: `messages` upsert failing with `42703` /
  `PGRST204` → retried without `referral`, message saved, warning logged.
- `record_contact_touch` (SQL): later-processed but earlier-timestamped
  ad touch replaces a `direct` first touch; a later ad touch doesn't
  replace an earlier `direct`; duplicate message id → no-op; touch +
  first-touch update are atomic.
- Migration 069 backfill: contact with a customer message → `pre_existing`
  first touch; contact with no messages (imported) → no touch.
- Standby delivery: a referral on a message delivered via the `standby`
  field is captured the same way.
- `last_sync_error` never contains a URL, cursor or token (sanitiser unit
  test); Test connection permission error → friendly message.
- Debug log: a message with a referral → `detail` includes source_type,
  source_id, source_url.
- Currency: won deals in a different `deals.currency` → warning shown.
- Sync with mocked Graph responses (pagination, error → `last_sync_error`,
  archived ad name taken from insights rows).
- Analytics function (SQL tests or integration): `pre_existing` and
  `direct` first touches excluded; booking / won deal before
  `first_touch_at` not counted; post enquiries land in the "No ad
  (organic post)" row; missing entity name falls back to the ID; table
  totals equal KPI totals.
- Access: non-admin gets sync status without `access_token`; non-admin
  Sync now → 403; non-member page view can't trigger a sync.
- Manual: real CTWA click from FB and IG ads (and a WhatsApp Status ad if
  possible) on a test number; confirm classification with
  `WEBHOOK_DEBUG_LOG`.
