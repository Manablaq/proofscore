'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { formatEther, parseEther } from 'viem'
import { BRADBURY_CHAIN_ID, BRADBURY_EXPLORER, BRADBURY_RPC, PROOFSCORE_CONTRACT_ADDRESS, PROOFSCORE_IS_CONFIGURED } from '@/lib/config'

type Campaign = {
  campaign_id: string; creator: string; title: string; description: string
  threshold_score: number; reward_per_qualified_builder: string; total_pool: string
  remaining_pool: string; deadline: number; evidence_requirements: string
  status: 'OPEN' | 'CLOSED' | 'EXHAUSTED'; submissions_count: number; qualified_count: number
}

type Submission = {
  campaign_id: string; submission_id: string; builder: string; handle: string
  score: number; decision: 'QUALIFIED' | 'NOT_QUALIFIED' | 'INVALID'; confidence: string
  dimensions: Record<string, number>; evidence_summary: string; accepted_sources: string[]
  rejected_sources: string[]; risk_flags: string[]; reasoning: string
  eligible_to_claim: boolean; claimed: boolean; payout_status: string
  challenge_count: number; revision_count: number
}

type Challenge = {
  challenge_id: string; challenger: string; verdict: string; revised_score: number
  revised_decision: string; confidence: string; reasoning: string; settlement_effect: string
  challenge_url: string; created_at: number
}

type ContractStats = {
  campaigns?: number | string; submissions?: number | string; challenges?: number | string
  claims_scheduled?: number | string; total_locked_wei?: string; contract_version?: string
}

type TxState = { phase: 'idle' | 'submitted' | 'accepted' | 'finalized' | 'failed'; hash?: string; detail?: string }

const chainHex = `0x${BRADBURY_CHAIN_ID.toString(16)}`
const MIN_DEADLINE_AHEAD_MS = 10 * 60_000
const DEFAULT_DEADLINE_AHEAD_MS = 24 * 60 * 60_000

function formatLocalDateTime(date: Date, roundUp = false) {
  if (!Number.isFinite(date.getTime())) return ''
  const value = new Date(date)
  if (roundUp && (value.getSeconds() > 0 || value.getMilliseconds() > 0)) value.setMinutes(value.getMinutes() + 1)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }
  return []
}

function parseContractStats(value: unknown): ContractStats | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as ContractStats
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ContractStats : null
  } catch {
    return null
  }
}

async function readContract(method: string, args: unknown[] = []) {
  const response = await fetch(`/api/contract?method=${method}&args=${encodeURIComponent(JSON.stringify(args))}`, { cache: 'no-store' })
  const payload = await response.json()
  if (!payload.ok) throw new Error(payload.error ?? 'Contract read failed.')
  return payload.result
}

async function walletProvider(address: string) {
  const win = window as Window & { ethereum?: any; okxwallet?: any }
  const candidates = [win.okxwallet, ...(win.ethereum?.providers ?? []), win.ethereum].filter(Boolean)
  for (const provider of candidates) {
    try {
      const accounts: string[] = await provider.request({ method: 'eth_accounts' })
      if (accounts.some(account => account.toLowerCase() === address.toLowerCase())) return provider
    } catch {}
  }
  if (candidates[0]) return candidates[0]
  throw new Error('No connected wallet provider found.')
}

