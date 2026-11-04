-- ============================================================
-- 064_booking_slots.sql — availability for booking types
--
-- A booking can only be confirmed into a slot that is actually free.
-- Each type says when it runs and how many bookings can overlap, e.g.
-- one demo presenter (capacity 1) or three installation crews
-- (capacity 3). NULL capacity means no limit, for things like callbacks.
--
-- Working hours are checked in application code because they depend on
-- the account's timezone and agents may override them. Capacity is
-- enforced here as well: two customers can confirm the same slot at the
-- same moment, and only the database can settle that race.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE booking_types
  ADD COLUMN IF NOT EXISTS slot_capacity INTEGER DEFAULT 1
    CHECK (slot_capacity IS NULL OR slot_capacity BETWEEN 1 AND 1000),
  -- ISO weekdays: 1 = Monday ... 7 = Sunday.
  ADD COLUMN IF NOT EXISTS available_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6}'
    CHECK (available_days <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]),
  ADD COLUMN IF NOT EXISTS available_from TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS available_to TIME NOT NULL DEFAULT '18:00';

-- 'needs_review' holds its slot too: it is a real customer waiting for a
-- detail, not a free time. A booking whose slot could not be honoured is
-- saved without a time, so it holds nothing.
CREATE INDEX IF NOT EXISTS idx_bookings_type_schedule
  ON bookings(booking_type_id, scheduled_at)
  WHERE status IN ('open', 'needs_review') AND scheduled_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bookings_enforce_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity INTEGER;
  v_duration INTEGER;
  v_end TIMESTAMPTZ;
  v_taken INTEGER;
BEGIN
  IF NEW.scheduled_at IS NULL OR NEW.status NOT IN ('open', 'needs_review') THEN
    RETURN NEW;
  END IF;

  SELECT slot_capacity, duration_minutes INTO v_capacity, v_duration
  FROM booking_types WHERE id = NEW.booking_type_id;

  IF v_capacity IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialises writers per type until the transaction ends; without it
  -- two concurrent inserts would each count the other as absent.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.booking_type_id::TEXT, 0));

  v_end := NEW.scheduled_at + make_interval(mins => v_duration);

  SELECT count(*) INTO v_taken
  FROM bookings b
  WHERE b.booking_type_id = NEW.booking_type_id
    AND b.id <> NEW.id
    AND b.status IN ('open', 'needs_review')
    AND b.scheduled_at IS NOT NULL
    AND b.scheduled_at < v_end
    AND b.scheduled_at + make_interval(mins => v_duration) > NEW.scheduled_at;

  IF v_taken >= v_capacity THEN
    RAISE EXCEPTION 'booking slot is full' USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.bookings_enforce_capacity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bookings_enforce_capacity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_enforce_capacity ON bookings;
CREATE TRIGGER bookings_enforce_capacity
  BEFORE INSERT OR UPDATE OF scheduled_at, status, booking_type_id ON bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_enforce_capacity();
