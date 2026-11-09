-- Behaviour checks for migration 069 (ad attribution + Meta ads tables)
-- — backfill, first-touch ordering, idempotent touches, account guard,
-- grants/RLS, contact merge, re-runnable backfill.
--
-- Run against a THROWAWAY local database that has every migration
-- applied (e.g. `npx supabase start && npx supabase db reset`), as the
-- postgres superuser:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/manual-tests/069_ad_analytics.test.sql
--
-- Every check RAISEs on failure; the last line prints AD ANALYTICS 069 OK.
-- It inserts test users — never run it on production.
\set ON_ERROR_STOP 1

-- A = owner of account A, B = owner of account B, C = agent in account A.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-000000069a01','ads-a@test','{"full_name":"Ads A"}'),
 ('00000000-0000-0000-0000-000000069b01','ads-b@test','{"full_name":"Ads B"}'),
 ('00000000-0000-0000-0000-000000069c01','ads-c@test','{"full_name":"Ads C"}');
UPDATE profiles
SET account_id = (SELECT account_id FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000069a01'),
    account_role = 'agent'
WHERE user_id = '00000000-0000-0000-0000-000000069c01';

-- Shared ids for the DO blocks (psql variables don't reach inside $$).
CREATE TEMP TABLE ctx (k TEXT PRIMARY KEY, v UUID);
GRANT SELECT ON ctx TO authenticated;
INSERT INTO ctx SELECT 'user_a', '00000000-0000-0000-0000-000000069a01';
INSERT INTO ctx SELECT 'acc_a', account_id FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000069a01';
INSERT INTO ctx SELECT 'acc_b', account_id FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000069b01';
CREATE FUNCTION pg_temp.ctx(p_k TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT v FROM ctx WHERE k = p_k $$;

-- Contacts in A: messaged (customer), silent, agent-only, and three
-- for the touch-order and merge checks.
INSERT INTO contacts (id, user_id, account_id, phone, name, created_at) VALUES
 ('00000000-0000-0000-0069-000000000001', pg_temp.ctx('user_a'), pg_temp.ctx('acc_a'), '+9169001', 'Messaged', '2026-01-01 00:00+00'),
 ('00000000-0000-0000-0069-000000000002', pg_temp.ctx('user_a'), pg_temp.ctx('acc_a'), '+9169002', 'Silent',   '2026-01-01 00:00+00'),
 ('00000000-0000-0000-0069-000000000003', pg_temp.ctx('user_a'), pg_temp.ctx('acc_a'), '+9169003', 'Agent only','2026-01-01 00:00+00'),
 ('00000000-0000-0000-0069-000000000004', pg_temp.ctx('user_a'), pg_temp.ctx('acc_a'), '+9169004', 'Stays direct','2026-01-01 00:00+00');
INSERT INTO conversations (id, user_id, account_id, contact_id) VALUES
 ('00000000-0000-0000-0069-0000000000c1', pg_temp.ctx('user_a'), pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000001'),
 ('00000000-0000-0000-0069-0000000000c3', pg_temp.ctx('user_a'), pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000003');
INSERT INTO messages (conversation_id, sender_type, content_text, message_id, created_at) VALUES
 ('00000000-0000-0000-0069-0000000000c1', 'customer', 'hi', 'wamid.pre1', '2026-02-01 00:00+00'),
 ('00000000-0000-0000-0069-0000000000c3', 'agent',    'hello', 'wamid.agent3', '2026-02-01 00:00+00');

-- 1. backfill: messaged contact gets one pre_existing touch; others none.
DO $$
DECLARE v_added INTEGER; v_c RECORD; v_n INTEGER;
BEGIN
  v_added := public.backfill_pre_existing_touches();
  IF v_added < 1 THEN RAISE EXCEPTION '1: backfill added % touches, expected >= 1', v_added; END IF;

  SELECT count(*) INTO v_n FROM contact_touches
  WHERE contact_id = '00000000-0000-0000-0069-000000000001' AND source_type = 'pre_existing' AND message_id IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION '1: messaged contact has % pre_existing touches', v_n; END IF;

  SELECT * INTO v_c FROM contacts WHERE id = '00000000-0000-0000-0069-000000000001';
  IF v_c.first_touch_source_type IS DISTINCT FROM 'pre_existing'
     OR v_c.first_touch_id IS NULL
     OR v_c.first_touch_at IS DISTINCT FROM '2026-01-01 00:00+00'::timestamptz
     OR v_c.first_touch_platform IS NOT NULL THEN
    RAISE EXCEPTION '1: messaged contact first touch wrong: % % %', v_c.first_touch_source_type, v_c.first_touch_at, v_c.first_touch_platform;
  END IF;

  SELECT count(*) INTO v_n FROM contact_touches
  WHERE contact_id IN ('00000000-0000-0000-0069-000000000002', '00000000-0000-0000-0069-000000000003');
  IF v_n <> 0 THEN RAISE EXCEPTION '1: silent / agent-only contacts got % touches', v_n; END IF;
  IF (SELECT first_touch_id FROM contacts WHERE id = '00000000-0000-0000-0069-000000000002') IS NOT NULL THEN
    RAISE EXCEPTION '1: silent contact has a first touch';
  END IF;
  RAISE NOTICE 'ok 1: pre_existing backfill';
END $$;

-- 7 (first half). A second run adds nothing.
DO $$
DECLARE v_added INTEGER;
BEGIN
  v_added := public.backfill_pre_existing_touches();
  IF v_added <> 0 THEN RAISE EXCEPTION '7: second backfill run added %', v_added; END IF;
  RAISE NOTICE 'ok 7: backfill re-run returns 0';
END $$;

-- 2. earliest message time wins, whatever the processing order.
DO $$
DECLARE v_direct UUID; v_ad UUID; v_c RECORD;
BEGIN
  v_direct := public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000002', NULL,
    'wamid.d2', '2026-11-01 10:00+00', 'direct', NULL, NULL, NULL, NULL, NULL);
  IF (SELECT first_touch_id FROM contacts WHERE id = '00000000-0000-0000-0069-000000000002') IS DISTINCT FROM v_direct THEN
    RAISE EXCEPTION '2: first direct touch not recorded as first touch';
  END IF;

  -- An earlier ad, processed later, takes over.
  v_ad := public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000002', NULL,
    'wamid.a2', '2026-11-01 09:00+00', 'ad', 'facebook', '120', 'clid1', 'Buy now', '{"source_type":"ad","source_id":"120"}');
  SELECT * INTO v_c FROM contacts WHERE id = '00000000-0000-0000-0069-000000000002';
  IF v_c.first_touch_id IS DISTINCT FROM v_ad
     OR v_c.first_touch_source_type IS DISTINCT FROM 'ad'
     OR v_c.first_touch_platform IS DISTINCT FROM 'facebook'
     OR v_c.first_touch_ad_id IS DISTINCT FROM '120'
     OR v_c.first_touch_at IS DISTINCT FROM '2026-11-01 09:00+00'::timestamptz THEN
    RAISE EXCEPTION '2: earlier ad did not become first touch: % % %', v_c.first_touch_source_type, v_c.first_touch_ad_id, v_c.first_touch_at;
  END IF;

  -- A later ad never replaces an earlier direct.
  v_direct := public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000004', NULL,
    'wamid.d4', '2026-11-01 10:00+00', 'direct', NULL, NULL, NULL, NULL, NULL);
  PERFORM public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000004', NULL,
    'wamid.a4', '2026-11-01 11:00+00', 'ad', 'instagram', '121', NULL, NULL, NULL);
  SELECT * INTO v_c FROM contacts WHERE id = '00000000-0000-0000-0069-000000000004';
  IF v_c.first_touch_id IS DISTINCT FROM v_direct OR v_c.first_touch_source_type IS DISTINCT FROM 'direct'
     OR v_c.first_touch_ad_id IS NOT NULL THEN
    RAISE EXCEPTION '2: later ad replaced earlier direct: %', v_c.first_touch_source_type;
  END IF;
  IF (SELECT count(*) FROM contact_touches WHERE contact_id = '00000000-0000-0000-0069-000000000004') <> 2 THEN
    RAISE EXCEPTION '2: later ad touch not kept in history';
  END IF;

  -- Same instant: ad outranks direct.
  PERFORM public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000003', NULL,
    'wamid.tie-d', '2026-11-02 10:00+00', 'direct', NULL, NULL, NULL, NULL, NULL);
  PERFORM public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000003', NULL,
    'wamid.tie-a', '2026-11-02 10:00+00', 'ad', 'unknown', '122', NULL, NULL, NULL);
  IF (SELECT first_touch_source_type FROM contacts WHERE id = '00000000-0000-0000-0069-000000000003') IS DISTINCT FROM 'ad' THEN
    RAISE EXCEPTION '2: ad did not win a same-time tie with direct';
  END IF;
  RAISE NOTICE 'ok 2: first touch by message time, ad wins ties';
