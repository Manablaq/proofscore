import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'

const hash = process.argv[2]

if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) {
  console.error('Usage: node scripts/diagnose-v9-deploy.mjs 0x<deploy-or-call-transaction-hash>')
  process.exit(1)
}

const OMIT_KEYS = /(?:calldata|contractcode|code$|source)/i
const USEFUL_KEYS = /(?:status_name|resultname|txexecutionresultname|leader.*result|validator.*result|stderr|stdout|exception|message|txdatadecoded|contractaddress)/i

function compact(value, depth = 0) {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value
  if (value === null || typeof value !== 'object' || depth >= 5) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(item => compact(item, depth + 1))
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !OMIT_KEYS.test(key))
    .map(([key, item]) => [key, compact(item, depth + 1)]))
}

function collectUseful(value, path = '$', out = {}) {
  if (!value || typeof value !== 'object') return out
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`
    if (USEFUL_KEYS.test(key) && !OMIT_KEYS.test(key)) out[itemPath] = compact(item)
    if (item && typeof item === 'object') collectUseful(item, itemPath, out)
  }
  return out
}

function compactRounds(transaction) {
  const rounds = transaction?.consensusData?.roundsData ?? transaction?.roundsData ?? transaction?.consensusRounds
  if (!Array.isArray(rounds)) return undefined
  return rounds.map((round, index) => ({
    round: round.round ?? round.roundNumber ?? index,
    result: round.resultName ?? round.result ?? null,
    leader: round.leader ?? round.leaderAddress ?? null,
    leaderResult: compact(round.leaderResult ?? round.leader_result ?? null),
    validatorResults: compact(round.validatorResults ?? round.validatorsResults ?? round.validator_results ?? null),
    validators: compact(round.roundValidators ?? round.validators ?? null),
  }))
}

function compactLastRound(round) {
  if (!round || typeof round !== 'object') return undefined
  return {
    round: round.round ?? null,
    leaderIndex: round.leaderIndex ?? null,
    result: round.resultName ?? round.result ?? null,
    votesCommitted: round.votesCommitted ?? null,
    votesRevealed: round.votesRevealed ?? null,
    validatorVotesName: round.validatorVotesName ?? null,
    roundValidators: round.roundValidators ?? null,
    validatorResultHash: round.validatorResultHash ?? null,
  }
}

const client = createClient({ chain: testnetBradbury })
const transaction = await client.getTransaction({ hash })
let trace
try {
  trace = await client.debugTraceTransaction({ hash, round: Number(transaction?.lastRound?.round ?? 0) })
} catch (error) {
  trace = { unavailable: error instanceof Error ? error.message : String(error) }
}
const fields = collectUseful(transaction)
const traceFields = collectUseful(trace, '$.executionTrace')
const rounds = compactRounds(transaction)
const lastRound = compactLastRound(transaction.lastRound)

console.log(JSON.stringify({
  transactionHash: hash,
  status_name: transaction.statusName ?? transaction.status_name ?? null,
  resultName: transaction.resultName ?? null,
  txExecutionResultName: transaction.txExecutionResultName ?? null,
  ...fields,
  ...traceFields,
  ...(lastRound ? { consensusLastRound: lastRound } : {}),
  ...(rounds ? { consensusRounds: rounds } : {}),
}, null, 2))
