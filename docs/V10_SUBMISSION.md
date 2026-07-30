# ProofScore v10 — submission-ready capability statement

ProofScore v10 is a GenLayer-native evidence adjudication project for builder
bounties. A sponsor deposits GEN. A builder first proves that the wallet making
the claim controls a stated public resource, then submits repository, product,
and documentation evidence for decentralized evaluation against a fixed rubric.
Only a consensus-accepted verdict may schedule a reward transfer.

Use the concise [public v10 evidence dossier](V10_EVIDENCE.md) as the
documentation URL for live evidence-adjudication tests.

## Exact guarantees

- **Wallet control:** the caller's signed GenLayer transaction identifies the
  wallet controlling the submission.
- **Public-resource control:** the caller must publish the contract-generated,
  expiry-bound challenge token at the submitted HTTPS proof URL. Validators
  independently fetch the URL and require the exact token before marking the
  record `CONTROL_VERIFIED`.
- **Evidence decision:** validators independently fetch one concise, public
  evidence dossier and derive fixed signals: repository link present (25),
  product link present (25), GenLayer mentioned (20), wallet-control flow
  described (15), and deployment evidence present (15). An `ACCEPTED` result
  needs a total of at least 70.

## Claims we do not make

- A public-resource challenge is not legal or government identity verification.
- A verdict is not an objective universal proof of quality. It is a transparent,
  decentralized evidence-completeness judgment against the published rubric.
- The contract never stores fetched page prose or hidden reasoning. It stores the
  agreed structured result and concise rationale only.

## Security model

Evidence URLs are HTTPS-only and bounded. The documentation URL is the concise
evidence dossier; repository and product URLs are checked as exact public links.
The fetched dossier is untrusted data and only explicit Boolean signals are
derived from it. Validators independently fetch the same dossier and strict-match
the canonical signal set. Any failed fetch, expired challenge, or insufficient
signal score prevents payout eligibility.

## Required live proof before Portal submission

1. Deploy `contracts/proof_score_v10.py` as a new contract; v9 stays unchanged.
   Use `npm run deploy:v10` with `GENLAYER_DEPLOYER_PK` supplied only through
   the shell environment. The script refuses to configure a contract unless its
   accepted-state `get_stats` response is explicitly v10.
2. Create a funded campaign.
3. Submit evidence from a wallet, then publish the generated token at the public
   proof URL.
4. Finalize account-control verification, evidence adjudication, and the reward
   claim on Bradbury.
5. Record contract address and finalized transaction links in this document and
   the project submission.
