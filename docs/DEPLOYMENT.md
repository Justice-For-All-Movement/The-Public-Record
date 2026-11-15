# Deployment (Render web service + optional Neon PostgreSQL)

**Live preview (deployed by the lead, 2026-11-15):** https://the-public-record-w34f.onrender.com — Render service `the-public-record` (Docker, free plan, auto-deploy from `main`), its own Neon PostgreSQL 16 database, `TPR_ENVIRONMENT=preview`, `AUTH_PROVIDER=disabled`, archive fixtures on. `main` must stay deployable: every merge redeploys. Probes: `/api/health`, `/api/ready`. (Not reachable from the agent sandbox; verify from a browser.)

FOIA Aggregator export API (FC-13), live: https://foia-aggregator-gjk5.onrender.com — set `FOIA_AGGREGATOR_PUBLIC_URL` to this origin to search the real catalog (it is empty until its B2 storage is connected; results then say so).

**Status:** deployable preview. Merging this does **not** create any Render, Neon or B2 resource; an authorized lead applies `render.yaml` in the Justice For All workspace. `production_ready` stays `false` until the TPR-47..52 gates are met.

## Build and start

| Step | Command |
|---|---|
| Image build | `docker build -t the-public-record .` (runs `npm run verify:quality`, then copies the Next.js standalone server) |
| Start | `node scripts/start.mjs` (image `CMD`) |
| Local without Docker | `npm run db:migrate` (if `DATABASE_URL` is set), then `npm run build && npm start` |

`scripts/start.mjs` binds `0.0.0.0:$PORT` (Render injects `PORT`; default 3000). When `DATABASE_URL` (or `MIGRATION_DATABASE_URL`) is set it applies pending checksum-locked migrations under an advisory lock before serving and **exits non-zero** if a migration fails, so a deploy never goes live on an unknown schema. Set `TPR_MIGRATE_ON_START=false` to run `node scripts/migrate.mjs` separately (e.g. a Render pre-deploy command).

## Probes

- `GET /api/health` — liveness. No external calls. Always `200` while the process serves.
- `GET /api/ready` — readiness (`render.yaml` `healthCheckPath`). `200` only if every **configured** dependency works: database reachable, all bundled migrations applied with matching digests, the effective runtime role is neither superuser nor `BYPASSRLS`, and the sign-in configuration is valid. Unconfigured optional services are reported as `not_configured`, not failures. Responses never include connection strings or secrets.

## Environment variables

Nothing is required. With no variables the service serves the public preview pages; database-backed and signed-in features report themselves as unavailable.

| Variable | Needed for | External service |
|---|---|---|
| `TPR_ENVIRONMENT` | Stage label `local`/`preview`/`staging`/`production`. An unknown value on a production build is treated as `production`. | — |
| `DATABASE_URL` | Member drafts, lifecycle tracking, audit trail, readiness DB checks | Neon PostgreSQL (pooled connection string, `sslmode=require`) |
| `MIGRATION_DATABASE_URL` | Optional owner/direct connection used only for migrations | Neon PostgreSQL |
| `DATABASE_RUNTIME_ROLE` | Role assumed per private transaction (`tpr_app_runtime`, created by migration 0003) | Neon PostgreSQL |
| `TPR_MIGRATE_ON_START` | `false` to skip start-time migrations | — |
| `SESSION_SECRET` | Any sign-in (base64url, ≥32 random bytes) | — |
| `AUTH_PROVIDER` | `disabled` (default), `fake` (synthetic identities; refused when stage is `production`), `oidc` | — |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT`, `OIDC_JWKS_URI` | `AUTH_PROVIDER=oidc`; endpoints must be HTTPS and share the issuer origin | Justice For All identity provider (not yet registered) |
| `WORKER_TOKEN` | Outbox worker endpoint `POST /api/internal/jobs/run` (≥32 chars); unset = disabled | An external scheduler (e.g. a Render cron job, paid) |
| `PUBLIC_ORIGIN` | Optional exact browser origin for CSRF checks (e.g. `https://records.example.org`) | — |
| `FOIA_AGGREGATOR_PUBLIC_URL` | Live read-only archive search over the FC-13 export (origin only, e.g. `https://foia-aggregator-gjk5.onrender.com`); takes precedence over fixtures | FOIA Aggregator |
| `FOIA_AGGREGATOR_FIXTURES` | `true` to use the synthetic archive fixtures (ignored in production) | — |

Generate a session secret with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.

## Database role model

Migrations run as the database owner. Private work runs under row-level security keyed by a transaction-local verified subject, and the app **refuses private queries** if the effective role bypasses RLS. Two supported setups:

1. **Single owner URL (simplest on Neon):** set `DATABASE_URL` to the owner connection and `DATABASE_RUNTIME_ROLE=tpr_app_runtime`. Migration 0003 creates the `NOLOGIN NOBYPASSRLS` role and lets the owner `SET ROLE` to it; each private transaction runs `SET LOCAL ROLE tpr_app_runtime`.
2. **Separate login role (stronger):** create a `LOGIN NOBYPASSRLS` role, `GRANT tpr_app_runtime TO <login>`, use it in `DATABASE_URL`, and put the owner connection in `MIGRATION_DATABASE_URL`.

`tpr_app_runtime` has no `DELETE` on private tables, only `INSERT/SELECT` on append-only history, and no DDL rights. Role grants for privileged staff roles are never writable by the runtime role.

## Render checklist for the lead

1. New Blueprint from this repository (`render.yaml`), Justice For All workspace only.
2. Optionally create a Neon project/branch in the Justice For All organization and paste its pooled URL into `DATABASE_URL`.
3. Set `SESSION_SECRET`; set `AUTH_PROVIDER=fake` only for a clearly labeled non-production preview, or `oidc` once the Justice For All client is registered.
4. Verify `/api/ready` shows `ready: true` and record evidence before claiming any deployment status.

## Background jobs (TPR-25)

Reminders are queued in `tpr_private.outbox_jobs` in the same transaction as the lifecycle event that produced them. Nothing runs them until an **authenticated external scheduler** calls `POST /api/internal/jobs/run` with `Authorization: Bearer $WORKER_TOKEN` (for example a Render cron job every 15 minutes: `curl -fsS -X POST -H "Authorization: Bearer $WORKER_TOKEN" https://<service>/api/internal/jobs/run`). Each pass leases up to 25 jobs (`FOR UPDATE SKIP LOCKED`, 120 s lease, exponential backoff, dead-letter after 5 attempts) under the `tpr_worker_runtime` role, which cannot read drafts, events, audit history or notification text. Render cron jobs are a paid service type, so none is declared in `render.yaml`.
