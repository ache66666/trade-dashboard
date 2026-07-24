# Market Coach Mobile MVP

## Scope

Market Coach adds a mobile-first Morning Meeting workflow while preserving
Markets, Auth, Trading Journal, Editor protections, and existing connectors.
Navigation priority is:

1. Morning
2. Journal
3. Markets

This phase does not add OCR, AI analysis, sharing, public profiles, or
cross-user search.

## Privacy architecture

- The Node API verifies the Supabase access token before parsing a private
  request body or calling the Data API.
- The server derives `user_id` from the verified token. Query, body, custom
  headers, file metadata, and local storage cannot select another identity.
- `morning_meetings` and `morning_meeting_images` both enable and force RLS.
- SELECT, INSERT, UPDATE, and DELETE policies require
  `auth.uid() = user_id`.
- Image rows also use a composite foreign key so image ownership must match
  meeting ownership.
- Anonymous and public table privileges are revoked.
- Foreign or missing record IDs return the same generic 404 response.

Migration: `sql/003_private_morning_meetings.sql`.

The migration is review-only in this feature. It must not be run against
Production as part of the Draft PR.

## Screenshot storage boundary

This MVP does **not** upload or permanently store screenshot bytes.

- The browser validates JPEG, PNG, or WebP signatures and renders local object
  URL previews.
- The server validates filename, MIME type, per-file size, total count, and
  total size for metadata.
- Only private screenshot metadata is saved with `storage_path = NULL` and
  `upload_status = metadata_only`.
- The UI explicitly distinguishes local selection from persisted metadata.
- There is no bucket, public object URL, signed URL, or sharing route.

A later storage phase must use a private bucket, unpredictable object names,
user-prefixed paths, RLS-backed storage policies, and short-lived signed URLs.

## Limits

- Up to 12 screenshots per meeting.
- Up to 10 MB per screenshot.
- Up to 60 MB selected in one meeting.
- Accepted MIME types: `image/jpeg`, `image/png`, `image/webp`.
- SVG, HTML, PDF, executables, mismatched extensions, dangerous double
  extensions, and traversal filenames are rejected.

## PWA boundary

The Service Worker uses a fixed static-resource allow-list. It does not
intercept API calls, requests with Authorization headers, screenshots,
private records, or signed URLs. Static resources are network-first so an old
cache does not block application updates.

## Local verification

Configure the existing local environment and run:

```powershell
npm start
```

Then open `http://localhost:4173`.

The new database migration is not automatically executed. Authenticated
Morning Meeting persistence requires an isolated database where Migration 003
has been reviewed and applied.

## Deferred

- Screenshot byte persistence and private Storage policies
- OCR
- AI screenshot analysis
- Notifications
- Sharing or community features
