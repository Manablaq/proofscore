import { NextRequest, NextResponse } from 'next/server'
import { BRADBURY_RPC, PROOFSCORE_CONTRACT_ADDRESS, PROOFSCORE_IS_CONFIGURED } from '@/lib/config'

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const READ_TRANSACTION_HASH_VARIANT = 'latest-nonfinal'

const READ_METHODS = {
  get_campaign: { args: 1, addressArgs: [] },
  list_campaigns: { args: 0, addressArgs: [] },
  get_submission: { args: 2, addressArgs: [] },
  list_submissions: { args: 1, addressArgs: [] },
  get_challenge: { args: 3, addressArgs: [] },
  list_challenges: { args: 2, addressArgs: [] },
  get_leaderboard: { args: 0, addressArgs: [] },
  list_top_scores: { args: 0, addressArgs: [] },
  get_stats: { args: 0, addressArgs: [] },
} as const

type ReadMethod = keyof typeof READ_METHODS

function parseArgs(argsParam: string | null) {
  if (!argsParam) return []

  try {
    const parsed = JSON.parse(argsParam)
    if (!Array.isArray(parsed)) {
      return { error: 'args must be a JSON array.' }
    }
    return parsed
  } catch {
    return { error: 'args must be valid JSON.' }
  }
}

export async function GET(req: NextRequest) {
  if (!PROOFSCORE_IS_CONFIGURED) {
    return NextResponse.json({ ok: false, error: 'ProofScore v9 contract address is not configured.' }, { status: 503 })
  }
  const method = req.nextUrl.searchParams.get('method') ?? ''
  const argsParam = req.nextUrl.searchParams.get('args')

  if (!(method in READ_METHODS)) {
    return NextResponse.json({ ok: false, error: 'Unsupported contract read method.' }, { status: 400 })
  }

  const args = parseArgs(argsParam)
  if (!Array.isArray(args)) {
    return NextResponse.json({ ok: false, error: args.error }, { status: 400 })
  }

  const spec = READ_METHODS[method as ReadMethod]
  if (args.length !== spec.args) {
    return NextResponse.json({ ok: false, error: `Expected ${spec.args} args for ${method}.` }, { status: 400 })
  }

  for (const idx of spec.addressArgs) {
    if (typeof args[idx] !== 'string' || !ADDRESS_RE.test(args[idx])) {
      return NextResponse.json({ ok: false, error: `Argument ${idx} must be an EVM address.` }, { status: 400 })
    }
  }

  try {
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
    const raw = await (client as any).readContract({
      address: PROOFSCORE_CONTRACT_ADDRESS,
      functionName: method,
      args,
      transactionHashVariant: READ_TRANSACTION_HASH_VARIANT,
    })
    let result = raw
    if (typeof raw === 'string') {
      try {
        result = JSON.parse(raw)
      } catch {
        result = raw
      }
    }
    return NextResponse.json({ ok: true, result }, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' }
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Contract read failed.' }, { status: 500 })
  }
}
