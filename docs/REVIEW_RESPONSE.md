# Response to GenLayer Portal Review

## What changed

ProofScore v8 was advisory only: it produced an evidence-backed score, but that score behaved like a reputation badge and did not gate a contestable outcome.

ProofScore v9 is an evidence-settled builder bounty protocol. A sponsor locks a real GEN reward pool and chooses a minimum score. Accepted canonical score state directly controls campaign eligibility: only a `QUALIFIED` submission at or above the threshold can call `claim_reward`, which debits campaign escrow and schedules the builder payout for finalization.

For Bradbury/testnet safety, v9 accepts at most 25 campaigns and 25 submissions per campaign and retains an exact top-25 leaderboard. Full leaderboard recomputation is bounded to at most 625 stored candidates, so a challenged score decrease can correctly promote an omitted candidate without making ranking work grow indefinitely. The limits are exposed by `get_stats`.

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

## Accepted production proof

The final accepted v9 production candidate is `0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3`, deployed by Studio transaction `0xc9e7487b6300b305fa8ce9c12770f48e67c656cef17c006242f96b54eaf289bb`.

The complete campaign `1`, submission `1` smoke flow was accepted with consensus `AGREE` and execution `FINISHED_WITH_RETURN` for `create_campaign` (`0x91d2dcb5dd9445bcad04c85fda7b10e75fbf5e61ec028691627e93d14942a0d9`), `submit_builder_profile` (`0xbc2b1669f528a12e8b97694db7809c8f51f58d2ce62a004a7bc1cd1de8a30478`), `challenge_score` (`0xe6ca01a9a7cf00132fb09f8bdb14f67fd09dcd80442a2e2a90089785efe72aea`), and `claim_reward` (`0x633c79ac18b7e70b5b524adfde595c2daf747954b460ca82ac13a8ed1bfd2070`). The `[invalid:additional]` challenge reduced score 85 to 65 while the decision remained `QUALIFIED` and the submission remained eligible before claim. Claim scheduled payout finalization. Accepted stats were one campaign, submission, challenge, and scheduled claim, with `total_locked_wei` 0.

These results are **accepted / finalization pending**, not finalized, unless the explorer later reports finality. Earlier addresses remain historical failures: `0xE01239760aA51069107B27915b63583E6fd91b3f` failed submit consensus, while `0xD09cF426b9CeA68ff6106b9ce098399100e03303` passed create/submit/claim but its challenge failed because of the old indexed `DynArray.pop` implementation.

## Honest state language

The UI distinguishes submitted, accepted with finalization pending, finalized, and failed. A transaction hash is not presented as a state change. Campaign and score reads occur after acceptance. External payout/refund transfers are labeled scheduled for finalization until finality is actually reached.

This makes validator consensus, canonical source handling, and settlement state essential to the product’s core value flow without allowing variable model prose to fork state.

## Known validation limitation

Some deployed user-triggerable validation uses assertions. The frontend prevents invalid campaign deadlines before wallet submission, but a malformed direct call can be accepted and then finish execution with an error such as `AssertionError: Deadline must be in the future.` Converting these paths to readable `UserError` handling is recommended hardening, not a submission blocker, and would require redeployment and a complete smoke test.
