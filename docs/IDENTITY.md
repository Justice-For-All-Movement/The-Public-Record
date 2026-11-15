# TPR-07 — Parent identity integration contract

**Status:** wired into the app. `/api/auth/login` → provider → `/api/auth/callback` → HttpOnly session; `/api/auth/logout` revokes server-side; `/api/auth/session` reports the signed-in member. Two providers sit behind one `IdentityProvider` interface (`lib/auth/providers.ts`), selected by `AUTH_PROVIDER`:

- `oidc` — Justice For All (or any standards OIDC issuer): authorization code + PKCE S256, sealed single-use login transaction cookie (`__Host-tpr_login`, AES-256-GCM, 5 min), token exchange at the pinned same-origin token endpoint (`lib/auth/oidc-token-exchange.ts`, bounded, no redirects, access/refresh tokens discarded), ID token verified with the pinned JWKS. **Not yet registered with the parent provider.**
- `fake` — synthetic identities for local/preview only (refused when the stage is production). It runs the same code-exchange and RS256 ID-token verification against an in-process issuer `https://fake-oidc.the-public-record.invalid` with an ephemeral key; subjects are `fake|<persona>`. The chooser page is `/auth/dev-login`.

Sessions (`lib/auth/session.ts`, ≤15 min) are recorded in `tpr_private.app_sessions`; every request re-checks that the session exists, is unrevoked, unexpired, matches the account's first issuer and the account is active (`tpr_private.member_accounts`). Logout revokes the row, so a copied cookie stops working. Without a database, a non-production `fake` deployment uses a clearly labeled in-memory store that resets on restart.

## Trust boundaries

- Justice For All is the intended OIDC identity authority; its issuer, client ID and same-origin JWKS URL must be configured explicitly by an operator.
- Start authorization using the authorization-code grant with PKCE S256 and independently random `state`, `nonce`, and code verifier. Persist login transactions in short-lived trusted storage; the helper does **not** create a browser cookie itself.
- After the trusted backend exchanges the code, validate the ID token signature using a **pinned, issuer-owned RS256 JWKS source**. Reject token-supplied `jku`, `x5u`, `crit`, unsigned tokens and unexpected algorithms. Verify exact issuer, audience, authorized party when applicable, nonce, issuance time, expiry, and maximum token age.
- Return only stable issuer/subject and validity times from identity verification. Never treat roles, custom permissions, names or email claims in the token as authorization. Map roles separately in TPR-08.
- Issue a host-only, HttpOnly, Secure, SameSite=Lax HMAC-signed application session with at most 15 minutes validity. `__Host-tpr_session` cookies must be set only by secure backend handlers.
- Expired/revoked accounts and sessions must be checked against durable identity/session records before enabling real user operations. The local session helper alone does **not** implement server-side revocation.
- OIDC metadata/JWKS changes and algorithm upgrades require an explicit reviewed configuration change; no browser may provide a JWKS URL.
- All user-controlled state and claims are untrusted until validated on the backend; never log raw tokens, signing secrets, authorization codes, or full identity assertions.

## Portable integration contract

Modules: `lib/auth/oidc-login.ts` (authorization parameters), `lib/auth/trusted-jwks.ts` (pinned key fetching), `lib/auth/oidc-id-token.ts` (signature and claims) and `lib/auth/session.ts` (short-lived signed session).

To replace the parent identity provider, supply verified configuration including issuer, authorization endpoint, client ID, redirect URI and JWKS URI. Same-origin issuer/JWKS and authorization endpoints are required in this first profile. A different trusted provider topology requires an explicit ADR and negative security tests; never loosen validation simply to make login work.

Test fixtures generate synthetic RSA signing keys inside the test process. No sample production keys or tokens belong in Git.

## Remaining gates before TPR-07 can be accepted as operational

1. Register the Justice For All OIDC client (issuer, endpoints, redirect URI) and set the `OIDC_*` variables.
2. Live test against that provider (claims, key rotation, logout); account deletion workflow.
3. ~~Callback/code exchange, PKCE/state lifecycle, persisted revocation, cookie handling, CSRF~~ — implemented and tested in-process (`tests/auth-routes.test.ts`, `tests/identity-providers.test.ts`, `tests/db-member-store.test.ts`).
4. Prove unauthenticated/private API denials, refresh/logout and provider failover behavior in a running deployed environment.
5. Confirm E2EESA identity/authentication profile applicability and security-review evidence.

**These gates are not fulfilled by a passing unit test.** The app remains a preview that cannot accept personal or private data.
