-- ============================================================
-- 069_ad_analytics.sql — Meta ad attribution + ads tables (Phase 1)
--
-- Capture side of Ad Analytics (spec docs/superpowers/specs/
-- 2026-11-08-ad-analytics-design.md §1/§2):
--
--   messages.referral       raw Click-to-WhatsApp referral, stored in the
--                           same insert as the inbound message — the
--                           durable copy a lost touch is rebuilt from.
--   contact_touches         append-only history of how a contact arrived
--                           (ad / post / direct / pre_existing).
--   contacts.first_touch_*  denormalised earliest touch, maintained only
--                           by recompute_contact_first_touch.
--   meta_ads_config         per-account ad account + (encrypted) token.
--   meta_ad_entities        ad / ad set / campaign names.
--   meta_ad_insights_daily  spend per ad x day x placement.
--
-- First touch = earliest touched_at (Meta's message timestamp), ties by
-- source rank (ad, post, direct, pre_existing) then id, so processing
-- order never matters.
--
-- Touches and synced ads data are written by the service role only;
-- members read. meta_ads_config holds a token, so it is admin-only and
-- other members read status through get_meta_ads_status(), which never
-- returns access_token.
--
-- Report functions land in 070. Idempotent — safe to re-run.
-- ============================================================

-- ---- messages.referral ------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS referral JSONB;

CREATE INDEX IF NOT EXISTS idx_messages_referral
  ON messages(conversation_id) WHERE referral IS NOT NULL;

-- ---- contact_touches --------------------------------------------
CREATE TABLE IF NOT EXISTS contact_touches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- Meta's wamid (same value as messages.message_id, not messages.id).
  -- NULL for pre_existing touches.
  message_id TEXT,
  touched_at TIMESTAMPTZ NOT NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('ad', 'post', 'direct', 'pre_existing')),
  -- NULL for direct and pre_existing.
  platform TEXT
    CHECK (platform IS NULL OR platform IN ('facebook', 'instagram', 'whatsapp', 'unknown')),
  ad_id TEXT,
  ctwa_clid TEXT,
  headline TEXT,
  referral JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook replays of the same message are no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_touches_account_message
  ON contact_touches(account_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_touches_contact_time
  ON contact_touches(contact_id, touched_at);

-- ---- contacts.first_touch_* -------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS first_touch_id UUID REFERENCES contact_touches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_touch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_touch_source_type TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_platform TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_ad_id TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_first_touch
  ON contacts(account_id, first_touch_source_type, first_touch_at);

-- ---- meta_ads_config --------------------------------------------
CREATE TABLE IF NOT EXISTS meta_ads_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ad_account_id TEXT NOT NULL CHECK (ad_account_id ~ '^act_[0-9]+$'),
  -- Encrypted (src/lib/whatsapp/encryption). NULL = reuse the WhatsApp
  -- config token.
  access_token TEXT,
  currency TEXT,
  timezone TEXT,
  backfill_days INTEGER NOT NULL DEFAULT 90 CHECK (backfill_days BETWEEN 1 AND 1095),
  last_synced_at TIMESTAMPTZ,
  -- Sanitised, human-readable message only — never a Graph URL, body
  -- or anything containing a token.
  last_sync_error TEXT,
  last_sync_failed_at TIMESTAMPTZ,
  -- Sync lock; treated as stale after 15 minutes.
  sync_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON meta_ads_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_ads_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- meta_ad_entities -------------------------------------------
CREATE TABLE IF NOT EXISTS meta_ad_entities (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  effective_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, ad_id)
);

DROP TRIGGER IF EXISTS set_updated_at ON meta_ad_entities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_ad_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- meta_ad_insights_daily -------------------------------------
CREATE TABLE IF NOT EXISTS meta_ad_insights_daily (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ad_id TEXT NOT NULL,
  publisher_platform TEXT NOT NULL,
  spend NUMERIC(14,2) NOT NULL DEFAULT 0,
  impressions BIGINT,
  clicks BIGINT,
  -- action onsite_conversion.messaging_conversation_started_7d
  meta_conversations INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, date, ad_id, publisher_platform)
);

-- ---- RLS --------------------------------------------------------
-- Service-role-only writes: no write policies, and no write grants.
ALTER TABLE contact_touches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_touches_select ON contact_touches;
CREATE POLICY contact_touches_select ON contact_touches FOR SELECT USING (is_account_member(account_id));

ALTER TABLE meta_ad_entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_ad_entities_select ON meta_ad_entities;
CREATE POLICY meta_ad_entities_select ON meta_ad_entities FOR SELECT USING (is_account_member(account_id));

ALTER TABLE meta_ad_insights_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_ad_insights_daily_select ON meta_ad_insights_daily;
CREATE POLICY meta_ad_insights_daily_select ON meta_ad_insights_daily FOR SELECT USING (is_account_member(account_id));

