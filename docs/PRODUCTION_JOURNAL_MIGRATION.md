# Production Journal Schema and RLS Migration

This document covers the Production-safe database preparation for Trading Journal. It does not publish the Journal API or UI.

## Scope

The migration creates or upgrades `public.daily_market_notes`, adds user ownership, enforces PostgreSQL Row Level Security, and grants only the access required by authenticated Supabase Data API requests. It does not seed data, create users, or modify `indicators` or `macro_events`.

## Safety gates

The runner refuses to connect unless all of the following are true:

- `APP_ENV=production`.
- `PRODUCTION_SUPABASE_PROJECT_REF` is present.
- the project refs derived independently from `DATABASE_URL` and `SUPABASE_URL` exactly match the Production allow-list.
- `STAGING_SUPABASE_PROJECT_REF` supplies a mandatory deny-list entry.
- optional Staging URL and database evidence must resolve to that same deny-list ref.
- the Production target does not match any verified Staging project ref.
- formal execution additionally sets `PRODUCTION_JOURNAL_MIGRATION_CONFIRM=production-journal-migration`.

Never store the formal confirmation value as a permanent Render environment variable. The publishable key and service-role key are not used by this migration.

## State machine

| State | Meaning | Formal execution |
| --- | --- | --- |
| `table-absent` | Journal table does not exist | Allowed |
| `legacy-empty` | Recognized legacy schema exists and contains zero rows | Allowed |
| `legacy-with-data` | Legacy table contains rows without ownership | Refused; explicit ownership plan required |
| `partially-migrated` | Schema, constraints, grants, policies, or ownership are inconsistent | Refused; investigate manually |
| `target-compliant` | Target schema and security boundary are already present | No-op |

The runner never guesses an owner and contains no Staging dates, row counts, or user UUIDs.

## Dry-run

Load Production secrets through the approved local secret mechanism, then run:

```text
npm run journal:migration:production:dry-run
```

Dry-run uses `BEGIN READ ONLY`, inspects schema and aggregate metadata, and always rolls back. It does not require the formal confirmation variable. Review the sanitized state, count, date range, and mismatch codes. Do not proceed when the result is `stopped`.

## Formal execution

Formal execution is a separate, explicitly approved release step:

```text
npm run journal:migration:production
```

The runner opens one transaction, repeats preflight inspection, applies the SQL body only for `table-absent` or `legacy-empty`, verifies the final state, and commits only after verification succeeds. Any error rolls back the complete transaction.

## Target security boundary

- `user_id uuid NOT NULL` references `auth.users(id)` with `ON DELETE RESTRICT`.
- `(user_id, note_date)` is unique.
- RLS and `FORCE ROW LEVEL SECURITY` are enabled.
- SELECT, INSERT, UPDATE, and DELETE policies require `auth.uid() = user_id`.
- `anon` has no table or sequence privileges.
- `authenticated` has table CRUD and sequence `USAGE`; RLS remains the row boundary.
- `service_role` and `PUBLIC` receive no table or sequence grant from this migration.
- `anon` and `authenticated` must not have `BYPASSRLS`, and neither role may own the table.
- Journal runtime access must use the user JWT through Supabase Data API. Service role and database-owner access are forbidden for user requests.

## Locking and rollback

Formal execution uses a transaction-scoped advisory lock to serialize this runner. A recognized empty legacy table is then locked with `ACCESS EXCLUSIVE` and re-inspected before any DDL. For an absent table, the server-side create block uses a non-conditional `CREATE TABLE` after its existence check, so a conflicting concurrent create fails the transaction instead of silently upgrading an unknown relation. The only upgradeable legacy table must be empty, so the expected lock window is short. Run during a controlled release window and stop application Journal traffic before formal execution.

Before commit, rollback is automatic. If the client loses its connection while PostgreSQL is acknowledging `COMMIT`, completion may be ambiguous; never retry blindly, and run the separately authorized read-only inspection first. After a confirmed commit, prefer a forward correction: the schema contains no destructive data transformation. Dropping `user_id`, RLS, or the composite unique constraint would weaken security and is not an approved automatic rollback. If application publication fails, keep the secured schema and roll back application code separately.

## Verification checklist

- Runner reports `target-compliant` after execution.
- `user_id` is UUID, identity ownership is intact, and all required columns are `NOT NULL`.
- primary key, validation checks, foreign key, composite unique constraint, and updated-at index exist.
- legacy `UNIQUE(note_date)` is absent.
- RLS and FORCE RLS are enabled.
- all four own-row policies match `auth.uid()`.
- `anon` has no table or sequence access.
- no seed rows or Auth users were created.
