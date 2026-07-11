# ProofScore v9 Architecture

## Product boundary

ProofScore v9 is an escrow-backed bounty settlement protocol. Validator judgment is economically consequential: its accepted score controls whether a specific builder can release a fixed campaign reward.

```text
Sponsor payable deposit → Campaign escrow
                              ↓
Builder source identifiers → Validator assessment → eligibility
                                      ↑                 ↓
Counter-evidence challenge ────────────┘          claim schedules GEN transfer
```

## Stored records

- A campaign stores creator, terms, threshold, fixed reward, total/remaining pool, deadline, status, and counts.
- A submission stores all evidence URLs/notes plus score, decision, confidence, five 0–20 dimensions, source acceptance/rejection, risk flags, reasoning, eligibility, claim state, and revisions.
- A challenge stores the counter-evidence, prior result, verdict, revised result, source handling, risks, reasoning, and whether it recomputed eligibility or was recorded after claim.

Collections are JSON-string records keyed in `TreeMap`; ordered IDs are stored separately for robust JSON-string views. The leaderboard is a bounded top-50 accepted-score index.

## Validator boundary

Bradbury can be sensitive to heavy live web resolution, so v9 uses a metadata-only resolver pattern. The prompt receives campaign requirements, submitted URL identifiers, evidence notes, and prior accepted reasoning. Validators must not invent page contents or treat a URL as identity proof. Unverifiable or weak records must reduce confidence and produce `INVALID` or `NOT_QUALIFIED`.

All non-deterministic prompting finishes before the contract performs persistent writes. Parser guards enforce bounded scores, enums, string/list shapes, source presence, and conservative fallbacks.

Challenges give validators both the complete original record and the new counter-evidence. Insufficient counter-evidence preserves the prior result through `NEEDS_MORE_EVIDENCE`; credible evidence can uphold, reduce, increase, or invalidate the score.

## Value settlement

Campaign creation is payable and accounts for the exact received wei as escrow. A claim requires the caller to be the submitting builder, accepted eligibility, no prior claim, and sufficient remaining pool. State is debited once and an external transfer is emitted to the builder. GenLayer external transfers execute on finalization.

Protocol statistics distinguish cumulative funding (`total_funded_wei`), current outstanding campaign escrow (`total_locked_wei`), cumulative scheduled claims (`total_claimed_wei`), and cumulative scheduled creator refunds (`total_refunded_wei`). These are contract accounting values; claim and refund transfers remain finalization-dependent.

After the deadline, only the creator can close and schedule refund of the unallocated pool. Challenge evaluation is synchronous within its accepted transaction, so the contract has no separate unresolved challenge queue. No centralized administrator can override validator results.

## Known limitation

There is no clawback. A challenge accepted before claim can block or enable settlement; a challenge after a claim records the revised assessment without reversing the already scheduled transfer. This limitation is explicit in contract state and UI.
