import { setTimeout as sleep } from 'node:timers/promises'
import { createAccount, createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const TX_HASH_PATTERN = /0x[0-9a-fA-F]{64}/g
const EVM_WRAPPER_HASH_PATTERN = /EVM tx (0x[0-9a-fA-F]{64})/i
const BACKPRESSURE_DELAYS_MS = [15_000, 30_000, 60_000, 120_000]
const READ_DELAYS_MS = [10_000, 20_000, 40_000, 80_000, 120_000]
const EXPECTED_EXECUTION_RESULT = 'FINISHED_WITH_RETURN'

const privateKey = (process.env.GENLAYER_DEPLOYER_PK ?? '').trim()
const contractAddress = (process.env.PROOFSCORE_V9_ADDRESS ?? process.env.NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS ?? '').trim()
if (!PRIVATE_KEY_PATTERN.test(privateKey)) throw new Error('GENLAYER_DEPLOYER_PK is required and must be a 32-byte private key. The key was not printed.')
if (!ADDRESS_PATTERN.test(contractAddress)) throw new Error('PROOFSCORE_V9_ADDRESS or NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS must be a deployed contract address.')

const account = createAccount(privateKey)
const client = createClient({ chain: testnetBradbury, account })
const rewardWei = BigInt(process.env.SMOKE_REWARD_WEI ?? '100000000000000')
const stringify = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)

function errorText(error) {
  if (!error || typeof error !== 'object') return String(error)
  return [error.shortMessage, error.details, error.message, String(error)].filter(Boolean).join('\n')
}

function isBackpressure(error) {
  const text = errorText(error).toLowerCase()
  return text.includes('node is not currently accepting transactions') || text.includes('pipeline backpressure') || text.includes('l1_sender_commit')
}

function isTransientRead(error) {
  const text = errorText(error).toLowerCase()
  return ['unexpected token', '<!doctype', 'not valid json', 'unknownrpcerror', 'fetch failed', 'bad gateway', '502', '503', '504', 'econnreset', 'etimedout', 'enotfound', 'gen_call'].some(term => text.includes(term))
}

function hashesIn(error) {
  return [...new Set(errorText(error).match(TX_HASH_PATTERN) ?? [])]
}

async function submitOnceKnown(label, params) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const hash = await client.writeContract(params)
      console.log(stringify({ label, txHash: hash, state: 'SUBMITTED', inspect: `Inspect consensus transaction ${hash}; do not resubmit it.` }))
      return hash
    } catch (error) {
      const evmWrapperHash = errorText(error).match(EVM_WRAPPER_HASH_PATTERN)?.[1]
      if (evmWrapperHash) {
        throw new Error(`${label} produced EVM wrapper tx ${evmWrapperHash}. Inspect it and do not retry blindly.\n${errorText(error)}`)
      }
      const hashes = hashesIn(error)
      if (hashes.length > 0) {
        throw new Error(`${label} returned error text containing tx hash ${hashes[0]}. Inspect it and do not retry blindly.\n${errorText(error)}`)
      }
      if (isBackpressure(error) && attempt < BACKPRESSURE_DELAYS_MS.length) {
        const delay = BACKPRESSURE_DELAYS_MS[attempt]
        console.warn(`Bradbury backpressure before any hash was returned; retrying ${label} in ${delay / 1000}s.`)
        await sleep(delay)
        continue
      }
      throw error
    }
  }
}

async function acceptedWrite(functionName, args, value) {
  const hash = await submitOnceKnown(functionName, { address: contractAddress, functionName, args, ...(value === undefined ? {} : { value }) })
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 7_000, retries: 180 })
    console.log(stringify({ functionName, txHash: hash, state: 'ACCEPTED_FINALIZATION_PENDING', receipt }))
    if (receipt.txExecutionResultName !== EXPECTED_EXECUTION_RESULT) {
      throw new Error(`${functionName} reached a decided state without successful execution. Inspect ${hash}; do not retry blindly. Receipt: ${stringify(receipt)}`)
    }
    return { hash, receipt }
  } catch (error) {
    throw new Error(`${functionName} did not confirm successful ACCEPTED execution. Inspect ${hash}; do not retry blindly.\n${errorText(error)}`)
  }
}