async function submitWrite(address: string, method: string, args: unknown[], value?: bigint, update?: (state: TxState) => void) {
  if (!PROOFSCORE_IS_CONFIGURED) throw new Error('V9 contract address is not configured. Deploy separately, then set NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS.')
  const provider = await walletProvider(address)
  const currentChain = await provider.request({ method: 'eth_chainId' })
  if (currentChain.toLowerCase() !== chainHex.toLowerCase()) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] })
    } catch (error: any) {
      if (error?.code !== 4902 && error?.code !== -32603) throw error
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: chainHex, chainName: 'GenLayer Bradbury Testnet', nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 }, rpcUrls: [BRADBURY_RPC], blockExplorerUrls: [BRADBURY_EXPLORER] }] })
    }
  }
  const { createClient } = await import('genlayer-js')
  const { testnetBradbury } = await import('genlayer-js/chains')
  const chain = { ...testnetBradbury, rpcUrls: { default: { http: [BRADBURY_RPC] } } } as any
  const client = createClient({ chain, account: address, provider } as any)
  const hash = await (client as any).writeContract({ address: PROOFSCORE_CONTRACT_ADDRESS, functionName: method, args, ...(value !== undefined ? { value } : {}) })
  update?.({ phase: 'submitted', hash, detail: 'Transaction submitted. State is not available yet.' })
  const started = Date.now()
  while (Date.now() - started < 15 * 60_000) {
    await new Promise(resolve => setTimeout(resolve, 3500))
    try {
      const receipt = await (client as any).getTransactionReceipt({ hash })
      if (!receipt) continue
      const status = String(receipt.statusName ?? receipt.status ?? '').toUpperCase()
      const execution = String(receipt.txExecutionResultName ?? '').toUpperCase()
      const result = String(receipt.resultName ?? receipt.result ?? '').toUpperCase()
      const receiptError = typeof receipt.error === 'string' ? receipt.error : typeof receipt.data?.error === 'string' ? receipt.data.error : ''
      const failure = [status, execution, result, receiptError.toUpperCase()].some(value => /FINISHED_WITH_ERROR|USERERROR|VMERROR|UNDETERMINED|NO_MAJORITY|DETERMINISTIC_VIOLATION|TIMEOUT|CANCELED|FAILURE/.test(value))
      if (failure) {
        const outcome = [status, result, execution].filter(Boolean).join(' / ') || 'Transaction failed'
        update?.({ phase: 'failed', hash, detail: receiptError ? `${outcome}: ${receiptError}` : outcome.replaceAll('_', ' ') })
        return false
      }
      if (execution === 'FINISHED_WITH_RETURN' && status.includes('FINALIZED')) {
        update?.({ phase: 'finalized', hash, detail: 'Finalized.' }); return true
      }
      if (execution === 'FINISHED_WITH_RETURN' && status.includes('ACCEPTED')) {
        update?.({ phase: 'accepted', hash, detail: 'Accepted with successful execution — finalization pending. Accepted state can now be refreshed.' }); return true
      }
    } catch {}
  }
  update?.({ phase: 'submitted', hash, detail: 'Timed out waiting for the receipt. The transaction outcome is unknown; inspect the transaction hash before retrying.' })
  return false
}

function gen(wei: string) {
  try { return `${Number(formatEther(BigInt(wei))).toLocaleString(undefined, { maximumFractionDigits: 4 })} GEN` } catch { return '—' }
}

