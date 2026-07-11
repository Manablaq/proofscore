# ProofScore v9 Submission

**One-line pitch:** ProofScore is an evidence-settled builder bounty protocol where deterministic, contestable scores gate claims from sponsor-funded GEN escrow.

## Problem

Builder bounties often separate evidence review from payment. Sponsors must manually compare inconsistent profiles, builders cannot easily inspect why they qualified, and a reputation score has little consequence if it does not control a real outcome.

## Solution

ProofScore joins evidence submission, deterministic scoring, contestability, and reward settlement in one contract. A sponsor funds a campaign and defines a threshold and evidence requirements. Each builder submits public evidence identifiers once. Accepted canonical state determines eligibility; an eligible builder can claim one fixed reward, while challenges remain in the audit trail.

## Why GenLayer

GenLayer supplies consensus and accepted/finalized transaction semantics for a value-bearing decision. The canonical score is not merely displayed: it authorizes release from campaign escrow. ProofScore deliberately keeps the rubric deterministic so validators converge on identical persisted state, while GenLayer provides the consensus boundary, accepted-state reads, and finalization-dependent external transfers needed for settlement.

## User journey

1. A sponsor creates a payable campaign, selecting a threshold, reward per qualified builder, funded slots, deadline, and evidence requirements.
2. A builder submits a handle, supported evidence URLs, and bounded notes. One wallet can submit once per campaign.
3. The contract validates evidence categories, applies fixed weights, stores a canonical decision, and exposes claim eligibility in accepted state.
4. Any wallet may record counter-evidence. Before claim, only the campaign creator can use supported exact invalidation tags to revise score or eligibility.
5. An eligible submitting wallet claims. Contract accounting is debited and the external GEN transfer is marked `SCHEDULED_FOR_FINALIZATION`; it is not described as paid until finality is known.
6. After the deadline, the creator may close the campaign and schedule the remaining pool for refund. There is no post-claim clawback.

## Contract architecture

`contracts/proof_score.py` stores campaigns, submissions, and challenges as compact JSON records in `TreeMap` collections with ordered ID arrays for views. Payable campaign creation accounts for received wei as escrow. Writes cover campaign creation, evidence submission, challenge, claim, and close; read-only JSON views expose records, statistics, and the top-score list.

The deployed safety bounds are 25 campaigns, 25 submissions per campaign, and a top-25 leaderboard. Full reranking is therefore bounded to at most 625 stored submissions.

## Frontend architecture

The Next.js App Router frontend uses RainbowKit/Wagmi for wallet connection and `genlayer-js` for writes. A server-side read route allowlists view methods and reads the configured Bradbury contract. The UI waits for successful accepted execution, polls for accepted-state visibility, refreshes in the background, and never automatically resubmits a transaction after receiving a hash.

Campaign cards show total and remaining reward pool, threshold, deadline, and protocol status. The selected campaign shows reward per builder and evidence requirements. Submission records show score, decision, eligibility, challenge state, and finalization-dependent payout status. The UI disables submission for closed, exhausted, or time-expired campaigns even though expiration is derived from an `OPEN` campaign's deadline rather than stored as a separate contract status.

## Scoring and challenge rules

The 100-point rubric is deterministic:

- GitHub URL: 25
- X/Twitter URL: 15
- Portfolio URL: 20
- Additional evidence URL: 20
- Notes: 0, 10, or 20 according to bounded context length

Qualification requires GitHub or portfolio evidence, a score at or above the campaign threshold, and every exact mandatory category. Requirements use `[requires:github]`, `[requires:x]`, `[requires:portfolio]`, and `[requires:additional]`.

Creator challenges before claim may use `[invalid:github]`, `[invalid:x]`, `[invalid:portfolio]`, or `[invalid:additional]` to remove category points. `[invalid:duplicate]` and `[invalid:irrelevant]` force `INVALID`. Ordinary-user, untagged, and post-claim challenges are recorded without changing payout eligibility.

## Deployment details

- Live app: <https://proofscoreapp.vercel.app>
- Repository: <https://github.com/Manablaq/proofscore>
- Network: GenLayer Bradbury testnet
- Production contract: `0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3`
- Studio deployment transaction: `0xc9e7487b6300b305fa8ce9c12770f48e67c656cef17c006242f96b54eaf289bb`

The deployment is recorded as accepted with successful execution. This document does not claim it is finalized.

## Smoke-test proof

- `create_campaign`: `0x91d2dcb5dd9445bcad04c85fda7b10e75fbf5e61ec028691627e93d14942a0d9`
- `submit_builder_profile`: `0xbc2b1669f528a12e8b97694db7809c8f51f58d2ce62a004a7bc1cd1de8a30478`
- `challenge_score`: `0xe6ca01a9a7cf00132fb09f8bdb14f67fd09dcd80442a2e2a90089785efe72aea`
- `claim_reward`: `0x633c79ac18b7e70b5b524adfde595c2daf747954b460ca82ac13a8ed1bfd2070`

All four were observed `ACCEPTED` with consensus `AGREE` and execution `FINISHED_WITH_RETURN`. The challenge reduced the canonical score from 85 to 65 while retaining threshold-45 eligibility. The claim scheduled payout finalization. See [Deployment](DEPLOYMENT.md) for the complete record.

## Known limitations

- Evidence URLs are identifiers, not proof of profile ownership or independent verification of linked claims.
- Deterministic category scoring favors consensus safety and auditability over qualitative evaluation.
- There is no post-claim clawback.
- Protocol and leaderboard sizes are intentionally bounded for Bradbury/testnet safety.
- Accepted state can precede finality; scheduled payout/refund accounting is not proof of an externally finalized transfer.
- Some deployed user-triggerable validation uses assertions. Frontend deadline preflight protects normal UI users, but malformed direct contract calls may be accepted and finish with an execution error such as `AssertionError: Deadline must be in the future.` Replacing assertions with readable `UserError` handling is recommended hardening, not a submission blocker, and requires redeployment plus complete smoke testing.

## Roadmap

- Redeploy assertion-based validation as readable `UserError` paths and repeat the complete smoke suite.
- Add stronger evidence ownership or attestation mechanisms without overstating identity guarantees.
- Explore richer consensus-safe evidence evaluation while preserving reproducible settlement state.
- Revisit protocol bounds and post-claim dispute design after testnet operating evidence.
