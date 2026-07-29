'use client'

import './v10.css'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import {
  BRADBURY_CHAIN_ID,
  BRADBURY_EXPLORER,
  BRADBURY_RPC,
  PROOFSCORE_V10_CONTRACT_ADDRESS,
  PROOFSCORE_V10_IS_CONFIGURED,
} from '@/lib/config'

type Campaign = {
  campaign_id: string
  creator: string
  title: string
  description: string
  deadline: number
  remaining_pool: string
  reward_per_builder: string
  submissions_count: number
  status: string
}

type Submission = {
  submission_id: string
  builder: string
  handle: string
  verification_token: string
  verification_expires_at: number
  account_control: string
  quality_status: string
  verdict: string
  score: number
  rationale: string
  eligible_to_claim?: boolean
  claimed: boolean
}

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null

async function readContract(method: string, args: unknown[] = []) {
  const response = await fetch(
    `/api/contract?version=v10&method=${method}&args=${encodeURIComponent(JSON.stringify(args))}`,
    { cache: 'no-store' },
  )
  const payload = await response.json()
  if (!payload.ok) throw new Error(payload.error ?? 'Could not read contract state.')
  return payload.result
}

async function writeContract(address: string, method: string, args: unknown[], value?: bigint) {
  const ethereum = (window as Window & { ethereum?: { request: (request: unknown) => Promise<string> } }).ethereum
  if (!ethereum) throw new Error('Connect a browser wallet first.')

  const expectedChain = `0x${BRADBURY_CHAIN_ID.toString(16)}`
  const currentChain = await ethereum.request({ method: 'eth_chainId' })
  if (currentChain.toLowerCase() !== expectedChain) {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: expectedChain }] })
  }

  const { createClient } = await import('genlayer-js')
  const { testnetBradbury } = await import('genlayer-js/chains')
  const client = createClient({
    chain: { ...testnetBradbury, rpcUrls: { default: { http: [BRADBURY_RPC] } } },
    account: address,
    provider: ethereum,
  } as any)
  return (client as any).writeContract({
    address: PROOFSCORE_V10_CONTRACT_ADDRESS,
    functionName: method,
    args,
    ...(value === undefined ? {} : { value }),
  })
}

