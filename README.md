# ProofScore

AI-Verified On-Chain Reputation for Builders on GenLayer Bradbury Testnet.

## Live App
https://proofscoreapp.vercel.app

## Contract
- Address: `0xB7e56dAA26e5f1b6127398d14A3Fa90338A0e4c2` (Bradbury Testnet)
- File: `contracts/proof_score.py`

## How It Works
Users submit GitHub, Twitter/X, and portfolio URLs. The Intelligent Contract fetches real data from each platform and scores across 5 dimensions using `gl.eq_principle.prompt_non_comparative`:

- **BUILD** (0-200): GitHub activity via GitHub REST API
- **VOICE** (0-200): Twitter/X professional presence
- **CRAFT** (0-200): Portfolio quality
- **NETWORK** (0-200): On-chain history (Bradbury + Ethereum)
- **CONSISTENCY** (0-200): Cross-platform identity alignment

Tier-based scoring (0/40/80/120/160/200) with format-only validator criteria ensures reliable consensus. Scores stored on-chain with a global leaderboard.

## Stack
- GenLayer Bradbury Testnet (Python Intelligent Contract)
- Next.js + genlayer-js
- Vercel