function short(address: string) { return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—' }

const KNOWN_FINAL_V9_DEPLOYMENT_ADDRESS = '0x0a4E4cBBF682aE0EdedE09865eD0A338518976C3'

const proofTransactions = [
  ['Studio deploy tx', '0xc9e7487b6300b305fa8ce9c12770f48e67c656cef17c006242f96b54eaf289bb'],
  ['create_campaign', '0x91d2dcb5dd9445bcad04c85fda7b10e75fbf5e61ec028691627e93d14942a0d9'],
  ['submit_builder_profile', '0xbc2b1669f528a12e8b97694db7809c8f51f58d2ce62a004a7bc1cd1de8a30478'],
  ['challenge_score', '0xe6ca01a9a7cf00132fb09f8bdb14f67fd09dcd80442a2e2a90089785efe72aea'],
  ['claim_reward', '0x633c79ac18b7e70b5b524adfde595c2daf747954b460ca82ac13a8ed1bfd2070'],
] as const

function TxNotice({ state }: { state: TxState }) {
  if (state.phase === 'idle') return null
  return <div className={`tx tx-${state.phase}`}>
    <strong>{state.phase === 'submitted' ? 'Submitted' : state.phase === 'accepted' ? 'Accepted — finalization pending' : state.phase === 'finalized' ? 'Finalized' : 'Failed'}</strong>
    <span>{state.detail}</span>
    {state.hash && <a href={`${BRADBURY_EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">Inspect {short(state.hash)} ↗</a>}
  </div>
}

function ScoreRing({ score }: { score: number }) {
  return <div className="score-ring" style={{ '--score': `${Math.max(0, Math.min(100, score)) * 3.6}deg` } as React.CSSProperties}>
    <div><strong>{score}</strong><span>/100</span></div>
  </div>
}

export default function Home() {
  const { address, isConnected } = useAccount()
  const hasRecordedDeploymentProof = PROOFSCORE_IS_CONFIGURED && PROOFSCORE_CONTRACT_ADDRESS.toLowerCase() === KNOWN_FINAL_V9_DEPLOYMENT_ADDRESS.toLowerCase()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [stats, setStats] = useState<ContractStats | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [challenges, setChallenges] = useState<Record<string, Challenge[]>>({})
  const [loading, setLoading] = useState(true)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [error, setError] = useState('')
  const [deadlineError, setDeadlineError] = useState('')
  const [tx, setTx] = useState<TxState>({ phase: 'idle' })
  const selected = campaigns.find(campaign => campaign.campaign_id === selectedId)
  const isV9Live = PROOFSCORE_IS_CONFIGURED && String(stats?.contract_version).toLowerCase() === 'v9'

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const refreshCampaigns = useCallback(async () => {
    if (!PROOFSCORE_IS_CONFIGURED) { setLoading(false); return }
    try {
      const [campaignResult, statsResult] = await Promise.allSettled([readContract('list_campaigns'), readContract('get_stats')])
      if (campaignResult.status === 'rejected') throw campaignResult.reason
      const list = asArray<Campaign>(campaignResult.value)
      setCampaigns(list)
      setStats(statsResult.status === 'fulfilled' ? parseContractStats(statsResult.value) : null)
      setSelectedId(current => current || list[0]?.campaign_id || '')
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load campaigns.') }
    finally { setLoading(false) }
  }, [])

  const refreshSelected = useCallback(async () => {
    if (!selectedId || !PROOFSCORE_IS_CONFIGURED) return
    try {
      const list = asArray<Submission>(await readContract('list_submissions', [selectedId]))
      setSubmissions(list)
      const entries = await Promise.all(list.map(async submission => [submission.submission_id, asArray<Challenge>(await readContract('list_challenges', [selectedId, submission.submission_id]))] as const))
      setChallenges(Object.fromEntries(entries))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load submissions.') }
  }, [selectedId])

  useEffect(() => { const timer = window.setTimeout(() => { void refreshCampaigns() }, 0); return () => window.clearTimeout(timer) }, [refreshCampaigns])
  useEffect(() => { const timer = window.setTimeout(() => { void refreshSelected() }, 0); return () => window.clearTimeout(timer) }, [refreshSelected])

  async function runWrite(method: string, args: unknown[], value?: bigint) {
    if (!address) { setError('Connect a wallet first.'); return false }
    setError(''); setTx({ phase: 'idle' })
    try {
      const accepted = await submitWrite(address, method, args, value, setTx)
      if (accepted) { await refreshCampaigns(); await refreshSelected() }
      return accepted
    } catch (reason) {
      setTx({ phase: 'failed', detail: reason instanceof Error ? reason.message : 'Transaction failed.' }); return false
    }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') ?? '').trim()
    const description = String(form.get('description') ?? '').trim()
    const threshold = Number(form.get('threshold'))
    const rewardInput = String(form.get('reward') ?? '').trim()
    const slots = Number(form.get('slots'))
    const deadlineInput = String(form.get('deadline') ?? '').trim()
    const requirements = String(form.get('requirements') ?? '').trim()
    const deadlineMs = deadlineInput ? new Date(deadlineInput).getTime() : Number.NaN

    setDeadlineError('')
    if (!deadlineInput || !Number.isFinite(deadlineMs) || deadlineMs < Date.now() + MIN_DEADLINE_AHEAD_MS) {
      const message = 'Choose a deadline at least 10 minutes in the future.'
      setDeadlineError(message); setError(message); return
    }
    if (title.length < 3 || title.length > 100) { setError('Campaign title must be between 3 and 100 characters.'); return }
    if (!description) { setError('Enter a campaign description.'); return }
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) { setError('ProofScore threshold must be between 1 and 100.'); return }
    if (!Number.isSafeInteger(slots) || slots <= 0) { setError('Funded reward slots must be a positive whole number.'); return }
    if (!requirements) { setError('Enter evidence requirements.'); return }

    let reward: bigint
    let totalValue: bigint
    try {
      reward = parseEther(rewardInput)
      if (reward <= BigInt(0)) throw new Error('Reward must be positive.')
      totalValue = reward * BigInt(slots)
      if (totalValue <= BigInt(0) || totalValue / BigInt(slots) !== reward) throw new Error('Invalid campaign funding total.')
    } catch {
      setError('Enter a valid positive reward amount.'); return
    }

    const deadline = Math.floor(deadlineMs / 1000)
    const ok = await runWrite('create_campaign', [title, description, threshold, reward.toString(), deadline, requirements], totalValue)
    if (ok) { event.currentTarget.reset(); setDeadlineError('') }
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const form = new FormData(event.currentTarget)
    const ok = await runWrite('submit_builder_profile', [selected.campaign_id, ...['handle', 'github', 'x', 'portfolio', 'additional', 'notes'].map(key => String(form.get(key) || 'none'))])
    if (ok) event.currentTarget.reset()
  }

  async function challenge(event: FormEvent<HTMLFormElement>, submissionId: string) {
    event.preventDefault(); if (!selected) return
    const form = new FormData(event.currentTarget)
    const ok = await runWrite('challenge_score', [selected.campaign_id, submissionId, String(form.get('challenge_url')), String(form.get('reason'))])
    if (ok) event.currentTarget.reset()
  }

  return <main>
    <div className="aurora aurora-one" /><div className="aurora aurora-two" />
    <nav className="top-nav"><div className="nav-shell"><a className="brand" href="#overview"><span>PS</span> ProofScore <em>v9</em></a><div className="nav-links" aria-label="Primary navigation"><a href="#overview">Overview</a><a href="#campaigns">Campaigns</a><a href="#submit-evidence">Submit Evidence</a><a href="#challenge">Challenge</a><a href="#claim">Claim</a><a href="#deployment-proof">Deployment Proof</a></div><div className="wallet-control"><ConnectButton /></div></div></nav>

    <section className="hero" id="overview">
      <div className="hero-copy"><div className="eyebrow"><i /> LIVE ON GENLAYER BRADBURY</div>
      <h1>Evidence-settled<br /><span>builder bounties.</span></h1>
      <p>Evidence-settled builder bounty protocol on GenLayer. Sponsors fund outcomes, canonical scores gate eligibility, and every decision remains contestable.</p>
      <div className="hero-actions"><a className="button primary" href="#create">Create Campaign</a><a className="button secondary" href="#submit-evidence">Submit Builder Evidence</a><a className="button ghost" href="#dashboard">View Live Contract State</a></div></div>
      <aside className="contract-card">{PROOFSCORE_IS_CONFIGURED ? <><div className="contract-card-head"><span className="live-pulse" /> <strong>{isV9Live ? 'v9 live' : 'Contract configured'}</strong><span>Bradbury testnet</span></div><small>{isV9Live ? 'CONFIRMED V9 CONTRACT' : 'CONFIGURED CONTRACT'}</small><code>{PROOFSCORE_CONTRACT_ADDRESS}</code><div className="contract-meta"><span>Evidence scoring</span><b>Contestable settlement</b></div><a href={`${BRADBURY_EXPLORER}/address/${PROOFSCORE_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Inspect contract ↗</a></> : <><div className="contract-card-head preview"><strong>Preview mode</strong><span>Live reads disabled</span></div><small>CONTRACT CONFIGURATION</small><div className="config-empty">No v9 contract configured</div><p className="config-copy">Set NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS to enable live reads and writes.</p></>}</aside>
      <div className="flow">
        {['Sponsor locks reward', 'Builder submits evidence', 'Score gates eligibility', 'Challenge can reduce / deny', 'Qualified builder claims'].map((step, index) => <div key={step}><b>0{index + 1}</b><span>{step}</span>{index < 4 && <i>→</i>}</div>)}
      </div>
      <p className="truth-note">Evidence-backed reputation assessment. ProofScore does not prove identity or ownership of submitted profiles.</p>
    </section>

    {!PROOFSCORE_IS_CONFIGURED && <section className="config-warning"><strong>V9 preview mode</strong><span>No v9 address is configured, so writes and live reads are disabled. Deploy separately and set <code>NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS</code>.</span></section>}
    <TxNotice state={tx} />{error && <div className="error">{error}</div>}

    <section className="section dashboard" id="dashboard">
      <header className="section-head"><div><span className="eyebrow">LIVE CONTRACT TELEMETRY</span><h2>Protocol overview</h2></div><div className="state-legend"><span className="live-pulse" /> Latest accepted state <small>Finalization may be pending</small></div></header>
      {loading ? <div className="stats-grid loading-grid">{Array.from({ length: 6 }, (_, index) => <div className="stat-card skeleton" key={index} />)}</div> : !stats ? <div className="empty"><strong>Contract telemetry unavailable</strong><span>Campaign data may still be available below. Refresh to retry the live read.</span></div> : <div className="stats-grid">
        {[['Campaigns', stats.campaigns], ['Submissions', stats.submissions], ['Challenges', stats.challenges], ['Claims scheduled', stats.claims_scheduled], ['Total locked', gen(stats.total_locked_wei ?? '0')], ['Contract version', stats.contract_version ?? '—']].map(([label, value]) => <div className="stat-card" key={String(label)}><small>{label}</small><strong>{String(value ?? '—')}</strong>{label === 'Contract version' && isV9Live && <span className="live-badge"><i /> v9 live</span>}</div>)}
      </div>}
      <p className="finality-note"><b>Accepted / finalization pending:</b> live reads use the latest accepted contract state. A scheduled claim is not described as paid until finality is known.</p>
    </section>

    <section className="section" id="campaigns">
      <header className="section-head"><div><span className="eyebrow">OPEN SETTLEMENTS</span><h2>Builder campaigns</h2></div><button className="mini-button" onClick={() => { refreshCampaigns(); refreshSelected() }}>Refresh accepted state</button></header>
      {loading ? <div className="empty">Reading accepted contract state…</div> : campaigns.length === 0 ? <div className="empty">No live v9 campaigns. This interface does not fabricate campaign data.</div> : <div className="campaign-grid">
        {campaigns.map(campaign => <article className={`campaign-card ${selectedId === campaign.campaign_id ? 'selected' : ''}`} key={campaign.campaign_id} role="button" tabIndex={0} aria-pressed={selectedId === campaign.campaign_id} onClick={() => setSelectedId(campaign.campaign_id)} onKeyDown={event => { if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return; event.preventDefault(); setSelectedId(campaign.campaign_id) }}>
          <div className="card-top"><span className={`status ${campaign.status.toLowerCase()}`}>{campaign.status}</span><span>#{campaign.campaign_id}</span></div>
          <h3>{campaign.title}</h3><p>{campaign.description}</p>
          <div className="campaign-stats"><div><small>Threshold</small><strong>{campaign.threshold_score}/100</strong></div><div><small>Total pool</small><strong>{gen(campaign.total_pool)}</strong></div><div><small>Remaining</small><strong>{gen(campaign.remaining_pool)}</strong></div><div><small>Qualified</small><strong>{campaign.qualified_count}</strong></div></div>
          <footer><span>{campaign.submissions_count} submissions</span><span>Deadline {new Date(campaign.deadline * 1000).toLocaleDateString()}</span></footer>
          <button className="card-action" disabled={campaign.status !== 'OPEN' || campaign.deadline * 1000 < nowMs} onClick={event => { event.stopPropagation(); setSelectedId(campaign.campaign_id); window.setTimeout(() => document.querySelector('#submit-evidence')?.scrollIntoView({ behavior: 'smooth' }), 0) }}>{campaign.status === 'OPEN' && campaign.deadline * 1000 >= nowMs ? 'Submit Evidence →' : campaign.status === 'EXHAUSTED' ? 'Reward pool exhausted' : 'Campaign unavailable'}</button>
        </article>)}
      </div>}
    </section>

    {selected && <section className="section detail" id="submit-evidence">
      <div className="detail-header"><div><span className="eyebrow">CAMPAIGN #{selected.campaign_id}</span><h2>{selected.title}</h2><p>{selected.description}</p></div><div className="pool"><small>Remaining escrow</small><strong>{gen(selected.remaining_pool)}</strong><span>{gen(selected.reward_per_qualified_builder)} per accepted builder</span></div></div>
      <div className="requirements"><strong>Evidence requirements</strong><p>{selected.evidence_requirements}</p><span>Deadline {new Date(selected.deadline * 1000).toLocaleString()}</span></div>
      {selected.status === 'OPEN' && selected.deadline * 1000 >= nowMs && <form className="glass-form" onSubmit={submitProfile}>
        <div className="form-title"><span><b>01</b> Submit builder evidence</span><small>One submission per wallet. Provide public, directly accessible URLs that clearly support your work.</small></div>
        <div className="form-grid"><label>Handle <small>Your public builder or team handle.</small><input required name="handle" placeholder="builder-name" /></label><label>GitHub URL <small>Full github.com profile or repository URL.</small><input name="github" type="url" placeholder="https://github.com/…" /></label><label>X URL <small>Full x.com profile or relevant post URL.</small><input name="x" type="url" placeholder="https://x.com/…" /></label><label>Portfolio URL <small>Public portfolio, product, or case-study URL.</small><input name="portfolio" type="url" placeholder="https://…" /></label><label className="wide">Additional evidence URL <small>One additional public project, demo, or source URL.</small><input name="additional" type="url" placeholder="https://…" /></label><label className="wide">Notes <small>Explain what the evidence demonstrates; avoid unsupported identity claims.</small><textarea name="notes" placeholder="Concise evidence context and contribution details…" /></label></div>
        <div className="scoring-preview"><strong>Scoring framework</strong><div><span>GitHub <b>25</b></span><span>X <b>15</b></span><span>Portfolio <b>20</b></span><span>Additional <b>20</b></span><span>Notes <b>up to 20</b></span></div><p>This is the category weighting—not a score estimate. The canonical result is read back from the contract after acceptance.</p></div>
        <button className="button primary" disabled={!isConnected || !PROOFSCORE_IS_CONFIGURED}>Submit for canonical scoring</button>
      </form>}

      {address && submissions.some(item => item.builder.toLowerCase() === address.toLowerCase()) && <div className="readback"><span>Canonical result available</span><p>Your accepted submission appears below with its contract score, decision, dimensions, eligibility, and payout status.</p></div>}

      <div className="challenge-intro" id="challenge"><span className="eyebrow">CONTESTABLE BY DESIGN</span><p>Any user can record public counter-evidence. Only the campaign creator can apply valid tags to change score or eligibility before claim; post-claim challenges remain a transparent record with no payout reversal.</p></div>
      <div className="submission-list" id="claim">
        <div className="section-head compact"><div><span className="eyebrow">ACCEPTED ASSESSMENTS</span><h3>Submissions</h3></div></div>
        {submissions.length === 0 ? <div className="empty">No accepted submissions yet.</div> : submissions.map(submission => <article className="submission" key={submission.submission_id}>
          <div className="submission-main"><ScoreRing score={submission.score} /><div className="submission-copy"><div className="badges"><span className={`decision ${submission.decision.toLowerCase()}`}>{submission.decision.replace('_', ' ')}</span>{submission.eligible_to_claim && <span className="decision eligible">ELIGIBLE TO CLAIM</span>}{submission.claimed && <span className="decision claimed">CLAIMED · FINALIZATION DEPENDENT</span>}{submission.challenge_count > 0 && <span className="decision challenged">CHALLENGED</span>}{submission.revision_count > 0 && <span className="decision revised">REVISED</span>}</div><h3>{submission.handle}</h3><span className="wallet">Builder {short(submission.builder)} · Confidence {submission.confidence}</span><p>{submission.evidence_summary}</p><details><summary>Canonical score record</summary><p>{submission.reasoning}</p><div className="source-columns"><div><b>Accepted sources</b>{submission.accepted_sources.map(source => <span key={source}>{source}</span>)}</div><div><b>Risk flags</b>{submission.risk_flags.length ? submission.risk_flags.map(flag => <span key={flag}>{flag}</span>) : <span>None recorded</span>}</div></div></details></div></div>
          <div className="dimensions">{Object.entries(submission.dimensions).map(([name, value]) => { const max = name === 'github' ? 25 : name === 'x' ? 15 : 20; return <div key={name}><span>{name}</span><i><b style={{ width: `${value / max * 100}%` }} /></i><strong>{value}/{max}</strong></div> })}</div>
          {submission.eligible_to_claim && !submission.claimed && address?.toLowerCase() === submission.builder.toLowerCase() && <div className="claim-panel"><div><strong>Reward eligible</strong><span>Claiming schedules {gen(selected.reward_per_qualified_builder)} for finalization. It is not paid until finality is known.</span></div><button className="button claim" onClick={() => runWrite('claim_reward', [selected.campaign_id, submission.submission_id])}>Schedule reward claim</button></div>}
          <div className="challenge-zone"><form onSubmit={event => challenge(event, submission.submission_id)}><strong>Challenge this score</strong><small>{submission.claimed ? 'Post-claim challenges are recorded for transparency and do not claw back scheduled payouts.' : address?.toLowerCase() === selected.creator.toLowerCase() ? 'Creator challenge: valid tags can recompute score and eligibility before claim.' : 'This challenge will be recorded as counter-evidence. Only the campaign creator can change score/eligibility before claim.'}</small><input required type="url" name="challenge_url" placeholder="https://… counter-evidence URL" /><div className="tag-list" aria-label="Valid challenge tags">{['github', 'x', 'portfolio', 'additional', 'duplicate', 'irrelevant'].map(tag => <code key={tag}>[invalid:{tag}]</code>)}</div><textarea required minLength={10} name="reason" placeholder="Explain the issue and include applicable validation tags…" /><button className="mini-button" disabled={!isConnected || !PROOFSCORE_IS_CONFIGURED}>Submit contestable challenge</button></form>
            {(challenges[submission.submission_id] ?? []).length > 0 && <div className="timeline"><strong>Challenge timeline</strong>{challenges[submission.submission_id].map(item => <div className="timeline-item" key={item.challenge_id}><i /><div><span>#{item.challenge_id} · {item.verdict} · score {item.revised_score}</span><p>{item.reasoning}</p><small>{item.settlement_effect.replaceAll('_', ' ')} · {new Date(item.created_at * 1000).toLocaleString()}</small></div></div>)}</div>}
          </div>
        </article>)}
      </div>
    </section>}

    <section className="section create" id="create"><div><span className="eyebrow">SPONSOR A SETTLEMENT</span><h2>Create and fund a campaign</h2><p>The deposited GEN becomes the campaign reward pool. Every accepted score at or above your threshold unlocks one fixed claim, while creator counter-evidence can revise eligibility before claim.</p></div><form className="glass-form" onSubmit={createCampaign}><div className="form-grid"><label>Campaign title<input required name="title" minLength={3} maxLength={100} /></label><label>Minimum ProofScore<input required name="threshold" type="number" min="1" max="100" defaultValue="70" /></label><label>Reward per builder (GEN)<input required name="reward" type="number" min="0.000001" step="0.000001" /></label><label>Funded reward slots<input required name="slots" type="number" min="1" step="1" defaultValue="3" /></label><label>Deadline<input required name="deadline" type="datetime-local" min={formatLocalDateTime(new Date(nowMs + MIN_DEADLINE_AHEAD_MS), true)} defaultValue={formatLocalDateTime(new Date(nowMs + DEFAULT_DEADLINE_AHEAD_MS))} aria-describedby={`deadline-guidance${deadlineError ? ' deadline-error' : ''}`} aria-invalid={deadlineError ? true : undefined} onChange={() => { if (deadlineError) { setDeadlineError(''); setError('') } }} /><small id="deadline-guidance">Uses your local timezone and must be at least 10 minutes ahead.</small>{deadlineError && <small className="field-error" id="deadline-error" role="alert">{deadlineError}</small>}</label><label className="wide">Description<textarea required name="description" /></label><label className="wide">Evidence requirements<textarea required name="requirements" placeholder="Exact tokens: [requires:github] [requires:x] [requires:portfolio] [requires:additional]" /></label></div><button className="button primary" disabled={!isConnected || !PROOFSCORE_IS_CONFIGURED}>Create campaign + deposit pool</button><small>Payable value is sent in wei. The transaction hash is immediate; campaign state appears only after accepted execution succeeds.</small></form></section>

    <section className="section proof-section" id="deployment-proof"><header className="section-head"><div><span className="eyebrow">DEPLOYMENT RECORD</span><h2>Deployment proof</h2></div><span className={`proof-seal ${hasRecordedDeploymentProof ? '' : 'unavailable'}`}>{hasRecordedDeploymentProof ? '✓ ON-CHAIN PROOF' : 'PROOF NOT RECORDED'}</span></header><div className="proof-card"><div className="proof-contract">{PROOFSCORE_IS_CONFIGURED ? <><span>Configured ProofScore contract</span><code>{PROOFSCORE_CONTRACT_ADDRESS}</code><a href={`${BRADBURY_EXPLORER}/address/${PROOFSCORE_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">View configured contract ↗</a></> : <><span>Contract configuration</span><div className="config-empty">No v9 contract configured</div><p className="config-copy">Set NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS to enable live reads and writes.</p></>}</div>{hasRecordedDeploymentProof ? <div className="proof-list">{proofTransactions.map(([label, hash], index) => <a href={`${BRADBURY_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" key={hash}><i>{String(index + 1).padStart(2, '0')}</i><span><small>{label}</small><code>{hash}</code></span><b>↗</b></a>)}</div> : <div className="proof-unavailable"><span>Deployment proof unavailable</span><p>{PROOFSCORE_IS_CONFIGURED ? 'Deployment proof is available only for the recorded final v9 deployment. This configured address does not match the recorded proof bundle.' : 'No proof transactions are shown because a v9 contract is not configured.'}</p></div>}</div>{hasRecordedDeploymentProof && <p className="proof-note">Transaction references are fixed deployment artifacts. Explorer status is the source of truth for finality.</p>}</section>

    <footer className="site-footer"><span>ProofScore v9 · GenLayer Bradbury</span><span>Accepted is not finalized. Payout transfers execute on finalization.</span><a href={BRADBURY_EXPLORER} target="_blank" rel="noreferrer">Explorer ↗</a></footer>
  </main>
}
