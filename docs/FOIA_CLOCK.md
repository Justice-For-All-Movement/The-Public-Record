# TPR-24 — Federal working-day and appeal-clock engine

Modules: `lib/clock/federal-calendar.ts`, `lib/clock/foia-clock.ts`; public estimator at `/public-record/clock` (browser-only, nothing is sent). Tests: `tests/federal-calendar.test.ts`, `tests/foia-clock.test.ts`.

## Calendar
Legal public holidays are computed from [5 U.S.C. § 6103](https://www.law.cornell.edu/uscode/text/5/6103) (including Juneteenth from 2021) with the observed-day rule (Saturday → Friday, Sunday → Monday, crossing year boundaries, e.g. 2021-12-31). Inauguration Day is excluded (Washington, D.C. area only). Presidential one-off closures are **not guessed**: supply them as reviewed `AdditionalClosure` entries with an HTTPS source.

## Rules modelled ([5 U.S.C. § 552(a)(6)](https://www.justice.gov/oip/freedom-information-act-5-usc-552))
| Rule | Behaviour |
|---|---|
| 20 working days for a determination | Counted from the day after receipt by the appropriate component |
| Unverified receipt | Range: from the reported filing date to the 10-working-day routing ceiling; labeled `approximate` |
| Requester-estimated receipt | Used, but labeled `approximate` |
| Misrouted request | Clock starts no later than 10 working days after first receipt by a designated component |
| Information toll | Only the first one pauses; later ones are noted and not excluded |
| Fee-clarification tolls | Pause from the day after the agency's request through the requester's response; open pause → `paused`, no date |
| Pause requested after the estimated date | Does not move the date |
| Unusual circumstances | Needs written notice; ≤10 extra working days; more → `alternative_timeframe` (date only if agreed) |
| Expedited processing | Decision estimate 10 calendar days after the request |
| Adverse determination | Appeal window at least 90 calendar days; a shorter stated deadline is flagged for review, never overridden |
| Appeal decision | 20 working days after appeal receipt (filing date if receipt unknown, noted) |
| Disputed records | `disputed`, no date |

`estimatedDatePassed` is a neutral fact. Output text is tested never to state illegality, violation or "overdue"; every result carries a disclaimer and its legal/calendar basis.

## Not modelled
Agency-specific regulations, exceptional-circumstances litigation standards, multitrack queues, state laws, government shutdown effects, after-hours receipt conventions. TPR-23 feeds lifecycle events into this engine; TPR-36 (Silence Clock exhibit) will present it publicly.
