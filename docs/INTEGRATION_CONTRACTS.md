# Cross-platform contracts — version 1 (internal proposal)

Implementation and legal boundaries: [ADR 0001](adr/0001-system-boundaries.md). These version numbers describe **The Public Record's internal interface**; they do not promise other repositories already expose them.

## FOIA Aggregator: `public-archive-search/v1`
Direction: only publicly released records and read-only metadata into The Public Record. Do **not** send requester names, emails, adoption state, unpublished allegations or private documents.

Required response envelope: `contract_version`, `source`, `observed_at`, `coverage`, and `records`. Unknown keys are invalid. Response is bounded to 100 records. Each record has `id`, `title`, `agency`, `source_url`, `record_url`, `sha256` (nullable) and `published_at` (nullable). URLs must be HTTPS with ordinary hostnames. SHA-256 hashes must be exact 64-hex characters. Unknown keys in record rows are rejected rather than accidentally logged or rendered.

`coverage` is `unknown`, `partial`, or `broad_not_exhaustive`. None means that every available record has been covered. Returned records may still require attribution and independent review before being used as evidence for allegations.

Adapter status must distinguish `not_configured`, `unavailable`, `invalid_contract`, `available`. It must not invent search results on outage or parse arbitrary upstream HTML as JSON. Operational adapter authentication is undefined until an upstream endpoint exists.

### Resolver (TPR-15) — now on the real FC-13 export
FOIA Aggregator publishes `foia-catalog-export/1` (FC-13: `GET /api/v1/export/manifest`, `GET /api/v1/records?limit=&cursor=`, JSON Schema `schemas/catalog-record.v1.schema.json` in Justice-For-All-Movement/FOIA_Aggregator). It has no search endpoint, so `lib/integrations/foia-catalog-export.ts` pages up to 5,000 records of one snapshot from the pinned HTTPS origin (`FOIA_AGGREGATOR_PUBLIC_URL`; `credentials:"omit"`, no redirects, JSON only, 4 MiB per response), restarts once if the snapshot changes mid-export (409), caches the parsed index for 10 minutes and reuses it while `snapshot_id` is unchanged, and searches locally. **The search text is never sent upstream.** Only known schema fields are projected; additive or unexpected fields (e.g. storage keys) are dropped and never rendered; non-HTTPS record links are skipped.

`lib/research/archive-resolver.ts` (page `/public-record/search`, API `GET /api/v1/public-record/records/search?q=`) returns `matches`, `no_matches_in_indexed_portion`, `not_configured`, `unavailable`, `incompatible_contract` or `invalid_query`, with provenance (contract, snapshot id, generated time, catalog vs searched counts, archive-connected flag), `exhaustive:false`, preservation status per record (`archived_copy_with_hash` only for archived binaries with SHA-256, otherwise `indexed_link_only`), official/third-party source labels, warnings for partial/empty/disconnected catalogs, and official fallback links. Every non-match outcome says a missing result does not mean records don't exist (tested). `FOIA_AGGREGATOR_FIXTURES=true` uses a synthetic FC-13-shaped catalog (ignored in production); the upstream golden page is vendored at `fixtures/aggregator/` for conformance tests. The earlier `public-archive-search/v1` proposal remains only as the TPR-02 contract test.

## Other intended contracts
- **Justice For All identity**: OIDC discovery, signed token verification and issuer/audience constraints; browser claims not directly accepted. TPR-07 implements.
- **Engine Room**: repository roadmap `.exechub/project.yml` and explicitly mapped PR numbers; operational status output never includes participant content. TPR-45 implements.
- **Liberty Nodes**: reviewed publication-manifest-only output, versioned content hash and correction/takedown signaling with permanence caveat. TPR-44 implements.

## Schema changes
Add `v2` rather than silently weakening `v1` privacy fields. Tests against synthetic fixtures are mandatory; then negotiate and verify the matching upstream producer contract.
