# ProofScore v9

ProofScore is a GenLayer-native, evidence-settled builder bounty protocol: **reputation that settles rewards**. A sponsor locks a GEN reward pool and sets a minimum score. Builders submit public evidence identifiers, the contract computes a canonical score, and only an accepted qualifying submission unlocks a reward claim. Counter-evidence challenges remain in the on-chain audit trail without persisting validator-variable prose.

This is an evidence-backed reputation assessment, not identity verification. A submitted profile URL does not prove that a wallet owns the profile.

## Settlement flow

1. **Campaign:** a sponsor creates a payable campaign and deposits its reward pool in wei.
2. **Evidence:** a builder submits source URLs and contextual notes.
3. **Canonical score:** validated GitHub, X/Twitter, portfolio, additional evidence, and bounded notes receive fixed weights. Qualification requires GitHub or portfolio plus the threshold and every exact requirement token.
4. **Claim reward:** `QUALIFIED` plus `score >= threshold` makes the builder eligible. `claim_reward` deducts the fixed reward from escrow and schedules the external GEN transfer for finalization.
5. **Challenge:** anyone can record bounded counter-evidence. Before claim, only the campaign creator can apply exact invalidation tags that deterministically recompute score and eligibility. Post-claim challenges cannot claw funds back.

One builder wallet can submit only once per campaign. GitHub evidence must use `https://github.com/...`; X evidence must use `https://x.com/...` or `https://twitter.com/...`.

ProofScore v9 is intentionally bounded for Bradbury/testnet safety: at most 25 campaigns, 25 submissions per campaign, and 25 leaderboard entries. These limits keep exact full-submission leaderboard recomputation bounded to at most 625 candidates, including when a challenge lowers a score and promotes a previously omitted submission.

Campaign requirements use only these exact lowercase tokens: `[requires:github]`, `[requires:x]`, `[requires:portfolio]`, and `[requires:additional]`. Other requirement prose remains descriptive and does not silently create mandatory categories.

Score-affecting creator challenges use only these exact lowercase tags: `[invalid:github]`, `[invalid:x]`, `[invalid:portfolio]`, `[invalid:additional]`, `[invalid:duplicate]`, and `[invalid:irrelevant]`. Category tags remove their points; duplicate and irrelevant tags force `INVALID`.

See [Submission](docs/SUBMISSION.md), [Architecture](docs/ARCHITECTURE.md), [Deployment](docs/DEPLOYMENT.md), [Testing](docs/TESTING.md), and [Review response](docs/REVIEW_RESPONSE.md).

## Live project and deployment proof

- Live app: <https://proofscoreapp.vercel.app>
- Repository: <https://github.com/Manablaq/proofscore>
- Production contract: `0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3`
- Studio deployment transaction: `0xc9e7487b6300b305fa8ce9c12770f48e67c656cef17c006242f96b54eaf289bb`

The deployment and smoke transactions are recorded as accepted with finalization pending. Exact hashes and observed accepted state are in [Deployment](docs/DEPLOYMENT.md).

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

The accepted ProofScore v9 production candidate is `0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3`. Configure it with:

```text
NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS=0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3
```

There is deliberately no runtime fallback to an earlier deployment. See the deployment record for the Studio deploy transaction and complete accepted-state smoke proof. The recorded transactions are accepted with finalization pending unless the explorer subsequently reports them finalized.

## Verification

```bash
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

See [Testing](docs/TESTING.md) for scope, smoke-test behavior, and the difference between local checks and accepted-chain evidence.

## Scripts

- `npm run deploy:v9` reads `GENLAYER_DEPLOYER_PK` from the environment and deploys the v9 source. It never prints the key.
- `npm run diagnose:v9 -- 0x…` prints compact receipt and execution-trace failure fields without dumping contract calldata.
- `npm run smoke:v9` requires `GENLAYER_DEPLOYER_PK` and `PROOFSCORE_V9_ADDRESS`, safely finds or creates a funded campaign, waits for accepted-state visibility, submits evidence, confirms canonical score state, and claims only if eligible. Set `SMOKE_CAMPAIGN_ID` to continue exactly one existing campaign and disable creation. Challenge submission is opt-in with `SMOKE_CHALLENGE=1`.

Neither script retries a write after receiving a transaction hash. The deploy script exposes an address only after `FINISHED_WITH_RETURN` and a successful `get_stats` read. The smoke script backs off on transient Bradbury reads, polls all campaign views after acceptance, reuses one matching campaign on continuation, and fails explicitly on `UNDETERMINED` / `NO_MAJORITY`.

## Honest limitations

- Submitted URLs are evidence identifiers, not proof that a wallet owns an off-chain profile; the contract does not fetch or authenticate them.
- Scoring is deliberately deterministic and category-based. It is consensus-safe and auditable, but does not judge the qualitative merit of the linked work.
- There is no post-claim clawback. Later challenges remain recorded but cannot reverse a scheduled transfer.
- Bradbury safety bounds limit the deployment to 25 campaigns, 25 submissions per campaign, and 25 leaderboard entries.
- Some deployed user-triggerable validation paths use Python assertions. The frontend preflights campaign deadlines, so normal UI users receive readable validation before wallet submission. A malformed direct contract call can still be accepted with an execution error such as `AssertionError: Deadline must be in the future.` Replacing these assertions with readable `UserError` handling is **recommended hardening**, not a submission blocker; it changes deployed contract runtime behavior and therefore requires a new deployment and a complete smoke test.
