# ProofScore v10 — submission-ready capability statement

ProofScore v10 is a GenLayer-native evidence adjudication project for builder
bounties. A sponsor deposits GEN. A builder first proves that the wallet making
the claim controls a stated public resource, then submits repository, product,
and documentation evidence for decentralized evaluation against a fixed rubric.
Only a consensus-accepted verdict may schedule a reward transfer.

## Exact guarantees

- **Wallet control:** the caller's signed GenLayer transaction identifies the
  wallet controlling the submission.
- **Public-resource control:** the caller must publish the contract-generated,
  expiry-bound challenge token at the submitted HTTPS proof URL. Validators
  independently fetch the URL and require the exact token before marking the
  record `CONTROL_VERIFIED`.
- **Quality decision:** validators evaluate publicly accessible evidence against
  fixed criteria: functionality (25), meaningful GenLayer integration (30),
  real-world use (20), documentation/reproducibility (15), and originality/reuse
  potential (10). An `ACCEPTED` result needs a total of at least 70.

## Claims we do not make

- A public-resource challenge is not legal or government identity verification.
- A verdict is not an objective universal proof of quality. It is a transparent,
  decentralized judgment against the published rubric and available evidence.
- The contract never stores fetched page prose or hidden reasoning. It stores the
  agreed structured result and concise rationale only.

## Security model

Evidence URLs are HTTPS-only and bounded. Rendered pages are untrusted data; the
quality prompt explicitly ignores instructions inside the evidence. Each quality
result must fit an exact JSON schema, fixed per-criterion ranges, a valid verdict,
and an acceptance threshold. Validator-side evaluation must agree on verdict and
stay within four points on every rubric criterion. Any malformed result, failed
fetch, expired challenge, or lack of consensus prevents payout eligibility.

## Required live proof before Portal submission

1. Deploy `contracts/proof_score_v10.py` as a new contract; v9 stays unchanged.
   Use `npm run deploy:v10` with `GENLAYER_DEPLOYER_PK` supplied only through
   the shell environment. The script refuses to configure a contract unless its
   accepted-state `get_stats` response is explicitly v10.
2. Create a funded campaign.
3. Submit evidence from a wallet, then publish the generated token at the public
   proof URL.
4. Finalize account-control verification, quality adjudication, and the reward
   claim on Bradbury.
5. Record contract address and finalized transaction links in this document and
   the project submission.
