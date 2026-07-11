# ProofScore v9

ProofScore is a GenLayer-native, evidence-settled builder bounty protocol: **reputation that settles rewards**. A sponsor locks a GEN reward pool and sets a minimum score. Builders submit public evidence identifiers, validators produce an accepted structured assessment, and only a qualifying score unlocks a reward claim. Counter-evidence can challenge and revise eligibility before claim.

This is an evidence-backed reputation assessment, not identity verification. A submitted profile URL does not prove that a wallet owns the profile.

## Settlement flow

1. **Campaign:** a sponsor creates a payable campaign and deposits its reward pool in wei.
2. **Evidence:** a builder submits source URLs and contextual notes.
3. **Validator score:** GenLayer validators accept a 0–100 score, decision, confidence, five dimensions, source record, risks, and reasoning.
4. **Claim reward:** `QUALIFIED` plus `score >= threshold` makes the builder eligible. `claim_reward` deducts the fixed reward from escrow and schedules the external GEN transfer for finalization.
5. **Challenge:** a challenger submits counter-evidence. Validators compare it with the original evidence and accepted reasoning, then recompute eligibility. A post-claim challenge is recorded but does not pretend to claw funds back.

See [Architecture](docs/ARCHITECTURE.md), [Deployment](docs/DEPLOYMENT.md), and [Review response](docs/REVIEW_RESPONSE.md).

## Contract interface

Payable write:

- `create_campaign(title, description, threshold_score, reward_per_qualified_builder, deadline, evidence_requirements)`

Writes:

- `submit_builder_profile(campaign_id, handle, github_url, x_url, portfolio_url, additional_evidence_url, notes)`
- `claim_reward(campaign_id, submission_id)`
- `challenge_score(campaign_id, submission_id, challenge_url, reason)`
- `close_campaign(campaign_id)`

Read-only views return JSON strings immediately and do not change state:

- `get_campaign`, `list_campaigns`
- `get_submission`, `list_submissions`
- `get_challenge`, `list_challenges`
- `get_stats`, `get_leaderboard`, `list_top_scores`

## Transaction semantics

`writeContract` returns a transaction hash immediately; it does not mean state changed. The app and smoke script wait for `ACCEPTED` before reading accepted state. `ACCEPTED` is always labeled “finalization pending.” External EOA payout/refund messages execute on finalization, so accepted claim state says `SCHEDULED_FOR_FINALIZATION`, not “paid.” Wait for `FINALIZED` before relying on final settlement.

Payable `value` is denominated in wei (1 GEN = 10¹⁸ wei), and `create_campaign` is decorated `@gl.public.write.payable`.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

The default contract address is the zero address and disables live reads/writes. After a separately authorized deployment, set `NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS`. There is deliberately no fallback to an earlier deployment.

## Verification

```bash
npm run lint
npm run build
npm audit
PYTHONPYCACHEPREFIX=/private/tmp/proofscore-pycache python3 -m py_compile contracts/*.py
git diff --check
git status --short
```

## Scripts

- `npm run deploy:v9` reads `GENLAYER_DEPLOYER_PK` from the environment and deploys the v9 source. It never prints the key.
- `npm run diagnose:v9 -- 0x…` prints compact receipt and execution-trace failure fields without dumping contract calldata.
- `npm run smoke:v9` requires `GENLAYER_DEPLOYER_PK` and `PROOFSCORE_V9_ADDRESS`, creates a funded campaign, waits for acceptance, submits evidence, confirms accepted score state, and claims only if eligible. Challenge submission is opt-in with `SMOKE_CHALLENGE=1`.

Neither script retries a write after receiving a transaction hash. The deploy script exposes an address only after `FINISHED_WITH_RETURN` and a successful `get_stats` read. The smoke script backs off on transient Bradbury read failures.
