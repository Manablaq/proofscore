'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useWalletClient } from 'wagmi'

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:      '#060608',
  surface: 'rgba(255,255,255,0.04)',
  border:  'rgba(255,255,255,0.08)',
  gold:    '#C9A84C',
  goldDim: '#7A6330',
  amber:   '#E8963A',
  green:   '#3DD68C',
  red:     '#FF4F4F',
  muted:   'rgba(255,255,255,0.35)',
  text:    '#F0EDE8',
}

// Score color: 0-299 red, 300-599 amber, 600-799 gold, 800+ green
function scoreColor(score: number) {
  if (score >= 800) return T.green
  if (score >= 600) return T.gold
  if (score >= 300) return T.amber
  return T.red
}

function scoreLabel(score: number) {
  if (score >= 800) return 'Elite'
  if (score >= 600) return 'Expert'
  if (score >= 400) return 'Skilled'
  if (score >= 200) return 'Rising'
  return 'Unverified'
}

// ── Contract config ────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS = '0x9A93A3Cd425A0Ee1b7e2347b8Dd8b53b208F9Aad' as `0x${string}` // replace after deploy
const BRADBURY_CHAIN_ID = '0x107D'
const BRADBURY_RPC = 'https://rpc-bradbury.genlayer.com'

// ── genlayer helpers ───────────────────────────────────────────────────────────
async function readContract(method: string, args: unknown[] = []) {
  const { createClient } = await import('genlayer-js')
  const { testnetBradbury } = await import('genlayer-js/chains')
  const bradburyFetch: typeof fetch = async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body)
        if (Array.isArray(parsed)) {
          init = { ...init, body: JSON.stringify(parsed.map((r: any) => ({ ...r, id: typeof r.id === 'string' ? parseInt(r.id,10)||1 : r.id??1 }))) }
        } else if (parsed && typeof parsed === 'object') {
          init = { ...init, body: JSON.stringify({ ...parsed, id: typeof parsed.id === 'string' ? parseInt(parsed.id,10)||1 : parsed.id??1 }) }
        }
      } catch {}
    }
    return fetch(input, init)
  }
  const chain = { ...testnetBradbury, rpcUrls: { default: { http: [BRADBURY_RPC] } } } as any
  const client = createClient({ chain, fetch: bradburyFetch } as any)
  return (client as any).readContract({ address: CONTRACT_ADDRESS, functionName: method, args })
}

async function getActiveProvider(address: string) {
  const win = window as any
  const addr = address.toLowerCase()
  const candidates: any[] = []
  if (win.okxwallet) candidates.push(win.okxwallet)
  if (Array.isArray(win.ethereum?.providers)) candidates.push(...win.ethereum.providers)
  if (win.ethereum && !candidates.includes(win.ethereum)) candidates.push(win.ethereum)
  for (const p of candidates) {
    try {
      const accounts: string[] = await p.request({ method: 'eth_accounts' })
      if (accounts.some((a: string) => a.toLowerCase() === addr)) return p
    } catch {}
  }
  if (candidates.length > 0) return candidates[0]
  throw new Error('No wallet found.')
}

