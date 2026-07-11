import { readFile } from 'node:fs/promises'
import { createAccount, createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

const privateKey = (process.env.GENLAYER_DEPLOYER_PK ?? '').trim()
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error('GENLAYER_DEPLOYER_PK must be set to a 32-byte 0x-prefixed hex private key.')
  console.error('The key is read from the environment only and is never printed.')
  process.exit(1)
}

const code = await readFile(new URL('../contracts/proof_score.py', import.meta.url), 'utf8')
const client = createClient({ chain: testnetBradbury, account: createAccount(privateKey) })
const hash = await client.deployContract({ code })
console.log(JSON.stringify({ version: 'v9', deployTransactionHash: hash }, null, 2))
console.log('Submitted. Waiting for ACCEPTED; this does not claim finality.')

const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 5_000, retries: 180 })
console.log(JSON.stringify({ acceptedReceipt: receipt }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2))
console.log('Deployment was accepted. Inspect the receipt and wait for FINALIZED before treating the address as final.')
