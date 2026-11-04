-- ============================================================
-- 061_whatsapp_provider.sql — which WhatsApp API provider a
-- connection uses.
--
-- Today every connection is Meta's official Cloud API
-- ('meta_cloud'). The column lets a later release plug in a BSP
-- (Gupshup, Interakt, AiSensy, Twilio, 360dialog, …) per account
-- without another schema change: the app resolves an adapter from
-- src/lib/whatsapp/providers by this id. The CHECK only pins the
-- shape of the id (lowercase slug), not a closed list, so adding a
-- provider is a code change, not a migration.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta_cloud';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_provider_slug'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_slug
      CHECK (provider ~ '^[a-z][a-z0-9_]{1,39}$');
  END IF;
END $$;

COMMENT ON COLUMN whatsapp_config.provider IS
  'WhatsApp API provider adapter id (src/lib/whatsapp/providers). Default meta_cloud = official Meta Cloud API.';
