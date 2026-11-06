-- ============================================================
-- 068_ai_reply_caps.sql — admin-set reply caps + testing numbers
--
-- 1. The customer cap (`auto_reply_max_per_conversation`) loses its
--    1..20 CHECK from 029. Any whole number >= 1 is allowed; the only
--    ceiling is the `integer` type itself (2,147,483,647). Saved values
--    are left exactly as they are.
-- 2. `auto_reply_max_testing` — the cap used when the conversation's
--    contact is on the account's testing list. Default 1000.
-- 3. `testing_numbers` — the admin-managed testing list, stored in
--    E.164 (`+919876543210`). Normalization and de-duplication happen
--    in application code (`src/lib/ai/reply-cap.ts`). Default empty.
--
-- Cap selection runs in app code; `claim_ai_reply_slot` already takes
-- the cap as a parameter, so it is unchanged.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- Drop the 1..20 CHECK on the customer cap. Postgres auto-named the
-- inline column CHECK from 029; look it up rather than assume the name.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.ai_configs'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%auto_reply_max_per_conversation%'
      AND con.conname <> 'ai_configs_auto_reply_max_min_check'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_configs DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_min_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_min_check
  CHECK (auto_reply_max_per_conversation >= 1);

-- Testing cap. ADD COLUMN with a constant DEFAULT backfills every
-- existing row with 1000.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_reply_max_testing integer NOT NULL DEFAULT 1000;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_testing_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_testing_check
  CHECK (auto_reply_max_testing >= 1);

-- Testing numbers. Existing rows get an empty list.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS testing_numbers text[] NOT NULL DEFAULT '{}';