const displayStatus = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`
const asGen = (value: string) => {
  try { return Number(formatEther(BigInt(value))).toLocaleString(undefined, { maximumFractionDigits: 4 }) } catch { return '—' }
}

export default function ProofScoreV10() {
  const { address, isConnected } = useAccount()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)

  const selectedCampaign = campaigns.find((campaign) => campaign.campaign_id === selectedCampaignId)
  const ownSubmission = useMemo(
    () => submissions.find((submission) => submission.builder.toLowerCase() === address?.toLowerCase()),
    [address, submissions],
  )

  const refresh = useCallback(async (requestedCampaignId?: string) => {
    if (!PROOFSCORE_V10_IS_CONFIGURED) return
    setLoading(true)
    try {
      const nextCampaigns = await readContract('list_campaigns') as Campaign[]
      const id = requestedCampaignId ?? selectedCampaignId ?? nextCampaigns[0]?.campaign_id ?? ''
      setCampaigns(nextCampaigns)
      setSelectedCampaignId(id)
      setSubmissions(id ? await readContract('list_submissions', [id]) as Submission[] : [])
      setNotice(null)
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not refresh contract state.' })
    } finally {
      setLoading(false)
    }
  }, [selectedCampaignId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  async function run(method: string, args: unknown[], value?: bigint) {
    if (!address) {
      setNotice({ tone: 'info', text: 'Connect your wallet to submit a transaction.' })
      return
    }
    try {
      const hash = await writeContract(address, method, args, value)
      setNotice({ tone: 'success', text: `Transaction submitted: ${hash}. It must reach accepted state before the next action.` })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Transaction could not be submitted.' })
    }
  }

  function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const reward = parseEther(String(form.get('reward') ?? ''))
      const slots = BigInt(String(form.get('slots') ?? ''))
      const deadline = Math.floor(new Date(String(form.get('deadline') ?? '')).getTime() / 1000)
      if (reward <= BigInt(0) || slots < BigInt(1) || !Number.isFinite(deadline) || deadline <= Math.floor(Date.now() / 1000)) throw new Error()
      void run('create_campaign', [
        String(form.get('title') ?? '').trim(),
        String(form.get('description') ?? '').trim(),
        reward.toString(),
        deadline,
      ], reward * slots)
    } catch {
      setNotice({ tone: 'error', text: 'Enter a valid positive GEN reward, number of slots, and future deadline.' })
    }
  }

  function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCampaignId) {
      setNotice({ tone: 'error', text: 'Select an open campaign before submitting evidence.' })
      return
    }
    const form = new FormData(event.currentTarget)
    void run('submit_evidence', [
      selectedCampaignId,
      ...['handle', 'proof_url', 'repository_url', 'product_url', 'documentation_url', 'notes']
        .map((field) => String(form.get(field) ?? '').trim()),
    ])
  }

  function changeCampaign(id: string) {
    setSelectedCampaignId(id)
    void refresh(id)
  }

  const openCampaigns = campaigns.filter((campaign) => campaign.status === 'OPEN').length
  const fundedGen = campaigns.reduce((total, campaign) => total + Number(formatEther(BigInt(campaign.remaining_pool || '0'))), 0)

  if (!PROOFSCORE_V10_IS_CONFIGURED) {
    return <main className="v10-config"><h1>ProofScore v10 is not configured.</h1><p>Set <code>NEXT_PUBLIC_PROOFSCORE_V10_ADDRESS</code> to the finalized contract address before using this workspace.</p></main>
  }

  return (
    <main className="v10-app">
      <aside className="v10-sidebar" aria-label="Primary navigation">
        <Link href="/" className="v10-brand"><span>PS</span><strong>ProofScore</strong><em>v10</em></Link>
        <nav>
          <a href="#overview">Overview</a>
          <a href="#campaigns">Campaigns</a>
          <a href="#submit-evidence">Submit evidence</a>
          <a href="#verification">Verification</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className="sidebar-contract">
          <span>LIVE ON BRADBURY</span>
          <code>{shortAddress(PROOFSCORE_V10_CONTRACT_ADDRESS)}</code>
          <a href={`${BRADBURY_EXPLORER}/address/${PROOFSCORE_V10_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">View contract ↗</a>
        </div>
        <div className="sidebar-footer"><Link href="/v9">Legacy v9</Link><a href="https://github.com/Manablaq/proofscore" target="_blank" rel="noreferrer">Source ↗</a></div>
      </aside>

      <div className="v10-main">
        <header className="v10-topbar">
          <div><span className="network-dot" /> Bradbury Testnet <small>· v10 protocol workspace</small></div>
          <ConnectButton />
        </header>

        {notice && <div className={`v10-notice ${notice.tone}`} role="status">{notice.text}</div>}

        <section className="v10-hero" id="overview">
          <div>
            <span className="v10-kicker">EVIDENCE-SETTLED CONTRIBUTIONS</span>
            <h1>Make work<br /><i>verifiable.</i></h1>
            <p>ProofScore v10 lets sponsors fund real outcomes. Builders prove control of a public resource, then GenLayer validators assess the submitted product evidence.</p>
            <div className="v10-hero-actions"><a className="v10-primary" href="#campaigns">Explore campaigns</a><a className="v10-text-action" href="#how-it-works">See the protocol ↓</a></div>
          </div>
          <div className="v10-hero-card">
            <div className="hero-card-top"><span>PROTOCOL STATUS</span><b><i /> LIVE</b></div>
            <div className="hero-card-score"><strong>01</strong><span>Public resource<br />control proof</span></div>
            <div className="hero-card-line" />
            <div className="hero-card-score"><strong>02</strong><span>Validator consensus<br />quality verdict</span></div>
            <p>Settlement unlocks only after the required on-chain states are accepted.</p>
          </div>
        </section>

        <section className="v10-stats" aria-label="Protocol statistics">
          <article><span>OPEN CAMPAIGNS</span><strong>{loading ? '—' : openCampaigns}</strong></article>
          <article><span>ACTIVE CAMPAIGN</span><strong>{selectedCampaign ? `#${selectedCampaign.campaign_id}` : '—'}</strong></article>
          <article><span>AVAILABLE GEN</span><strong>{loading ? '—' : fundedGen.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong></article>
          <article><span>CONTRACT STATE</span><strong className="live-state"><i /> accepted reads</strong></article>
        </section>

        <section className="v10-section" id="campaigns">
          <header className="v10-section-heading"><div><span>01 / DISCOVER</span><h2>Verified campaigns</h2></div><button className="v10-refresh" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh state'}</button></header>
          {campaigns.length === 0 && !loading ? <div className="v10-empty"><strong>No campaigns yet</strong><p>Create the first funded, verifiable campaign below.</p></div> : <div className="v10-campaign-grid">
            {campaigns.map((campaign) => <button type="button" className={`v10-campaign ${campaign.campaign_id === selectedCampaignId ? 'selected' : ''}`} key={campaign.campaign_id} onClick={() => changeCampaign(campaign.campaign_id)}>
              <div><span className={`v10-status ${campaign.status.toLowerCase()}`}>{displayStatus(campaign.status)}</span><small>CAMPAIGN #{campaign.campaign_id}</small></div>
              <h3>{campaign.title}</h3><p>{campaign.description}</p>
              <footer><span><b>{asGen(campaign.reward_per_builder)} GEN</b> / builder</span><span><b>{campaign.submissions_count}</b> submissions</span></footer>
            </button>)}
          </div>}
        </section>

        <section className="v10-workspace" id="submit-evidence">
          <div className="v10-workspace-copy"><span>02 / SUBMIT</span><h2>Submit evidence<br />with context.</h2><p>Every submission creates a wallet-bound record. Use permanent, public HTTPS links so validators can assess the work and a one-time control token can be published.</p><div className="v10-rule"><b>Required</b><span>Proof, repository, product, and documentation URLs.</span></div></div>
          <form className="v10-form" onSubmit={submitEvidence}>
            <label>Campaign<select value={selectedCampaignId} required onChange={(event) => changeCampaign(event.target.value)}><option value="">Choose a campaign</option>{campaigns.map((campaign) => <option value={campaign.campaign_id} key={campaign.campaign_id}>{campaign.title} · {campaign.status}</option>)}</select></label>
            <div className="v10-form-grid"><label>Public handle<input name="handle" required minLength={2} placeholder="your-handle" /></label><label>Proof URL<input name="proof_url" type="url" required placeholder="https://…" /></label><label>Repository URL<input name="repository_url" type="url" required placeholder="https://github.com/…" /></label><label>Product URL<input name="product_url" type="url" required placeholder="https://…" /></label></div>
            <label>Documentation URL<input name="documentation_url" type="url" required placeholder="https://…" /></label>
            <label>Evidence notes <small>Optional but useful to validators</small><textarea name="notes" maxLength={2000} placeholder="Explain what was delivered, where to review it, and any relevant constraints." /></label>
            <button className="v10-primary" disabled={!isConnected || !selectedCampaignId}>Create evidence record</button>
          </form>
        </section>

        <section className="v10-section" id="verification">
          <header className="v10-section-heading"><div><span>03 / VERIFY</span><h2>Your verification state</h2></div>{selectedCampaign && <small>Campaign #{selectedCampaign.campaign_id}</small>}</header>
          {!address ? <div className="v10-empty"><strong>Connect the submitting wallet</strong><p>Your active evidence record and available actions will appear here.</p></div> : !ownSubmission ? <div className="v10-empty"><strong>No record for this wallet</strong><p>Submit evidence to the selected campaign to start a verification flow.</p></div> : <div className="v10-verification-card">
            <div className="verification-state"><span className="v10-status pending">{displayStatus(ownSubmission.account_control)}</span><h3>Public-control challenge</h3><p>Publish this exact token at your submitted Proof URL, then request verification before it expires.</p><code>{ownSubmission.verification_token}</code><small>Expires {new Date(ownSubmission.verification_expires_at * 1000).toLocaleString()}</small></div>
            <div className="verification-actions"><div className="action-progress"><span className={ownSubmission.account_control === 'CONTROL_VERIFIED' ? 'done' : ''}>1</span><p><b>Control</b><small>{displayStatus(ownSubmission.account_control)}</small></p><i /><span className={ownSubmission.quality_status !== 'NOT_REQUESTED' ? 'done' : ''}>2</span><p><b>Quality</b><small>{displayStatus(ownSubmission.quality_status)}</small></p></div>
              <button className="v10-secondary" disabled={!isConnected || ownSubmission.account_control !== 'PENDING'} onClick={() => void run('verify_account_control', [selectedCampaignId, ownSubmission.submission_id])}>Verify public control</button>
              <button className="v10-secondary" disabled={!isConnected || ownSubmission.account_control !== 'CONTROL_VERIFIED' || ownSubmission.quality_status !== 'NOT_REQUESTED'} onClick={() => void run('adjudicate_quality', [selectedCampaignId, ownSubmission.submission_id])}>Request validator verdict</button>
              {ownSubmission.eligible_to_claim && !ownSubmission.claimed && <button className="v10-primary" onClick={() => void run('claim_reward', [selectedCampaignId, ownSubmission.submission_id])}>Claim verified reward</button>}
              <div className="v10-verdict"><span>VERDICT</span><strong>{ownSubmission.verdict || 'Pending'}</strong><b>{ownSubmission.score || 0}/100</b><p>{ownSubmission.rationale || 'A validator rationale will appear after quality adjudication.'}</p></div>
            </div>
          </div>}
        </section>

        <section className="v10-create" id="create-campaign">
          <div><span>SPONSOR A CAMPAIGN</span><h2>Fund an outcome<br />worth verifying.</h2><p>Funding is held by the contract. Define a concrete contribution brief, fair reward, number of accepted builders, and deadline.</p></div>
          <form className="v10-form" onSubmit={createCampaign}>
            <label>Campaign title<input name="title" required minLength={3} maxLength={120} placeholder="e.g. Improve mobile onboarding" /></label>
            <label>Concrete contribution brief<textarea name="description" required minLength={20} maxLength={2000} placeholder="Describe the deliverable, acceptance criteria, and evidence reviewers should examine." /></label>
            <div className="v10-form-grid"><label>GEN per accepted builder<input name="reward" type="number" required min="0.000001" step="0.000001" placeholder="1" /></label><label>Accepted builder slots<input name="slots" type="number" required min="1" step="1" defaultValue="1" /></label></div>
            <label>Deadline<input name="deadline" type="datetime-local" required /></label>
            <button className="v10-primary" disabled={!isConnected}>Create and fund campaign</button>
          </form>
        </section>

        <section className="v10-protocol" id="how-it-works"><span>HOW THE V10 PROTOCOL WORKS</span><div><article><b>01</b><h3>Submit public evidence</h3><p>A builder attaches public URLs to a wallet-bound on-chain record.</p></article><article><b>02</b><h3>Prove resource control</h3><p>The builder publishes a one-time token at the submitted public resource.</p></article><article><b>03</b><h3>Reach validator consensus</h3><p>Validators assess the product evidence against the v10 quality rubric.</p></article><article><b>04</b><h3>Settle eligible work</h3><p>Only a verified, qualifying record can unlock its reserved GEN reward.</p></article></div><p className="v10-disclaimer">ProofScore verifies control of a submitted public resource—not legal identity—and records validator-consensus quality judgements, not universal objective quality.</p></section>
        <footer className="v10-footer"><span>ProofScore v10 · GenLayer Bradbury</span><a href={`${BRADBURY_EXPLORER}/address/${PROOFSCORE_V10_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Contract explorer ↗</a></footer>
      </div>
    </main>
  )
}
