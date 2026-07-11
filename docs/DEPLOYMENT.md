# ProofScore v9 Deployment

Deployment is intentionally separate from implementation. Do not reuse an earlier contract address: v9 changes storage and public methods.

The earlier source was deployed at `0xE01239760aA51069107B27915b63583E6fd91b3f`, but it is not production-ready. Its first `submit_builder_profile` transaction (`0xb8b4cf0189d4a24b28381aafd21c47eb09a5ff7134dd7f1a97f76dbf0a5e3b4c`) ended `UNDETERMINED` / `NO_MAJORITY` and was not accepted. Do not resubmit that transaction. Do not update the production address to this deployment or any replacement until a fresh deployment passes the complete accepted-state smoke test.

## Preflight

Run the repository verification commands from the README. Fund a dedicated Bradbury deployer and export its private key only in the current shell:

Set `GENLAYER_DEPLOYER_PK` securely in the current shell without writing or displaying it, then run `npm run deploy:v9`.

The script prints the transaction hash and waits for `ACCEPTED`. It presents an address only when execution is `FINISHED_WITH_RETURN` and `get_stats` succeeds. `FINISHED_WITH_ERROR` is a failed deployment even if consensus reports `AGREE` and the transaction later becomes `FINALIZED`; never publish its address. Acceptance is not finality, so wait for `FINALIZED` before publishing a successful deployment.

Never put `GENLAYER_DEPLOYER_PK` in `.env`, `.env.local`, source, logs, screenshots, or command history shared with reviewers.

## Configure the app

After finalization, set the frontend deployment environment variable:

```text
NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS=0x…
```

Optionally override `NEXT_PUBLIC_GENLAYER_RPC`. Build and deploy the frontend separately. Until an address is configured, the app visibly remains in preview mode with reads/writes disabled.

## Accepted-state smoke test

Set `GENLAYER_DEPLOYER_PK` securely in the current shell, set `PROOFSCORE_V9_ADDRESS` to the deployed address, then run `npm run smoke:v9`.

The smoke script spends testnet GEN. It polls repeatedly for an existing matching campaign before creating one, waits for acceptance, and polls campaign, submission, claim, and stats views until each accepted state is visible. Set `SMOKE_CAMPAIGN_ID` to continue only that exact campaign and prohibit creation. Otherwise set `SMOKE_CAMPAIGN_TITLE` to a stable lookup key. `SMOKE_REWARD_WEI` controls the small test reward; `SMOKE_CHALLENGE=1` opts into challenge recording.

Campaign requirements must use exact lowercase tokens when a category is mandatory: `[requires:github]`, `[requires:x]`, `[requires:portfolio]`, `[requires:additional]`. Score-affecting pre-claim creator challenges likewise use `[invalid:github]`, `[invalid:x]`, `[invalid:portfolio]`, `[invalid:additional]`, `[invalid:duplicate]`, or `[invalid:irrelevant]`.

Once any write returns a hash, inspect that hash rather than resubmitting. `UNDETERMINED`, `NO_MAJORITY`, and deterministic-violation results are hard failures, not retry signals. Bradbury read backpressure is handled with bounded exponential delay. For production evidence, wait for `FINALIZED` before treating campaign creation, scoring, claim, or refund as irreversible.
