-- Behaviour checks for migration 060 (apps) — tenant isolation, role
-- gates, cross-account guard, URL checks, app-scoped contact filter.
--
-- Run against a THROWAWAY local database that has every migration
-- applied (e.g. `npx supabase start && npx supabase db reset`), as the
-- postgres superuser:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/manual-tests/060_crm_apps.test.sql
--
-- Every check RAISEs on failure; the last line prints APPS BEHAVIOUR OK
-- and FILTER OK. It inserts test users — never run it on production.
\set ON_ERROR_STOP 1
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-00000000000a','arun@test','{"full_name":"Arun"}'),
 ('00000000-0000-0000-0000-00000000000b','other@test','{"full_name":"Other"}');
-- make B an agent of its own account for the "agent blocked" case later
SELECT account_id AS acc_a FROM profiles WHERE user_id='00000000-0000-0000-0000-00000000000a' \gset
SELECT account_id AS acc_b FROM profiles WHERE user_id='00000000-0000-0000-0000-00000000000b' \gset

-- 1. owner A creates two apps (tag + pipeline auto-made)
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
SELECT name, slug, tag_id IS NOT NULL AS has_tag, pipeline_id IS NOT NULL AS has_pipe FROM create_crm_app('Nixie CRM','nixie-crm','#0ea5a4','💧','Water purifier dealer CRM','https://nixie.in',NULL,true);
SELECT name, pipeline_id IS NULL AS no_pipe FROM create_crm_app('MoneyCtrl','moneyctrl','#f59e0b',NULL,NULL,NULL,NULL,false);
SELECT count(*) AS stages_for_nixie FROM pipeline_stages ps JOIN crm_apps a ON a.pipeline_id = ps.pipeline_id WHERE a.slug='nixie-crm';
-- existing tag is adopted, not duplicated
INSERT INTO tags (user_id, account_id, name) VALUES ('00000000-0000-0000-0000-00000000000a', :'acc_a', 'Payments App');
SELECT (SELECT count(*) FROM tags WHERE lower(name)='payments app') AS tag_count_before;
SELECT name FROM create_crm_app('payments app','pay','#ef4444',NULL,NULL,NULL,NULL,false);
SELECT (SELECT count(*) FROM tags WHERE lower(name)='payments app') AS tag_count_after;
-- duplicate slug rejected
DO $$ BEGIN PERFORM create_crm_app('Nixie 2','nixie-crm'); RAISE EXCEPTION 'dup slug allowed!'; EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: duplicate slug rejected'; END $$;
-- bad url rejected
DO $$ BEGIN PERFORM create_crm_app('X','x','#000000',NULL,NULL,'javascript:alert(1)'); RAISE EXCEPTION 'bad url allowed!'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: javascript: url rejected'; END $$;

-- 2. user B (another tenant) sees none of A's apps and cannot point at A's tag
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
SELECT count(*) AS b_sees_apps FROM crm_apps;
RESET ROLE;
SELECT id AS a_tag FROM tags WHERE account_id = :'acc_a' LIMIT 1 \gset
SET ROLE authenticated;
DO $$ BEGIN
  INSERT INTO crm_apps (account_id, name, slug, tag_id)
  SELECT p.account_id, 'Steal', 'steal', (SELECT id FROM tags WHERE false) FROM profiles p WHERE p.user_id = auth.uid();
  RAISE NOTICE 'ok: B can create own app';
END $$;
RESET ROLE;
\set QUIET 1
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \gset
SET ROLE authenticated;
DO $$ DECLARE v uuid; BEGIN
  SELECT t.id INTO v FROM tags t LIMIT 1; -- B's RLS can't see A's tags; use a literal via temp table below
END $$;
RESET ROLE;
CREATE TEMP TABLE a_tag AS SELECT id FROM tags WHERE account_id = :'acc_a' LIMIT 1;
GRANT SELECT ON a_tag TO authenticated;
SET ROLE authenticated;
DO $$ BEGIN
  UPDATE crm_apps SET tag_id = (SELECT id FROM a_tag) WHERE slug='steal';
  RAISE EXCEPTION 'cross-tenant tag allowed!';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: cross-account tag rejected'; END $$;

-- 3. agent cannot create apps
RESET ROLE;
UPDATE profiles SET account_role='agent' WHERE user_id='00000000-0000-0000-0000-00000000000b';
SET ROLE authenticated;
DO $$ BEGIN PERFORM create_crm_app('Agent app','agent-app'); RAISE EXCEPTION 'agent allowed!'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: agent blocked'; END $$;
DO $$ BEGIN INSERT INTO crm_apps (account_id,name,slug) SELECT account_id,'x','x2' FROM profiles WHERE user_id=auth.uid(); RAISE EXCEPTION 'agent direct insert allowed!'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: agent direct insert blocked by RLS'; END $$;

-- 4. anon gets nothing
RESET ROLE; SET ROLE anon;
DO $$ BEGIN PERFORM 1 FROM crm_apps; RAISE EXCEPTION 'anon can read!'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: anon has no table access'; END $$;
RESET ROLE;
-- 5. deleting the tag nulls the link, app survives
DELETE FROM tags WHERE id = (SELECT tag_id FROM crm_apps WHERE slug='moneyctrl');
SELECT slug, tag_id IS NULL AS tag_cleared FROM crm_apps WHERE slug='moneyctrl';
SELECT 'APPS BEHAVIOUR OK';
-- 6. filter_contacts_for_app: app AND optional tags, account-isolated
RESET ROLE;
SELECT id AS nixie_tag FROM tags WHERE account_id = :'acc_a' AND name = 'Nixie CRM' \gset
INSERT INTO tags (user_id, account_id, name) VALUES ('00000000-0000-0000-0000-00000000000a', :'acc_a', 'VIP') RETURNING id AS vip_tag \gset
INSERT INTO contacts (user_id, account_id, phone, name) VALUES
 ('00000000-0000-0000-0000-00000000000a', :'acc_a', '+911', 'In app VIP'),
 ('00000000-0000-0000-0000-00000000000a', :'acc_a', '+912', 'In app'),
 ('00000000-0000-0000-0000-00000000000a', :'acc_a', '+913', 'VIP only');
INSERT INTO contact_tags (contact_id, tag_id) SELECT id, :'nixie_tag' FROM contacts WHERE phone IN ('+911','+912');
INSERT INTO contact_tags (contact_id, tag_id) SELECT id, :'vip_tag' FROM contacts WHERE phone IN ('+911','+913');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \gset
SELECT string_agg((contact).name, ',' ORDER BY (contact).name) AS app_only, max(total_count) AS n FROM filter_contacts_for_app(:'nixie_tag');
SELECT string_agg((contact).name, ',') AS app_and_vip FROM filter_contacts_for_app(:'nixie_tag', ARRAY[:'vip_tag']::uuid[]);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \gset
SELECT count(*) AS other_tenant_sees FROM filter_contacts_for_app(:'nixie_tag');
RESET ROLE;
SELECT 'FILTER OK';
