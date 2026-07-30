import { NextRequest, NextResponse } from 'next/server'

const MAX_BYTES = 1_000_000
const MAX_REDIRECTS = 3

function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_000) return false
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || !host || host === 'localhost' || host.endsWith('.localhost')) return false
    return !/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
  } catch { return false }
}

async function fetchPublicText(initialUrl: string) {
  let url = initialUrl
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'text/plain,text/markdown,text/html;q=0.9,*/*;q=0.1' } })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('The Proof URL redirected without a destination.')
      const nextUrl = new URL(location, url).toString()
      if (!isPublicHttpsUrl(nextUrl)) throw new Error('The Proof URL redirected to a non-public HTTPS destination.')
      url = nextUrl
      continue
    }
    if (!response.ok) throw new Error(`The Proof URL returned HTTP ${response.status}.`)
    if (Number(response.headers.get('content-length') ?? '0') > MAX_BYTES) throw new Error('The Proof URL response is too large to verify safely.')
    const body = await response.text()
    if (body.length > MAX_BYTES) throw new Error('The Proof URL response is too large to verify safely.')
    return { finalUrl: url, body }
  }
  throw new Error('The Proof URL redirected too many times.')
}

export async function POST(req: NextRequest) {
  try {
    const { proofUrl, token } = await req.json()
    if (!isPublicHttpsUrl(proofUrl)) return NextResponse.json({ ok: false, error: 'Use a valid, public HTTPS Proof URL.' }, { status: 400 })
    if (typeof token !== 'string' || token.length < 16 || token.length > 600) return NextResponse.json({ ok: false, error: 'The verification token is invalid.' }, { status: 400 })
    const { finalUrl, body } = await fetchPublicText(proofUrl)
    return NextResponse.json({ ok: true, found: body.includes(token), finalUrl }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not check the Proof URL.' }, { status: 502 })
  }
}
