# Implementation and acceptance register

**Planning baseline:** 2026-10-10. Canonical scope and 52 work packages: [development plan](DEVELOPMENT_PLAN.md).
**Last reconciled:** 2026-11-15 against merged PRs #56–#66 and CI on `main`.
**Accepted (repository/CI level):** 11/52 (21.2%). **Public production service:** NOT RELEASED. **Deployed service:** preview at https://the-public-record-w34f.onrender.com (deployed by the lead; see [DEPLOYMENT.md](DEPLOYMENT.md)).
**Machine-readable mapping:** [`registry/prs.json`](../registry/prs.json) (units → PRs, dependencies, external prerequisites) and [`.exechub/approved-pr-mapping.json`](../.exechub/approved-pr-mapping.json) (accepted units only).

A merged PR alone does not mean a package is accepted. Acceptance here means the package's stated acceptance criterion is demonstrated by merged code and passing CI (unit, real-PostgreSQL integration and container smoke tests). Deployment, live external integrations and independent human security review are separate gates and are reported separately. Per the 2026-10-13 owner policy, AI-assisted review/testing replaces the human-review prerequisite for development; it is **not** an independent audit or certification.

| Work IDs | Workstream | Planned | Accepted | Source work merged, not accepted |
|---|---|---:|---:|---:|
| TPR-01–10 | Foundation, security, data | 10 | 7 | 3 (07, 09, 10) |
| TPR-11–18 | Research and templates | 8 | 0 | 8 (11–18) |
| TPR-19–27 | Citizen filing | 9 | 4 | 5 (21, 22, 25, 26, 27) |
| TPR-28–32 | Documentary publication | 5 | 0 | 0 |
| TPR-33–40 | Eight public actions | 8 | 0 | 0 |
| TPR-41–46 | Platform integration | 6 | 0 | 0 |
| TPR-47–52 | Production and verification | 6 | 0 | 1 partial (51: deploy config) |
| **Total** | | **52** | **11** | |

## Accepted (repository/CI level)

