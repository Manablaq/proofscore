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
const raw = await client.readContract({ address, functionName: 'get_stats', args: [], stateStatus: 'accepted' })
const stats = typeof raw === 'string' ? JSON.parse(raw) : raw
if (stats?.contract_version !== 'v10') throw new Error('get_stats did not return v10. Do not configure the frontend.')
console.log(JSON.stringify({ version: 'v10', deployTransactionHash: hash, contractAddress: address, getStats: stats, next: `Set NEXT_PUBLIC_PROOFSCORE_V10_ADDRESS=${address}; wait for FINALIZED before claiming production proof.` }, null, 2))
