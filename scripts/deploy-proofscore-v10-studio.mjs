import { readFile } from 'node:fs/promises'
import { createAccount, createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

// Studionet is for a short-lived functional demonstration. It is not a
// replacement for the finalized Bradbury deployment and must never be used as
// a production address in the hosted frontend.
const key = (process.env.GENLAYER_DEPLOYER_PK ?? '').trim()
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('GENLAYER_DEPLOYER_PK must be a 32-byte 0x-prefixed private key. It is never printed.')
  process.exit(1)
}

const client = createClient({ chain: studionet, account: createAccount(key) })
const code = await readFile(new URL('../contracts/proof_score_v10.py', import.meta.url), 'utf8')
const hash = await client.deployContract({ code })
console.log(`Submitted v10 Studionet deployment: ${hash}`)

const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 2_000, retries: 90 })
if (receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
  throw new Error(`Studionet deployment did not execute successfully: ${receipt.txExecutionResultName ?? 'UNKNOWN'}.`)
}
const address = receipt.recipient
if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '') || /^0x0{40}$/i.test(address)) {
  throw new Error('Studionet deployment was accepted but returned no usable contract address.')
}

const raw = await client.readContract({ address, functionName: 'get_stats', args: [], stateStatus: 'accepted' })
const stats = typeof raw === 'string' ? JSON.parse(raw) : raw
if (stats?.contract_version !== 'v10') throw new Error('get_stats did not return the expected v10 contract.')

console.log(JSON.stringify({
  network: 'studionet',
  purpose: 'temporary functional demo only',
  deployTransactionHash: hash,
  contractAddress: address,
  getStats: stats,
  next: 'The contract is readable. Use this address only in GenLayer Studio for testing; do not place it in NEXT_PUBLIC_PROOFSCORE_V10_ADDRESS for the public Bradbury app.',
}, null, 2))
