'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'

// ─── Contract config ──────────────────────────────────────────────────────────
const CONTRACT_ADDRESS = '0x0adB982131F14a3b1A7C03Ce9358bAB2442e1C33'
const BRADBURY_CHAIN_ID = '0x107D'
const BRADBURY_RPC = 'https://rpc-bradbury.genlayer.com'

// ─── API reads (server-side genlayer-js) ─────────────────────────────────────
async function readContract(method: string, args: unknown[] = []) {
  const url = `/api/contract?method=${method}&args=${encodeURIComponent(JSON.stringify(args))}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.ok) return data.result
  throw new Error(data.error ?? 'API error')
}

// ─── Wallet + write ───────────────────────────────────────────────────────────
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

async function writeContract(address: string, method: string, args: unknown[] = []) {
  const provider = await getActiveProvider(address)
  const current = await provider.request({ method: 'eth_chainId' })
  if (current.toLowerCase() !== BRADBURY_CHAIN_ID.toLowerCase()) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BRADBURY_CHAIN_ID }] })
    } catch (e: any) {
      if (e?.code === 4902 || e?.code === -32603) {
        await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: BRADBURY_CHAIN_ID, chainName: 'GenLayer Bradbury Testnet', nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 }, rpcUrls: [BRADBURY_RPC], blockExplorerUrls: ['https://explorer-bradbury.genlayer.com'] }] })
      } else throw e
    }
  }
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
          init = { ...init, body: JSON.stringify(parsed.map((r: any) => ({ ...r, id: typeof r.id === 'string' ? parseInt(r.id, 10) || 1 : r.id ?? 1 }))) }
        } else if (parsed && typeof parsed === 'object') {
          init = { ...init, body: JSON.stringify({ ...parsed, id: typeof parsed.id === 'string' ? parseInt(parsed.id, 10) || 1 : parsed.id ?? 1 }) }
        }
      } catch {}
    }
    return fetch(input, init)
  }
  const chain = { ...testnetBradbury, rpcUrls: { default: { http: [BRADBURY_RPC] } } } as any
  const client = createClient({ chain, account: address, provider, fetch: bradburyFetch } as any)
  const txHash = await (client as any).writeContract({ address: CONTRACT_ADDRESS, functionName: method, args })
  const deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const receipt = await (client as any).getTransactionReceipt({ hash: txHash })
      if (!receipt) continue
      const statusName: string = (receipt as any).statusName ?? (receipt as any).status ?? 'UNKNOWN'
      const execResult: string = (receipt as any).txExecutionResultName ?? ''
      const isTerminal = ['ACCEPTED', 'FINALIZED'].some(s => statusName.toUpperCase().includes(s))
      if (isTerminal) {
        const success = !statusName.toUpperCase().includes('ERROR') && execResult !== 'FINISHED_WITH_ERROR'
        return { success, statusName, txHash, error: success ? undefined : `${statusName}/${execResult}` }
      }
      if (statusName.toUpperCase().includes('UNDETERMINED')) return { success: false, statusName, txHash, error: statusName }
    } catch {}
  }
  return { success: false, statusName: 'TIMEOUT', txHash, error: 'Timed out' }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(n: number) {
  if (n >= 800) return '#10b981'
  if (n >= 600) return '#f59e0b'
  if (n >= 300) return '#8b5cf6'
  return '#475569'
}
function scoreLabel(n: number) {
  if (n >= 800) return 'Elite'
  if (n >= 600) return 'Expert'
  if (n >= 400) return 'Skilled'
  if (n >= 200) return 'Rising'
  return 'Unverified'
}
function short(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}` }

// ─── Types ────────────────────────────────────────────────────────────────────
interface Score {
  exists: string; address: string; username: string
  total_score: string; build_score: string; voice_score: string
  craft_score: string; network_score: string; consistency_score: string
  reasoning: string; github_url: string; twitter_url: string; portfolio_url: string
  last_updated: string; update_count: string
}
interface LeaderEntry {
  address: string; username: string; total_score: string
  build_score: string; voice_score: string; craft_score: string
  network_score: string; consistency_score: string
}

