import { readFile } from 'node:fs/promises'
import { createAccount, createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

const key = (process.env.GENLAYER_DEPLOYER_PK ?? '').trim()
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('GENLAYER_DEPLOYER_PK must be a 32-byte 0x-prefixed private key. It is never printed.')
  process.exit(1)
}

const explorer = 'https://explorer-bradbury.genlayer.com'
const account = createAccount(key)
const client = createClient({ chain: testnetBradbury, account })
const code = await readFile(new URL('../contracts/proof_score_v10.py', import.meta.url), 'utf8')
const hash = await client.deployContract({ code })
console.log(`Submitted v10 deployment: ${explorer}/tx/${hash}`)

const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 5_000, retries: 180 })
if (receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
  throw new Error(`v10 deployment did not execute successfully: ${receipt.txExecutionResultName ?? 'UNKNOWN'}. Do not configure the frontend.`)
}
const address = receipt.recipient
if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '') || /^0x0{40}$/i.test(address)) {
  throw new Error('Deployment was accepted but no usable contract address was returned. Inspect the transaction; do not retry blindly.')
}
let stats = null
let readError = null
// Consensus can accept a deployment before a public GenVM RPC has caught up.
// Preserve the one submitted transaction and report that state; never invite a
// blind redeploy merely because an immediate read is unavailable.
for (let attempt = 0; attempt < 12; attempt += 1) {
  try {
    const raw = await client.readContract({ address, functionName: 'get_stats', args: [], stateStatus: 'accepted' })
    const candidate = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (candidate?.contract_version === 'v10') { stats = candidate; break }
    readError = 'get_stats returned an unexpected contract version.'
  } catch (error) {
    readError = error instanceof Error ? error.shortMessage ?? error.message : String(error)
  }
  await new Promise(resolve => setTimeout(resolve, 10_000))
}
console.log(JSON.stringify({
  version: 'v10', deployTransactionHash: hash, contractAddress: address, getStats: stats,
  state: stats ? 'ACCEPTED_AND_READABLE' : 'ACCEPTED_EXECUTION_CONFIRMED_RPC_SYNC_PENDING',
  rpcReadError: stats ? null : readError,
  next: stats ? `Set NEXT_PUBLIC_PROOFSCORE_V10_ADDRESS=${address}; wait for FINALIZED before claiming production proof.` : `Do not redeploy. Recheck ${address} after the public GenVM RPC syncs.`,
}, null, 2))
