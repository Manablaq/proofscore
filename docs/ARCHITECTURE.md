# ProofScore v9 Architecture

## Product boundary

ProofScore v9 is an escrow-backed bounty settlement protocol. Consensus is economically consequential: accepted canonical score state controls whether a specific builder can release a fixed campaign reward.

```text
Sponsor payable deposit → Campaign escrow
                              ↓
Builder source identifiers → canonical scoring rubric → eligibility
                                      ↑                 ↓
Counter-evidence challenge ────────────┘          claim schedules GEN transfer
```

## Stored records

- A campaign stores creator, terms, threshold, fixed reward, total/remaining pool, deadline, status, and counts.
- A submission stores validated evidence URLs/notes plus a deterministic score, decision, five weighted dimensions, exact-token requirement flags, eligibility, claim state, cumulative invalidations, and revisions. A builder wallet has one submission slot per campaign.
- A challenge stores bounded counter-evidence, prior/revised results, verdict, and settlement effect. Only pre-claim campaign-creator challenges carrying supported exact tags can change eligibility.

Collections are JSON-string records keyed in `TreeMap`; ordered IDs are stored separately for robust JSON-string views. The leaderboard is a bounded top-50 accepted-score index.

## Consensus-safe scoring

`submit_builder_profile` performs no web fetch or AI prompt. GitHub must use `https://github.com/...`; X must use `https://x.com/...` or `https://twitter.com/...`; portfolio and additional evidence must be HTTP(S). Fixed weights are GitHub 25, X 15, portfolio 20, additional evidence 20, and notes 0/10/20 based on bounded context length. Qualification requires GitHub or portfolio, the threshold, and all mandatory categories.

Only exact lowercase tokens create mandatory categories: `[requires:github]`, `[requires:x]`, `[requires:portfolio]`, and `[requires:additional]`.

Every persisted record uses sorted-key compact JSON. Raw AI output, freeform validator reasoning, validator-variable arrays, and nondeterministic scores never enter storage or leaderboard mutation.

## Value settlement

Campaign creation is payable and accounts for the exact received wei as escrow. A claim requires the caller to be the submitting builder, accepted eligibility, no prior claim, and sufficient remaining pool. State is debited once and an external transfer is emitted to the builder. GenLayer external transfers execute on finalization.

Protocol statistics distinguish cumulative funding (`total_funded_wei`), current outstanding campaign escrow (`total_locked_wei`), cumulative scheduled claims (`total_claimed_wei`), and cumulative scheduled creator refunds (`total_refunded_wei`). These are contract accounting values; claim and refund transfers remain finalization-dependent.

Before claim, the campaign creator can apply `[invalid:github]`, `[invalid:x]`, `[invalid:portfolio]`, or `[invalid:additional]` to remove category points and recompute eligibility. `[invalid:duplicate]` and `[invalid:irrelevant]` force `INVALID`. The tags are exact and lowercase. Other participants' challenges are recorded as `NEEDS_MORE_EVIDENCE` without changing eligibility.

After the deadline, only the creator can close and schedule refund of the unallocated pool. Challenge processing is synchronous and never derives state from unstructured AI output.

## Known limitation

There is no clawback. Post-claim challenges are recorded as `RECORDED_NO_CLAWBACK` and cannot reverse the already scheduled transfer.
