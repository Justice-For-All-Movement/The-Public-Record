# TPR-25 — Notification and job outbox

**Status:** durable outbox, worker, in-app reminders and preferences implemented and tested against PostgreSQL. **No email is sent**: no address is collected and no provider is configured. The `MailProvider` boundary (`lib/jobs/mail.ts`) has a fake adapter and a Resend-compatible HTTPS adapter, tested only with mocked responses; no claim of real email delivery is made until a live test.

- **Producer:** recording a lifecycle event rebuilds the member's clock and enqueues reminders (2 days before the estimated determination date; 14 days before the minimum appeal window ends) in the same transaction. Per-owner `dedupe_key` (`deadline:<draft>:<kind>:<date>`) suppresses duplicates; a changed estimate schedules a new reminder whose text says it reflects the estimate at scheduling time.
- **Worker:** `runWorkerOnce` leases with `FOR UPDATE SKIP LOCKED` and a 120 s lease (expired leases are recoverable), completes only while holding the lease, retries with exponential backoff (30 s … 1 h) and dead-letters after `max_attempts` or a permanent error. Rows record short error codes only.
- **Isolation:** `tpr_worker_runtime` (NOLOGIN, NOBYPASSRLS) can lease jobs and insert notifications but cannot read drafts, events, audit rows or notification text. Members see only their own notifications/preferences (RLS).
- **Consent/unsubscribe:** reminders are in-app only and can be switched off on `/me` (`PATCH /api/v1/me/public-record/notifications`), audited as `notification_preference_changed`. One-click email unsubscribe links are deferred until an email channel exists.
- **Scheduling:** `POST /api/internal/jobs/run` with `WORKER_TOKEN`; see [DEPLOYMENT.md](DEPLOYMENT.md#background-jobs-tpr-25).

Tests: `tests/outbox.test.ts` (planning, mail adapter failure codes incl. invalid credentials/offline/header injection, same-transaction scheduling and dedupe, single delivery, concurrent workers, expired lease recovery, retry→dead-letter, worker confinement, opt-out, token-guarded runner).