// ─── Hex grid canvas ──────────────────────────────────────────────────────────
function HexGrid() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    let W = window.innerWidth, H = window.innerHeight
    c.width = W; c.height = H
    const S = 54
    const cols = Math.ceil(W / (S * 1.5)) + 3
    const rows = Math.ceil(H / (S * Math.sqrt(3))) + 3
    const nodes: { x: number; y: number; phase: number; speed: number }[] = []
    for (let col = -1; col < cols; col++) {
      for (let row = -1; row < rows; row++) {
        const x = col * S * 1.5
        const y = row * S * Math.sqrt(3) + (col % 2) * S * Math.sqrt(3) / 2
        if (Math.random() < 0.28) nodes.push({ x, y, phase: Math.random() * Math.PI * 2, speed: 0.006 + Math.random() * 0.01 })
      }
    }
    let raf: number
    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      // Hex grid
      ctx.strokeStyle = 'rgba(99,102,241,0.055)'
      ctx.lineWidth = 0.5
      for (let col = -1; col < cols; col++) {
        for (let row = -1; row < rows; row++) {
          const cx = col * S * 1.5
          const cy = row * S * Math.sqrt(3) + (col % 2) * S * Math.sqrt(3) / 2
          ctx.beginPath()
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6
            const px = cx + S * 0.93 * Math.cos(a)
            const py = cy + S * 0.93 * Math.sin(a)
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
          }
          ctx.closePath(); ctx.stroke()
        }
      }
      // Node connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < S * 2.8) {
            ctx.beginPath()
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.strokeStyle = `rgba(245,158,11,${(1 - d / (S * 2.8)) * 0.12})`
            ctx.lineWidth = 0.7; ctx.stroke()
          }
        }
      }
      // Pulsing nodes
      nodes.forEach(n => {
        n.phase += n.speed
        const a = (Math.sin(n.phase) + 1) / 2
        const r = 1.8 + a * 2.2
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 5)
        g.addColorStop(0, `rgba(245,158,11,${0.35 * a})`)
        g.addColorStop(1, 'rgba(245,158,11,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(n.x, n.y, r * 5, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(245,158,11,${0.5 + a * 0.5})`; ctx.fill()
      })
      raf = requestAnimationFrame(draw)
    }
    draw()
    const resize = () => { W = c.width = window.innerWidth; H = c.height = window.innerHeight }
    window.addEventListener('resize', resize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
}

// ─── Count-up hook ────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1200, skip = false) {
  const [val, setVal] = useState(skip ? target : 0)
  useEffect(() => {
    if (skip) { setVal(target); return }
    setVal(0)
    const start = Date.now()
    const id = setInterval(() => {
      const t = Math.min((Date.now() - start) / duration, 1)
      setVal(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t >= 1) clearInterval(id)
    }, 16)
    return () => clearInterval(id)
  }, [target, duration, skip])
  return val
}

// ─── Typewriter hook ──────────────────────────────────────────────────────────
function useTypewriter(text: string, speed = 50) {
  const [out, setOut] = useState('')
  useEffect(() => {
    setOut(''); let i = 0
    const id = setInterval(() => { setOut(text.slice(0, ++i)); if (i >= text.length) clearInterval(id) }, speed)
    return () => clearInterval(id)
  }, [text, speed])
  return out
}

