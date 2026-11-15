# Deployment (Render web service + optional Neon PostgreSQL)

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
| `FOIA_AGGREGATOR_PUBLIC_URL` | Live read-only archive search | FOIA Aggregator (no compatible JSON endpoint exists yet) |
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
