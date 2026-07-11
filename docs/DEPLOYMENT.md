# ProofScore v9 Deployment

Deployment is intentionally separate from implementation. Do not reuse an earlier contract address: v9 changes storage and public methods.

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

The smoke script spends testnet GEN. It creates one campaign funded for one reward, waits for acceptance, reads accepted state, submits evidence, and claims only when the accepted validator result is eligible. Set `SMOKE_REWARD_WEI` to control the small test reward. Set `SMOKE_CHALLENGE=1` only when deliberately testing a pre-claim challenge.

Once any write returns a hash, inspect that hash rather than resubmitting. Bradbury read backpressure is handled with bounded exponential delay. For production evidence, wait for `FINALIZED` before treating campaign creation, scoring, claim, or refund as irreversible.
