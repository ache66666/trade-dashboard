# FRED Connector MVP

Phase B validates one complete, deliberately small Production data path without changing the database schema or public API:

```text
FRED graph CSV
  -> Fetcher
  -> Adapter
  -> Validator
  -> allow-listed Repository
  -> existing indicators table
  -> existing read-only API verification
```

## Scope

| Indicator | Category | FRED series | Database unit | Update rule |
| --- | --- | --- | --- | --- |
| `US10Y` | US Rates | `DGS10` | `%` | Latest two published observations |
| `USDCNY` | FX | `DEXCHUS` | unitless spot quote | Latest two published observations |
| `WTI` | Commodity | `DCOILWTICO` | `美元/桶` | Latest two published observations |

These indicators already exist in the Catalog and Production database. The connector does not create indicators and does not request an API key. It uses FRED's official graph CSV download endpoint. A publication lag, weekend, or holiday is accepted; an observation older than the current database date is rejected.

## Safety model

`npm run data:fred:dry-run` is the default operational command. It loads the ignored `.env.production.local`, validates the Production allow-list and Staging deny-list, reads the current three rows, fetches and validates all three sources, and prints a sanitized plan. It performs no database update.

A formal write is intentionally not wrapped in an npm shortcut. It requires all of the following in one operator-controlled command:

- `APP_ENV=production`;
- a `DATABASE_URL` whose parsed Project Ref matches the tracked Production hash allow-list;
- a distinct tracked Staging Project Ref hash deny-list;
- `--apply` and the exact explicit confirmation argument;
- current-value read before writes;
- all three records valid before the transaction begins;
- one transaction limited to `US10Y`, `USDCNY`, and `WTI`;
- successful readback through the existing Production indicators API.

Never store the confirmation argument in an environment file. This MVP has no scheduler and must not be invoked automatically.

## Phase C schedule

The optional `FRED Production Sync` workflow runs at 00:30 UTC (08:30 China Standard Time) on weekdays and supports manual dispatch. It uses a non-cancelling concurrency group, runs tests and a dry-run before one apply attempt, never calls the Render deploy hook, and writes a sanitized date/count summary. The workflow requires only the Production database connection and the explicit write confirmation as GitHub Production Environment Secrets.

## Failure behavior

- Network, HTTP, HTML, empty body, invalid CSV, invalid values, wrong units, unexpected symbols, dates moving backward, or range violations stop the entire run before writes.
- A repository failure rolls back the transaction, preserving the previous snapshot.
- Repeating a run with the same date, values, source, and frequency is a no-op.
- Logs contain indicator codes and fixed error classifications only; they do not include response bodies, credentials, or database targets.

## Deferred work

The remaining FRED indicators, scheduling, run history, observation history, multi-source fallback, and all non-FRED sources remain outside this MVP.