END $$;

-- 3. the same message twice is one row, same id.
DO $$
DECLARE v_first UUID; v_again UUID; v_n INTEGER;
BEGIN
  SELECT id INTO v_first FROM contact_touches WHERE account_id = pg_temp.ctx('acc_a') AND message_id = 'wamid.a2';
  v_again := public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000002', NULL,
    'wamid.a2', '2026-11-01 09:00+00', 'ad', 'facebook', '120', 'clid1', 'Buy now', NULL);
  SELECT count(*) INTO v_n FROM contact_touches WHERE account_id = pg_temp.ctx('acc_a') AND message_id = 'wamid.a2';
  IF v_first IS NULL OR v_again IS DISTINCT FROM v_first OR v_n <> 1 THEN
    RAISE EXCEPTION '3: replay not idempotent: % vs %, % rows', v_first, v_again, v_n;
  END IF;
  RAISE NOTICE 'ok 3: replayed message is a no-op';
END $$;

-- 4. a contact from another account is refused.
DO $$ BEGIN
  PERFORM public.record_contact_touch(pg_temp.ctx('acc_b'), '00000000-0000-0000-0069-000000000002', NULL,
    'wamid.x', now(), 'direct', NULL, NULL, NULL, NULL, NULL);
  RAISE EXCEPTION '4: wrong account accepted!';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 4: wrong account refused';