async function writeContract(address: string, walletClient: any, method: string, args: unknown[] = []) {
  const provider = await getActiveProvider(address)
  // Ensure Bradbury chain
  const current = await provider.request({ method: 'eth_chainId' })
  if (current.toLowerCase() !== BRADBURY_CHAIN_ID.toLowerCase()) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BRADBURY_CHAIN_ID }] })
    } catch (e: any) {
      if (e?.code === 4902 || e?.code === -32603) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: BRADBURY_CHAIN_ID, chainName: 'GenLayer Bradbury Testnet', nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 }, rpcUrls: [BRADBURY_RPC], blockExplorerUrls: ['https://explorer-bradbury.genlayer.com'] }]
        })
      } else throw e
    }
  }
  // Install GenLayer Snap
  try {
    const snapId = 'npm:genlayer-wallet-plugin'
    const snaps = await provider.request({ method: 'wallet_getSnaps' })
    const installed = Object.values(snaps as any).some((s: any) => s.id === snapId)
    if (!installed) await provider.request({ method: 'wallet_requestSnaps', params: { [snapId]: {} } })
  } catch {}
  const { createClient } = await import('genlayer-js')
  const { testnetBradbury } = await import('genlayer-js/chains')
  const bradburyFetch: typeof fetch = async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body)
        if (Array.isArray(parsed)) {
          init = { ...init, body: JSON.stringify(parsed.map((r: any) => ({ ...r, id: typeof r.id === 'string' ? parseInt(r.id,10)||1 : r.id??1 }))) }
        } else if (parsed && typeof parsed === 'object') {
          init = { ...init, body: JSON.stringify({ ...parsed, id: typeof parsed.id === 'string' ? parseInt(parsed.id,10)||1 : parsed.id??1 }) }
        }
      } catch {}
    }
    return fetch(input, init)
  }
  const chain = { ...testnetBradbury, rpcUrls: { default: { http: [BRADBURY_RPC] } } } as any
  const client = createClient({ chain, account: address, provider, fetch: bradburyFetch } as any)
  const txHash = await (client as any).writeContract({ address: CONTRACT_ADDRESS, functionName: method, args })
  // Poll for receipt
  const deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const receipt = await (client as any).getTransactionReceipt({ hash: txHash })
      if (!receipt) continue
      const statusName: string = (receipt as any).statusName ?? (receipt as any).status ?? 'UNKNOWN'
      const execResult: string = (receipt as any).txExecutionResultName ?? ''
      const isTerminal = ['ACCEPTED','FINALIZED'].some(s => statusName.toUpperCase().includes(s))
      if (isTerminal) {
        const success = !statusName.toUpperCase().includes('ERROR') && execResult !== 'FINISHED_WITH_ERROR'
        return { success, statusName, txHash, error: success ? undefined : `${statusName}/${execResult}` }
      }
      if (statusName.toUpperCase().includes('UNDETERMINED')) {
        return { success: false, statusName, txHash, error: `${statusName}/${execResult}` }
      }
    } catch {}
  }
  return { success: false, statusName: 'TIMEOUT', txHash, error: 'Timed out' }
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Score {
  exists: string
  address: string
  username: string
  total_score: string
  build_score: string
  voice_score: string
  craft_score: string
  network_score: string
  consistency_score: string
  reasoning: string
  github_url: string
  twitter_url: string
  portfolio_url: string
  last_updated: string
  update_count: string
}

interface LeaderEntry {
  address: string
  username: string
  total_score: string
  build_score: string
  voice_score: string
  craft_score: string
  network_score: string
  consistency_score: string
}

