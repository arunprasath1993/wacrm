-- ============================================================
-- 060_crm_apps.sql — Multi-app marketing on one WhatsApp number
--
-- One wacrm account (one WhatsApp Business number, one Meta API) is
-- used to market several products — e.g. "Nixie CRM" and a payment
-- app — and more later. Each product is an "app":
--
--   crm_apps        name, slug, colour, icon, links, description
--     ├─ tag_id      the tag that marks a contact as this app's lead.
--     │              Reusing tags means contact filters, broadcast
--     │              audiences, automations ("tag added" triggers) and
--     │              the public API (`tags: ["Nixie CRM"]`) all work
--     │              per app with no extra plumbing.
--     └─ pipeline_id optional sales pipeline dedicated to the app.
--
--   broadcasts.app_id  which app a campaign was sent for (list filter).
--
-- Tenancy follows 017: every row carries account_id, members read,
-- admins+ write. A trigger refuses a tag / pipeline from another
-- account so an app can never point across tenants.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  color TEXT NOT NULL DEFAULT '#0ea5a4' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  icon TEXT CHECK (icon IS NULL OR char_length(icon) <= 16),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  website_url TEXT CHECK (website_url IS NULL OR (website_url ~* '^https?://[^\s]+$' AND char_length(website_url) <= 500)),
  signup_url TEXT CHECK (signup_url IS NULL OR (signup_url ~* '^https?://[^\s]+$' AND char_length(signup_url) <= 500)),
  tag_id UUID REFERENCES tags(id) ON DELETE SET NULL,
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_crm_apps_account ON crm_apps(account_id, position);
CREATE INDEX IF NOT EXISTS idx_crm_apps_tag ON crm_apps(tag_id);

DROP TRIGGER IF EXISTS set_updated_at ON crm_apps;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_apps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- cross-tenant guard ------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_apps_same_account_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tag_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tags t WHERE t.id = NEW.tag_id AND t.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'crm_apps.tag_id must belong to the same account'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.pipeline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pipelines p WHERE p.id = NEW.pipeline_id AND p.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'crm_apps.pipeline_id must belong to the same account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.crm_apps_same_account_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.crm_apps_same_account_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_apps_same_account ON crm_apps;
CREATE TRIGGER crm_apps_same_account
  BEFORE INSERT OR UPDATE OF account_id, tag_id, pipeline_id ON crm_apps
  FOR EACH ROW EXECUTE FUNCTION public.crm_apps_same_account_guard();

-- ---- RLS (settings-class: members read, admins write) -------------
ALTER TABLE crm_apps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_apps_select ON crm_apps;
DROP POLICY IF EXISTS crm_apps_insert ON crm_apps;
DROP POLICY IF EXISTS crm_apps_update ON crm_apps;
DROP POLICY IF EXISTS crm_apps_delete ON crm_apps;
CREATE POLICY crm_apps_select ON crm_apps FOR SELECT USING (is_account_member(account_id));
CREATE POLICY crm_apps_insert ON crm_apps FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY crm_apps_update ON crm_apps FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY crm_apps_delete ON crm_apps FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Supabase's default privileges grant anon on new tables; RLS would
-- block it anyway, but a private CRM table has no business with anon.
REVOKE ALL ON crm_apps FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_apps TO authenticated;
GRANT ALL ON crm_apps TO service_role;

