# ProofScore v9 Deployment

## Accepted production candidate

Contract: `0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3`

Studio deploy transaction: `0xc9e7487b6300b305fa8ce9c12770f48e67c656cef17c006242f96b54eaf289bb`

This is the final accepted v9 production candidate. The deployment and smoke transactions below are recorded as accepted; accepted does not mean finalized. Treat them as **accepted / finalization pending** unless the explorer later reports `FINALIZED`. In particular, `claim_reward` scheduled payout finalization and does not establish that the external payout has finalized.

## Accepted-state smoke proof

Campaign ID `1` and submission ID `1` completed the entire flow:

- `create_campaign`: `0x91d2dcb5dd9445bcad04c85fda7b10e75fbf5e61ec028691627e93d14942a0d9`
- `submit_builder_profile`: `0xbc2b1669f528a12e8b97694db7809c8f51f58d2ce62a004a7bc1cd1de8a30478`
- `challenge_score`: `0xe6ca01a9a7cf00132fb09f8bdb14f67fd09dcd80442a2e2a90089785efe72aea`
- `claim_reward`: `0x633c79ac18b7e70b5b524adfde595c2daf747954b460ca82ac13a8ed1bfd2070`

All four transactions reported `ACCEPTED`, consensus `AGREE`, and execution `FINISHED_WITH_RETURN`. The submission scored 85 before challenge. The `[invalid:additional]` challenge reduced it to 65 while its decision remained `QUALIFIED`; `eligible_to_claim` remained true before claim. The claim then scheduled payout finalization.

The accepted `get_stats` state was: campaigns `1`, submissions `1`, challenges `1`, claims scheduled `1`, and total locked wei `0`.

## Historical failed deployments

- `0xE01239760aA51069107B27915b63583E6fd91b3f` failed submit consensus: its first `submit_builder_profile` transaction (`0xb8b4cf0189d4a24b28381aafd21c47eb09a5ff7134dd7f1a97f76dbf0a5e3b4c`) ended `UNDETERMINED` / `NO_MAJORITY` and was not accepted.
- `0xD09cF426b9CeA68ff6106b9ce098399100e03303` passed create, submit, and claim, but its challenge failed because the old leaderboard rerank used unsupported indexed `DynArray.pop`. Campaign 2 challenge transaction `0xd85069809c52741850325799689c19ef7aefb99faf9c9691578f8f120a82d749` reached consensus `AGREE` but execution `FINISHED_WITH_ERROR`.

This source intentionally limits v9 to 25 campaigns, 25 submissions per campaign, and a top-25 leaderboard for Bradbury/testnet safety. Exact leaderboard rebuilding is consequently capped at 625 candidates.

## Preflight

Run the repository verification commands from the README. Fund a dedicated Bradbury deployer and export its private key only in the current shell:

Set `GENLAYER_DEPLOYER_PK` securely in the current shell without writing or displaying it, then run `npm run deploy:v9`.

The script prints the transaction hash and waits for `ACCEPTED`. It presents an address only when execution is `FINISHED_WITH_RETURN` and `get_stats` succeeds. `FINISHED_WITH_ERROR` is a failed deployment even if consensus reports `AGREE` and the transaction later becomes `FINALIZED`; never publish its address. Acceptance is not finality, so wait for `FINALIZED` before publishing a successful deployment.

Never put `GENLAYER_DEPLOYER_PK` in `.env`, `.env.local`, source, logs, screenshots, or command history shared with reviewers.

## Configure the app

Set the frontend deployment environment variable:

```text
NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS=0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3
```

Optionally override `NEXT_PUBLIC_GENLAYER_RPC`. Build and deploy the frontend separately. Until an address is configured, the app visibly remains in preview mode with reads/writes disabled.

## Accepted-state smoke test

Set `GENLAYER_DEPLOYER_PK` securely in the current shell, set `PROOFSCORE_V9_ADDRESS` to the deployed address, then run `npm run smoke:v9`.

The smoke script spends testnet GEN. It polls repeatedly for an existing matching campaign before creating one, waits for acceptance, and polls campaign, submission, claim, and stats views until each accepted state is visible. Set `SMOKE_CAMPAIGN_ID` to continue only that exact campaign and prohibit creation. Otherwise set `SMOKE_CAMPAIGN_TITLE` to a stable lookup key. `SMOKE_REWARD_WEI` controls the small test reward; `SMOKE_CHALLENGE=1` exercises pre-claim additional-evidence invalidation. That path verifies the canonical score falls from 85 to 65, remains eligible at threshold 45, and then claims. If a future challenge forces `INVALID` or otherwise removes eligibility, claim is skipped safely.

Campaign requirements must use exact lowercase tokens when a category is mandatory: `[requires:github]`, `[requires:x]`, `[requires:portfolio]`, `[requires:additional]`. Score-affecting pre-claim creator challenges likewise use `[invalid:github]`, `[invalid:x]`, `[invalid:portfolio]`, `[invalid:additional]`, `[invalid:duplicate]`, or `[invalid:irrelevant]`.

Once any write returns a hash, inspect that hash rather than resubmitting. `UNDETERMINED`, `NO_MAJORITY`, and deterministic-violation results are hard failures, not retry signals. Bradbury read backpressure is handled with bounded exponential delay. For production evidence, wait for `FINALIZED` before treating campaign creation, scoring, claim, or refund as irreversible.
