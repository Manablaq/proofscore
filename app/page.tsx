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

type TxState = { phase: 'idle' | 'submitted' | 'accepted' | 'finalized' | 'failed'; hash?: string; detail?: string }

const chainHex = `0x${BRADBURY_CHAIN_ID.toString(16)}`

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }
  return []
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
      if (execution.includes('ERROR') || status.includes('ERROR') || status.includes('UNDETERMINED')) {
        update?.({ phase: 'failed', hash, detail: `${status || 'FAILED'}${execution ? ` / ${execution}` : ''}` })
        return false
      }
      if (status.includes('FINALIZED')) {
        update?.({ phase: 'finalized', hash, detail: 'Finalized.' }); return true
      }
      if (status.includes('ACCEPTED')) {
        update?.({ phase: 'accepted', hash, detail: 'Accepted — finalization pending. Accepted state can now be refreshed.' }); return true
      }
    } catch {}
  }
  update?.({ phase: 'failed', hash, detail: 'Receipt polling timed out. Inspect the transaction before retrying.' })
  return false
}

function gen(wei: string) {
  try { return `${Number(formatEther(BigInt(wei))).toLocaleString(undefined, { maximumFractionDigits: 4 })} GEN` } catch { return '—' }
}

function short(address: string) { return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—' }

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
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [challenges, setChallenges] = useState<Record<string, Challenge[]>>({})
  const [loading, setLoading] = useState(true)
  const [renderedAt] = useState(() => Date.now())
  const [error, setError] = useState('')
  const [tx, setTx] = useState<TxState>({ phase: 'idle' })
  const selected = campaigns.find(campaign => campaign.campaign_id === selectedId)

  const refreshCampaigns = useCallback(async () => {
    if (!PROOFSCORE_IS_CONFIGURED) { setLoading(false); return }
    try {
      const list = asArray<Campaign>(await readContract('list_campaigns'))
      setCampaigns(list)
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
    const reward = parseEther(String(form.get('reward')))
    const slots = Math.max(1, Number(form.get('slots')))
    const deadline = Math.floor(new Date(String(form.get('deadline'))).getTime() / 1000)
    const ok = await runWrite('create_campaign', [String(form.get('title')), String(form.get('description')), Number(form.get('threshold')), reward.toString(), deadline, String(form.get('requirements'))], reward * BigInt(slots))
    if (ok) event.currentTarget.reset()
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
    <nav><a className="brand" href="#top"><span>PS</span> ProofScore <em>v9</em></a><div className="nav-right"><a href="#campaigns">Campaigns</a><a href="#create">Sponsor</a><ConnectButton /></div></nav>

    <section className="hero" id="top">
      <div className="eyebrow">GENLAYER-NATIVE · CONTESTABLE SETTLEMENT</div>
      <h1>Reputation that<br /><span>settles rewards.</span></h1>
      <p>Scores are no longer badges. They decide campaign eligibility and payout release.</p>
      <div className="hero-actions"><a className="button primary" href="#campaigns">Explore campaigns</a><a className="button ghost" href="#create">Fund a bounty</a></div>
      <div className="flow">
        {['Campaign', 'Evidence', 'Validator score', 'Claim reward', 'Challenge'].map((step, index) => <div key={step}><b>0{index + 1}</b><span>{step}</span>{index < 4 && <i>→</i>}</div>)}
      </div>
      <p className="truth-note">Evidence-backed reputation assessment. ProofScore does not prove identity or ownership of submitted profiles.</p>
    </section>

    {!PROOFSCORE_IS_CONFIGURED && <section className="config-warning"><strong>V9 preview mode</strong><span>No v9 address is configured, so writes and live reads are disabled. Deploy separately and set <code>NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS</code>.</span></section>}
    <TxNotice state={tx} />{error && <div className="error">{error}</div>}

    <section className="section" id="campaigns">
      <header className="section-head"><div><span className="eyebrow">OPEN SETTLEMENTS</span><h2>Builder campaigns</h2></div><button className="mini-button" onClick={() => { refreshCampaigns(); refreshSelected() }}>Refresh accepted state</button></header>
      {loading ? <div className="empty">Reading accepted contract state…</div> : campaigns.length === 0 ? <div className="empty">No live v9 campaigns. This interface does not fabricate campaign data.</div> : <div className="campaign-grid">
        {campaigns.map(campaign => <button className={`campaign-card ${selectedId === campaign.campaign_id ? 'selected' : ''}`} key={campaign.campaign_id} onClick={() => setSelectedId(campaign.campaign_id)}>
          <div className="card-top"><span className={`status ${campaign.status.toLowerCase()}`}>{campaign.status}</span><span>#{campaign.campaign_id}</span></div>
          <h3>{campaign.title}</h3><p>{campaign.description}</p>
          <div className="campaign-stats"><div><small>Threshold</small><strong>{campaign.threshold_score}</strong></div><div><small>Reward</small><strong>{gen(campaign.reward_per_qualified_builder)}</strong></div><div><small>Pool left</small><strong>{gen(campaign.remaining_pool)}</strong></div></div>
          <footer><span>{campaign.submissions_count} submissions · {campaign.qualified_count} qualified</span><span>{new Date(campaign.deadline * 1000).toLocaleDateString()}</span></footer>
        </button>)}
      </div>}
    </section>

    {selected && <section className="section detail">
      <div className="detail-header"><div><span className="eyebrow">CAMPAIGN #{selected.campaign_id}</span><h2>{selected.title}</h2><p>{selected.description}</p></div><div className="pool"><small>Remaining escrow</small><strong>{gen(selected.remaining_pool)}</strong><span>{gen(selected.reward_per_qualified_builder)} per accepted builder</span></div></div>
      <div className="requirements"><strong>Evidence requirements</strong><p>{selected.evidence_requirements}</p><span>Deadline {new Date(selected.deadline * 1000).toLocaleString()}</span></div>
      {selected.status === 'OPEN' && selected.deadline * 1000 >= renderedAt && <form className="glass-form" onSubmit={submitProfile}>
        <div className="form-title"><span>Builder evidence</span><small>Validated source categories and context receive deterministic weights. One submission per wallet.</small></div>
        <div className="form-grid"><label>Handle<input required name="handle" placeholder="builder-name" /></label><label>GitHub URL<input name="github" type="url" placeholder="https://github.com/…" /></label><label>X URL<input name="x" type="url" placeholder="https://x.com/…" /></label><label>Portfolio URL<input name="portfolio" type="url" placeholder="https://…" /></label><label className="wide">Additional evidence URL<input name="additional" type="url" placeholder="Project, case study, or source URL" /></label><label className="wide">Evidence notes<textarea name="notes" placeholder="Explain what each source supports. Avoid identity claims." /></label></div>
        <button className="button primary" disabled={!isConnected || !PROOFSCORE_IS_CONFIGURED}>Submit for canonical scoring</button>
      </form>}

      <div className="submission-list">
        <div className="section-head compact"><div><span className="eyebrow">ACCEPTED ASSESSMENTS</span><h3>Submissions</h3></div></div>
        {submissions.length === 0 ? <div className="empty">No accepted submissions yet.</div> : submissions.map(submission => <article className="submission" key={submission.submission_id}>
          <div className="submission-main"><ScoreRing score={submission.score} /><div className="submission-copy"><div className="badges"><span className={`decision ${submission.decision.toLowerCase()}`}>{submission.decision.replace('_', ' ')}</span>{submission.eligible_to_claim && <span className="decision eligible">ELIGIBLE TO CLAIM</span>}{submission.claimed && <span className="decision claimed">CLAIMED · FINALIZATION DEPENDENT</span>}{submission.challenge_count > 0 && <span className="decision challenged">CHALLENGED</span>}{submission.revision_count > 0 && <span className="decision revised">REVISED</span>}</div><h3>{submission.handle}</h3><span className="wallet">Builder {short(submission.builder)} · Confidence {submission.confidence}</span><p>{submission.evidence_summary}</p><details><summary>Canonical score record</summary><p>{submission.reasoning}</p><div className="source-columns"><div><b>Accepted sources</b>{submission.accepted_sources.map(source => <span key={source}>{source}</span>)}</div><div><b>Risk flags</b>{submission.risk_flags.length ? submission.risk_flags.map(flag => <span key={flag}>{flag}</span>) : <span>None recorded</span>}</div></div></details></div></div>
          <div className="dimensions">{Object.entries(submission.dimensions).map(([name, value]) => { const max = name === 'github' ? 25 : name === 'x' ? 15 : 20; return <div key={name}><span>{name}</span><i><b style={{ width: `${value / max * 100}%` }} /></i><strong>{value}/{max}</strong></div> })}</div>
          {submission.eligible_to_claim && address?.toLowerCase() === submission.builder.toLowerCase() && <button className="button claim" onClick={() => runWrite('claim_reward', [selected.campaign_id, submission.submission_id])}>Claim {gen(selected.reward_per_qualified_builder)}</button>}
          <div className="challenge-zone"><form onSubmit={event => challenge(event, submission.submission_id)}><strong>Challenge this score</strong><input required type="url" name="challenge_url" placeholder="Counter-evidence URL" /><textarea required minLength={10} name="reason" placeholder="Creator tags: [invalid:github], [invalid:x], [invalid:portfolio], [invalid:additional], [invalid:duplicate], [invalid:irrelevant]" /><button className="mini-button" disabled={!isConnected || !PROOFSCORE_IS_CONFIGURED}>Submit contestable challenge</button></form>
            {(challenges[submission.submission_id] ?? []).length > 0 && <div className="timeline"><strong>Challenge timeline</strong>{challenges[submission.submission_id].map(item => <div className="timeline-item" key={item.challenge_id}><i /><div><span>#{item.challenge_id} · {item.verdict} · score {item.revised_score}</span><p>{item.reasoning}</p><small>{item.settlement_effect.replaceAll('_', ' ')} · {new Date(item.created_at * 1000).toLocaleString()}</small></div></div>)}</div>}
          </div>
        </article>)}
      </div>
    </section>}

    <section className="section create" id="create"><div><span className="eyebrow">SPONSOR A SETTLEMENT</span><h2>Create and fund a campaign</h2><p>The deposited GEN becomes the campaign reward pool. Every accepted score at or above your threshold unlocks one fixed claim, while creator counter-evidence can revise eligibility before claim.</p></div><form className="glass-form" onSubmit={createCampaign}><div className="form-grid"><label>Campaign title<input required name="title" minLength={3} maxLength={100} /></label><label>Minimum ProofScore<input required name="threshold" type="number" min="1" max="100" defaultValue="70" /></label><label>Reward per builder (GEN)<input required name="reward" type="number" min="0.000001" step="0.000001" /></label><label>Funded reward slots<input required name="slots" type="number" min="1" defaultValue="3" /></label><label>Deadline<input required name="deadline" type="datetime-local" /></label><label className="wide">Description<textarea required name="description" /></label><label className="wide">Evidence requirements<textarea required name="requirements" placeholder="Exact tokens: [requires:github] [requires:x] [requires:portfolio] [requires:additional]" /></label></div><button className="button primary" disabled={!isConnected || !PROOFSCORE_IS_CONFIGURED}>Create campaign + deposit pool</button><small>Payable value is sent in wei. The transaction hash is immediate; campaign state appears only after acceptance.</small></form></section>

    <footer className="site-footer"><span>ProofScore v9 · GenLayer Bradbury</span><span>Accepted is not finalized. Payout transfers execute on finalization.</span><a href={BRADBURY_EXPLORER} target="_blank" rel="noreferrer">Explorer ↗</a></footer>
  </main>
}
