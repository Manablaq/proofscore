# ProofScore

ProofScore is a GenLayer Bradbury testnet app for generating and reading on-chain builder reputation scores. The frontend points at the deployed ProofScore v8 contract on GenLayer Bradbury. The contract generates evidence-backed tiered builder reputation scores and stores accepted results on-chain.

The project is intentionally careful about claims: ProofScore is a contract-scored reputation signal, not identity verification and not a truth oracle.

## Links

- Live app: https://proofscoreapp.vercel.app
- GitHub repo: https://github.com/Manablaq/proofscore
- Network: GenLayer Bradbury testnet
- RPC: `https://rpc-bradbury.genlayer.com`
- Chain ID: `4221`
- V8 live contract address: `0x12aE05355F2C89476a46c2Ec5BCA75B0F073A09B`
- V8 live explorer page: https://explorer-bradbury.genlayer.com/address/0x12aE05355F2C89476a46c2Ec5BCA75B0F073A09B
- Contract source: `contracts/proof_score.py`

## Version Status

- ProofScore v8 is deployed on GenLayer Bradbury.
- The frontend config points to the v8 deployed contract.
- V8 keeps the public method names and frontend score keys compatible with the previous deployment.
- V8 adds evidence-backed tier validation, `version`, `evidence_summary`, and `evidence` fields.

## Contract Methods

Write method:

- `generate_score(username, github_url, twitter_url, portfolio_url)`: generates a score for `gl.message.sender_address`, stores score JSON, updates the username map, and maintains the top-50 leaderboard.

Read methods:

- `get_score(address)`: returns a JSON object for an address, or a default `exists: "false"` object if no score exists.
- `get_leaderboard()`: returns the stored leaderboard as JSON.
- `get_stats()`: returns `total_profiles`, `leaderboard_size`, and v8 `contract_version` after redeployment.
- `has_score(address)`: returns `"true"` or `"false"`.

## V8 Scoring Model

Users submit a display name plus at least one of GitHub, Twitter/X, or portfolio URL. The v8 contract keeps tiered scores and stores frontend-compatible fields:

- `BUILD`: GitHub evidence, 0-200
- `VOICE`: Twitter/X evidence, 0-200
- `CRAFT`: portfolio/work evidence, 0-200
- `NETWORK`: Bradbury and Ethereum address evidence, 40-200
- `CONSISTENCY`: visible alignment across submitted URLs, handles, display name, and evidence summaries, 0-200

Each dimension is snapped to fixed tiers: `0`, `40`, `80`, `120`, `160`, or `200`. Total score is the sum of the five dimensions, up to 1000.

V8 stores additional review data:

- `version`
- `evidence_summary`
- `evidence`

The existing frontend remains compatible with older scores and displays v8 evidence summaries when present.

## What Validators Check

The v8 contract uses `gl.eq_principle.prompt_non_comparative` with compact leader-fetched evidence. Validator criteria ask validators to accept outputs only when:

- output is a valid JSON object
- `score` is exactly in the allowed tier set for that dimension
- `reasoning` and `evidence` are non-empty strings
- evidence is derived from the supplied input
- reasoning explains why the selected tier follows the rubric
- high tiers are not accepted when evidence is unavailable or too sparse
- consistency scores obey caps when only one or two platforms are submitted

This is stronger than the current deployed format-only criteria, but it still uses bounded prompts and compact evidence to avoid heavy validator-side web fetching.

## What Validators Do Not Prove

ProofScore validators still do not prove:

- that a submitted profile belongs to the wallet owner
- that external GitHub, Twitter/X, portfolio, explorer, or Etherscan pages are complete or truthful
- that a user is objectively skilled or trustworthy
- that all relevant off-chain evidence was available at scoring time

ProofScore should be read as an on-chain, evidence-backed reputation signal after v8 redeployment, not as identity verification.

## Frontend And API Behavior

The Next.js app uses RainbowKit/Wagmi for wallet connection and `genlayer-js` for contract calls.

