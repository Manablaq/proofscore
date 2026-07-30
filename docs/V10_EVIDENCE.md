# ProofScore v10 — public evidence dossier

## What is being tested

ProofScore v10 is a GenLayer-native builder-bounty workflow. A sponsor locks a
GEN reward in an intelligent contract. A builder then creates a wallet-bound
evidence record and publishes a one-time challenge token at a public resource.
Only after validators confirm that public-resource control can the same record
receive a consensus evidence-completeness verdict. A reward is claimable only
after an `ACCEPTED` verdict meets the published 70/100 threshold.

## Live references

- Live workspace: <https://proofscoreapp.vercel.app>
- Source repository: <https://github.com/Manablaq/proofscore>
- v10 contract: `0x8F34645E4757EFa01BDb620431934ca1caEAe4d4`
- Deployment transaction: <https://explorer-bradbury.genlayer.com/tx/0x1560d78338c702e9cf62ddbe2c6bac7f873c836d00ac1b2ca18fcbf5a5c032d5>
- Contract source: [proof_score_v10.py](../contracts/proof_score_v10.py)

## Reproducible workflow

1. A sponsor creates and funds an open campaign with a stated deadline and a
   fixed per-builder reward.
2. A builder submits four public URLs: a proof resource, repository, live
   product, and this evidence dossier.
3. The contract derives a one-time token bound to the campaign, submission,
   caller wallet, and expiry. The builder publishes that exact token at the
   proof resource.
4. GenLayer validators independently fetch the public proof resource. Account
   control becomes `CONTROL_VERIFIED` only when the exact token is present.
5. Validators independently fetch this same dossier and derive a transparent,
   deterministic rubric: repository link present (25), product link present
   (25), GenLayer mentioned (20), wallet-control flow described (15), and
   deployment evidence present (15).
6. An `ACCEPTED` verdict with a score of at least 70 makes the record eligible
   to claim the escrowed GEN reward. All state transitions remain auditable in
   the GenLayer explorer.

## Why GenLayer is central

The product is not a static scorecard. Its core workflow depends on GenLayer
consensus twice: first to confirm control of a public resource using a
contract-generated challenge, and then to settle a transparent evidence-based
evidence-completeness verdict. The contract gates GEN settlement on those accepted on-chain
states; a normal web backend cannot substitute for that protocol decision.

## Scope and limits

ProofScore proves that the submitting wallet controlled the stated public
resource during the active challenge window. It does **not** prove legal
identity, authorship outside that resource, or universal objective quality.
The evidence-completeness verdict is a decentralized, reproducible judgment of
explicit public-dossier signals and should be read within that scope. Incomplete evidence
must result in `INSUFFICIENT_EVIDENCE` or a rejected, non-rewardable record.
