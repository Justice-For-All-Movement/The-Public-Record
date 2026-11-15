# TPR-09 private object quarantine — initial capability contract

**Current status (TPR-09/28):** private uploads work end to end behind interfaces, with credential-free drivers for development. **No live bucket or ClamAV daemon has been exercised**; production needs `STORAGE_DRIVER=s3` (Backblaze B2 S3-compatible) or another durable driver, a real scanner, and `PRIVATE_STORAGE_KEY`.

## Implemented
- `lib/storage/object-store.ts`: one `PrivateObjectStore` interface; drivers `memory` (tests/previews; refused in production), `local` (absolute `PRIVATE_STORAGE_DIR`, 0600 files, atomic writes, no path escape) and `s3` (SigV4, path-style, HTTPS only; signer verified against AWS's published example). Every driver stores **AES-256-GCM ciphertext** keyed per object via HKDF from `PRIVATE_STORAGE_KEY` and bound to the object key (moved/tampered ciphertext fails). Keys look like `private/quarantine/v1/<HMAC owner tag>/<uuid>`; no names or filenames. No method creates a public URL.
- `lib/storage/inspection.ts`: server-side byte sniffing (PDF, PNG, JPEG, UTF-8 text, DOCX/XLSX), declared-vs-actual mismatch refusal, 25 MiB cap, PDF active content (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/XFA`, … including `#xx`-escaped names), Office macros/embedded binaries, ZIP central-directory checks (entries, total size, compression ratio → archive bombs).
- `lib/storage/scanner.ts`: fake EICAR scanner (refused in production) and a ClamAV `clamd` INSTREAM client (`CLAMAV_HOST`/`CLAMAV_PORT`). Scanner errors fail closed; without a scanner uploads are disabled.
- `lib/storage/uploads.ts` + `POST/GET /api/v1/me/public-record/requests/{id}/uploads[/{objectId}]`: owner of the draft only; inspect → scan → encrypt/store → record (migration 0009) → audit `evidence_quarantined`; rejected bytes are never stored (only SHA-256 + reason audited); downloads are owner-only, re-verify SHA-256, `attachment`, `no-store`, `nosniff`, `CSP sandbox`. Draft page shows a "Private documents" panel when enabled.

## Original contract notes


## Storage ownership and privacy

1. Each quarantined original is private; the server must never expose a public B2 object URL or use a publicly listed/readable bucket for original evidence.
2. The upload-intent issuer requires a verified account and server-loaded draft owner, matching the same authenticated subject. Untrusted client-supplied `ownerSubject` is not authoritative.
3. Object keys use `private/quarantine/v1/` with keyed pseudonymous owner tags and random UUIDs; raw requester identity does not appear in the storage path. Even pseudonyms are sensitive metadata.
4. Upload intent is a 5-minute HMAC capability with allowed MIME types and a 50 MiB initial per-item ceiling. Server verifies the signature, authenticated subject, key prefix and expiry.
5. Capabilities are not proof that bytes are safe or legitimately obtained. Future ingress must independently sniff content type, verify byte count/checksum, malware-scan in isolation, reject oversized/archive bombs, log only redacted metadata and store a one-time token replay ledger.
6. The only storage adapter methods are write/read/delete **private** bytes; publication/replication must go through separate explicit consent and editorial review, never through a flag added to the original.
7. Access checks must use actual session identity plus server-owned object/draft membership; permission tests include cross-user, tamper and expiry scenarios.

## Required integration before production

- Create a distinct *private* B2 bucket (or isolated scope with equivalent access constraints) through an authorized workspace, no public bucket grants and no cross-project credentials.
- Provision least-privilege application keys through Render secret management; never commit or print them.
- Implement true private B2 adapter and usage/fee ceilings, retry/idempotency and object lifecycle/versioning.
- Persist upload grants, scanned status, hash and ownership in Neon; issue one-time short-lived access tokens backed by audit and revocation.
- Implement malware/type-safety pipeline and privacy screening before editorial review; encrypted-at-rest storage and TLS are not claims of end-to-end encryption against server-side workers.
- Test forged/cross-owner and expired access, wrong MIME/size, unauthorized direct B2 access and backup/restore from a separate runtime database principal.
- Capture applicable E2EESA control-level evidence; obtain review prior to real confidential submissions.

These steps are tracked under TPR-09, 10, 28–32 and 47–52. **Do not enable uploads or call TPR-09 operationally complete on the strength of this library alone.**