async function resilientRead(functionName, args = []) {
  let lastError
  for (let attempt = 0; attempt <= READ_DELAYS_MS.length; attempt += 1) {
    try {
      const raw = await client.readContract({ address: contractAddress, functionName, args, stateStatus: 'accepted' })
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw
      console.log(stringify({ functionName, args, acceptedRead: value }))
      return value
    } catch (error) {
      lastError = error
      if (!isTransientRead(error) || attempt >= READ_DELAYS_MS.length) break
      const delay = READ_DELAYS_MS[attempt]
      console.warn(`Transient Bradbury read failure for ${functionName}; retrying in ${delay / 1000}s. No write will be retried.`)
      await sleep(delay)
    }
  }
  throw new Error(`Accepted-state read ${functionName} failed. No write was retried.\n${errorText(lastError)}`)
}

const runId = Date.now().toString()
const title = `ProofScore v9 smoke ${runId}`
const deadline = Math.floor(Date.now() / 1000) + 24 * 60 * 60
await acceptedWrite('create_campaign', [
  title,
  'Clearly labeled test campaign validating score-gated settlement wiring.',
  45,
  rewardWei.toString(),
  deadline,
  'Assess source-backed public builder work. Treat URLs as identifiers, not identity proof.',
], rewardWei)

const campaigns = await resilientRead('list_campaigns')
const matches = Array.isArray(campaigns) ? campaigns.filter(item => item.title === title) : []
if (matches.length !== 1) throw new Error(`Expected exactly one accepted campaign matching ${title}; found ${matches.length}. Do not recreate blindly.`)
const campaignId = String(matches[0].campaign_id)
if (matches[0].remaining_pool !== rewardWei.toString()) throw new Error('Accepted campaign pool does not match the submitted payable value.')

await acceptedWrite('submit_builder_profile', [
  campaignId,
  'proofscore-smoke-builder',
  'https://github.com/genlayerlabs',
  'none',
  'https://www.genlayer.com',
  'https://docs.genlayer.com',
  'Smoke-test metadata only. Validators should assess submitted source identifiers conservatively.',
])

const submissions = await resilientRead('list_submissions', [campaignId])
if (!Array.isArray(submissions) || submissions.length !== 1) throw new Error('Expected exactly one accepted smoke submission. Do not resubmit blindly.')
const submission = submissions[0]
const submissionId = String(submission.submission_id)
if (typeof submission.score !== 'number' || !['QUALIFIED', 'NOT_QUALIFIED', 'INVALID'].includes(submission.decision)) throw new Error('Accepted submission lacks a valid stored score and decision.')

if (submission.eligible_to_claim === true) {
  await acceptedWrite('claim_reward', [campaignId, submissionId])
  const claimed = await resilientRead('get_submission', [campaignId, submissionId])
  if (!claimed.claimed || claimed.payout_status !== 'SCHEDULED_FOR_FINALIZATION') throw new Error('Accepted claim is missing its finalization-dependent payout state.')
  console.log('Claim accepted. The external GEN transfer is scheduled for finalization and is not yet described as finalized.')
} else {
  console.log(`Claim skipped safely: accepted decision=${submission.decision}, score=${submission.score}, eligible=false.`)
}

if (process.env.SMOKE_CHALLENGE === '1' && submission.claimed !== true) {
  await acceptedWrite('challenge_score', [campaignId, submissionId, 'https://docs.genlayer.com', 'Smoke challenge asks validators to compare original evidence with this counter-evidence identifier.'])
  await resilientRead('list_challenges', [campaignId, submissionId])
} else {
  console.log('Challenge skipped. Set SMOKE_CHALLENGE=1 to opt in when a pre-claim challenge is safe.')
}

console.log(stringify({ contractAddress, campaignId, submissionId, result: 'ACCEPTED_STATE_VERIFIED', warning: 'ACCEPTED does not mean FINALIZED. Inspect every printed transaction hash.' }))