END $$;
DO $$ BEGIN
  PERFORM public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000002',
    '00000000-0000-0000-0069-0000000000ff', 'wamid.y', now(), 'direct', NULL, NULL, NULL, NULL, NULL);
  RAISE EXCEPTION '4: unknown conversation accepted!';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 4: foreign conversation refused';
END $$;

-- 5. grants and RLS.
INSERT INTO meta_ads_config (account_id, ad_account_id, access_token, currency, sync_started_at)
VALUES (pg_temp.ctx('acc_a'), 'act_123', 'enc:secret', 'INR', now());
DO $$ BEGIN
  INSERT INTO meta_ads_config (account_id, ad_account_id) VALUES (pg_temp.ctx('acc_b'), '123');
  RAISE EXCEPTION '5: ad_account_id without act_ accepted!';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 5: ad_account_id format enforced';
END $$;

SET ROLE authenticated;
-- C: agent in A
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000069c01', false) \gset
DO $$ BEGIN
  PERFORM public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000002', NULL,
    'wamid.z', now(), 'direct', NULL, NULL, NULL, NULL, NULL);
  RAISE EXCEPTION '5: authenticated can call record_contact_touch!';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 5: record_contact_touch denied to authenticated';
END $$;
DO $$ BEGIN
  PERFORM public.recompute_contact_first_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000002');
  RAISE EXCEPTION '5: authenticated can call recompute_contact_first_touch!';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 5: recompute denied to authenticated';