// ── Radar chart ───────────────────────────────────────────────────────────────
function RadarChart({ scores, color }: { scores: number[], color: string }) {
  const cx = 120, cy = 120, r = 90
  const labels = ['BUILD','VOICE','CRAFT','NETWORK','CONSIST.']
  const n = 5
  const angles = labels.map((_, i) => (i * 2 * Math.PI / n) - Math.PI / 2)
  const point = (angle: number, radius: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  })
  // Normalize scores to 0-1 (each max 200)
  const normalized = scores.map(s => Math.min(s / 200, 1))
  const dataPoints = normalized.map((v, i) => point(angles[i], v * r))
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z'
  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1]
  return (
    <svg width="240" height="240" viewBox="0 0 240 240" style={{ overflow: 'visible' }}>
      {/* Grid rings */}
      {rings.map((ring, ri) => {
        const ringPoints = angles.map(a => point(a, ring * r))
        const ringPath = ringPoints.map((p, i) => `${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z'
        return <path key={ri} d={ringPath} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      })}
      {/* Spokes */}
      {angles.map((a, i) => {
        const end = point(a, r)
        return <line key={i} x1={cx} y1={cy} x2={end.x.toFixed(1)} y2={end.y.toFixed(1)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      })}
      {/* Data fill */}
      <path d={dataPath} fill={color} fillOpacity="0.15" stroke={color} strokeWidth="2" />
      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill={color} />
      ))}
      {/* Labels */}
      {labels.map((label, i) => {
        const lp = point(angles[i], r + 18)
        return (
          <text
            key={i}
            x={lp.x}
            y={lp.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="8"
            fontFamily="'Space Mono', monospace"
            letterSpacing="1"
            fill="rgba(255,255,255,0.45)"
          >
            {label}
          </text>
        )
      })}
    </svg>
  )
}

// ── Score card ────────────────────────────────────────────────────────────────
function ScoreCard({ score }: { score: Score }) {
  const total = parseInt(score.total_score)
  const color = scoreColor(total)
  const label = scoreLabel(total)
  const scores = [
    parseInt(score.build_score),
    parseInt(score.voice_score),
    parseInt(score.craft_score),
    parseInt(score.network_score),
    parseInt(score.consistency_score),
  ]
  const dims = [
    { label: 'Build', val: parseInt(score.build_score), max: 200, icon: '⬡' },
    { label: 'Voice', val: parseInt(score.voice_score), max: 200, icon: '◈' },
    { label: 'Craft', val: parseInt(score.craft_score), max: 200, icon: '◆' },
    { label: 'Network', val: parseInt(score.network_score), max: 200, icon: '◉' },
    { label: 'Consistency', val: parseInt(score.consistency_score), max: 200, icon: '◎' },
  ]
  const sa = (a: string) => `${a.slice(0,6)}...${a.slice(-4)}`
  const ago = (ts: number) => {
    const s = Math.floor((Date.now() - ts * 1000) / 1000)
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s/60)}m ago`
    if (s < 86400) return `${Math.floor(s/3600)}h ago`
    return `${Math.floor(s/86400)}d ago`
  }

  return (
    <div style={{ background: T.surface, border: `1px solid ${color}30`, borderRadius: 16, padding: 32, display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* Radar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <RadarChart scores={scores} color={color} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, fontWeight: 700, color, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: 11, letterSpacing: 3, color, marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{label.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>/ 1000</div>
        </div>
      </div>
      {/* Details */}
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, ${color}40, ${color}10)`, border: `1px solid ${color}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>◈</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: T.text }}>{score.username}</div>
            <div style={{ fontSize: 11, color: T.muted, fontFamily: "'Space Mono', monospace" }}>{sa(score.address)}</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 20 }}>
          Updated {ago(parseInt(score.last_updated))} · {score.update_count}× scored
        </div>
        {/* Dimension bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {dims.map(d => (
            <div key={d.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: T.muted, letterSpacing: 1, fontFamily: "'Space Mono', monospace" }}>{d.icon} {d.label.toUpperCase()}</span>
                <span style={{ fontSize: 11, color: scoreColor(d.val * 5), fontFamily: "'Space Mono', monospace" }}>{d.val} <span style={{ color: T.muted }}>/ {d.max}</span></span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(d.val / d.max) * 100}%`, background: scoreColor(d.val * 5), borderRadius: 2, transition: 'width 0.8s ease' }} />
              </div>
            </div>
          ))}
        </div>
        {/* Links */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {score.github_url !== 'none' && <a href={score.github_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.muted, textDecoration: 'none', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 10px' }}>GitHub ↗</a>}
          {score.twitter_url !== 'none' && <a href={score.twitter_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.muted, textDecoration: 'none', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 10px' }}>Twitter/X ↗</a>}
          {score.portfolio_url !== 'none' && <a href={score.portfolio_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.muted, textDecoration: 'none', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 10px' }}>Portfolio ↗</a>}
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Home() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()

  const [tab, setTab] = useState<'score'|'leaderboard'|'verify'>('score')
  const [myScore, setMyScore] = useState<Score | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([])
  const [stats, setStats] = useState<{ total_profiles: string, leaderboard_size: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [txLoading, setTxLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [verifyAddress, setVerifyAddress] = useState('')
  const [verifyScore, setVerifyScore] = useState<Score | null>(null)
  const [verifyLoading, setVerifyLoading] = useState(false)

  // Form state
  const [username, setUsername] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [twitterUrl, setTwitterUrl] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')

  const fetchMyScore = useCallback(async () => {
    if (!address) return
    try {
      const result = await readContract('get_score', [address])
      setMyScore(result as Score)
    } catch {}
  }, [address])

  const fetchLeaderboard = useCallback(async () => {
    try {
      const result = await readContract('get_leaderboard', [])
      setLeaderboard(result as LeaderEntry[])
    } catch {}
  }, [])

  const fetchStats = useCallback(async () => {
    try {
      const result = await readContract('get_stats', [])
      setStats(result as any)
    } catch {}
  }, [])

  useEffect(() => {
    fetchStats()
    fetchLeaderboard()
  }, [fetchLeaderboard, fetchStats])

  useEffect(() => {
    if (address) fetchMyScore()
  }, [address, fetchMyScore])

  async function handleGenerateScore() {
    if (!address || !walletClient) return
    if (!username.trim()) { setErrorMsg('Enter a display name.'); return }
    const hasGithub = githubUrl.trim() && githubUrl.trim() !== 'none'
    const hasTwitter = twitterUrl.trim() && twitterUrl.trim() !== 'none'
    const hasPortfolio = portfolioUrl.trim() && portfolioUrl.trim() !== 'none'
    if (!hasGithub && !hasTwitter && !hasPortfolio) {
      setErrorMsg('Provide at least one profile URL.')
      return
    }
    setTxLoading(true)
    setErrorMsg(null)
    setStatusMsg('Submitting to GenLayer — 5 AI validators will browse your profiles. This takes 2-5 minutes...')
    try {
      const result = await writeContract(address, walletClient, 'generate_score', [
        username.trim(),
        githubUrl.trim() || 'none',
        twitterUrl.trim() || 'none',
        portfolioUrl.trim() || 'none',
      ])
      if (result.success) {
        setStatusMsg('Score generated! Fetching results...')
        await new Promise(r => setTimeout(r, 3000))
        await fetchMyScore()
        await fetchLeaderboard()
        await fetchStats()
        setStatusMsg(null)
      } else {
        setErrorMsg(result.error ?? 'Transaction failed.')
        setStatusMsg(null)
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
      setStatusMsg(null)
    }
    setTxLoading(false)
  }

  async function handleVerify() {
    if (!verifyAddress.trim()) return
    setVerifyLoading(true)
    try {
      const result = await readContract('get_score', [verifyAddress.trim()])
      setVerifyScore(result as Score)
    } catch (e: any) {
      setErrorMsg('Could not fetch score for that address.')
    }
    setVerifyLoading(false)
  }

  const hasScore = myScore?.exists === 'true'
  const canUpdate = hasScore ? (() => {
    const last = parseInt(myScore!.last_updated)
    return (Date.now() / 1000) - last >= 604800
  })() : true

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.border}`,
    borderRadius: 8, padding: '10px 14px', color: T.text, fontSize: 13, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: T.muted, letterSpacing: 1.5, display: 'block', marginBottom: 6, fontFamily: "'Space Mono', monospace" }
  const btnPrimary: React.CSSProperties = {
    background: `linear-gradient(135deg, ${T.gold}, ${T.amber})`,
    color: '#000', border: 'none', borderRadius: 10, padding: '12px 28px',
    fontWeight: 700, fontSize: 13, cursor: txLoading ? 'not-allowed' : 'pointer',
    opacity: txLoading ? 0.6 : 1, letterSpacing: 1, fontFamily: "'Space Mono', monospace",
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Ambient orbs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '10%', left: '15%', width: 500, height: 500, borderRadius: '50%', background: `radial-gradient(circle, ${T.gold}08 0%, transparent 70%)` }} />
        <div style={{ position: 'absolute', bottom: '20%', right: '10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(61,214,140,0.06) 0%, transparent 70%)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 900, margin: '0 auto', padding: '0 20px' }}>
        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 20px', borderBottom: `1px solid ${T.border}` }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${T.gold}, ${T.amber})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>◈</div>
              <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: -0.5 }}>ProofScore</span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2, letterSpacing: 1 }}>AI-VERIFIED REPUTATION · GENLAYER</div>
          </div>
          <ConnectButton />
        </header>

        {/* Stats bar */}
        {stats && (
          <div style={{ display: 'flex', gap: 24, padding: '14px 0', borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 11, color: T.muted }}>
              <span style={{ color: T.gold, fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{stats.total_profiles}</span> profiles scored
            </div>
            <div style={{ fontSize: 11, color: T.muted }}>
              <span style={{ color: T.gold, fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{stats.leaderboard_size}</span> on leaderboard
            </div>
            <div style={{ fontSize: 11, color: T.muted }}>
              <span style={{ color: T.green, fontWeight: 700 }}>● LIVE</span> on Bradbury Testnet
            </div>
          </div>
        )}

        {/* Hero */}
        <div style={{ padding: '48px 0 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: 4, color: T.goldDim, marginBottom: 16, fontFamily: "'Space Mono', monospace" }}>YOUR WORK SPEAKS. NOW IT'S PERMANENT.</div>
          <h1 style={{ fontSize: 'clamp(32px,6vw,56px)', fontWeight: 900, lineHeight: 1.05, margin: 0, letterSpacing: -2 }}>
            Prove what you can do.<br />
            <span style={{ background: `linear-gradient(90deg, ${T.gold}, ${T.amber})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Own it on-chain forever.</span>
          </h1>
          <p style={{ fontSize: 15, color: T.muted, maxWidth: 540, margin: '20px auto 0', lineHeight: 1.7 }}>
            5 independent AI validators browse your GitHub, Twitter, and portfolio — then write a permanent reputation score to the blockchain. No platform can take it away.
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: T.surface, borderRadius: 10, padding: 4, border: `1px solid ${T.border}`, width: 'fit-content' }}>
          {(['score', 'leaderboard', 'verify'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
              fontWeight: 600, letterSpacing: 1, fontFamily: "'Space Mono', monospace",
              background: tab === t ? `linear-gradient(135deg, ${T.gold}20, ${T.amber}10)` : 'transparent',
              color: tab === t ? T.gold : T.muted,
              borderBottom: tab === t ? `2px solid ${T.gold}` : '2px solid transparent',
            }}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* ── SCORE TAB ── */}
        {tab === 'score' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {!address ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', background: T.surface, borderRadius: 16, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>◈</div>
                <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Connect your wallet to get scored</div>
                <div style={{ color: T.muted, fontSize: 13 }}>Your ProofScore is tied to your wallet address — permanent and portable.</div>
              </div>
            ) : (
              <>
                {/* My score display */}
                {hasScore && myScore && (
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 2, color: T.muted, marginBottom: 12, fontFamily: "'Space Mono', monospace" }}>YOUR PROOFSCORE</div>
                    <ScoreCard score={myScore} />
                    {!canUpdate && (
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 10, textAlign: 'center' }}>
                        Score refresh available in ~{Math.ceil((604800 - (Date.now()/1000 - parseInt(myScore.last_updated))) / 86400)} days
                      </div>
                    )}
                  </div>
                )}

                {/* Generate/update form */}
                {(!hasScore || canUpdate) && (
                  <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, padding: 28 }}>
                    <div style={{ fontSize: 11, letterSpacing: 2, color: T.muted, marginBottom: 20, fontFamily: "'Space Mono', monospace" }}>
                      {hasScore ? 'REFRESH YOUR SCORE' : 'GET YOUR PROOFSCORE'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <div>
                        <label style={labelStyle}>DISPLAY NAME *</label>
                        <input style={inputStyle} placeholder="How you appear on the leaderboard" value={username} onChange={e => setUsername(e.target.value)} maxLength={30} />
                      </div>
                      <div>
                        <label style={labelStyle}>GITHUB PROFILE URL</label>
                        <input style={inputStyle} placeholder="https://github.com/yourusername" value={githubUrl} onChange={e => setGithubUrl(e.target.value)} />
                      </div>
                      <div>
                        <label style={labelStyle}>TWITTER / X PROFILE URL</label>
                        <input style={inputStyle} placeholder="https://x.com/yourusername" value={twitterUrl} onChange={e => setTwitterUrl(e.target.value)} />
                      </div>
                      <div>
                        <label style={labelStyle}>PORTFOLIO / WORK URL</label>
                        <input style={inputStyle} placeholder="Website, Behance, Medium, Dribbble, Substack..." value={portfolioUrl} onChange={e => setPortfolioUrl(e.target.value)} />
                      </div>
                      <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
                        Provide at least one URL. AI validators will browse each profile and score your work on 5 dimensions. Takes 2-5 minutes. Score can be refreshed every 7 days.
                      </div>
                      {errorMsg && <div style={{ background: 'rgba(255,79,79,0.1)', border: '1px solid rgba(255,79,79,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: T.red }}>{errorMsg}</div>}
                      {statusMsg && <div style={{ background: `rgba(201,168,76,0.08)`, border: `1px solid ${T.gold}30`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: T.gold }}>{statusMsg}</div>}
                      <button style={btnPrimary} onClick={handleGenerateScore} disabled={txLoading}>
                        {txLoading ? 'AI Validators Working...' : hasScore ? '↻ Refresh ProofScore' : '◈ Generate ProofScore'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── LEADERBOARD TAB ── */}
        {tab === 'leaderboard' && (
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, color: T.muted, marginBottom: 16, fontFamily: "'Space Mono', monospace" }}>TOP PROOFSCORES</div>
            {leaderboard.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, color: T.muted }}>
                No scores yet. Be the first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {leaderboard.map((entry, i) => {
                  const total = parseInt(entry.total_score)
                  const color = scoreColor(total)
                  const sa = (a: string) => `${a.slice(0,6)}...${a.slice(-4)}`
                  const isMe = address && entry.address.toLowerCase() === address.toLowerCase()
                  return (
                    <div key={entry.address} style={{ display: 'flex', alignItems: 'center', gap: 16, background: isMe ? `${color}08` : T.surface, border: `1px solid ${isMe ? color+'30' : T.border}`, borderRadius: 12, padding: '14px 20px' }}>
                      <div style={{ width: 28, textAlign: 'center', fontWeight: 800, fontSize: 13, color: i < 3 ? T.gold : T.muted, fontFamily: "'Space Mono', monospace" }}>
                        {i === 0 ? '◆' : i === 1 ? '◈' : i === 2 ? '◉' : `${i+1}`}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{entry.username} {isMe && <span style={{ fontSize: 10, color: T.gold, background: `${T.gold}15`, padding: '2px 6px', borderRadius: 4 }}>YOU</span>}</div>
                        <div style={{ fontSize: 11, color: T.muted, fontFamily: "'Space Mono', monospace" }}>{sa(entry.address)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        {[
                          { l: 'B', v: parseInt(entry.build_score) },
                          { l: 'V', v: parseInt(entry.voice_score) },
                          { l: 'C', v: parseInt(entry.craft_score) },
                          { l: 'N', v: parseInt(entry.network_score) },
                          { l: 'X', v: parseInt(entry.consistency_score) },
                        ].map(d => (
                          <div key={d.l} style={{ textAlign: 'center', display: 'none' }} className="desktop-only">
                            <div style={{ fontSize: 10, color: T.muted }}>{d.l}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: scoreColor(d.v * 5), fontFamily: "'Space Mono', monospace" }}>{d.v}</div>
                          </div>
                        ))}
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Space Mono', monospace" }}>{total}</div>
                          <div style={{ fontSize: 10, letterSpacing: 1, color, fontFamily: "'Space Mono', monospace" }}>{scoreLabel(total).toUpperCase()}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── VERIFY TAB ── */}
        {tab === 'verify' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: T.muted, fontFamily: "'Space Mono', monospace" }}>VERIFY ANY ADDRESS</div>
            <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, padding: 28 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="0x wallet address"
                  value={verifyAddress}
                  onChange={e => setVerifyAddress(e.target.value)}
                />
                <button onClick={handleVerify} disabled={verifyLoading} style={{ ...btnPrimary, whiteSpace: 'nowrap' }}>
                  {verifyLoading ? 'Checking...' : 'Verify →'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>
                Look up the ProofScore of any wallet — share your own address to let clients verify your reputation.
              </div>
            </div>
            {verifyScore && verifyScore.exists === 'true' && <ScoreCard score={verifyScore} />}
            {verifyScore && verifyScore.exists === 'false' && (
              <div style={{ textAlign: 'center', padding: '40px 20px', background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, color: T.muted }}>
                No ProofScore found for this address.
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        <div style={{ margin: '60px 0 40px', borderTop: `1px solid ${T.border}`, paddingTop: 48 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: T.muted, marginBottom: 28, fontFamily: "'Space Mono', monospace", textAlign: 'center' }}>HOW IT WORKS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {[
              { icon: '◈', title: 'Submit your profiles', desc: 'Provide your GitHub, Twitter, and portfolio URLs. At least one required.' },
              { icon: '⬡', title: '5 AI validators judge', desc: 'Independent GenLayer validators browse each profile and score your actual work — not just numbers.' },
              { icon: '◆', title: 'Consensus on-chain', desc: 'Validators reach consensus. Your ProofScore is written permanently to the blockchain.' },
              { icon: '◉', title: 'Share anywhere', desc: 'Share your wallet address. Clients verify your score instantly — no platform can revoke it.' },
            ].map(item => (
              <div key={item.title} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 24, color: T.gold, marginBottom: 10 }}>{item.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <footer style={{ borderTop: `1px solid ${T.border}`, padding: '24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: 12, color: T.muted }}>ProofScore · Built on GenLayer Bradbury Testnet</div>
          <div style={{ fontSize: 12, color: T.muted }}>by <span style={{ color: T.gold }}>Manablaq</span></div>
        </footer>
      </div>
    </div>
  )
}
