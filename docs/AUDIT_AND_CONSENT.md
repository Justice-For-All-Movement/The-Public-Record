# TPR-10 — Private audit, consent versioning and retention events

**Status:** database event-structure and immutable-row safeguards in disposable PostgreSQL CI. No production logging, consent interface, revision service or backup claim is made.

## Schema added in 0002

- `tpr_private.audit_events`: a strictly typed, append-only history of restricted actions with actor/owner pseudonymous subject IDs, object IDs, optional SHA-256 evidence fingerprints and timestamps. There is no freeform note, document body, access token, filename, address or email column.
- `tpr_private.consent_events`: append-only `granted`/`revoked` records independently scoped to one quarantined original and to `web_publication` or `distributed_replication`. Grant and revocation both remain auditable; a currently active grant must be derived from **the latest effective event**, not the existence of any historical grant.
- `tpr_private.retention_requests`: participant removal/redaction request tracking, separately from the evidentiary history. Resolving a request does not automatically delete an archival public copy on independent nodes.

RLS is **forced** on all three tables, with owner-scoped policies using the transaction-local trusted identity. `UPDATE` and `DELETE` on audit/consent events are rejected by database triggers; updates to a mutable derived view may never rewrite this source history. The database owner/superuser can still alter triggers or backups: this is database append-only enforcement, not an independent cryptographic immutability guarantee.

## Emission (TPR-10 wiring)

`lib/audit/audit-log.ts` records typed audit rows inside the same transaction as the business change (`MemberStore.transaction`). Migration 0005 adds `session_started`, `session_ended`, `draft_adopted` and `lifecycle_event_recorded`. Entries are validated: object ids are opaque identifiers, fingerprints must be SHA-256, there is no free text. Members can read their own trail; the runtime role cannot update or delete it. `lib/audit/consent.ts` derives **current effective consent** from the latest event per (object, scope), and distributed replication counts only while web publication consent is effective. `lib/server/log.ts` emits allow-listed structured log fields with token/email/connection-string redaction.

## Required follow-up enforcement

1. Server routes must emit an audit event for every restricted action in the *same authorized transaction* as the business mutation.
2. Produce a privacy-safe audit format and retention policy. Never log OAuth tokens, plaintext drafts, sensitive files or full incoming request bodies.
3. Add versioned consent APIs with signed identity, one-item previews, explicit distribution warnings, revocation and reconciliation of currently effective grants.
4. Extend editor/records reviewer auditing, immutable externally anchored hash proofs and backup/restore tests. Audit lifecycle before live operations.
5. Ensure withdrawal/takedown is best-effort for third-party/public/distributed replicas; the participant must be warned of those limitations before publication.
6. Independently verify SQL runtime role privileges, backup handling, crash recovery and relevant E2EESA controls before collecting participant data.

The initial private event ledger does not enable uploads, external notifications or public publication. All test entries are synthetic.
