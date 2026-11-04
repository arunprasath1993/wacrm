-- ============================================================
-- 065_webhook_inbound_log.sql
--
-- Diagnostic trail for the Meta webhook. Hosts whose runtime logs we
-- can't read (Hostinger) gave no way to tell "Meta never delivered the
-- inbound message" apart from "we received it and dropped it". With
-- WEBHOOK_DEBUG_LOG=true the webhook writes one row per change it
-- receives (signature result, field, which keys the payload carried)
-- and one row per inbound message saying where processing ended.
--
-- Off unless the env flag is set. Service role only: RLS is on with no
-- policies, so no dashboard user can read or write it.
--
-- Clean up when done:  truncate webhook_inbound_log;
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_inbound_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at      timestamptz NOT NULL DEFAULT now(),
  signature_ok     boolean NOT NULL,
  field            text,
  phone_number_id  text,
  message_id       text,
  message_type     text,
  status_count     integer NOT NULL DEFAULT 0,
  outcome          text NOT NULL,
  detail           text
);

CREATE INDEX IF NOT EXISTS idx_webhook_inbound_log_received_at
  ON webhook_inbound_log (received_at DESC);

ALTER TABLE webhook_inbound_log ENABLE ROW LEVEL SECURITY;
