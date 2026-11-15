# The Public Record

The Public Record is the Justice For All civic records and Freedom of Information Act (FOIA) participation platform.

**Current status:** deployable development preview; not launched. It boots with no credentials and, when configured, offers sign-in, private drafts, request lifecycle tracking and FOIA deadline estimates. No agency integration, uploads, archive publication or encryption assurance exists, and the platform never files requests for anyone. See the [delivery register](docs/IMPLEMENTATION_STATUS.md) for verified status.

## Start here

- [Complete development and independent-account handoff plan](docs/DEVELOPMENT_PLAN.md) — authoritative 52-work-package roadmap.
- [Delivery and acceptance register](docs/IMPLEMENTATION_STATUS.md) — implementation truth, dependencies, and next steps.
- [Security boundary and contribution rules](SECURITY.md) — privacy-first development rules.

## Mission

Let the public investigate documented questions, locate existing disclosures, prepare **individual, self-filed** agency records requests, preserve correspondence privately, and publish reviewed documentary evidence with verifiable provenance. Never automate third-party requester impersonation or indiscriminate mass submissions.

## Existing infrastructure to integrate

- [FOIA Aggregator](https://github.com/Justice-For-All-Movement/FOIA_Aggregator): publicly released records and ingestion, not a request filing engine.
- [End-To-End-Everywhere Security Architecture Standard](https://github.com/Justice-For-All-Movement/End-To-End-Everywhere-Security-Architecture-Standard): applicable security requirements by component and data flow; no unsupported certification claims.
- [Engine Room](https://github.com/Justice-For-All-Movement/Engine-Room): evidence-backed progress, not invented completion percentages.
- [Justice For All](https://github.com/Justice-For-All-Movement/Justic-For-All): future parent site and shared navigation.

## Development

Local setup: [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md). Hosted deployment (Render web service, optional Neon PostgreSQL) and every environment variable: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The app is built incrementally against TPR-01 onward. The full scope lives in the development plan, and progress is recorded only when a work package meets its stated acceptance criteria.

No production secrets belong in Git, issues, logs, or pull requests.

## End-to-End Everywhere progress

The canonical [security/e2eesa-status.json](security/e2eesa-status.json) records standard implementation, complete testing and independent expert review separately. Engine Room reads it automatically from GitHub. All initial stages are pending; existing profile locks and approved decisions remain authoritative. Read [adoption and independent-account instructions](docs/E2EESA_ADOPTION.md), and run `python3 scripts/validate_e2eesa_status.py`. Record validation does not establish product security or certification.
