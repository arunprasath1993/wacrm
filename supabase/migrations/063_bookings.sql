-- ============================================================
-- 063_bookings.sql — AI-captured follow-ups for any business
--
-- What the AI agent commits to in a chat has to outlive the chat. One
-- business books online demos, another schedules installation visits
-- or callback times, so nothing here is demo-specific:
--
--   booking_types  per-account definition: which details to collect,
--                  when, for how long, and who follows up.
--   bookings       one row per commitment. The same row is the task in
--                  the list and, once it has a time, the calendar event
--                  — storing those separately would let them drift.
--
-- A contact holds at most one open booking per type, so the model
-- re-confirming or rescheduling updates that row instead of adding a
-- duplicate.
--
-- Tenancy follows 017/060: every row carries account_id, a trigger
-- refuses references across accounts, members read. Types are
-- settings-class (admins write); bookings are operational (agents
-- write, admins delete).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- Accounts had no timezone. "Tomorrow at 11 AM" needs one to become an
-- instant, and every deployment so far is in India.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata'
    CHECK (char_length(time_zone) BETWEEN 1 AND 64);

-- ---- booking_types ----------------------------------------------
CREATE TABLE IF NOT EXISTS booking_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  -- Stable identifier the model echoes back in its booking marker.
  key TEXT NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Soft delete: bookings keep pointing at the type they were made under.
  archived_at TIMESTAMPTZ,
  -- [{ key, label, required, maps_to }] — see src/lib/bookings/types.ts.
  fields JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  time_mode TEXT NOT NULL DEFAULT 'required'
    CHECK (time_mode IN ('required', 'optional', 'none')),
  duration_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (duration_minutes BETWEEN 5 AND 1440),
  -- Extra rules for the AI, e.g. "Monday to Saturday, 9 AM to 6 PM only".
  instructions TEXT CHECK (instructions IS NULL OR char_length(instructions) <= 1000),
  assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Off by default: assigning the chat stops the bot answering in it.
  handoff_on_confirm BOOLEAN NOT NULL DEFAULT FALSE,
  -- NULL = no reminder.
  remind_minutes_before INTEGER DEFAULT 60
    CHECK (remind_minutes_before IS NULL OR remind_minutes_before BETWEEN 0 AND 10080),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS idx_booking_types_account ON booking_types(account_id, position);

DROP TRIGGER IF EXISTS set_updated_at ON booking_types;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON booking_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- bookings ---------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NO ACTION rather than RESTRICT: it is checked after the cascades of
  -- an account delete, so that delete still succeeds.
  booking_type_id UUID NOT NULL REFERENCES booking_types(id),
  -- SET NULL like deals (004): the captured details survive the contact.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'needs_review', 'done', 'cancelled')),
  fields JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fields) = 'object'),
  scheduled_at TIMESTAMPTZ,
  -- The customer's own words, kept even when they could not be parsed.
  scheduled_text TEXT CHECK (scheduled_text IS NULL OR char_length(scheduled_text) <= 200),
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Maintained by the bookings_set_remind_at trigger below.
  remind_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_open_per_contact_type
  ON bookings(contact_id, booking_type_id)
  WHERE status IN ('open', 'needs_review');
