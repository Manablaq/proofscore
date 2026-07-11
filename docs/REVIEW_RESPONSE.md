# Response to GenLayer Portal Review

## What changed

ProofScore v8 was advisory only: it produced an evidence-backed score, but that score behaved like a reputation badge and did not gate a contestable outcome.

ProofScore v9 is an evidence-settled builder bounty protocol. A sponsor locks a real GEN reward pool and chooses a minimum score. The accepted validator score directly controls campaign eligibility: only a `QUALIFIED` submission at or above the threshold can call `claim_reward`, which debits campaign escrow and schedules the builder payout for finalization.

## Why GenLayer consensus is essential

Deterministic code can enforce the accepted threshold, but it cannot judge whether varied off-chain builder evidence satisfies a campaign. GenLayer validators produce and contest that structured judgment. Their consensus now decides a value-bearing result rather than decorating a profile.

Each assessment records:

- score and qualification decision
- confidence and five score dimensions
- evidence summary
- accepted and rejected source identifiers
- risk flags
- validator reasoning
- accepted eligibility and claim state

## Contestability

Any participant can submit a source-backed challenge. Validators receive the original evidence URLs and notes, the accepted sources and reasoning, the prior score/decision, and the new challenge URL/reason. They must explicitly compare original evidence with counter-evidence and return an uphold, reduction, increase, invalidation, or needs-more-evidence verdict.

Before claim, the revised accepted result recomputes `eligible_to_claim`, so a successful challenge can block reward release and a corrective challenge can enable it. After claim, the outcome remains part of the record, but v9 clearly states that it cannot claw back the already scheduled payout.

## Honest state language

The UI distinguishes submitted, accepted with finalization pending, finalized, and failed. A transaction hash is not presented as a state change. Campaign and score reads occur after acceptance. External payout/refund transfers are labeled scheduled for finalization until finality is actually reached.

This makes validator consensus, source handling, challenge comparison, and settlement state essential to the product’s core value flow.
