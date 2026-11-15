# TPR-19 — Adoption and member dashboard

**Pages:** `/public-record/work` (anonymous work cards), `/me` (dashboard), `/me/drafts/{id}` (edit, timeline, timing estimate, record events). **APIs:** see [API_CONTRACTS.md](API_CONTRACTS.md).

- **Anonymous browse:** work cards show only reviewed, *published* template versions (no editor/reviewer identities, no adoption counts). The current catalog is the clearly labeled synthetic fixture `fixtures/request-templates.synthetic.json`.
- **Adoption:** creates a private draft that copies the reviewed text and pins `template_id`/`template_version` (migration 0006). Later template revisions never change it. Creation is idempotent per owner and records an `adopted` lifecycle event plus `draft_adopted` audit row in the same transaction.
- **Private saved drafts:** stored in `tpr_private.request_drafts` under forced RLS and the `tpr_app_runtime` role; only the owner can read or change them (cross-member attempts return 404). Updates require `If-Match` and fail with 412 on concurrent edits. Field validation is strict; drafting lint is advisory.
- **Secure history:** lifecycle timeline with evidence wording, corrections and conflicts (TPR-23), the TPR-24 timing estimate, and the member's own activity trail (TPR-10).
- **Legal identity:** not collected. Drafts contain no requester name/contact fields; participants add those only in the agency's own system when filing.
- **Without a database:** a non-production deployment with `AUTH_PROVIDER=fake` uses an in-memory store (banner shown; resets on restart). Otherwise member pages explain that accounts are unavailable and link to the browser-only drafting tool.

Tests: `tests/member-api.test.ts` runs the full API suite against both the memory store and real PostgreSQL under RLS.
