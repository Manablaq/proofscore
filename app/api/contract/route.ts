import { NextRequest, NextResponse } from 'next/server'

const CONTRACT = '0x9A93A3Cd425A0Ee1b7e2347b8Dd8b53b208F9Aad'
const RPC = 'https://rpc-bradbury.genlayer.com'

async function callContract(method: string, args: unknown[] = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'gen_call', params: [{ to: CONTRACT, data: { function: method, args } }, 'latest'] }),
    next: { revalidate: 30 },
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message ?? 'RPC error')
  const result = data.result
  if (typeof result === 'string') { try { return JSON.parse(result) } catch { return result } }
  return result
}

export async function GET(req: NextRequest) {
  const method = req.nextUrl.searchParams.get('method') ?? ''
  const argsParam = req.nextUrl.searchParams.get('args')
  const args = argsParam ? JSON.parse(argsParam) : []
  try {
    const result = await callContract(method, args)
    return NextResponse.json({ ok: true, result }, { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