| Work | Evidence | Accepted scope |
|---|---|---|
| TPR-01 | [PR #1](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/1) | Decision register, complete plan, contribution/handoff and acceptance specifications |
| TPR-02 | [PR #2](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/2) | Cross-service ADR, strict public archive JSON contract, read-only adapter with offline and negative tests |
| TPR-03 | [PR #3](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/3) | Per-flow security inventory, threat boundaries and tested publication policy; NOT an E2EESA conformance assertion |
| TPR-04 | [PR #4](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/4) | OpenAPI and evidence/state/public projection schemas with tests (OpenAPI now lists implemented endpoints) |
| TPR-05 | [#5](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/5), [#8](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/8), [#12](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/12); deploy surface [#56](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/56) | Next.js bootstrap, CI, non-root standalone image; #56 adds `0.0.0.0:$PORT` start script, start-time migrations, `/api/ready`, `render.yaml` |
| TPR-06 | [PR #6](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/6) | Public/private PostgreSQL schema, checksum migrations, RLS integration tests |
| TPR-08 | [PR #59](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/59) (+ #10) | Server-owned, issuer-scoped append-only role grants; runtime role cannot write grants (no self-escalation); owner-only drafts/events/sessions/audit under forced RLS with `tpr_app_runtime`; cross-member API attempts return no private data (tested against PostgreSQL) |
| TPR-19 | [PR #60](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/60) | Anonymous work cards of reviewed templates; pinned private adoption; DB-saved drafts with optimistic concurrency; member dashboard and history; only the owner sees drafts; no legal identity collected |
| TPR-20 | [PR #66](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/66) (+ #23) | Browser-local drafting plus export of saved drafts (copy, download, print/PDF) addressing the pinned agency, matching the pinned template text with version provenance, and containing no hidden submission fields |
| TPR-23 | [PR #58](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/58) | Typed append-only lifecycle events, deterministic projection handling out-of-order/repeated/conflicting fixtures, corrections retained in history, DB append-only + RLS forbidding participant self-verification |
| TPR-24 | [PR #57](https://github.com/Justice-For-All-Movement/The-Public-Record/pull/57) | 5 U.S.C. 6103 holiday calendar; legal test matrix for holidays, unknown receipt, routing, extensions, tolls/fee pause, disputed outcomes and appeals; output never states illegality |

## Source work merged, not yet accepted

| Work | PRs | Done | Blocking acceptance |
|---|---|---|---|
| TPR-07 identity | #9, #59 | OIDC code+PKCE flow, sealed login transaction, pinned token exchange and JWKS verification, revocable DB sessions, synthetic provider (refused in production) | **External:** Justice For All OIDC client registration and a live sign-in test |
| TPR-09 private storage | #11 | Signed quarantine upload permits | B2 buckets/keys, replay ledger, scanner (not started here) |
| TPR-10 audit & consent | #13, #59 | Audit emitted in-transaction for sessions, adoptions, draft edits, lifecycle events; current-effective-consent service; privacy-safe logging | Retention/deletion workflow, external integrity checkpoint, restore test |
| TPR-11–14, 16–18 | #14, #16, #17, #19, #22, #20, #21 | Library modules with tests (FOIA.gov adapter, verified channels, editorial history, citation graph, duplicates, templates, lint) | Persistence, live sources, editorial UI |
| TPR-15 archive resolver | #61, FC-13 adaptation PR | Resolver over the real FOIA Aggregator FC-13 export (`foia-catalog-export/1`): snapshot-bound paging, per-snapshot cache, local search (query never sent upstream), provenance, preservation status, coverage warnings; no outcome reads as "records don't exist" | **External:** live verification against a non-empty Aggregator catalog (archive currently empty pending its B2 keys) |
| TPR-21 self-filing guide | #62 | Verified-destination-only guide, explicit self-filing affirmation, no submit path | Real human-reviewed filing routes for ≥2 agency formats (TPR-12) |
| TPR-22 proof & receipt | #62 | In-browser receipt fingerprints, tamper check, evidence-level labels, tracking numbers | Reviewer verification workflow; private proof storage (TPR-09/28) |
| TPR-25 notifications & outbox | #65 | Durable outbox (dedupe, SKIP LOCKED leases, recovery, backoff, dead-letter), confined worker role, in-app deadline reminders with opt-out, token-guarded runner, mail adapters (fake + Resend-compatible, mocked) | Email channel (consented address storage, unsubscribe links) and a live provider test; external scheduler provisioning |
| TPR-26 fees & correspondence | #63 | Fee-ceiling guard: no above-ceiling acceptance without explicit maximum | Private correspondence storage, referral UI |
| TPR-27 appeals & OGIS | #63 | Appeal/OGIS explanation, hedged window, editable self-filed letter, original denial preserved | Agency-specific appeal instructions in the reviewed registry |
| TPR-51 staging | #56 | `render.yaml`, Dockerfile, readiness, migration-on-start, CI DB smoke | Actual Render/Neon deployment by the lead, rollback rehearsal |

Superseded automation drafts closed in favour of the merged PRs above: #28, #29, #31, #32, #33, #34, #35, #36, #37, #38, #39.

## Runtime status (what a deployment does today)

- Boots with **no credentials**: home, browser-only drafting, FOIA deadline estimator, template browse, archive search (fixtures where enabled).
- With `DATABASE_URL`: migrations applied at start; member drafts, lifecycle tracking, audit trail under RLS via `tpr_app_runtime`.
- With `AUTH_PROVIDER=fake` (non-production only): synthetic sign-in; with no database, a clearly labeled in-memory store.
- With `AUTH_PROVIDER=oidc`: real OIDC sign-in once the Justice For All client exists.
- With `DATABASE_URL` + `WORKER_TOKEN` and an external scheduler: in-app deadline reminders.
- Not enabled: uploads/private storage, agency submission (never), publication, email, public actions.

## Next dependency-ready steps

1. Lead: apply `render.yaml` in the Justice For All Render workspace; optionally attach a Neon branch; record `/api/ready` evidence (TPR-51).
2. Register the Justice For All OIDC client and run a live sign-in (TPR-07, TPR-44).
3. Provision an authenticated scheduler for `/api/internal/jobs/run` (TPR-25); TPR-12 persisted reviewed filing registry; TPR-17 template persistence.
4. TPR-09/28 private storage and quarantine before any upload feature.
5. TPR-36 Silence Clock exhibit once public projections and consent (TPR-31) exist.

## Dependencies and non-goals

- FOIA Aggregator remains the public archive/search source; its FC-13 export API is live and consumed by TPR-15 (catalog currently empty).
- Justice For All is the intended identity provider. Roles never come from token claims or browsers.
- Liberty Nodes may replicate **only approved public derivatives** with explicit additional consent.
- No Render, Neon or B2 resources were created by these PRs; no paid resources or shared secrets are assumed.
- The platform does not file FOIA requests, impersonate participants, claim agency acknowledgment without reviewed evidence, or publish unreviewed uploads.

**Handoff rule:** Before each session, inspect the actual GitHub, CI, deployment and database state. Treat missing evidence as unverified—not as completed.