CREATE INDEX IF NOT EXISTS idx_bookings_account_schedule
  ON bookings(account_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bookings_contact ON bookings(contact_id);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned ON bookings(assigned_to);
CREATE INDEX IF NOT EXISTS idx_bookings_due_reminders
  ON bookings(remind_at)
  WHERE reminded_at IS NULL AND status IN ('open', 'needs_review');

DROP TRIGGER IF EXISTS set_updated_at ON bookings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- cross-tenant guards ----------------------------------------
CREATE OR REPLACE FUNCTION public.booking_types_same_account_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assignee_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = NEW.assignee_user_id AND p.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'booking_types.assignee_user_id must belong to the same account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.booking_types_same_account_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.booking_types_same_account_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_types_same_account ON booking_types;
CREATE TRIGGER booking_types_same_account
  BEFORE INSERT OR UPDATE OF account_id, assignee_user_id ON booking_types
  FOR EACH ROW EXECUTE FUNCTION public.booking_types_same_account_guard();

CREATE OR REPLACE FUNCTION public.bookings_same_account_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM booking_types t
    WHERE t.id = NEW.booking_type_id AND t.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'bookings.booking_type_id must belong to the same account'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'bookings.contact_id must belong to the same account'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = NEW.conversation_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'bookings.conversation_id must belong to the same account'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = NEW.assigned_to AND p.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'bookings.assigned_to must belong to the same account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.bookings_same_account_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bookings_same_account_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_same_account ON bookings;
CREATE TRIGGER bookings_same_account
  BEFORE INSERT OR UPDATE OF account_id, booking_type_id, contact_id, conversation_id, assigned_to
  ON bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_same_account_guard();

-- ---- reminder schedule ------------------------------------------
-- Derived here, not in application code, so the AI path and the manual
-- API can't disagree. Moving a booking re-arms its reminder.
CREATE OR REPLACE FUNCTION public.bookings_set_remind_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minutes INTEGER;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
     AND NEW.booking_type_id = OLD.booking_type_id THEN
    RETURN NEW;
  END IF;

  SELECT remind_minutes_before INTO v_minutes
  FROM booking_types WHERE id = NEW.booking_type_id;

  NEW.remind_at := CASE
    WHEN NEW.scheduled_at IS NOT NULL AND v_minutes IS NOT NULL
      THEN NEW.scheduled_at - make_interval(mins => v_minutes)
  END;
  NEW.reminded_at := NULL;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.bookings_set_remind_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bookings_set_remind_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_set_remind_at ON bookings;
CREATE TRIGGER bookings_set_remind_at
  BEFORE INSERT OR UPDATE OF scheduled_at, booking_type_id ON bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_set_remind_at();

-- ---- RLS --------------------------------------------------------
ALTER TABLE booking_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_types_select ON booking_types;
DROP POLICY IF EXISTS booking_types_insert ON booking_types;
DROP POLICY IF EXISTS booking_types_update ON booking_types;
DROP POLICY IF EXISTS booking_types_delete ON booking_types;
CREATE POLICY booking_types_select ON booking_types FOR SELECT USING (is_account_member(account_id));
CREATE POLICY booking_types_insert ON booking_types FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY booking_types_update ON booking_types FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY booking_types_delete ON booking_types FOR DELETE USING (is_account_member(account_id, 'admin'));

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bookings_select ON bookings;
DROP POLICY IF EXISTS bookings_insert ON bookings;
DROP POLICY IF EXISTS bookings_update ON bookings;
DROP POLICY IF EXISTS bookings_delete ON bookings;
CREATE POLICY bookings_select ON bookings FOR SELECT USING (is_account_member(account_id));
CREATE POLICY bookings_insert ON bookings FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY bookings_update ON bookings FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY bookings_delete ON bookings FOR DELETE USING (is_account_member(account_id, 'admin'));

REVOKE ALL ON booking_types FROM anon;
REVOKE ALL ON bookings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO authenticated;
GRANT ALL ON booking_types TO service_role;
GRANT ALL ON bookings TO service_role;

-- ---- notifications ----------------------------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_booking
  ON notifications(booking_id) WHERE booking_id IS NOT NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'booking_assigned', 'booking_reminder'));

-- Mirrors notify_conversation_assigned (027).
CREATE OR REPLACE FUNCTION public.notify_booking_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_type_name TEXT;
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_to THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  SELECT name INTO v_type_name FROM booking_types WHERE id = NEW.booking_type_id;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    booking_id, actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_to,
    'booking_assigned',
    NEW.conversation_id,
    NEW.contact_id,
    NEW.id,
    auth.uid(),
    'New booking assigned',
    COALESCE(v_type_name, 'Booking') || ' with ' || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block saving the booking itself.
  RAISE WARNING 'Failed to create booking notification for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_booking_assigned() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_booking_assigned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_booking_assigned ON bookings;
CREATE TRIGGER on_booking_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_booking_assigned();

-- ============================================================
-- redeem_invitation — re-declared from 060 with booking_types and
-- bookings added to the "does the invitee's old personal account hold
-- any data?" guard. Body otherwise identical to 060.
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
