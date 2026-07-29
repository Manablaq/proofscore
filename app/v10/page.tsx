'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { parseEther } from 'viem'
import { BRADBURY_CHAIN_ID, BRADBURY_EXPLORER, BRADBURY_RPC, PROOFSCORE_V10_CONTRACT_ADDRESS, PROOFSCORE_V10_IS_CONFIGURED } from '@/lib/config'

type Campaign = { campaign_id: string; title: string; description: string; deadline: number; remaining_pool: string; reward_per_builder: string; status: string }
type Submission = { submission_id: string; builder: string; handle: string; verification_token: string; verification_expires_at: number; account_control: string; quality_status: string; verdict: string; score: number; scores: Record<string, number>; rationale: string; eligible_to_claim?: boolean; claimed: boolean; payout_status: string }

async function read(method: string, args: unknown[] = []) {
  const response = await fetch(`/api/contract?version=v10&method=${method}&args=${encodeURIComponent(JSON.stringify(args))}`, { cache: 'no-store' })
  const data = await response.json()
  if (!data.ok) throw new Error(data.error ?? 'Contract read failed.')
  return data.result
}

async function write(address: string, method: string, args: unknown[], value?: bigint) {
  const ethereum = (window as Window & { ethereum?: any }).ethereum
  if (!ethereum) throw new Error('Connect a browser wallet first.')
  const expected = `0x${BRADBURY_CHAIN_ID.toString(16)}`
  if ((await ethereum.request({ method: 'eth_chainId' })).toLowerCase() !== expected) await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: expected }] })
  const { createClient } = await import('genlayer-js')
  const { testnetBradbury } = await import('genlayer-js/chains')
  const client = createClient({ chain: { ...testnetBradbury, rpcUrls: { default: { http: [BRADBURY_RPC] } } }, account: address, provider: ethereum } as any)
  return (client as any).writeContract({ address: PROOFSCORE_V10_CONTRACT_ADDRESS, functionName: method, args, ...(value === undefined ? {} : { value }) })
}

export default function ProofScoreV10() {
  const { address, isConnected } = useAccount()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selected, setSelected] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [notice, setNotice] = useState('')
  const current = submissions.find(item => item.builder.toLowerCase() === address?.toLowerCase())
  const refresh = useCallback(async () => {
    try {
      const list = await read('list_campaigns') as Campaign[]
      setCampaigns(list); const id = selected || list[0]?.campaign_id || ''; setSelected(id)
      if (id) setSubmissions(await read('list_submissions', [id]) as Submission[])
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not read v10 state.') }
  }, [selected])
  useEffect(() => {
    if (!PROOFSCORE_V10_IS_CONFIGURED) return
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])
  async function run(method: string, args: unknown[], value?: bigint) {
    if (!address) return setNotice('Connect a wallet first.')
    try { const hash = await write(address, method, args, value); setNotice(`Submitted: ${hash}. Wait for accepted state, then refresh.`) } catch (error) { setNotice(error instanceof Error ? error.message : 'Transaction failed.') }
  }
  async function chooseCampaign(campaignId: string) {
    setSelected(campaignId)
    try { setSubmissions(await read('list_submissions', [campaignId]) as Submission[]) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load submissions.') }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const form = new FormData(event.currentTarget)
    void run('submit_evidence', [selected, 'handle', 'proof_url', 'repository_url', 'product_url', 'documentation_url', 'notes'].map(key => String(form.get(key) ?? '').trim()))
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    try { const reward = parseEther(String(form.get('reward'))); const slots = BigInt(String(form.get('slots'))); void run('create_campaign', [String(form.get('title')), String(form.get('description')), reward.toString(), Math.floor(new Date(String(form.get('deadline'))).getTime() / 1000)], reward * slots) } catch { setNotice('Enter a valid GEN reward, slot count, and deadline.') }
  }
  if (!PROOFSCORE_V10_IS_CONFIGURED) return <main className="v10"><ConnectButton /><h1>ProofScore v10 is not deployed yet.</h1><p>The current ProofScore app remains available at <Link href="/">the main app</Link>. Configure <code>NEXT_PUBLIC_PROOFSCORE_V10_ADDRESS</code> only after v10 has a finalized deployment.</p></main>
  return <main className="v10"><header><Link href="/">← Current ProofScore app</Link><ConnectButton /></header><h1>ProofScore <em>v10</em></h1><p>Public-account control + decentralized evidence adjudication. A wallet must publish its one-time on-chain challenge before a quality verdict can unlock GEN settlement.</p>{notice && <p className="notice">{notice}</p>}<button onClick={() => void refresh()}>Refresh accepted state</button><section><h2>1. Sponsor a verified bounty</h2><form onSubmit={create}><input name="title" required placeholder="Campaign title" /><textarea name="description" required minLength={20} placeholder="Concrete contribution brief" /><input name="reward" required type="number" step="0.000001" placeholder="GEN per accepted builder" /><input name="slots" required type="number" min="1" defaultValue="1" /><input name="deadline" required type="datetime-local" /><button disabled={!isConnected}>Create + fund</button></form></section><section><h2>2. Submit evidence</h2><select value={selected} onChange={event => void chooseCampaign(event.target.value)}>{campaigns.map(c => <option key={c.campaign_id} value={c.campaign_id}>{c.title} · {c.status}</option>)}</select><form onSubmit={submit}><input name="handle" required placeholder="Public builder handle" /><input name="proof_url" required type="url" placeholder="HTTPS URL where you will publish the challenge" /><input name="repository_url" required type="url" placeholder="Immutable repository / commit URL" /><input name="product_url" required type="url" placeholder="Working product URL" /><input name="documentation_url" required type="url" placeholder="Documentation URL" /><textarea name="notes" placeholder="Bounded evidence context" /><button disabled={!isConnected || !selected}>Create evidence record</button></form></section>{current && <section><h2>3. Verify and adjudicate</h2><p><b>Account control:</b> {current.account_control} · <b>Quality:</b> {current.quality_status}</p><p>Publish this exact token at your proof URL before it expires:</p><code>{current.verification_token}</code><p>Expires {new Date(current.verification_expires_at * 1000).toLocaleString()}</p><button disabled={!isConnected || current.account_control !== 'PENDING'} onClick={() => void run('verify_account_control', [selected, current.submission_id])}>Verify public proof</button><button disabled={!isConnected || current.account_control !== 'CONTROL_VERIFIED' || current.quality_status !== 'NOT_REQUESTED'} onClick={() => void run('adjudicate_quality', [selected, current.submission_id])}>Request validator verdict</button><p><b>{current.verdict}</b> {current.score}/100 · {current.rationale}</p>{current.eligible_to_claim && !current.claimed && <button onClick={() => void run('claim_reward', [selected, current.submission_id])}>Claim verified reward</button>}</section>}<footer><a href={`${BRADBURY_EXPLORER}/address/${PROOFSCORE_V10_CONTRACT_ADDRESS}`} target="_blank">Inspect v10 contract ↗</a></footer></main>
}