// ─── Score ring ───────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 120, animate = false }: { score: number; size?: number; animate?: boolean }) {
  const displayed = useCountUp(score, 1200, !animate)
  const color = scoreColor(score)
  const r = (size - 14) / 2
  const circ = 2 * Math.PI * r
  const dash = circ * Math.min(displayed / 1000, 1)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ filter: `drop-shadow(0 0 5px ${color}90)`, transition: 'stroke-dasharray 0.04s linear' }} />
      <text x={size/2} y={size/2 - 2} textAnchor="middle" dominantBaseline="middle"
        fontSize={size > 100 ? 22 : 13} fontWeight="800" fill={color} fontFamily="'Space Mono', monospace">
        {displayed}
      </text>
      <text x={size/2} y={size/2 + (size > 100 ? 15 : 10)} textAnchor="middle" dominantBaseline="middle"
        fontSize={size > 100 ? 8 : 6} fill="rgba(255,255,255,0.25)" fontFamily="'Space Mono', monospace" letterSpacing="1.5">
        / 1000
      </text>
    </svg>
  )
}

// ─── Dimension bar ────────────────────────────────────────────────────────────
function DimBar({ label, val, max, delay = 0 }: { label: string; val: number; max: number; delay?: number }) {
  const [w, setW] = useState(0)
  useEffect(() => { const t = setTimeout(() => setW((val / max) * 100), delay); return () => clearTimeout(t) }, [val, max, delay])
  const c = scoreColor(val * 5)
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: "'Space Mono', monospace", letterSpacing: '0.1em' }}>{label}</span>
        <span style={{ fontSize: 9, color: c, fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>{val}<span style={{ color: 'rgba(255,255,255,0.2)' }}>/{max}</span></span>
      </div>
      <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${w}%`, background: `linear-gradient(90deg, ${c}70, ${c})`, borderRadius: 1, transition: 'width 1s cubic-bezier(0.34,1.4,0.64,1)', boxShadow: `0 0 8px ${c}50` }} />
      </div>
    </div>
  )
}

// ─── Score card ───────────────────────────────────────────────────────────────
function ScoreCard({ score }: { score: Score }) {
  const total = parseInt(score.total_score)
  const color = scoreColor(total)
  const [swept, setSwept] = useState(false)
  useEffect(() => { const t = setTimeout(() => setSwept(true), 80); return () => clearTimeout(t) }, [])
  return (
    <div style={{ background: 'rgba(8,18,34,0.85)', border: `1px solid ${color}28`, borderRadius: 20, padding: 28, position: 'relative', overflow: 'hidden', backdropFilter: 'blur(12px)' }}>
      {/* Scanline */}
      {swept && <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, transparent, ${color}90, transparent)`, animation: 'scanline 1.4s ease-out forwards', top: 0, zIndex: 5, pointerEvents: 'none' }} />}
      {/* Corner brackets */}
      {(['tl','tr','bl','br'] as const).map(p => (
        <div key={p} style={{ position: 'absolute', width: 14, height: 14,
          top: p[0]==='t' ? 14 : undefined, bottom: p[0]==='b' ? 14 : undefined,
          left: p[1]==='l' ? 14 : undefined, right: p[1]==='r' ? 14 : undefined,
          borderTop: p[0]==='t' ? `1.5px solid ${color}55` : undefined,
          borderBottom: p[0]==='b' ? `1.5px solid ${color}55` : undefined,
          borderLeft: p[1]==='l' ? `1.5px solid ${color}55` : undefined,
          borderRight: p[1]==='r' ? `1.5px solid ${color}55` : undefined,
        }} />
      ))}
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.25)', fontFamily: "'Space Mono', monospace", marginBottom: 4 }}>PROOFSCORE · CREDENTIAL</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#F1F5F9', letterSpacing: '-0.03em' }}>{score.username}</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{short(score.address)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontFamily: "'Space Mono', monospace", marginBottom: 4, letterSpacing: '0.12em' }}>TIER</div>
          <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "'Space Mono', monospace", letterSpacing: '0.08em' }}>{scoreLabel(total).toUpperCase()}</div>
        </div>
      </div>
      {/* Body */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <ScoreRing score={total} size={140} animate />
        <div style={{ flex: 1, minWidth: 160 }}>
          <DimBar label="BUILD" val={parseInt(score.build_score)} max={200} delay={150} />
          <DimBar label="VOICE" val={parseInt(score.voice_score)} max={200} delay={250} />
          <DimBar label="CRAFT" val={parseInt(score.craft_score)} max={200} delay={350} />
          <DimBar label="NETWORK" val={parseInt(score.network_score)} max={200} delay={450} />
          <DimBar label="CONSISTENCY" val={parseInt(score.consistency_score)} max={200} delay={550} />
          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            {score.github_url !== 'none' && <a href={score.github_url} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 5, padding: '3px 9px', fontFamily: "'Space Mono', monospace" }}>GH ↗</a>}
            {score.twitter_url !== 'none' && <a href={score.twitter_url} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 5, padding: '3px 9px', fontFamily: "'Space Mono', monospace" }}>TW ↗</a>}
            {score.portfolio_url !== 'none' && <a href={score.portfolio_url} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 5, padding: '3px 9px', fontFamily: "'Space Mono', monospace" }}>PORT ↗</a>}
          </div>
        </div>
      </div>
      {/* AI Verdict */}
      {score.reasoning && (
        <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', fontFamily: "'Space Mono', monospace", letterSpacing: '0.14em', marginBottom: 10 }}>AI VERDICT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {score.reasoning.split(' | ').map((line, i) => (
              <div key={i} style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, paddingLeft: 10, borderLeft: `2px solid ${color}35` }}>{line}</div>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontFamily: "'Space Mono', monospace" }}>GENLAYER BRADBURY · VERIFIED</span>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontFamily: "'Space Mono', monospace" }}>×{score.update_count}</span>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const { address } = useAccount()
  const [tab, setTab] = useState<'score' | 'leaderboard' | 'verify'>('score')
  const [myScore, setMyScore] = useState<Score | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([])
  const [stats, setStats] = useState<{ total_profiles: string; leaderboard_size: string } | null>(null)
  const [txLoading, setTxLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [twitterUrl, setTwitterUrl] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [verifyAddr, setVerifyAddr] = useState('')
  const [verifyScore, setVerifyScore] = useState<Score | null>(null)
  const [verifyLoading, setVerifyLoading] = useState(false)

  const tagline = useTypewriter('VALIDATOR CONSENSUS ACTIVE.', 60)

  const fetchMyScore = useCallback(async () => {
    if (!address) return
    try { setMyScore(await readContract('get_score', [address])) } catch {}
  }, [address])

  const fetchLeaderboard = useCallback(async () => {
    try { const r = await readContract('get_leaderboard', []); setLeaderboard(Array.isArray(r) ? r : JSON.parse(r)) } catch {}
  }, [])

  const fetchStats = useCallback(async () => {
    try { setStats(await readContract('get_stats', [])) } catch {}
  }, [])

  useEffect(() => { fetchStats(); fetchLeaderboard() }, [fetchStats, fetchLeaderboard])
  useEffect(() => { if (address) fetchMyScore() }, [address, fetchMyScore])

  async function handleGenerate() {
    if (!address) return
    if (!username.trim()) { setErrorMsg('Enter a display name.'); return }
    const hasAny = (githubUrl && githubUrl !== 'none') || (twitterUrl && twitterUrl !== 'none') || (portfolioUrl && portfolioUrl !== 'none')
    if (!hasAny) { setErrorMsg('Provide at least one URL.'); return }
    setTxLoading(true); setErrorMsg(null)
    setStatusMsg('Submitted — 5 AI validators are scanning your profiles...')
    try {
      const result = await writeContract(address, 'generate_score', [username.trim(), githubUrl.trim() || 'none', twitterUrl.trim() || 'none', portfolioUrl.trim() || 'none'])
      if (result.success) {
        setStatusMsg('Score written to chain. Loading...')
        await new Promise(r => setTimeout(r, 3000))
        await fetchMyScore(); await fetchLeaderboard(); await fetchStats()
        setStatusMsg(null)
      } else { setErrorMsg(result.error ?? 'Transaction failed.'); setStatusMsg(null) }
    } catch (e: any) { setErrorMsg(e?.message ?? String(e)); setStatusMsg(null) }
    setTxLoading(false)
  }

  async function handleVerify() {
    if (!verifyAddr.trim()) return
    setVerifyLoading(true); setVerifyScore(null)
    try { setVerifyScore(await readContract('get_score', [verifyAddr.trim()])) } catch {}
    setVerifyLoading(false)
  }

  const hasScore = myScore?.exists === 'true'
  const canUpdate = hasScore ? (Date.now() / 1000 - parseInt(myScore!.last_updated)) >= 604800 : true

  const AMBER = '#F59E0B'
  const CYAN = '#06B6D4'
  const TEXT = '#F1F5F9'
  const MUTED = 'rgba(241,245,249,0.38)'
  const BORDER = 'rgba(255,255,255,0.08)'
  const SURFACE = 'rgba(8,18,34,0.75)'

  const inp: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`,
    borderRadius: 10, padding: '12px 16px', color: TEXT, fontSize: 13,
    outline: 'none', fontFamily: "'Space Grotesk', system-ui, sans-serif",
    boxSizing: 'border-box', transition: 'border-color 0.2s',
  }
  const lbl: React.CSSProperties = {
    display: 'block', marginBottom: 6, fontSize: 9, fontWeight: 700,
    letterSpacing: '0.14em', color: MUTED, textTransform: 'uppercase',
    fontFamily: "'Space Mono', monospace",
  }
  const card: React.CSSProperties = {
    background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16,
    padding: 24, backdropFilter: 'blur(12px)',
  }
  const primaryBtn: React.CSSProperties = {
    padding: '12px 28px', background: AMBER, border: 'none',
    borderRadius: 10, color: '#0a0a0f', fontWeight: 800, fontSize: 13,
    cursor: txLoading ? 'not-allowed' : 'pointer', opacity: txLoading ? 0.6 : 1,
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    letterSpacing: '-0.01em', transition: 'all 0.15s',
    boxShadow: `0 0 28px ${AMBER}35`,
  }

  const tabs = [
    { key: 'score' as const, label: 'MY SCORE', icon: '◈' },
    { key: 'leaderboard' as const, label: 'RANKS', icon: '◆' },
    { key: 'verify' as const, label: 'VERIFY', icon: '⬡' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#030B18', color: TEXT, fontFamily: "'Space Grotesk', system-ui, sans-serif", position: 'relative' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap');
        @keyframes scanline { 0%{top:-2px;opacity:1} 100%{top:101%;opacity:0} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes glowPulse { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:1;transform:scale(1.08)} }
        *{box-sizing:border-box}
        input::placeholder{color:rgba(241,245,249,0.2)}
        input:focus{border-color:rgba(245,158,11,0.45)!important;box-shadow:0 0 0 3px rgba(245,158,11,0.08)!important}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
        .fadeUp{animation:fadeUp 0.5s ease forwards}
        .rank-row{transition:border-color 0.2s,background 0.2s}
        .rank-row:hover{border-color:rgba(245,158,11,0.2)!important}
        @media(max-width:680px){
          .desktop-nav{display:none!important}
          .mobile-nav{display:flex!important}
          .main-wrap{padding-bottom:80px!important}
          .hero-h1{font-size:clamp(32px,9vw,52px)!important}
          .score-body{flex-direction:column!important}
          .lb-dims{display:none!important}
        }
        @media(min-width:681px){.mobile-nav{display:none!important}}
      `}</style>

      <HexGrid />

      {/* ── NAV ── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, backdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(3,11,24,0.88)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px', height: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, ${AMBER}, #D97706)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, boxShadow: `0 0 18px ${AMBER}35`, flexShrink: 0 }}>◈</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.03em', lineHeight: 1.1 }}>ProofScore</div>
              <div style={{ fontSize: 8, color: MUTED, fontFamily: "'Space Mono', monospace", letterSpacing: '0.09em' }}>AI-VERIFIED REPUTATION</div>
            </div>
          </div>
          {/* Desktop tabs */}
          <nav className="desktop-nav" style={{ display: 'flex', gap: 2 }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                background: tab === t.key ? `${AMBER}14` : 'transparent',
                border: tab === t.key ? `1px solid ${AMBER}28` : '1px solid transparent',
                borderRadius: 8, padding: '7px 16px', cursor: 'pointer',
                color: tab === t.key ? AMBER : MUTED, fontSize: 10, fontWeight: 700,
                fontFamily: "'Space Mono', monospace", letterSpacing: '0.08em', transition: 'all 0.15s',
              }}>{t.icon} {t.label}</button>
            ))}
          </nav>
          {/* Right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {stats && (
              <div style={{ fontSize: 9, color: MUTED, fontFamily: "'Space Mono', monospace", display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981', animation: 'glowPulse 2.5s ease infinite' }} />
                {stats.total_profiles} scored
              </div>
            )}
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 20px 44px', position: 'relative', zIndex: 1, animation: 'fadeUp 0.6s ease' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: `${AMBER}10`, border: `1px solid ${AMBER}22`, borderRadius: 6, padding: '4px 12px', marginBottom: 18 }}>
          <span style={{ fontSize: 8, color: AMBER, fontFamily: "'Space Mono', monospace", letterSpacing: '0.14em' }}>GENLAYER BRADBURY TESTNET</span>
        </div>
        <h1 className="hero-h1" style={{ fontSize: 'clamp(36px,5.5vw,74px)', fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.0, margin: '0 0 6px', maxWidth: 780 }}>
          Your work is proof.
        </h1>
        <h1 className="hero-h1" style={{ fontSize: 'clamp(36px,5.5vw,74px)', fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.0, margin: '0 0 22px', maxWidth: 780, color: AMBER }}>
          Now it's permanent.
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 36 }}>
          <span style={{ fontSize: 12, color: MUTED, fontFamily: "'Space Mono', monospace" }}>{tagline}</span>
          <span style={{ animation: 'blink 1s step-end infinite', color: CYAN, fontFamily: "'Space Mono', monospace", fontSize: 14 }}>▌</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setTab('score')} style={{ ...primaryBtn, fontSize: 14, padding: '13px 30px' }}>Get Scored →</button>
          <button onClick={() => setTab('leaderboard')} style={{ padding: '13px 30px', background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, color: TEXT, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'Space Grotesk', sans-serif", transition: 'all 0.15s' }}>
            View Rankings
          </button>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <main className="main-wrap" style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto', padding: '0 20px 80px' }}>

        {/* SCORE */}
        {tab === 'score' && (
          <div className="fadeUp" style={{ maxWidth: 720 }}>
            {!address ? (
              <div style={{ ...card, textAlign: 'center', padding: 64 }}>
                <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.25 }}>◈</div>
                <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 8 }}>Connect your wallet</div>
                <div style={{ color: MUTED, fontSize: 12, marginBottom: 28, maxWidth: 320, margin: '0 auto 28px', fontFamily: "'Space Mono', monospace", lineHeight: 1.7 }}>Your score lives on-chain, tied permanently to your wallet.</div>
                <ConnectButton />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {hasScore && myScore && <ScoreCard score={myScore} />}
                {hasScore && !canUpdate && (
                  <div style={{ ...card, textAlign: 'center', padding: 14 }}>
                    <span style={{ fontSize: 11, color: MUTED, fontFamily: "'Space Mono', monospace" }}>
                      Next refresh in ~{Math.ceil((604800 - (Date.now()/1000 - parseInt(myScore!.last_updated))) / 86400)} days
                    </span>
                  </div>
                )}
                {(!hasScore || canUpdate) && (
                  <div style={card}>
                    <div style={{ fontSize: 8, letterSpacing: '0.16em', color: MUTED, fontFamily: "'Space Mono', monospace", marginBottom: 22 }}>
                      {hasScore ? '// REFRESH_SCORE' : '// GENERATE_SCORE'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                      <div><label style={lbl}>Handle *</label><input style={inp} placeholder="How you appear on the leaderboard" value={username} onChange={e => setUsername(e.target.value)} maxLength={30} /></div>
                      <div><label style={lbl}>GitHub URL</label><input style={inp} placeholder="https://github.com/yourusername" value={githubUrl} onChange={e => setGithubUrl(e.target.value)} /></div>
                      <div><label style={lbl}>Twitter / X URL</label><input style={inp} placeholder="https://x.com/yourusername" value={twitterUrl} onChange={e => setTwitterUrl(e.target.value)} /></div>
                      <div><label style={lbl}>Portfolio / Work URL</label><input style={inp} placeholder="Website, GitHub Pages, Medium, Behance..." value={portfolioUrl} onChange={e => setPortfolioUrl(e.target.value)} /></div>
                      <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.7, padding: '11px 14px', background: `${AMBER}08`, borderRadius: 8, border: `1px solid ${AMBER}14`, fontFamily: "'Space Mono', monospace" }}>
                        At least one URL required. 5 AI validators browse and score your work across 5 dimensions. Takes 2–5 min.
                      </div>
                      {errorMsg && <div style={{ background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: 10, padding: '11px 15px', fontSize: 11, color: '#ef4444', fontFamily: "'Space Mono', monospace" }}>{errorMsg}</div>}
                      {statusMsg && <div style={{ background: `${CYAN}09`, border: `1px solid ${CYAN}22`, borderRadius: 10, padding: '11px 15px', fontSize: 11, color: CYAN, fontFamily: "'Space Mono', monospace" }}>⬡ {statusMsg}</div>}
                      <button style={primaryBtn} onClick={handleGenerate} disabled={txLoading}>
                        {txLoading ? '⟳ Validators Running...' : hasScore ? '↺ Refresh Score' : '◈ Generate ProofScore'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* LEADERBOARD */}
        {tab === 'leaderboard' && (
          <div className="fadeUp" style={{ maxWidth: 880 }}>
            <div style={{ marginBottom: 26, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 8, letterSpacing: '0.16em', color: MUTED, fontFamily: "'Space Mono', monospace", marginBottom: 6 }}>// LEADERBOARD</div>
                <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>Top Builders</h2>
              </div>
              {stats && <span style={{ fontSize: 9, color: MUTED, fontFamily: "'Space Mono', monospace" }}>{stats.leaderboard_size} entries</span>}
            </div>
            {leaderboard.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', padding: 80 }}>
                <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 12 }}>◈</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: MUTED }}>No scores yet. Be the first.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {leaderboard.map((e, i) => {
                  const total = parseInt(e.total_score)
                  const color = scoreColor(total)
                  const isMe = address && e.address.toLowerCase() === address.toLowerCase()
                  return (
                    <div key={e.address} className="rank-row" style={{ display: 'flex', alignItems: 'center', gap: 14, background: isMe ? `${color}07` : SURFACE, border: `1px solid ${isMe ? color+'28' : BORDER}`, borderRadius: 13, padding: '14px 18px', backdropFilter: 'blur(12px)', animation: `fadeUp 0.4s ease ${i * 0.04}s backwards` }}>
                      <div style={{ width: 26, flexShrink: 0, fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 12, color: i < 3 ? ['#F59E0B','#94A3B8','#C97D4A'][i] : MUTED, textAlign: 'center' }}>
                        {i < 3 ? ['◆','◈','⬡'][i] : i+1}
                      </div>
                      <ScoreRing score={total} size={50} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          {e.username}
                          {isMe && <span style={{ fontSize: 8, color: AMBER, background: `${AMBER}14`, padding: '2px 8px', borderRadius: 100, fontFamily: "'Space Mono', monospace", letterSpacing: '0.1em' }}>YOU</span>}
                        </div>
                        <div style={{ fontSize: 9, color: MUTED, fontFamily: "'Space Mono', monospace" }}>{short(e.address)}</div>
                      </div>
                      <div className="lb-dims" style={{ display: 'flex', gap: 10, textAlign: 'center' }}>
                        {[['B',e.build_score],['V',e.voice_score],['C',e.craft_score],['N',e.network_score],['X',e.consistency_score]].map(([l,v]) => (
                          <div key={l as string} style={{ minWidth: 24 }}>
                            <div style={{ fontSize: 7, color: MUTED, fontFamily: "'Space Mono', monospace" }}>{l}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor(parseInt(v as string) * 5), fontFamily: "'Space Mono', monospace" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Space Mono', monospace", letterSpacing: '-0.02em', lineHeight: 1 }}>{total}</div>
                        <div style={{ fontSize: 8, color, fontFamily: "'Space Mono', monospace", letterSpacing: '0.08em' }}>{scoreLabel(total).toUpperCase()}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* VERIFY */}
        {tab === 'verify' && (
          <div className="fadeUp" style={{ maxWidth: 720 }}>
            <div style={{ marginBottom: 26 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.16em', color: MUTED, fontFamily: "'Space Mono', monospace", marginBottom: 6 }}>// VERIFY_ADDRESS</div>
              <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 8px' }}>Verify Any Wallet</h2>
              <p style={{ color: MUTED, fontSize: 11, lineHeight: 1.7, margin: 0, fontFamily: "'Space Mono', monospace" }}>Look up any address. Share yours to prove your reputation anywhere.</p>
            </div>
            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <input style={{ ...inp, flex: 1 }} placeholder="0x wallet address" value={verifyAddr} onChange={e => setVerifyAddr(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleVerify()} />
                <button onClick={handleVerify} disabled={verifyLoading} style={{ ...primaryBtn, whiteSpace: 'nowrap', padding: '12px 20px' }}>
                  {verifyLoading ? '⟳' : 'Scan →'}
                </button>
              </div>
            </div>
            {verifyScore && verifyScore.exists === 'true' && <ScoreCard score={verifyScore} />}
            {verifyScore && verifyScore.exists === 'false' && (
              <div style={{ ...card, textAlign: 'center', padding: 52 }}>
                <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 12 }}>◈</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: MUTED }}>No ProofScore found for this address.</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── MOBILE BOTTOM NAV ── */}
      <div className="mobile-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, display: 'none', background: 'rgba(3,11,24,0.96)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 0 max(10px, env(safe-area-inset-bottom))' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 0', color: tab === t.key ? AMBER : MUTED, transition: 'color 0.15s' }}>
            <span style={{ fontSize: 17 }}>{t.icon}</span>
            <span style={{ fontSize: 8, fontFamily: "'Space Mono', monospace", letterSpacing: '0.08em', fontWeight: 700 }}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Footer */}
      <footer style={{ position: 'relative', zIndex: 1, borderTop: '1px solid rgba(255,255,255,0.05)', padding: '18px 20px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontFamily: "'Space Mono', monospace" }}>PROOFSCORE · AI-VERIFIED ON GENLAYER BRADBURY</span>
          <div style={{ display: 'flex', gap: 18 }}>
            <a href="https://github.com/Manablaq/proofscore" target="_blank" rel="noreferrer" style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', textDecoration: 'none', fontFamily: "'Space Mono', monospace" }}>GITHUB</a>
            <a href="https://x.com/mr_Albert_blaq" target="_blank" rel="noreferrer" style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', textDecoration: 'none', fontFamily: "'Space Mono', monospace" }}>TWITTER</a>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontFamily: "'Space Mono', monospace" }}>MANABLAQ</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
