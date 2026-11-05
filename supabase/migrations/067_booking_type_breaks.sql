-- ============================================================
-- 067_booking_type_breaks.sql — a daily break inside working hours
--
-- A booking type can now block one window each open day (a lunch
-- break, say 13:00-14:00). No booking may overlap it. Like the working
-- hours from 064 it is a local time in the account's timezone and is
-- checked in application code (`src/lib/bookings/slots.ts`), so the
-- CRM — not the model — decides whether a requested time is open.
--
-- Both columns NULL means no break. Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE booking_types
  ADD COLUMN IF NOT EXISTS break_from TIME,
  ADD COLUMN IF NOT EXISTS break_to TIME;

ALTER TABLE booking_types
  DROP CONSTRAINT IF EXISTS booking_types_break_check;

ALTER TABLE booking_types
  ADD CONSTRAINT booking_types_break_check
  CHECK (
    (break_from IS NULL AND break_to IS NULL)
    OR (break_from IS NOT NULL AND break_to IS NOT NULL AND break_from < break_to)
  );
