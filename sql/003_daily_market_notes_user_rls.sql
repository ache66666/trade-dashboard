-- Trading Journal v0.3: user ownership and Row Level Security.
--
-- Execution contract:
--   This file is a transaction body and must only be executed by the dedicated
--   Staging runner. The runner begins the transaction and sets the following
--   transaction-local setting with a parameterized query before this file:
--
--     select set_config(
--       'app.journal_legacy_owner_user_id',
--       $1,
--       true
--     );
--
--   $1 must be JOURNAL_LEGACY_OWNER_USER_ID from the protected Staging
--   environment. Never substitute or commit the UUID into this SQL file.
--
-- Rollback policy:
--   Before any multi-user writes, the transaction itself is the rollback
--   boundary: any failed assertion rolls back every schema, data and policy
--   change. After multi-user writes exist, restoring UNIQUE(note_date) or
--   dropping user_id would destroy valid ownership information and is not a
--   safe automatic rollback. Keep the migrated schema and revert application
--   code with a user-aware compatibility patch instead.

DO $migration$
DECLARE
  target_table regclass := to_regclass('public.daily_market_notes');
  owner_setting text := nullif(
    current_setting('app.journal_legacy_owner_user_id', true),
    ''
  );
  legacy_owner uuid;
  user_id_preexisting boolean;
  composite_unique_preexisting boolean;
  total_rows bigint;
  null_owner_rows bigint;
  preowned_rows bigint;
  backfilled_rows bigint;
  legacy_dates date[];
BEGIN
  IF target_table IS NULL THEN
    RAISE EXCEPTION 'Required table public.daily_market_notes does not exist';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_market_notes'
      AND column_name = 'user_id'
  ) INTO user_id_preexisting;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_attribute user_col
      ON user_col.attrelid = con.conrelid
     AND user_col.attname = 'user_id'
    JOIN pg_attribute date_col
      ON date_col.attrelid = con.conrelid
     AND date_col.attname = 'note_date'
    WHERE con.conrelid = target_table
      AND con.contype = 'u'
      AND con.conkey = ARRAY[user_col.attnum, date_col.attnum]::smallint[]
  ) INTO composite_unique_preexisting;

  ALTER TABLE public.daily_market_notes
    ADD COLUMN IF NOT EXISTS user_id uuid;

  SELECT count(*),
         count(*) FILTER (WHERE user_id IS NULL),
         count(*) FILTER (WHERE user_id IS NOT NULL)
  INTO total_rows, null_owner_rows, preowned_rows
  FROM public.daily_market_notes;

  -- A pre-populated user_id column without the target constraint is not a
  -- recognized completed migration. Refuse to trust unknown ownership data.
  IF user_id_preexisting
     AND total_rows > 0
     AND null_owner_rows = 0
     AND NOT composite_unique_preexisting THEN
    RAISE EXCEPTION
      'Existing Journal ownership cannot be verified automatically';
  END IF;

  IF null_owner_rows > 0 THEN
    IF preowned_rows <> 0 OR total_rows <> 2 THEN
      RAISE EXCEPTION
        'Legacy Journal ownership is partially or unexpectedly populated';
    END IF;

    IF null_owner_rows <> 2 THEN
      RAISE EXCEPTION
        'Expected exactly 2 legacy Journal rows, found %', null_owner_rows;
    END IF;

    SELECT array_agg(note_date ORDER BY note_date)
    INTO legacy_dates
    FROM public.daily_market_notes
    WHERE user_id IS NULL;

    IF legacy_dates <> ARRAY[DATE '2026-07-14', DATE '2026-07-15'] THEN
      RAISE EXCEPTION 'Legacy Journal dates do not match the approved set';
    END IF;

    IF owner_setting IS NULL THEN
      RAISE EXCEPTION
        'Missing app.journal_legacy_owner_user_id session setting';
    END IF;

    BEGIN
      legacy_owner := owner_setting::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Legacy Journal owner setting is not a valid UUID';
    END;

    IF NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = legacy_owner
    ) THEN
      RAISE EXCEPTION 'Legacy Journal owner does not exist in auth.users';
    END IF;

    UPDATE public.daily_market_notes
    SET user_id = legacy_owner
    WHERE user_id IS NULL;

    GET DIAGNOSTICS backfilled_rows = ROW_COUNT;
    IF backfilled_rows <> 2 THEN
      RAISE EXCEPTION
        'Expected to backfill exactly 2 legacy Journal rows, updated %',
        backfilled_rows;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.daily_market_notes
    WHERE user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Journal migration left rows without an owner';
  END IF;
END
$migration$;

ALTER TABLE public.daily_market_notes
  ALTER COLUMN user_id SET NOT NULL;

