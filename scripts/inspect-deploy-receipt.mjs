import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

const hash = process.argv[2]

if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) {
  console.error('Usage: node scripts/inspect-deploy-receipt.mjs 0x<64-byte-tx-hash>')
  process.exit(1)
}

const jsonReplacer = (_key, value) => (typeof value === 'bigint' ? value.toString() : value)

function findAddressCandidates(value, path = '$', out = []) {
  if (typeof value === 'string') {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) out.push({ path, value })
    return out
  }

  if (!value || typeof value !== 'object') return out

  if (Array.isArray(value)) {
    value.forEach((item, index) => findAddressCandidates(item, `${path}[${index}]`, out))
    return out
  }

  for (const [key, item] of Object.entries(value)) {
    findAddressCandidates(item, `${path}.${key}`, out)
  }

  return out
}

const client = createClient({ chain: testnetBradbury })

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.ACCEPTED,
  interval: 5000,
  retries: 180,
})

const addressCandidates = findAddressCandidates(receipt)

console.log(JSON.stringify({
  deployTransactionHash: hash,
  acceptedReceipt: receipt,
  addressCandidates,
}, jsonReplacer, 2))
