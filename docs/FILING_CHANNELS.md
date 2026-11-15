# TPR-12 — Verified self-filing channel registry

**Status:** review and destination-validation policies with synthetic tests; no live filing-channel database, agency portal integration or real recipient verification.

Every displayed filing destination must be tied to a verified FOIA.gov or independently verified agency source, a specific agency component ID, an authorized records editor and a current verification timestamp. Hostnames are compared against exact, server-owned reviewed lists; a similar-looking suffix does not qualify. Review is required again when a URL, channel kind, email recipient or source changes.

Two distinct guidance formats are modeled: verified HTTPS portal and verified agency mailbox. Both require *the citizen* to take the final action. No server route submits a request, follows arbitrary redirects or solicits participant credentials on another's behalf.

Review freshness currently expires after 90 calendar days; stale entries suppress the direct filing destination until someone reconfirms the agency's current instructions. This is a conservative engineering setting, not a FOIA legal deadline. Any outbound redirect must be separately validated against the reviewed host set.

The example destinations in automated tests are **illustrative test fixtures**, not claims that a real federal component uses those channels. Operational TPR-12 acceptance still requires two independently verified genuine agency form formats, a persisting reviewed registry, source comparison/redirect QA, and human approval. Direct filing remains disabled until those gates pass.

Official source: https://www.foia.gov/developer/

## TPR-21 self-filing guide and TPR-22 receipt evidence

`lib/filing/self-filing-guide.ts` builds the "File it yourself" steps on each draft page from the reviewed route for the draft's pinned agency component. A direct portal link or `mailto:` address appears **only** when `evaluateFilingRoute` returns `verified`; unknown, stale (>90 days) or tampered routes fall back to FOIA.gov guidance with no direct destination. There is no submission code path. Recording a `filed` event requires the participant to affirm the exact text "I personally submitted this request to the agency using its official instructions." (enforced by the API).

The only routes today are the labeled synthetic fixture `fixtures/filing-routes.synthetic.json` (reserved `example.org` hosts), never loaded in production. A persisted, human-reviewed registry remains TPR-12 work.

Receipt evidence (`lib/filing/proof-fingerprint.ts`): participants may fingerprint a receipt in their browser (WebCrypto SHA-256); only `sha256:<hex>` is stored as the event's evidence reference and the file never leaves the device. Re-selecting the file on the timeline checks it is unchanged (tamper detection). A fingerprinted event is labeled "document attached, not yet reviewed"; only reviewer verification (separate role, not yet built) can produce confirmed wording. Agency tracking numbers are captured on `acknowledged` events.
