# TPR-12/17 — Reviewed filing routes and request templates in the database

Migration `0008_reviewed_registry.sql` (schema `tpr_public`), repository `lib/registry/reviewed-registry.ts`, source selection `lib/server/catalog.ts`, review queue `/admin/registry`, API under `/api/v1/admin/public-record/` (see OpenAPI).

## Templates (TPR-17)
- Versions move `draft → in_review → published` (or `rejected`); approving a new version retires the previously published one in the same transaction (`one_published_template_version` unique index).
- Editors author (`create`, and `update`/`submit` only their own drafts). Publication requires a **different** editor or a records reviewer. The database enforces this again (`reviewer_subject <> editor_subject` CHECK) and a trigger makes submitted versions immutable and forbids deletion.
- Adopted drafts copy the text and pin the version, so later versions never change them (tested).
- The public catalog/work cards show only the latest published versions, without editor/reviewer identities.

## Filing routes (TPR-12)
- Admins maintain an exact trusted-host list (`filing_trusted_hosts`, with reason; audited). Routes (portal or agency email) are proposed by editors/records reviewers and must pass `evaluateFilingRoute` against that list at proposal **and** verification time.
- Verification requires a records reviewer or admin other than the proposer (also a DB CHECK). Approving supersedes the previous approved route for the component; `reverify` renews the 90-day freshness window. Route content is immutable; changes are new proposals.
- The self-filing guide (TPR-21) uses approved database routes when any exist.

## Fixtures
Outside production, when the database has no published templates / approved routes, the labeled synthetic fixtures are used so previews work. Production never shows fixtures.

## Roles
Roles come only from owner-provisioned `tpr_private.role_grant_events` (see AUTHORIZATION.md), e.g.
`INSERT INTO tpr_private.role_grant_events(owner_subject,issuer,role,grant_action,actor_subject,reason) VALUES ('<subject>','<issuer>','editor','granted','<operator>','<reason>');`

## Remaining for acceptance
Real reviewed routes for at least two genuine agency formats (portal and email) entered by people, and a template-authoring form (authoring is API-only today).
