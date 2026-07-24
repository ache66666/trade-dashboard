-- Market Coach Mobile MVP: private Morning Meeting records and screenshot
-- metadata. Screenshot bytes are not persisted in this phase.
BEGIN;

CREATE TABLE public.morning_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  meeting_date date NOT NULL,
  primary_driver text NOT NULL,
  evidence text NOT NULL DEFAULT '',
  contradiction text NOT NULL DEFAULT '',
  need_to_verify text NOT NULL DEFAULT '',
  confidence integer NOT NULL,
  my_view text NOT NULL,
  review_notes text NOT NULL DEFAULT '',
  analysis_status text NOT NULL DEFAULT 'not_configured',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT morning_meetings_user_date_key UNIQUE (user_id, meeting_date),
  CONSTRAINT morning_meetings_id_user_key UNIQUE (id, user_id),
  CONSTRAINT morning_meetings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT morning_meetings_primary_driver_check CHECK (
    primary_driver IN (
      'Growth',
      'Inflation',
      'Liquidity',
      'Risk',
      'Monetary Policy',
      'Positioning',
      'Other'
    )
  ),
  CONSTRAINT morning_meetings_confidence_check CHECK (
    confidence BETWEEN 0 AND 100
  ),
  CONSTRAINT morning_meetings_analysis_status_check CHECK (
    analysis_status = 'not_configured'
  ),
  CONSTRAINT morning_meetings_text_length_check CHECK (
    char_length(evidence) <= 4000
    AND char_length(contradiction) <= 4000
    AND char_length(need_to_verify) <= 4000
    AND char_length(my_view) BETWEEN 1 AND 4000
    AND char_length(review_notes) <= 4000
  )
);

CREATE INDEX morning_meetings_user_date_desc_idx
  ON public.morning_meetings (user_id, meeting_date DESC);

CREATE TABLE public.morning_meeting_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  storage_path text,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  upload_status text NOT NULL DEFAULT 'metadata_only',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT morning_meeting_images_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT morning_meeting_images_meeting_owner_fkey
    FOREIGN KEY (meeting_id, user_id)
    REFERENCES public.morning_meetings(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT morning_meeting_images_mime_check CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  CONSTRAINT morning_meeting_images_size_check CHECK (
    size_bytes > 0 AND size_bytes <= 10485760
  ),
  CONSTRAINT morning_meeting_images_filename_check CHECK (
    char_length(original_filename) BETWEEN 1 AND 180
    AND original_filename !~ '[\\/]'
    AND original_filename !~ '[[:cntrl:]]'
    AND original_filename !~* '\.(exe|com|bat|cmd|ps1|sh|js|html?|svg|pdf|php|jar|msi)(\.|$)'
    AND (
      (mime_type = 'image/jpeg' AND original_filename ~* '\.(jpe?g)$')
      OR (mime_type = 'image/png' AND original_filename ~* '\.png$')
      OR (mime_type = 'image/webp' AND original_filename ~* '\.webp$')
    )
  ),
  CONSTRAINT morning_meeting_images_status_check CHECK (
    upload_status = 'metadata_only'
  ),
  CONSTRAINT morning_meeting_images_storage_state_check CHECK (
    storage_path IS NULL
  )
);

CREATE INDEX morning_meeting_images_owner_meeting_idx
  ON public.morning_meeting_images (user_id, meeting_id, created_at);

ALTER TABLE public.morning_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.morning_meetings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.morning_meeting_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.morning_meeting_images FORCE ROW LEVEL SECURITY;

CREATE POLICY morning_meetings_select_own
  ON public.morning_meetings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY morning_meetings_insert_own
  ON public.morning_meetings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY morning_meetings_update_own
  ON public.morning_meetings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY morning_meetings_delete_own
  ON public.morning_meetings FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY morning_meeting_images_select_own
  ON public.morning_meeting_images FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY morning_meeting_images_insert_own
  ON public.morning_meeting_images FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY morning_meeting_images_update_own
  ON public.morning_meeting_images FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY morning_meeting_images_delete_own
  ON public.morning_meeting_images FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL PRIVILEGES ON public.morning_meetings FROM PUBLIC, anon, service_role;
REVOKE ALL PRIVILEGES ON public.morning_meeting_images FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.morning_meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.morning_meeting_images TO authenticated;

COMMENT ON TABLE public.morning_meetings IS
  'Private, user-owned Morning Meeting training records.';
COMMENT ON TABLE public.morning_meeting_images IS
  'Private screenshot metadata. Screenshot bytes are not persisted by MVP.';
COMMENT ON COLUMN public.morning_meeting_images.storage_path IS
  'Reserved for a future private bucket. Must remain null for metadata_only rows.';

COMMIT;