END $$;
DO $$ BEGIN
  PERFORM public.backfill_pre_existing_touches();
  RAISE EXCEPTION '5: authenticated can call backfill_pre_existing_touches!';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 5: backfill denied to authenticated';
END $$;
DO $$ BEGIN
  INSERT INTO contact_touches (account_id, contact_id, touched_at, source_type)
  VALUES (pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000002', now(), 'ad');
  RAISE EXCEPTION '5: agent can write contact_touches!';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 5: contact_touches not writable by members';
END $$;
DO $$
DECLARE v_n INTEGER; v_s RECORD;
BEGIN
  SELECT count(*) INTO v_n FROM meta_ads_config;
  IF v_n <> 0 THEN RAISE EXCEPTION '5: agent sees % meta_ads_config rows', v_n; END IF;
  SELECT count(*) INTO v_n FROM contact_touches;
  IF v_n = 0 THEN RAISE EXCEPTION '5: agent cannot read own account touches'; END IF;
  SELECT * INTO v_s FROM public.get_meta_ads_status(pg_temp.ctx('acc_a'));
  IF NOT v_s.connected OR v_s.ad_account_id IS DISTINCT FROM 'act_123' OR v_s.currency IS DISTINCT FROM 'INR'
     OR NOT v_s.syncing THEN
    RAISE EXCEPTION '5: agent status wrong: % % %', v_s.connected, v_s.ad_account_id, v_s.syncing;
  END IF;
  RAISE NOTICE 'ok 5: agent reads status but not config';
END $$;
DO $$ BEGIN
  PERFORM * FROM public.get_meta_ads_status(pg_temp.ctx('acc_b'));
  RAISE EXCEPTION '5: status of another account returned!';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 5: other account status refused';
END $$;
-- A: owner of A sees the config row.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000069a01', false) \gset
DO $$ BEGIN
  IF (SELECT count(*) FROM meta_ads_config) <> 1 THEN RAISE EXCEPTION '5: owner cannot read own config'; END IF;
  RAISE NOTICE 'ok 5: admin reads config';
END $$;
-- B: owner of B, no config → connected false; sees none of A's touches.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000069b01', false) \gset
DO $$
DECLARE v_s RECORD;
BEGIN
  SELECT * INTO v_s FROM public.get_meta_ads_status(pg_temp.ctx('acc_b'));
  IF v_s.connected OR v_s.syncing OR v_s.ad_account_id IS NOT NULL THEN
    RAISE EXCEPTION '5: unconfigured account reported connected';
  END IF;
  IF (SELECT count(*) FROM contact_touches) <> 0 OR (SELECT count(*) FROM meta_ads_config) <> 0 THEN
    RAISE EXCEPTION '5: B sees A rows';
  END IF;
  RAISE NOTICE 'ok 5: tenant isolation';
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  PERFORM * FROM public.get_meta_ads_status(gen_random_uuid());
  RAISE EXCEPTION '5: anon can call get_meta_ads_status!';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 5: anon denied status';
END $$;
RESET ROLE;
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT string_agg(a.attname, ',') INTO v_cols
  FROM pg_proc p, unnest(p.proargnames) AS a(attname)
  WHERE p.oid = 'public.get_meta_ads_status(uuid)'::regprocedure;
  IF v_cols LIKE '%access_token%' THEN RAISE EXCEPTION '5: status exposes access_token'; END IF;
END $$;