-- Drop the known legacy constraint and any equivalent single-column unique
-- constraint that may have been created under a different name.
ALTER TABLE public.daily_market_notes
  DROP CONSTRAINT IF EXISTS daily_market_notes_note_date_key;

DO $drop_legacy_unique$
DECLARE
  target_table regclass := 'public.daily_market_notes'::regclass;
  note_date_attnum smallint;
  legacy_constraint record;
BEGIN
  SELECT attnum
  INTO note_date_attnum
  FROM pg_attribute
  WHERE attrelid = target_table
    AND attname = 'note_date'
    AND NOT attisdropped;

  FOR legacy_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = target_table
      AND contype = 'u'
      AND conkey = ARRAY[note_date_attnum]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.daily_market_notes DROP CONSTRAINT IF EXISTS %I',
      legacy_constraint.conname
    );
  END LOOP;
END
$drop_legacy_unique$;

DO $add_constraints$
DECLARE
  target_table regclass := 'public.daily_market_notes'::regclass;
  auth_users_table regclass := 'auth.users'::regclass;
  user_id_attnum smallint;
  note_date_attnum smallint;
  auth_user_id_attnum smallint;
  named_unique record;
  named_foreign_key record;
BEGIN
  SELECT attnum INTO user_id_attnum
  FROM pg_attribute
  WHERE attrelid = target_table
    AND attname = 'user_id'
    AND NOT attisdropped;

  SELECT attnum INTO note_date_attnum
  FROM pg_attribute
  WHERE attrelid = target_table
    AND attname = 'note_date'
    AND NOT attisdropped;

  SELECT attnum INTO auth_user_id_attnum
  FROM pg_attribute
  WHERE attrelid = auth_users_table
    AND attname = 'id'
    AND NOT attisdropped;

  SELECT contype, conkey
  INTO named_unique
  FROM pg_constraint
  WHERE conrelid = target_table
    AND conname = 'daily_market_notes_user_date_key';

  IF NOT FOUND THEN
    ALTER TABLE public.daily_market_notes
      ADD CONSTRAINT daily_market_notes_user_date_key
      UNIQUE (user_id, note_date);
  ELSIF named_unique.contype <> 'u'
        OR named_unique.conkey <>
           ARRAY[user_id_attnum, note_date_attnum]::smallint[] THEN
    RAISE EXCEPTION
      'Constraint daily_market_notes_user_date_key has an unexpected definition';
  END IF;

  SELECT contype, conkey, confrelid, confkey, confdeltype
  INTO named_foreign_key
  FROM pg_constraint
  WHERE conrelid = target_table
    AND conname = 'daily_market_notes_user_id_fkey';

  IF NOT FOUND THEN
    ALTER TABLE public.daily_market_notes
      ADD CONSTRAINT daily_market_notes_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE RESTRICT
      NOT VALID;
  ELSIF named_foreign_key.contype <> 'f'
        OR named_foreign_key.conkey <> ARRAY[user_id_attnum]::smallint[]
        OR named_foreign_key.confrelid <> auth_users_table
        OR named_foreign_key.confkey <> ARRAY[auth_user_id_attnum]::smallint[]
        OR named_foreign_key.confdeltype <> 'r' THEN
    RAISE EXCEPTION
      'Constraint daily_market_notes_user_id_fkey has an unexpected definition';
  END IF;
END
$add_constraints$;

ALTER TABLE public.daily_market_notes
  VALIDATE CONSTRAINT daily_market_notes_user_id_fkey;

COMMENT ON COLUMN public.daily_market_notes.user_id IS
  'Supabase Auth user that owns this private Trading Journal entry.';

ALTER TABLE public.daily_market_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_market_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_market_notes_select_own
  ON public.daily_market_notes;
CREATE POLICY daily_market_notes_select_own
  ON public.daily_market_notes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS daily_market_notes_insert_own
  ON public.daily_market_notes;
CREATE POLICY daily_market_notes_insert_own
  ON public.daily_market_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS daily_market_notes_update_own
  ON public.daily_market_notes;
CREATE POLICY daily_market_notes_update_own
  ON public.daily_market_notes
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS daily_market_notes_delete_own
  ON public.daily_market_notes;
CREATE POLICY daily_market_notes_delete_own
  ON public.daily_market_notes
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Remove the broad default privileges observed on the Staging table. The
-- authenticated role receives only the operations protected by the policies.
REVOKE ALL PRIVILEGES ON TABLE public.daily_market_notes FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.daily_market_notes FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.daily_market_notes TO authenticated;

REVOKE ALL PRIVILEGES
  ON SEQUENCE public.daily_market_notes_id_seq FROM anon;
REVOKE ALL PRIVILEGES
  ON SEQUENCE public.daily_market_notes_id_seq FROM authenticated;
GRANT USAGE
  ON SEQUENCE public.daily_market_notes_id_seq TO authenticated;
