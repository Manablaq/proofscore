# Response to GenLayer Portal Review

## What changed

ProofScore v8 was advisory only: it produced an evidence-backed score, but that score behaved like a reputation badge and did not gate a contestable outcome.

ProofScore v9 is an evidence-settled builder bounty protocol. A sponsor locks a real GEN reward pool and chooses a minimum score. Accepted canonical score state directly controls campaign eligibility: only a `QUALIFIED` submission at or above the threshold can call `claim_reward`, which debits campaign escrow and schedules the builder payout for finalization.

## Why GenLayer consensus is essential

Validator consensus remains essential because the accepted score and eligibility state authorize a value-bearing claim from locked campaign funds. After a Bradbury smoke submission produced divergent validator result hashes and `NO_MAJORITY`, scoring was deliberately narrowed to a deterministic, reviewable rubric. Consensus now agrees on identical canonical state instead of attempting to store each validator's freeform judgment.

Each assessment uses validated category URLs, one submission per builder wallet per campaign, and records:

- score and qualification decision
- deterministic confidence marker and five score dimensions
- evidence summary
- accepted and rejected source identifiers
- risk flags
- fixed rubric reasoning and scoring-method version
- accepted eligibility and claim state

Campaigns declare mandatory categories only through exact lowercase `[requires:github]`, `[requires:x]`, `[requires:portfolio]`, and `[requires:additional]` tokens.

## Contestability

Any participant can submit a bounded, source-backed challenge. Before claim, the campaign creator can deterministically remove category points using exact lowercase `[invalid:github]`, `[invalid:x]`, `[invalid:portfolio]`, or `[invalid:additional]` tags. `[invalid:duplicate]` and `[invalid:irrelevant]` force `INVALID`. Eligibility and campaign qualified counts are recomputed. Non-creator, untagged, and post-claim challenges are recorded without changing payout eligibility; there is no clawback.

The old submit transaction `0xb8b4cf0189d4a24b28381aafd21c47eb09a5ff7134dd7f1a97f76dbf0a5e3b4c` was not accepted. No production address should be changed until this source is freshly deployed and the complete smoke flow passes.

## Honest state language

The UI distinguishes submitted, accepted with finalization pending, finalized, and failed. A transaction hash is not presented as a state change. Campaign and score reads occur after acceptance. External payout/refund transfers are labeled scheduled for finalization until finality is actually reached.

This makes validator consensus, canonical source handling, and settlement state essential to the product’s core value flow without allowing variable model prose to fork state.