-- ---- broadcasts.app_id ------------------------------------------
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES crm_apps(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_broadcasts_app ON broadcasts(app_id) WHERE app_id IS NOT NULL;

-- ============================================================
-- create_crm_app — one atomic call from Settings → Apps.
--
-- Finds or creates the app's tag (case-insensitive name match within
-- the account, so an existing "Nixie CRM" tag is adopted rather than
-- duplicated), optionally creates a dedicated pipeline with sensible
-- SaaS-funnel stages, then inserts the app row.
--
-- SECURITY INVOKER: every insert goes through the caller's RLS, so a
-- non-admin gets a policy violation instead of a back door.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_crm_app(
  p_name TEXT,
  p_slug TEXT,
  p_color TEXT DEFAULT '#0ea5a4',
  p_icon TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL,
  p_signup_url TEXT DEFAULT NULL,
  p_create_pipeline BOOLEAN DEFAULT TRUE
) RETURNS crm_apps
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_account UUID;
  v_tag UUID;
  v_pipeline UUID;
  v_position INTEGER;
  v_row crm_apps;
  v_name TEXT := btrim(coalesce(p_name, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_uid;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'no account for current user' USING ERRCODE = '28000';
  END IF;

  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'only admins can create apps' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_tag FROM tags
   WHERE account_id = v_account AND lower(btrim(name)) = lower(v_name)
   ORDER BY created_at
   LIMIT 1;

  IF v_tag IS NULL THEN
    INSERT INTO tags (user_id, account_id, name, color)
    VALUES (v_uid, v_account, v_name, coalesce(p_color, '#0ea5a4'))
    RETURNING id INTO v_tag;
  END IF;

  IF coalesce(p_create_pipeline, FALSE) THEN
    INSERT INTO pipelines (user_id, account_id, name)
    VALUES (v_uid, v_account, v_name || ' — Sales')
    RETURNING id INTO v_pipeline;

    INSERT INTO pipeline_stages (pipeline_id, name, position, color)
    VALUES
      (v_pipeline, 'New lead',   0, '#64748b'),
      (v_pipeline, 'Contacted',  1, '#0ea5e9'),
      (v_pipeline, 'Demo',       2, '#8b5cf6'),
      (v_pipeline, 'Trial',      3, '#f59e0b'),
      (v_pipeline, 'Won',        4, '#10b981'),
      (v_pipeline, 'Lost',       5, '#ef4444');
  END IF;

  SELECT coalesce(max(position) + 1, 0) INTO v_position
    FROM crm_apps WHERE account_id = v_account;

  INSERT INTO crm_apps (
    account_id, created_by, name, slug, color, icon, description,
    website_url, signup_url, tag_id, pipeline_id, position
  ) VALUES (
    v_account, v_uid, v_name, lower(btrim(p_slug)), coalesce(p_color, '#0ea5a4'),
    nullif(btrim(p_icon), ''), nullif(btrim(p_description), ''),
    nullif(btrim(p_website_url), ''), nullif(btrim(p_signup_url), ''),
    v_tag, v_pipeline, v_position
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_crm_app(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_crm_app(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ============================================================
-- redeem_invitation — re-declared from 047 with crm_apps added to the
-- "does the invitee's old personal account hold any data?" guard, so
-- accepting an invite can never silently cascade-delete apps someone
-- set up before joining. Body otherwise identical to 047.
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

-- ============================================================
-- filter_contacts_for_app — the Contacts list when an app is picked
-- in the app switcher: contacts carrying the app's tag AND (when any
-- are chosen) at least one of the extra filter tags. Same paging and
-- search contract as filter_contacts_by_tags (025). RLS applies
-- (SECURITY INVOKER), so it can only ever see the caller's account.
-- ============================================================
CREATE OR REPLACE FUNCTION public.filter_contacts_for_app(
  p_app_tag_id UUID,
  p_tag_ids UUID[] DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT c.id, c.created_at
    FROM contacts c
    WHERE EXISTS (
        SELECT 1 FROM contact_tags a
        WHERE a.contact_id = c.id AND a.tag_id = p_app_tag_id
      )
      AND (
        p_tag_ids IS NULL
        OR cardinality(p_tag_ids) = 0
        OR EXISTS (
          SELECT 1 FROM contact_tags t
          WHERE t.contact_id = c.id AND t.tag_id = ANY(p_tag_ids)
        )
      )
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_for_app(UUID, UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_for_app(UUID, UUID[], TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filter_contacts_for_app(UUID, UUID[], TEXT, INT, INT) TO authenticated;
