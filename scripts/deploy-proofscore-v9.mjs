import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAccount, createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const TX_HASH_PATTERN = /0x[0-9a-fA-F]{64}/g
const EVM_WRAPPER_HASH_PATTERN = /EVM tx (0x[0-9a-fA-F]{64})/i
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const BACKPRESSURE_DELAYS_MS = [15_000, 30_000, 60_000, 120_000]
const EXPECTED_EXECUTION_RESULT = 'FINISHED_WITH_RETURN'
const BRADBURY_EXPLORER = 'https://explorer-bradbury.genlayer.com'

const stringify = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)

function errorText(error) {
  if (!error || typeof error !== 'object') return String(error)
  return [error.shortMessage, error.details, error.message, String(error)].filter(Boolean).join('\n')
}

function isBackpressure(error) {
  const text = errorText(error).toLowerCase()
  return text.includes('node is not currently accepting transactions') || text.includes('pipeline backpressure') || text.includes('l1_sender_commit')
}

function hashesIn(error) {
  return [...new Set(errorText(error).match(TX_HASH_PATTERN) ?? [])]
}

function collectAddressCandidates(value, candidates = new Set()) {
  if (!value || typeof value !== 'object') return candidates

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && ADDRESS_PATTERN.test(item) && item.toLowerCase() !== ZERO_ADDRESS) {
      if (/(?:recipient|contract|address)$/i.test(key)) candidates.add(item)
    } else if (item && typeof item === 'object') {
      collectAddressCandidates(item, candidates)
    }
  }
  return candidates
}

async function submitDeploy(client, code) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.deployContract({ code })
    } catch (error) {
      const evmWrapperHash = errorText(error).match(EVM_WRAPPER_HASH_PATTERN)?.[1]
      if (evmWrapperHash) {
        throw new Error(`Deploy submission produced EVM wrapper tx ${evmWrapperHash}. Inspect it and do not retry blindly.\nBradbury explorer: ${BRADBURY_EXPLORER}/tx/${evmWrapperHash}\n${errorText(error)}`)
      }

      const hashes = hashesIn(error)
      if (hashes.length > 0) {
        throw new Error(`Deploy submission error contains transaction hash ${hashes[0]}. Inspect it and do not retry blindly.\nBradbury explorer: ${BRADBURY_EXPLORER}/tx/${hashes[0]}\nRun: node scripts/inspect-deploy-receipt.mjs ${hashes[0]}\n${errorText(error)}`)
      }

      if (isBackpressure(error) && attempt < BACKPRESSURE_DELAYS_MS.length) {
        const delay = BACKPRESSURE_DELAYS_MS[attempt]
        console.warn(`Bradbury backpressure before any hash was returned; retrying deploy submission in ${delay / 1000}s (${attempt + 1}/${BACKPRESSURE_DELAYS_MS.length}).`)
        await sleep(delay)
        continue
      }
      throw error
    }
  }
}

const privateKey = (process.env.GENLAYER_DEPLOYER_PK ?? '').trim()
if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
  console.error('GENLAYER_DEPLOYER_PK must be set to a 32-byte 0x-prefixed hex private key.')
  console.error('The key is read from the environment only and is never printed.')
  process.exit(1)
}

const code = await readFile(new URL('../contracts/proof_score.py', import.meta.url), 'utf8')
const account = createAccount(privateKey)
const client = createClient({ chain: testnetBradbury, account })
const hash = await submitDeploy(client, code)

console.log(`Submitted: deploy tx ${hash}`)
console.log(`Bradbury deploy tx: ${BRADBURY_EXPLORER}/tx/${hash}`)

let receipt
try {
  receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 5_000, retries: 180 })
} catch (error) {
  throw new Error(`Deploy tx did not reach ACCEPTED. Inspect it and do not resubmit blindly.\nBradbury explorer: ${BRADBURY_EXPLORER}/tx/${hash}\nRun: node scripts/inspect-deploy-receipt.mjs ${hash}\n${errorText(error)}`)
}

console.log(`Accepted — finalization pending: deploy tx ${hash}`)
console.log(stringify({ acceptedReceipt: receipt }))

if (receipt.txExecutionResultName !== EXPECTED_EXECUTION_RESULT) {
  throw new Error(`Deploy tx reached ACCEPTED without ${EXPECTED_EXECUTION_RESULT}. Inspect it and do not resubmit blindly.\nBradbury explorer: ${BRADBURY_EXPLORER}/tx/${hash}\nReceipt: ${stringify(receipt)}`)
}

const addressCandidates = [...collectAddressCandidates(receipt)]
const contractAddress = ADDRESS_PATTERN.test(receipt?.recipient ?? '') && receipt.recipient.toLowerCase() !== ZERO_ADDRESS
  ? receipt.recipient
  : addressCandidates[0]

console.log(stringify({
  version: 'v9',
  deployTransactionHash: hash,
  deployer: account.address,
  txExecutionHash: receipt.txExecutionHash ?? null,
  contractAddress: contractAddress ?? null,
  addressCandidates,
}))
console.log(`Bradbury deployer: ${BRADBURY_EXPLORER}/address/${account.address}`)
if (receipt.txExecutionHash) console.log(`Bradbury execution tx: ${BRADBURY_EXPLORER}/tx/${receipt.txExecutionHash}`)
if (contractAddress) console.log(`Bradbury contract: ${BRADBURY_EXPLORER}/address/${contractAddress}`)
console.log('Accepted — finalization pending. Do not treat this deployment as finalized until the explorer reports finalization.')
