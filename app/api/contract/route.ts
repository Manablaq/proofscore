import { NextRequest, NextResponse } from 'next/server'

const CONTRACT = '0xB7e56dAA26e5f1b6127398d14A3Fa90338A0e4c2'
const RPC = 'https://rpc-bradbury.genlayer.com'

export async function GET(req: NextRequest) {
  const method = req.nextUrl.searchParams.get('method') ?? ''
  const argsParam = req.nextUrl.searchParams.get('args')
  const args = argsParam ? JSON.parse(argsParam) : []
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
    const chain = { ...testnetBradbury, rpcUrls: { default: { http: [RPC] } } } as any
    const client = createClient({ chain, fetch: bradburyFetch } as any)
    const raw = await (client as any).readContract({ address: CONTRACT, functionName: method, args })
    const result = typeof raw === 'string' ? JSON.parse(raw) : raw
    return NextResponse.json({ ok: true, result }, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' }
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
