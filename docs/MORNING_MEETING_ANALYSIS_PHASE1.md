# Morning Meeting Analysis Phase 1

## Current baseline

Before this change, Morning Meeting persisted the meeting row and validated
screenshot metadata only. The browser created temporary object URLs for previews;
`morning_meeting_images.storage_path` was required to remain `NULL`, and no file
bytes were available to the server.

The original chain was:

```text
Browser selection
→ local magic-byte validation and preview
→ Node Auth
→ meeting row plus screenshot metadata
→ private PostgREST rows
→ metadata-only page history
```

Supported files are JPEG, PNG, and WebP. The existing limits remain 10 MiB per
file, 12 files, and 60 MiB in total.

## Phase 1 design

The minimal complete chain is:

```text
Browser selection
→ existing validation
→ save meeting and metadata
→ authenticated Node upload endpoint
→ private Supabase Storage object
→ user clicks Analyze
→ Node verifies meeting and file ownership
→ Node downloads only database-owned storage paths with the user JWT
→ server-only OpenAI Responses API request
→ strict JSON validation
→ user-owned analysis row
→ read-only result UI
```

The browser never receives the model API key and never calls the model provider.
Storage and database requests use the already verified user's access token and a
publishable key. Service-role and secret keys are not used.

## Database and RLS

Migration `sql/005_morning_meeting_analysis.sql`:

- extends screenshot metadata to represent `metadata_only` or `stored`;
- creates a private `morning-meeting-images` bucket, failing closed if a
  conflicting bucket is public or has unexpected limits;
- creates own-folder Storage policies for `authenticated`;
- creates `morning_meeting_analyses`, one row per meeting;
- enforces the parent meeting owner through a composite foreign key;
- enables and forces RLS;
- grants `authenticated` only `SELECT`, `INSERT`, and `UPDATE`;
- grants no analysis-table access to `anon`, `PUBLIC`, or `service_role`.

The migration is transactional and checks that the two base Morning Meeting
tables already exist. It must be reviewed and dry-run against the target before
Production execution.

## API

- `PUT /api/morning-meetings/:meetingId/images/:imageId/content`
  stores a validated private image. The server constructs the object path.
- `POST /api/morning-meetings/:meetingId/analyze`
  starts one synchronous analysis. `{ "retry": true }` is accepted only for a
  failed row.
- `GET /api/morning-meetings/:meetingId/analysis`
  returns the current user's result or `null`.

Authentication and ownership checks occur before body parsing, file access, and
model access. A unique `meeting_id` plus status-conditional retry prevents
parallel or accidental repeat analysis. Completed results are not automatically
re-analyzed.

## Output and safety

The model uses a strict JSON schema. Facts retain `source_text`; unknown numeric
values are `null`; confidence is from 0 to 1; low-confidence content is placed in
`uncertain_items`. The separate Chinese `analysis_text` has eight fixed sections.

No analysis result updates `indicators`, `macro_events`, or
`daily_market_notes`. Provider bodies, signed URLs, credentials, internal stack
traces, and model keys are neither stored nor returned.

## Runtime configuration

Optional server-only settings:

- `OPENAI_API_KEY` (required only when Analyze is clicked)
- `MORNING_ANALYSIS_MODEL` (default `gpt-5.4-mini`)
- `MORNING_ANALYSIS_TIMEOUT_MS` (default 45 seconds)
- `MORNING_MEETING_STORAGE_BUCKET` (default `morning-meeting-images`)

The application starts without model configuration. Analyze then returns a
sanitized configuration error.

## Cost and timeout

The model is called once per accepted analysis, with no automatic provider
retry. Cost depends mainly on screenshot dimensions/count and generated output.
Using the configured mini model, a practical initial budget assumption is
roughly USD 0.01–0.10 per small meeting set; this is an estimate, not a guarantee,
and must be calibrated from provider usage after one explicitly authorized test.

The synchronous request is capped at 45 seconds and the browser waits 60 seconds.
This is intentionally a Phase 1 compromise. If real Render requests regularly
approach the platform request limit, the next change should be a bounded
background worker with polling, not a longer unbounded HTTP timeout.
