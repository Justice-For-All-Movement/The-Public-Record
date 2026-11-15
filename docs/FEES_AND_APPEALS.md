# TPR-26 fees/scope and TPR-27 appeal & OGIS assistance

## Fees (`lib/lifecycle/fees.ts`)
The participant's fee ceiling (draft field) is a limit they chose, never a promise of no cost. `feeStatus` reads the latest `fee_estimate_received` and the response to it. The events API refuses to record `fee_response_sent: accepted` when the estimate exceeds the ceiling unless the participant states an `acceptedMaxUsd` of at least the estimate, and refuses acceptance with no recorded estimate. Narrowing, declining and waiver requests are always recordable. The platform never pays, chooses a fee category or claims a waiver. Draft-page fee notices are private.

## Appeals (`lib/appeals/appeal-assistant.ts`)
After an adverse recorded determination (anything but a full grant), the draft page explains the optional administrative appeal and OGIS mediation, shows the hedged window ("at least 90 days … follow the agency's letter"), links DOJ OIP, OGIS and FOIA.gov, and builds an editable plain-text letter from chosen grounds with placeholders for date, name and contact details. Nothing is filed for the participant; outcomes are never predicted. The timeline keeps the original determination alongside any appeal and its result (TPR-23).

## Remaining
Private correspondence storage (needs TPR-09/28), referral tracking UI, agency-specific appeal instructions in the reviewed registry (TPR-12), and live usability review.
