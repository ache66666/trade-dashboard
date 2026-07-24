-- Morning Meeting Phase 1: private screenshot storage and one-to-one analysis.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.morning_meetings') IS NULL
     OR to_regclass('public.morning_meeting_images') IS NULL THEN
    RAISE EXCEPTION 'Morning Meeting base tables are required';
  END IF;
END
$$;

ALTER TABLE public.morning_meeting_images
  DROP CONSTRAINT IF EXISTS morning_meeting_images_status_check;
ALTER TABLE public.morning_meeting_images
  ADD CONSTRAINT morning_meeting_images_status_check
  CHECK (upload_status IN ('metadata_only', 'stored'));

ALTER TABLE public.morning_meeting_images
  DROP CONSTRAINT IF EXISTS morning_meeting_images_storage_state_check;
ALTER TABLE public.morning_meeting_images
  ADD CONSTRAINT morning_meeting_images_storage_state_check
  CHECK (
    (upload_status = 'metadata_only' AND storage_path IS NULL)
    OR
    (
      upload_status = 'stored'
      AND storage_path IS NOT NULL
      AND storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    )
  );

DO $$
DECLARE
  existing_bucket storage.buckets%ROWTYPE;
BEGIN
  SELECT * INTO existing_bucket
  FROM storage.buckets
  WHERE id = 'morning-meeting-images';

  IF NOT FOUND THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'morning-meeting-images',
      'morning-meeting-images',
      false,
      10485760,
      ARRAY['image/jpeg', 'image/png', 'image/webp']
    );
  ELSIF existing_bucket.public
     OR existing_bucket.file_size_limit IS DISTINCT FROM 10485760
     OR existing_bucket.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg', 'image/png', 'image/webp']::text[] THEN
    RAISE EXCEPTION 'Existing Morning Meeting storage bucket is not compliant';
  END IF;
END
$$;

DROP POLICY IF EXISTS morning_meeting_storage_select_own ON storage.objects;
DROP POLICY IF EXISTS morning_meeting_storage_insert_own ON storage.objects;
DROP POLICY IF EXISTS morning_meeting_storage_update_own ON storage.objects;
DROP POLICY IF EXISTS morning_meeting_storage_delete_own ON storage.objects;

CREATE POLICY morning_meeting_storage_select_own
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'morning-meeting-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY morning_meeting_storage_insert_own
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'morning-meeting-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY morning_meeting_storage_update_own
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'morning-meeting-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'morning-meeting-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY morning_meeting_storage_delete_own
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'morning-meeting-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE TABLE IF NOT EXISTS public.morning_meeting_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  extracted_text text NOT NULL DEFAULT '',
  structured_data jsonb,
  analysis_text text NOT NULL DEFAULT '',
  model_provider text,
  model_name text,
  prompt_version text,
  error_code text,
  error_message_safe text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT morning_meeting_analyses_meeting_key UNIQUE (meeting_id),
  CONSTRAINT morning_meeting_analyses_owner_fkey
    FOREIGN KEY (meeting_id, user_id)
    REFERENCES public.morning_meetings(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT morning_meeting_analyses_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT morning_meeting_analyses_error_length_check
    CHECK (error_message_safe IS NULL OR char_length(error_message_safe) <= 300),
  CONSTRAINT morning_meeting_analyses_result_state_check
    CHECK (
      (status = 'completed' AND structured_data IS NOT NULL AND completed_at IS NOT NULL)
      OR status <> 'completed'
    )
);

DO $$
DECLARE
  valid_columns integer;
  actual_columns integer;
  required_constraints integer;
BEGIN
  WITH expected(name, data_type, not_null) AS (
    VALUES
      ('id', 'uuid', true),
      ('meeting_id', 'uuid', true),
      ('user_id', 'uuid', true),
      ('status', 'text', true),
      ('extracted_text', 'text', true),
      ('structured_data', 'jsonb', false),
      ('analysis_text', 'text', true),
      ('model_provider', 'text', false),
      ('model_name', 'text', false),
      ('prompt_version', 'text', false),
      ('error_code', 'text', false),
      ('error_message_safe', 'text', false),
      ('started_at', 'timestamp with time zone', false),
      ('completed_at', 'timestamp with time zone', false),
      ('created_at', 'timestamp with time zone', true),
      ('updated_at', 'timestamp with time zone', true)
  )
  SELECT count(*) INTO valid_columns
  FROM expected e
  JOIN pg_attribute a
    ON a.attrelid = 'public.morning_meeting_analyses'::regclass
   AND a.attname = e.name
   AND format_type(a.atttypid, a.atttypmod) = e.data_type
   AND a.attnotnull = e.not_null
   AND a.attnum > 0
   AND NOT a.attisdropped;

  SELECT count(*) INTO actual_columns
  FROM pg_attribute
  WHERE attrelid = 'public.morning_meeting_analyses'::regclass
    AND attnum > 0
    AND NOT attisdropped;

  SELECT count(*) INTO required_constraints
  FROM pg_constraint
  WHERE conrelid = 'public.morning_meeting_analyses'::regclass
    AND conname IN (
      'morning_meeting_analyses_pkey',
      'morning_meeting_analyses_meeting_key',
      'morning_meeting_analyses_owner_fkey',
      'morning_meeting_analyses_status_check',
      'morning_meeting_analyses_error_length_check',
      'morning_meeting_analyses_result_state_check'
    );

  IF valid_columns <> 16 OR actual_columns <> 16 OR required_constraints <> 6 THEN
    RAISE EXCEPTION 'Existing Morning Meeting analysis table is not compliant';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS morning_meeting_analyses_user_updated_idx
  ON public.morning_meeting_analyses (user_id, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'morning_meeting_analyses'
      AND indexname = 'morning_meeting_analyses_user_updated_idx'
      AND indexdef ~ 'USING btree \(user_id, updated_at DESC\)'
  ) THEN
    RAISE EXCEPTION 'Existing Morning Meeting analysis index is not compliant';
  END IF;
END
$$;

ALTER TABLE public.morning_meeting_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.morning_meeting_analyses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS morning_meeting_analyses_select_own ON public.morning_meeting_analyses;
DROP POLICY IF EXISTS morning_meeting_analyses_insert_own ON public.morning_meeting_analyses;
DROP POLICY IF EXISTS morning_meeting_analyses_update_own ON public.morning_meeting_analyses;

CREATE POLICY morning_meeting_analyses_select_own
  ON public.morning_meeting_analyses FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY morning_meeting_analyses_insert_own
  ON public.morning_meeting_analyses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY morning_meeting_analyses_update_own
  ON public.morning_meeting_analyses FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL PRIVILEGES ON public.morning_meeting_analyses
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.morning_meeting_analyses TO authenticated;

COMMENT ON TABLE public.morning_meeting_analyses IS
  'Private one-to-one structured analysis for a user-owned Morning Meeting.';

COMMIT;