-- Holds the token: admins only, for every command.
ALTER TABLE meta_ads_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_ads_config_select ON meta_ads_config;
DROP POLICY IF EXISTS meta_ads_config_insert ON meta_ads_config;
DROP POLICY IF EXISTS meta_ads_config_update ON meta_ads_config;
DROP POLICY IF EXISTS meta_ads_config_delete ON meta_ads_config;
CREATE POLICY meta_ads_config_select ON meta_ads_config FOR SELECT USING (is_account_member(account_id, 'admin'));
CREATE POLICY meta_ads_config_insert ON meta_ads_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY meta_ads_config_update ON meta_ads_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY meta_ads_config_delete ON meta_ads_config FOR DELETE USING (is_account_member(account_id, 'admin'));

REVOKE ALL ON contact_touches FROM anon, authenticated;
REVOKE ALL ON meta_ad_entities FROM anon, authenticated;
REVOKE ALL ON meta_ad_insights_daily FROM anon, authenticated;
REVOKE ALL ON meta_ads_config FROM anon;
GRANT SELECT ON contact_touches TO authenticated;
GRANT SELECT ON meta_ad_entities TO authenticated;
GRANT SELECT ON meta_ad_insights_daily TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON meta_ads_config TO authenticated;
GRANT ALL ON contact_touches TO service_role;
GRANT ALL ON meta_ad_entities TO service_role;
GRANT ALL ON meta_ad_insights_daily TO service_role;
GRANT ALL ON meta_ads_config TO service_role;

-- ============================================================
-- recompute_contact_first_touch — points contacts.first_touch_* at the
-- contact's earliest touch, or NULLs all five when it has none. Only
-- writes when something changed, so callers don't churn updated_at.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_contact_first_touch(
  p_account_id UUID,
  p_contact_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_touch contact_touches%ROWTYPE;
BEGIN
  SELECT t.* INTO v_touch
  FROM contact_touches t
  WHERE t.account_id = p_account_id
    AND t.contact_id = p_contact_id
  ORDER BY t.touched_at,
           CASE t.source_type
             WHEN 'ad' THEN 0
             WHEN 'post' THEN 1
             WHEN 'direct' THEN 2
             ELSE 3
           END,
           t.id
  LIMIT 1;

  -- No touch leaves v_touch all NULL, which clears the columns.
  UPDATE contacts c
  SET first_touch_id = v_touch.id,
      first_touch_at = v_touch.touched_at,
      first_touch_source_type = v_touch.source_type,
      first_touch_platform = v_touch.platform,
      first_touch_ad_id = v_touch.ad_id
  WHERE c.id = p_contact_id
    AND c.account_id = p_account_id
    AND (c.first_touch_id, c.first_touch_at, c.first_touch_source_type,
         c.first_touch_platform, c.first_touch_ad_id)
        IS DISTINCT FROM
        (v_touch.id, v_touch.touched_at, v_touch.source_type,
         v_touch.platform, v_touch.ad_id);
END;
$$;

