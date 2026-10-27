/**
 * Site gate — an HTTP Basic Auth wall in front of the whole app.
 *
 * For a single-owner deployment the Supabase login page itself is
 * attack surface: anyone who finds the URL can try passwords, read the
 * JS bundle (which carries the Supabase URL + anon key) and probe the
 * API. The gate asks for a separate username/password before ANY page,
 * static asset or session API is served, so a stranger never even sees
 * the login form.
 *
 * Enabled only when both SITE_GATE_USER and SITE_GATE_PASSWORD are set
 * (server-only env, never NEXT_PUBLIC_). Use a long random password —
 * the browser remembers it, so it costs nothing to make it 32+ chars.
 *
 * Machine callers that carry their own authentication are exempt (see
 * GATE_EXEMPT_PREFIXES): the Meta webhook (HMAC-signed), the cron
 * pingers (shared secret) and the public API (Bearer API keys, which
 * would collide with a Basic `Authorization` header anyway).
 *
 * Brute force: after MAX_FAILURES wrong attempts from one IP within
 * LOCKOUT_WINDOW_MS every request from that IP gets 429 until the
 * window expires — even with the right password. In-memory, so it is
 * per-process (same trade-off as src/lib/rate-limit.ts).
 */

import { NextResponse } from 'next/server'
import { getClientIp } from '@/lib/rate-limit'

export const GATE_EXEMPT_PREFIXES = [
  '/api/whatsapp/webhook',
  '/api/automations/cron',
  '/api/flows/cron',
  '/api/v1/',
] as const

/** Crawlers may still read the "Disallow: /" rules. */
const GATE_EXEMPT_EXACT = ['/robots.txt'] as const

export const MAX_FAILURES = 10
export const LOCKOUT_WINDOW_MS = 15 * 60_000

export interface SiteGateConfig {
  user: string
  password: string
}

export function getSiteGateConfig(): SiteGateConfig | null {
  const user = process.env.SITE_GATE_USER?.trim()
  const password = process.env.SITE_GATE_PASSWORD
  if (!user || !password) return null
  return { user, password }
}

export function isGateExempt(pathname: string): boolean {
  if ((GATE_EXEMPT_EXACT as readonly string[]).includes(pathname)) return true
  return GATE_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

interface FailureEntry {
  count: number
  resetAt: number
}

const failures = new Map<string, FailureEntry>()

function isLockedOut(ip: string, now: number): boolean {
  const entry = failures.get(ip)
  if (!entry) return false
  if (entry.resetAt <= now) {
    failures.delete(ip)
    return false
  }
  return entry.count >= MAX_FAILURES
}

function recordFailure(ip: string, now: number) {
  const entry = failures.get(ip)
  if (!entry || entry.resetAt <= now) {
    failures.set(ip, { count: 1, resetAt: now + LOCKOUT_WINDOW_MS })
  } else {
    entry.count += 1
  }
  // Cheap cap so a spray of spoofed IPs can't grow the Map forever.
  if (failures.size > 10_000) {
    for (const [key, value] of failures) {
      if (value.resetAt <= now) failures.delete(key)
    }
  }
}

/** Test hook — clears the lockout table between cases. */
export function resetSiteGateFailures() {
  failures.clear()
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return new Uint8Array(digest)
}

/** Constant-time string compare (hash first so lengths always match). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i]
  return diff === 0
}

function parseBasicAuth(header: string | null): { user: string; password: string } | null {
  if (!header) return null
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header)
  if (!match) return null
  let decoded: string
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
  const sep = decoded.indexOf(':')
  if (sep < 0) return null
  return { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) }
}

const DENY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
}

/**
 * Returns a 401/429 response when the request must be blocked, or null
 * when it may continue to the normal (Supabase session) checks.
 */
export async function checkSiteGate(request: Request, pathname: string): Promise<NextResponse | null> {
  const config = getSiteGateConfig()
  if (!config || isGateExempt(pathname)) return null

  const ip = getClientIp(request)
  const now = Date.now()

  if (isLockedOut(ip, now)) {
    const retryAfter = Math.max(1, Math.ceil((failures.get(ip)!.resetAt - now) / 1000))
    return new NextResponse('Too many attempts. Try again later.', {
      status: 429,
      headers: { ...DENY_HEADERS, 'Retry-After': String(retryAfter) },
    })
  }

  const credentials = parseBasicAuth(request.headers.get('authorization'))
  if (credentials) {
    const [userOk, passwordOk] = await Promise.all([
      safeEqual(credentials.user, config.user),
      safeEqual(credentials.password, config.password),
    ])
    if (userOk && passwordOk) return null
    recordFailure(ip, now)
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { ...DENY_HEADERS, 'WWW-Authenticate': 'Basic realm="Private", charset="UTF-8"' },
  })
}