-- 6. merge: survivor (oldest) owns every touch, first touch recomputed.
--    The unique phone index forbids duplicates, so drop it for this
--    check and rebuild it once the merge has removed them.
DROP INDEX idx_contacts_account_phone_normalized;
INSERT INTO contacts (id, user_id, account_id, phone, name, created_at) VALUES
 ('00000000-0000-0000-0069-0000000000a1', pg_temp.ctx('user_a'), pg_temp.ctx('acc_a'), '+91 69 777', 'Survivor', '2026-03-01 00:00+00'),
 ('00000000-0000-0000-0069-0000000000a2', pg_temp.ctx('user_a'), pg_temp.ctx('acc_a'), '+9169777',   'Loser',    '2026-04-01 00:00+00');
DO $$
DECLARE v_loser_ad UUID; v_c RECORD; v_merged INTEGER;
BEGIN
  PERFORM public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-0000000000a1', NULL,
    'wamid.m-s', '2026-11-03 10:00+00', 'direct', NULL, NULL, NULL, NULL, NULL);
  v_loser_ad := public.record_contact_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-0000000000a2', NULL,
    'wamid.m-l', '2026-11-03 09:00+00', 'ad', 'instagram', '130', NULL, NULL, NULL);

  v_merged := public.merge_duplicate_contacts();
  IF v_merged <> 1 THEN RAISE EXCEPTION '6: merged % contacts, expected 1', v_merged; END IF;
  IF EXISTS (SELECT 1 FROM contacts WHERE id = '00000000-0000-0000-0069-0000000000a2') THEN
    RAISE EXCEPTION '6: loser not deleted';
  END IF;
  IF (SELECT count(*) FROM contact_touches WHERE contact_id = '00000000-0000-0000-0069-0000000000a1') <> 2 THEN
    RAISE EXCEPTION '6: survivor does not own both touches';
  END IF;
  SELECT * INTO v_c FROM contacts WHERE id = '00000000-0000-0000-0069-0000000000a1';
  IF v_c.first_touch_id IS DISTINCT FROM v_loser_ad OR v_c.first_touch_source_type IS DISTINCT FROM 'ad'
     OR v_c.first_touch_ad_id IS DISTINCT FROM '130' THEN
    RAISE EXCEPTION '6: survivor first touch not recomputed: %', v_c.first_touch_source_type;
  END IF;
  RAISE NOTICE 'ok 6: merge repoints touches and recomputes';
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_phone_normalized
  ON contacts (account_id, phone_normalized)
  WHERE phone_normalized <> '';

-- 7 (second half). Still 0 after all of the above.
DO $$ BEGIN
  IF public.backfill_pre_existing_touches() <> 0 THEN RAISE EXCEPTION '7: backfill not idempotent'; END IF;
END $$;

-- 8. no touches → all five columns NULL; deleting a contact with
--    touches cascades cleanly despite the two-way FK.
DO $$
DECLARE v_c RECORD;
BEGIN
  DELETE FROM contact_touches WHERE contact_id = '00000000-0000-0000-0069-000000000004';
  PERFORM public.recompute_contact_first_touch(pg_temp.ctx('acc_a'), '00000000-0000-0000-0069-000000000004');
  SELECT * INTO v_c FROM contacts WHERE id = '00000000-0000-0000-0069-000000000004';
  IF v_c.first_touch_id IS NOT NULL OR v_c.first_touch_at IS NOT NULL OR v_c.first_touch_source_type IS NOT NULL
     OR v_c.first_touch_platform IS NOT NULL OR v_c.first_touch_ad_id IS NOT NULL THEN
    RAISE EXCEPTION '8: first_touch_* not cleared';
  END IF;

  DELETE FROM contacts WHERE id = '00000000-0000-0000-0069-000000000002';
  IF EXISTS (SELECT 1 FROM contact_touches WHERE contact_id = '00000000-0000-0000-0069-000000000002') THEN
    RAISE EXCEPTION '8: touches survived contact delete';
  END IF;
  RAISE NOTICE 'ok 8: clear + cascade';
END $$;

SELECT 'AD ANALYTICS 069 OK';
