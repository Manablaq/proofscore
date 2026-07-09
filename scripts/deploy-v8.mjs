import { readFile } from 'node:fs/promises'
import { createAccount, createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

const rawPk = process.env.GENLAYER_DEPLOYER_PK ?? ''
const deployerPk = rawPk.trim()

const jsonReplacer = (_key, value) => (typeof value === 'bigint' ? value.toString() : value)

if (!deployerPk) {
  console.error('Set GENLAYER_DEPLOYER_PK before running npm run deploy:v8.')
  process.exit(1)
}

if (!/^0x[0-9a-fA-F]{64}$/.test(deployerPk)) {
  console.error('GENLAYER_DEPLOYER_PK must be a 32-byte hex private key: 0x followed by 64 hex characters.')
  console.error('Do not use a mnemonic, wallet address, account name, or quoted text.')
  process.exit(1)
}

const code = await readFile(new URL('../contracts/proof_score.py', import.meta.url), 'utf8')
const account = createAccount(deployerPk)
const client = createClient({
  chain: testnetBradbury,
  account,
})

const hash = await client.deployContract({ code })
console.log(JSON.stringify({ deployTransactionHash: hash }, jsonReplacer, 2))

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.ACCEPTED,
  interval: 5000,
  retries: 180,
})

console.log(JSON.stringify({ acceptedReceipt: receipt }, jsonReplacer, 2))
