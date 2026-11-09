/**
 * Small Meta Marketing API (Graph) client for ad analytics sync.
 *
 * Security: Graph `paging.next` URLs and some error bodies carry
 * `access_token`. Nothing here logs or returns a user-facing message that
 * contains the token, cursors (`after`/`before`) or `appsecret_proof`.
 */

export const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

const MAX_PAGES = 200
const SENSITIVE_PARAMS = ['access_token', 'appsecret_proof', 'after', 'before']

export class GraphError extends Error {
  code?: number
  subcode?: number
  type?: string
  fbtraceId?: string
  /** True when Meta's raw message mentioned an ad account (checked pre-scrub). */
  adAccountHint = false

  constructor(
    message: string,
    opts: { code?: number; subcode?: number; type?: string; fbtraceId?: string; adAccountHint?: boolean } = {},
  ) {
    super(message)
    this.name = 'GraphError'
    this.code = opts.code
    this.subcode = opts.subcode
    this.type = opts.type
    this.fbtraceId = opts.fbtraceId
    this.adAccountHint = opts.adAccountHint ?? /ad account/i.test(message)
  }
}

/** Removes access_token=..., appsecret_proof=... and long token-like strings. */
function scrub(text: string): string {
  return text
    .replace(/(access_token|appsecret_proof|after|before)=[^&\s"']*/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
}

export function redactGraphUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const p of SENSITIVE_PARAMS) u.searchParams.delete(p)
    return u.toString()
  } catch {
    return scrub(url)
  }
}

export function friendlySyncError(err: unknown): string {
  const code = err instanceof GraphError ? err.code : undefined
  if (code === 190) return 'Meta token expired or invalid. Update it in Settings → Meta Ads.'
  if (code === 10 || code === 200 || code === 294)
    return 'This token needs the ads_read permission and access to this ad account.'
  if (code === 100 && err instanceof GraphError && err.adAccountHint)
    return 'Ad account not found. Check the Ad Account ID.'
  if (code === 4 || code === 17 || code === 80004 || code === 613)
    return 'Meta rate limit reached. Will retry automatically.'
  return `Meta sync failed (error ${code ?? 'network'}).`
}

async function request<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    // Never echo the underlying error: it may embed the URL with the token.
    console.error('[ads/graph] network failure', redactGraphUrl(url))
    throw new GraphError('Network error calling Meta Graph API')
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const e = (body as { error?: { message?: string; code?: number; error_subcode?: number; type?: string; fbtrace_id?: string } } | null)?.error

  if (!res.ok || e) {
    const raw = e?.message ?? ''
    const err = new GraphError(e?.code != null ? `Graph error ${e.code}` : `Graph HTTP ${res.status}`, {
      code: e?.code,
      subcode: e?.error_subcode,
      type: e?.type,
      fbtraceId: e?.fbtrace_id,
      adAccountHint: /ad account/i.test(raw),
    })
    console.error('[ads/graph] request failed', redactGraphUrl(url), {
      code: err.code,
      type: err.type,
      fbtrace_id: err.fbtraceId,
    })
    throw err
  }
  return body as T
}

export async function graphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token })
  return request<T>(`${GRAPH_BASE}${path}?${qs.toString()}`)
}

export async function graphGetAll<T>(
  path: string,
  params: Record<string, string>,
  token: string,
  onPage?: () => Promise<void>,
): Promise<T[]> {
  const out: T[] = []
  const qs = new URLSearchParams({ ...params, access_token: token })
  let url: string | undefined = `${GRAPH_BASE}${path}?${qs.toString()}`
  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES) throw new GraphError('Graph pagination: too many pages')
    const body: { data?: T[]; paging?: { next?: string } } = await request(url)
    if (Array.isArray(body.data)) out.push(...body.data)
    await onPage?.()
    url = body.paging?.next
  }
  return out
}
