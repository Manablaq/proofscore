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
const LOOKUP_DELAYS_MS = [5_000, 10_000, 20_000]
const EXPECTED_EXECUTION_RESULT = 'FINISHED_WITH_RETURN'
const EXPECTED_STATUS = 'ACCEPTED'

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
    const transaction = await client.getTransaction({ hash })
    const statusName = transaction.statusName ?? transaction.status_name ?? receipt.statusName ?? receipt.status_name
    const executionResult = transaction.txExecutionResultName ?? receipt.txExecutionResultName
    const resultName = transaction.resultName ?? receipt.resultName
    if (statusName !== EXPECTED_STATUS || executionResult !== EXPECTED_EXECUTION_RESULT) {
      throw new Error(`${functionName} reached a decided state without successful execution. Inspect ${hash}; do not retry blindly. Receipt: ${stringify(receipt)}`)
    }
    console.log(stringify({ functionName, txHash: hash, status_name: statusName, resultName, txExecutionResultName: executionResult, state: 'ACCEPTED_FINALIZATION_PENDING' }))
    return { hash, receipt, transaction }
  } catch (error) {
    let inspected
    try {
      inspected = await client.getTransaction({ hash })
    } catch {}
    const text = `${errorText(error)}\n${inspected ? stringify(inspected) : ''}`
    if (/UNDETERMINED|NO_MAJORITY|DETERMINISTIC_VIOLATION/i.test(text)) {
      throw new Error(`${functionName} reached UNDETERMINED / NO_MAJORITY consensus. Inspect ${hash}; do not resubmit this action.\n${text}`)
    }
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

async function pollCampaignVisibility(title, expectedId) {
  let lastSeen
  for (let attempt = 0; attempt <= READ_DELAYS_MS.length; attempt += 1) {
    const stats = await resilientRead('get_stats')
    const campaigns = await resilientRead('list_campaigns')
    const matches = Array.isArray(campaigns) ? campaigns.filter(item => item.title === title) : []
    const candidate = expectedId === undefined ? matches[0] : matches.find(item => String(item.campaign_id) === String(expectedId))
    if (candidate) {
      const campaign = await resilientRead('get_campaign', [String(candidate.campaign_id)])
      if (campaign?.exists !== false && String(campaign.campaign_id) === String(candidate.campaign_id)) return { campaign, stats, matches }
    }
    lastSeen = { stats, matches }
    if (attempt < READ_DELAYS_MS.length) await sleep(READ_DELAYS_MS[attempt])
  }
  throw new Error(`Accepted reads never exposed campaign ${title}. Do not create it again blindly. Last reads: ${stringify(lastSeen)}`)
}

async function pollSubmissions(campaignId) {
  let submissions = []
  for (let attempt = 0; attempt <= READ_DELAYS_MS.length; attempt += 1) {
    submissions = await resilientRead('list_submissions', [campaignId])
    if (Array.isArray(submissions) && submissions.length > 0) {
      const visible = []
      for (const item of submissions) {
        const submission = await resilientRead('get_submission', [campaignId, String(item.submission_id)])
        if (submission?.exists !== false) visible.push(submission)
      }
      if (visible.length === submissions.length) return visible
    }
    if (attempt < READ_DELAYS_MS.length) await sleep(READ_DELAYS_MS[attempt])
  }
  throw new Error(`Accepted reads never exposed the submission for campaign ${campaignId}. Inspect its transaction hash; do not resubmit.`)
}

async function findSubmissionsBeforeSubmit(campaignId) {
  let submissions = []
  for (let attempt = 0; attempt <= LOOKUP_DELAYS_MS.length; attempt += 1) {
    submissions = await resilientRead('list_submissions', [campaignId])
    if (Array.isArray(submissions) && submissions.length > 0) return pollSubmissions(campaignId)
    if (attempt < LOOKUP_DELAYS_MS.length) {
      console.warn(`No accepted submission for campaign ${campaignId} visible yet; checking again in ${LOOKUP_DELAYS_MS[attempt] / 1000}s before any submit.`)
      await sleep(LOOKUP_DELAYS_MS[attempt])
    }
  }
  return submissions
}

async function pollClaimState(campaignId, submissionId) {
  let lastSeen
  for (let attempt = 0; attempt <= READ_DELAYS_MS.length; attempt += 1) {
    const submission = await resilientRead('get_submission', [campaignId, submissionId])
    const stats = await resilientRead('get_stats')
    lastSeen = { submission, stats }
    if (submission?.claimed === true && submission.payout_status === 'SCHEDULED_FOR_FINALIZATION') return lastSeen
    if (attempt < READ_DELAYS_MS.length) await sleep(READ_DELAYS_MS[attempt])
  }
  throw new Error(`Accepted reads never exposed claimed state for campaign ${campaignId} submission ${submissionId}. Do not resubmit claim_reward. Last reads: ${stringify(lastSeen)}`)
}

async function pollChallengeState(campaignId, submissionId, baseline) {
  let lastSeen
  for (let attempt = 0; attempt <= READ_DELAYS_MS.length; attempt += 1) {
    const challenges = await resilientRead('list_challenges', [campaignId, submissionId])
    const submission = await resilientRead('get_submission', [campaignId, submissionId])
    lastSeen = { challenges, submission }
    const challengeVisible = Array.isArray(challenges) && challenges.length > baseline.challengeCount
    const countersAdvanced = Number(submission?.challenge_count ?? 0) > baseline.challengeCount || Number(submission?.revision_count ?? 0) > baseline.revisionCount
    const categoryInvalidated = Array.isArray(submission?.invalidated_categories) && submission.invalidated_categories.includes('additional')
    if (challengeVisible && (countersAdvanced || categoryInvalidated)) return submission
    if (attempt < READ_DELAYS_MS.length) await sleep(READ_DELAYS_MS[attempt])
  }
  throw new Error(`Accepted reads never exposed the pre-claim challenge for campaign ${campaignId} submission ${submissionId}. Do not resubmit challenge_score. Last reads: ${stringify(lastSeen)}`)
}

async function findCampaignBeforeCreate(title) {
  for (let attempt = 0; attempt <= LOOKUP_DELAYS_MS.length; attempt += 1) {
    const campaigns = await resilientRead('list_campaigns')
    const matches = Array.isArray(campaigns) ? campaigns.filter(item => item.title === title) : []
    if (matches.length > 1) throw new Error(`Found ${matches.length} campaigns named ${title}. Set SMOKE_CAMPAIGN_ID to continue one exact campaign; no campaign was created.`)
    if (matches.length === 1) return matches[0]
    if (attempt < LOOKUP_DELAYS_MS.length) {
      console.warn(`No accepted campaign named ${title} visible yet; checking again in ${LOOKUP_DELAYS_MS[attempt] / 1000}s before any create.`)
      await sleep(LOOKUP_DELAYS_MS[attempt])
    }
  }
  return undefined
}

async function pollCampaignById(campaignId) {
  let lastSeen
  for (let attempt = 0; attempt <= READ_DELAYS_MS.length; attempt += 1) {
    const campaign = await resilientRead('get_campaign', [campaignId])
    lastSeen = campaign
    if (campaign?.exists !== false && String(campaign.campaign_id) === campaignId) return campaign
    if (attempt < READ_DELAYS_MS.length) await sleep(READ_DELAYS_MS[attempt])
  }
  throw new Error(`SMOKE_CAMPAIGN_ID ${campaignId} was not visible in accepted state. It was not created or resubmitted. Last read: ${stringify(lastSeen)}`)
}

const title = (process.env.SMOKE_CAMPAIGN_TITLE ?? 'ProofScore v9 consensus smoke').trim()
const requestedCampaignId = (process.env.SMOKE_CAMPAIGN_ID ?? '').trim()
if (requestedCampaignId && !/^[1-9][0-9]*$/.test(requestedCampaignId)) throw new Error('SMOKE_CAMPAIGN_ID must be a positive decimal campaign id.')
const deadline = Math.floor(Date.now() / 1000) + 24 * 60 * 60
let campaign
if (requestedCampaignId) {
  campaign = await pollCampaignById(requestedCampaignId)
  console.log(`Continuing explicit SMOKE_CAMPAIGN_ID ${requestedCampaignId}; create_campaign is disabled for this run.`)
} else {
  const existing = await findCampaignBeforeCreate(title)
  if (existing) campaign = (await pollCampaignVisibility(title, existing.campaign_id)).campaign
}
if (campaign) {
  console.log(`Continuing existing accepted campaign ${campaign.campaign_id}; create_campaign was not resubmitted.`)
} else {
  await acceptedWrite('create_campaign', [
    title,
    'Clearly labeled test campaign validating score-gated settlement wiring.',
    45,
    rewardWei.toString(),
    deadline,
    '[requires:github] Assess source-backed public builder work. Treat URLs as identifiers, not identity proof.',
  ], rewardWei)
  const visibility = await pollCampaignVisibility(title)
  campaign = visibility.campaign
}
const campaignId = String(campaign.campaign_id)

let submissions = await findSubmissionsBeforeSubmit(campaignId)
if (Array.isArray(submissions) && submissions.length === 0) {
  if (campaign.remaining_pool !== rewardWei.toString() || campaign.status !== 'OPEN') throw new Error('Matching campaign cannot accept the smoke submission. Set a new SMOKE_CAMPAIGN_TITLE; nothing was resubmitted.')
  await acceptedWrite('submit_builder_profile', [
    campaignId,
    'proofscore-smoke-builder',
    'https://github.com/genlayerlabs',
    'none',
    'https://www.genlayer.com',
    'https://docs.genlayer.com',
    'Smoke-test metadata only. Canonical scoring treats submitted URLs as identifiers.',
  ])
  submissions = await pollSubmissions(campaignId)
} else {
  console.log(`Continuing ${submissions.length} existing accepted submission(s); submit_builder_profile was not resubmitted.`)
}

if (!Array.isArray(submissions) || submissions.length !== 1) throw new Error('Expected exactly one accepted smoke submission. Do not resubmit blindly.')
let submission = submissions[0]
const submissionId = String(submission.submission_id)
if (typeof submission.score !== 'number' || !['QUALIFIED', 'NOT_QUALIFIED', 'INVALID'].includes(submission.decision)) throw new Error('Accepted submission lacks a valid stored score and decision.')

const challengeEnabled = process.env.SMOKE_CHALLENGE === '1'
if (challengeEnabled && submission.claimed !== true) {
  const alreadyInvalidated = Array.isArray(submission.invalidated_categories) && submission.invalidated_categories.includes('additional')
  if (alreadyInvalidated) {
    submission = await resilientRead('get_submission', [campaignId, submissionId])
    console.log('Pre-claim additional-evidence invalidation is already visible; challenge_score was not resubmitted.')
  } else {
    const baseline = {
      challengeCount: Number(submission.challenge_count ?? 0),
      revisionCount: Number(submission.revision_count ?? 0),
    }
    await acceptedWrite('challenge_score', [campaignId, submissionId, 'https://docs.genlayer.com', '[invalid:additional] Smoke creator challenge exercises deterministic category invalidation.'])
    submission = await pollChallengeState(campaignId, submissionId, baseline)
    console.log(`Pre-claim challenge accepted and visible: decision=${submission.decision}, score=${submission.score}, eligible=${submission.eligible_to_claim}.`)
  }
  const invalidatedCategories = Array.isArray(submission.invalidated_categories) ? submission.invalidated_categories : []
  const additionalOnly = invalidatedCategories.length === 1 && invalidatedCategories[0] === 'additional'
  if (additionalOnly && (submission.score !== 65 || submission.decision !== 'QUALIFIED' || submission.eligible_to_claim !== true)) {
    throw new Error(`Additional-evidence invalidation must reduce the canonical smoke score from 85 to 65 while preserving threshold-45 eligibility. Observed: ${stringify(submission)}`)
  }
  if (submission.decision === 'INVALID' && submission.eligible_to_claim !== false) {
    throw new Error(`An INVALID challenged submission must not remain eligible to claim. Observed: ${stringify(submission)}`)
  }
} else if (!challengeEnabled) {
  console.log('Challenge skipped. Set SMOKE_CHALLENGE=1 to exercise pre-claim deterministic invalidation.')
} else {
  console.log('Challenge skipped because the accepted submission is already claimed; challenge_score was not submitted.')
}

if (submission.eligible_to_claim === true && submission.claimed !== true) {
  await acceptedWrite('claim_reward', [campaignId, submissionId])
  await pollClaimState(campaignId, submissionId)
  console.log('Claim accepted. The external GEN transfer is scheduled for finalization and is not yet described as finalized.')
} else {
  const context = challengeEnabled ? 'after the pre-claim challenge changed or preserved eligibility' : 'from accepted canonical state'
  console.log(`Claim skipped safely ${context}: decision=${submission.decision}, score=${submission.score}, eligible=${submission.eligible_to_claim}, claimed=${submission.claimed}.`)
}

console.log(stringify({ contractAddress, campaignId, submissionId, result: 'ACCEPTED_STATE_VERIFIED', warning: 'ACCEPTED does not mean FINALIZED. Inspect every printed transaction hash.' }))
