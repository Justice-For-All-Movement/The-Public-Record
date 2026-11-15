# TPR-23 — Request lifecycle event engine

Modules: `lib/lifecycle/events.ts` (typed events and validation), `lib/lifecycle/projection.ts` (deterministic rebuild), `lib/lifecycle/repository.ts` (PostgreSQL persistence); migration `0004_request_lifecycle.sql`.

## Model
Each request has an append-only stream of typed events (`filed`, `acknowledged`, `clarification_requested/answered`, `fee_estimate_received`/`fee_response_sent`, `extension_notice`, `alternative_timeframe_agreed`, `expedite_*`, `referral`, `interim_release`, `final_determination`, `appeal_*`, `closed`, `reopened`, `withdrawn`, `correction`). Every event carries `occurredOn` (per its evidence), server `recordedAt`, `assertedBy` (`requester`/`agency_document`/`reviewer`), `verification` (`self_reported`/`document_attached`/`reviewer_verified`), an optional evidence reference, an optional causal link (`causedBy`) and, for corrections, the corrected event. Payloads are typed per event; unknown keys are rejected so no free-form personal data can ride along.

## Projection rules
- **Order-independent and idempotent:** sorted by occurred date, then recorded time and id; identical repeats are marked `duplicate`; the same id with different content is a `conflicting_duplicate_id` (first recorded wins).
- **Causality:** an event whose cause has not arrived is `awaiting_cause` and does not affect status until it does.
- **Corrections:** never edit history. The latest valid correction supersedes or retracts its target; both remain visible (`corrected`/`retracted` + `correctedBy`). A correction needs at least the target's evidence level, so a self-report cannot undo reviewer-verified evidence. Corrections of corrections are rejected (correct the original).
- **Conflicts → disputed:** competing filing dates, two different determinations without an intervening appeal result/reopening, agency events dated before filing, and effects dated before causes. Disputed requests get a "records conflict" label and no clock date.
- **Verification wording:** only `reviewer_verified` reads as confirmed. Requester reports read "reported by the requester"; attached documents read "not yet reviewed". Only reviewer-verified receipt is treated as agency evidence by the clock; anything else is a requester estimate (approximate).
- **Clock feed:** `clockInputFromProjection` maps receipt, tolls (paired by `causedBy` or the earliest open request), extensions, expedited processing, determination (adverse unless full grant) and appeals into the TPR-24 engine.

## Database safeguards
Append-only trigger; forced RLS (owner read; owner insert only for non-reviewer events, so a participant cannot self-verify even with raw SQL); causal/correction links constrained to the same owner and request by composite foreign keys; check constraints for evidence consistency; per-request idempotency keys with replay detection; runtime role has `SELECT, INSERT` only.

## Remaining
Reviewer verification workflow (separate role/route), proof uploads (TPR-22/28), agency correspondence import (TPR-26), public projections (TPR-31/36).
