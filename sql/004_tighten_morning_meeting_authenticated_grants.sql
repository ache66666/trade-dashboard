-- Forward-only permission repair for Morning Meeting tables created by
-- Migration 003. Supabase default table privileges can grant authenticated
-- more than the CRUD permissions required by the application.
BEGIN;

REVOKE ALL PRIVILEGES
  ON TABLE public.morning_meetings
  FROM authenticated;

REVOKE ALL PRIVILEGES
  ON TABLE public.morning_meeting_images
  FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.morning_meetings
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.morning_meeting_images
  TO authenticated;

COMMIT;
