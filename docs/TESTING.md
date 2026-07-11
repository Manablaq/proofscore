# ProofScore v9 Testing

## Local verification

Run from the repository root:

```bash
npm install
npm run lint
npm run build
npm audit
PYTHONPYCACHEPREFIX=/private/tmp/proofscore-pycache python3 -m py_compile contracts/*.py
node --check scripts/deploy-proofscore-v9.mjs
node --check scripts/smoke-proofscore-v9.mjs
node --check scripts/diagnose-v9-deploy.mjs
git diff --check
git status --short
```

Lint and build check the Next.js frontend and API route. Python compilation catches contract syntax errors without deploying. The Node checks parse the deployment, smoke, and diagnostic scripts without executing network writes. `npm audit` reports known dependency vulnerabilities. `git diff --check` catches whitespace errors, while `git status --short` exposes uncommitted and untracked files.

## Smoke script

`npm run smoke:v9` is a write-capable Bradbury test and is not part of a routine local verification run. It requires `GENLAYER_DEPLOYER_PK` and `PROOFSCORE_V9_ADDRESS` in the shell and spends testnet GEN. `SMOKE_CAMPAIGN_ID` restricts the script to one existing campaign and disables campaign creation. `SMOKE_CHALLENGE=1` enables the creator challenge path.

The script submits each action at most once after a transaction hash is known. It waits for successful `ACCEPTED` execution, then polls accepted reads until campaign, submission, challenge, or claim state is visible. It does not treat backpressure before a hash as an on-chain submission, and it never interprets `UNDETERMINED`, `NO_MAJORITY`, or an execution error as success.

## Recorded production-candidate proof

The accepted smoke proof for contract `0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3` is:

- `create_campaign`: `0x91d2dcb5dd9445bcad04c85fda7b10e75fbf5e61ec028691627e93d14942a0d9`
- `submit_builder_profile`: `0xbc2b1669f528a12e8b97694db7809c8f51f58d2ce62a004a7bc1cd1de8a30478`
- `challenge_score`: `0xe6ca01a9a7cf00132fb09f8bdb14f67fd09dcd80442a2e2a90089785efe72aea`
- `claim_reward`: `0x633c79ac18b7e70b5b524adfde595c2daf747954b460ca82ac13a8ed1bfd2070`

All were observed as `ACCEPTED`, consensus `AGREE`, execution `FINISHED_WITH_RETURN`. These are accepted-state results, not claims of finality. The claim changed contract accounting to `SCHEDULED_FOR_FINALIZATION`; it does not prove the external transfer finalized. See [Deployment](DEPLOYMENT.md) for observed state and historical failures.

## Validation coverage and limitation

The frontend blocks campaign deadlines less than ten minutes in the future before wallet submission. This protects normal UI users from the deployed assertion path. Direct callers can bypass the UI; a malformed direct deadline call produced `AssertionError: Deadline must be in the future.` Converting assertion-based user validation to readable `UserError` handling is recommended hardening that requires a new deployment and full smoke testing.