ALTER FUNCTION public.recompute_contact_first_touch(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.recompute_contact_first_touch(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_contact_first_touch(UUID, UUID) TO service_role;

-- ============================================================
-- record_contact_touch — atomic touch insert + first-touch update.
-- The contact row lock serialises overlapping calls for one contact.
-- Returns the touch id (the existing one when p_message_id was already
-- recorded for this account).
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_contact_touch(
  p_account_id UUID,
  p_contact_id UUID,
  p_conversation_id UUID,
  p_message_id TEXT,
  p_touched_at TIMESTAMPTZ,
  p_source_type TEXT,
  p_platform TEXT,
  p_ad_id TEXT,
  p_ctwa_clid TEXT,
  p_headline TEXT,
  p_referral JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM 1 FROM contacts WHERE id = p_contact_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact % does not belong to account %', p_contact_id, p_account_id
      USING ERRCODE = '23514';
  END IF;

  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conversation_id AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'conversation % does not belong to account %', p_conversation_id, p_account_id
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO contact_touches (
    account_id, contact_id, conversation_id, message_id, touched_at,
    source_type, platform, ad_id, ctwa_clid, headline, referral
  ) VALUES (
    p_account_id, p_contact_id, p_conversation_id, p_message_id, p_touched_at,
    p_source_type, p_platform, p_ad_id, p_ctwa_clid, p_headline, p_referral
  )
  ON CONFLICT (account_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT t.id INTO v_id
    FROM contact_touches t
    WHERE t.account_id = p_account_id AND t.message_id = p_message_id;
  END IF;

  PERFORM public.recompute_contact_first_touch(p_account_id, p_contact_id);

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.record_contact_touch(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_contact_touch(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contact_touch(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ============================================================
-- backfill_pre_existing_touches — one pre_existing touch for every
-- contact that already has a customer message and no touch yet, then
-- recompute its first touch. Contacts that never messaged get nothing,
-- so their first ad message still counts as a new enquiry.
-- Re-runnable (NOT EXISTS guard); returns the number of touches added.
-- Run once more after the code deploy: SELECT backfill_pre_existing_touches();
-- ============================================================
CREATE OR REPLACE FUNCTION public.backfill_pre_existing_touches()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    INSERT INTO contact_touches (account_id, contact_id, touched_at, source_type)
    SELECT c.account_id,
           c.id,
           -- now() only guards the NOT NULL column against rows with
           -- neither timestamp.
           COALESCE(c.created_at, min(m.created_at), now()),
           'pre_existing'
    FROM contacts c
    JOIN conversations cv ON cv.contact_id = c.id
    JOIN messages m ON m.conversation_id = cv.id AND m.sender_type = 'customer'
    WHERE NOT EXISTS (SELECT 1 FROM contact_touches t WHERE t.contact_id = c.id)
    GROUP BY c.account_id, c.id, c.created_at
    RETURNING account_id, contact_id
  LOOP
    PERFORM public.recompute_contact_first_touch(v_row.account_id, v_row.contact_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

ALTER FUNCTION public.backfill_pre_existing_touches() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.backfill_pre_existing_touches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_pre_existing_touches() TO service_role;

SELECT public.backfill_pre_existing_touches();

-- ============================================================
-- merge_duplicate_contacts — re-declared from 022 with contact_touches
-- re-pointed to the survivor before the losers are deleted, then the
-- survivor's first touch recomputed. Body otherwise identical to 022;
-- grants as 044.
-- ============================================================
CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           phone_normalized,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM contacts
    WHERE phone_normalized <> ''
    GROUP BY account_id, phone_normalized
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    -- Plain re-point: these tables have no contact-scoped unique
    -- constraint. `conversations` is ON DELETE CASCADE, so this
    -- re-point is what saves its rows (and their messages) from
    -- being deleted with the loser contact.
    UPDATE conversations                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE contact_notes                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    -- contact_touches.contact_id is ON DELETE CASCADE: re-point so the
    -- loser's attribution history survives the merge.
    UPDATE contact_touches               SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);

    -- Conflict-guarded re-point for UNIQUE(contact_id, tag_id):
    -- move only tags the survivor doesn't already have, drop the rest.
    UPDATE contact_tags ct SET contact_id = v_survivor
      WHERE ct.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_tags s
          WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id
        );
    DELETE FROM contact_tags WHERE contact_id = ANY(v_losers);

    -- Same guard for UNIQUE(contact_id, custom_field_id). Survivor's
    -- own value wins on conflict.
    UPDATE contact_custom_values cv SET contact_id = v_survivor
      WHERE cv.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_custom_values s
          WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id
        );
    DELETE FROM contact_custom_values WHERE contact_id = ANY(v_losers);

    -- flow_runs has a partial UNIQUE on active runs per contact.
    -- Re-point only NON-active runs (exempt from the partial index)
    -- to preserve history; any active loser run is left to be
    -- NULLed by its FK's ON DELETE SET NULL when the loser is
    -- removed below — avoids colliding with the survivor's active run.
    UPDATE flow_runs SET contact_id = v_survivor
      WHERE contact_id = ANY(v_losers) AND status <> 'active';

    DELETE FROM contacts WHERE id = ANY(v_losers);

    -- Earliest touch across the merged history wins.
    PERFORM public.recompute_contact_first_touch(v_group.account_id, v_survivor);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;

ALTER FUNCTION public.merge_duplicate_contacts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts() TO service_role;

-- ============================================================
-- get_meta_ads_status — non-secret sync status for any member (the
-- page banner). Never selects access_token. Returns one row; when the
-- account has no config, connected = false and the rest NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_meta_ads_status(
  p_account_id UUID
) RETURNS TABLE (
  connected BOOLEAN,
  ad_account_id TEXT,
  currency TEXT,
  timezone TEXT,
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,
  syncing BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_account_member(p_account_id) THEN
    RAISE EXCEPTION 'Not a member of this account' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT TRUE,
           c.ad_account_id,
           c.currency,
           c.timezone,
           c.last_synced_at,
           c.last_sync_error,
           COALESCE(c.sync_started_at > now() - interval '15 minutes', FALSE)
    FROM meta_ads_config c
    WHERE c.account_id = p_account_id;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT, FALSE;
  END IF;
END;
$$;

ALTER FUNCTION public.get_meta_ads_status(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_meta_ads_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meta_ads_status(UUID) TO authenticated, service_role;

-- ============================================================
-- redeem_invitation — re-declared from 063 with the four tables above
-- added to the "does the invitee's old personal account hold any
-- data?" guard. Body otherwise identical to 063.
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM crm_apps WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM booking_types WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM bookings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_touches WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM meta_ads_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM meta_ad_entities WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM meta_ad_insights_daily WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