- Client writes call only `generate_score` through the connected wallet provider.
- The server API route at `app/api/contract/route.ts` performs read-only calls.
- API reads are allowlisted to `get_score`, `get_leaderboard`, `get_stats`, and `has_score`.
- Unsupported API methods return `400`.
- Malformed args return `400`.
- Address args are validated before contract reads.
- The server does not hold wallet credentials and does not sign transactions.
- No fabricated fallback data is returned; API errors are surfaced as failed responses.
- Shared network and contract constants live in `lib/config.ts`.

## Local Development

Install dependencies:

```bash
npm install
```

Run lint:

```bash
npm run lint
```

Run a production build:

```bash
npm run build
```

Optional local dev server:

```bash
npm run dev
```

## Submission Testing Steps

1. Open the live app and confirm wallet connection targets GenLayer Bradbury.
2. Use leaderboard and stats views to confirm read-only API calls return contract data.
3. Connect a wallet on Bradbury, submit a display name plus at least one profile URL, and sign the `generate_score` transaction in the connected wallet.
4. Wait for the transaction to reach an accepted or finalized state, then confirm the score appears in `My Score`.
5. Use the lookup view with the same wallet address and confirm it returns stored contract output.
6. Confirm `lib/config.ts` points to the v8 contract, redeploy the frontend, then repeat the write and read checks.
7. Run `npm run lint`, `npm run build`, `python3 -m py_compile contracts/proof_score.py`, and `git diff --check` locally before submission.

## Verification Commands

```bash
npm install
npm audit
npm run lint
npm run build
python3 -m py_compile contracts/proof_score.py
git diff --check
```

## V8 Redeploy Command

Set `GENLAYER_DEPLOYER_PK` in the deployment shell, then run:

```bash
npm run deploy:v8
```

The script prints the deploy transaction hash and accepted receipt. After deployment, update `lib/config.ts` with the new contract address, redeploy the frontend, and record the proof fields below.

## Deployment Proof

V8 deployment:

- Contract address: `0x12aE05355F2C89476a46c2Ec5BCA75B0F073A09B`
- Deployment transaction hash: `0xaf1f7497923fce7cd8a6e733237e1b6f6333d0ab08ed0c0ab9c99333f085647a`
- Explorer contract page: https://explorer-bradbury.genlayer.com/address/0x12aE05355F2C89476a46c2Ec5BCA75B0F073A09B
- Explorer transaction page: https://explorer-bradbury.genlayer.com/tx/0xaf1f7497923fce7cd8a6e733237e1b6f6333d0ab08ed0c0ab9c99333f085647a
- Deployer wallet: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- Transaction execution hash: `0xad21706d814336d5833527452981a57d45e5ea4e77ca83a674091f3631329479`
- Receipt result: `1`
- Contract source: `contracts/proof_score.py`

## Successful V8 Test Proof

A live v8 scoring transaction was submitted and accepted on Bradbury.

- Score transaction ID: `0x524800645a3a8bdcfc4840a9c0b4c30e8a8ae545a06bf690548add2ec219dba1`
- GenLayer chain transaction hash: `0x491412f4c43417e13d4f9e3d5f775383264c5278a86a39cc4f6164521764b63a`
- Scored wallet: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- Contract: `0x12aE05355F2C89476a46c2Ec5BCA75B0F073A09B`
- Stored version: `v8`
- Stored total score: `160`
- Stored leaderboard size after test: `1`
- Stored profile count after test: `1`

The live API returned `exists: "true"`, `version: "v8"`, score fields, `evidence_summary`, and the structured `evidence` object for the scored wallet.

## Dependency Audit Note

The dependency pass first used safe transitive fixes, then migrated the app to Next 16, ESLint 9, and TypeScript 5.9 with an explicit webpack build path. `npm audit` currently reports zero vulnerabilities.

## Security Notes

- No server wallet credentials are required by the app.
- No server-side signing is implemented.
- The WalletConnect/RainbowKit `projectId` in `app/providers.tsx` is a public client identifier.
- There is no required `.env` file for the current app configuration.
