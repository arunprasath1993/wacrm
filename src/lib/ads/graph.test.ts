import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GRAPH_BASE,
  GraphError,
  friendlySyncError,
  graphGet,
  graphGetAll,
  redactGraphUrl,
} from './graph'

const SECRET = 'SECRET'

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('redactGraphUrl', () => {
  it('strips token, proof and cursors but keeps path and other params', () => {
    const out = redactGraphUrl(
      `${GRAPH_BASE}/act_1/insights?access_token=${SECRET}&appsecret_proof=abc&after=CUR&before=CUR2&limit=50&fields=spend`,
    )
    expect(out).not.toContain(SECRET)
    expect(out).not.toContain('abc')
    expect(out).not.toContain('CUR')
    expect(out).toContain('/act_1/insights')
    expect(out).toContain('limit=50')
    expect(out).toContain('fields=spend')
  })
  it('handles unparsable input', () => {
    expect(redactGraphUrl('not a url access_token=SECRET')).not.toContain(SECRET)
  })
})

describe('friendlySyncError', () => {
  const mk = (code: number, msg = 'x') => new GraphError(msg, { code })
  it('maps codes', () => {
    expect(friendlySyncError(mk(190))).toBe('Meta token expired or invalid. Update it in Settings → Meta Ads.')
    for (const c of [10, 200, 294])
      expect(friendlySyncError(mk(c))).toBe('This token needs the ads_read permission and access to this ad account.')
    expect(friendlySyncError(mk(100, 'Unsupported get request. Object with ID does not exist (Ad Account)'))).toBe(
      'Ad account not found. Check the Ad Account ID.',
    )
    for (const c of [4, 17, 80004, 613])
      expect(friendlySyncError(mk(c))).toBe('Meta rate limit reached. Will retry automatically.')
    expect(friendlySyncError(mk(100, 'bad field'))).toBe('Meta sync failed (error 100).')
    expect(friendlySyncError(new Error('boom'))).toBe('Meta sync failed (error network).')
  })
  it('never leaks tokens', () => {
    const out = friendlySyncError(new Error(`fail https://x?access_token=${SECRET}`))
    expect(out).not.toContain(SECRET)
  })
})

describe('graphGet', () => {
  it('sends token as query param and returns json', async () => {
    const f = vi.fn().mockResolvedValue(jsonRes({ ok: 1 }))
    vi.stubGlobal('fetch', f)
    expect(await graphGet('/act_1/insights', { fields: 'spend' }, SECRET)).toEqual({ ok: 1 })
    const url = String(f.mock.calls[0][0])
    expect(url.startsWith(`${GRAPH_BASE}/act_1/insights?`)).toBe(true)
    expect(url).toContain('access_token=SECRET')
    expect(url).toContain('fields=spend')
  })
  it('throws GraphError with safe message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonRes({ error: { message: `Bad access_token=${SECRET}`, code: 190, error_subcode: 463, type: 'OAuthException', fbtrace_id: 'T1' } }, 400),
      ),
    )
    const err = (await graphGet('/me', {}, SECRET).catch((e) => e)) as GraphError
    expect(err).toBeInstanceOf(GraphError)
    expect(err.code).toBe(190)
    expect(err.subcode).toBe(463)
    expect(err.type).toBe('OAuthException')
    expect(err.fbtraceId).toBe('T1')
    expect(err.message).not.toContain(SECRET)
  })
  it('maps network failure to GraphError without code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`ECONN access_token=${SECRET}`)))
    const err = (await graphGet('/me', {}, SECRET).catch((e) => e)) as GraphError
    expect(err).toBeInstanceOf(GraphError)
    expect(err.code).toBeUndefined()
    expect(err.message).not.toContain(SECRET)
  })
})

describe('graphGetAll', () => {
  it('follows paging.next, calls onPage per page, never logs the secret', async () => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const next1 = `${GRAPH_BASE}/act_1/insights?access_token=${SECRET}&after=C1`
    const next2 = `${GRAPH_BASE}/act_1/insights?access_token=${SECRET}&after=C2`
    const f = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ data: [1], paging: { next: next1 } }))
      .mockResolvedValueOnce(jsonRes({ data: [2], paging: { next: next2 } }))
      .mockResolvedValueOnce(jsonRes({ data: [3] }))
    vi.stubGlobal('fetch', f)
    const onPage = vi.fn().mockResolvedValue(undefined)
    const rows = await graphGetAll<number>('/act_1/insights', {}, SECRET, onPage)
    expect(rows).toEqual([1, 2, 3])
    expect(onPage).toHaveBeenCalledTimes(3)
    expect(f.mock.calls[1][0]).toBe(next1)
    expect(f.mock.calls[2][0]).toBe(next2)
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET)
  })
  it('stops after 200 pages', async () => {
    const next = `${GRAPH_BASE}/x?access_token=${SECRET}&after=C`
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonRes({ data: [], paging: { next } })))
    await expect(graphGetAll('/x', {}, SECRET)).rejects.toThrow('too many pages')
  })
})

describe('failure logging', () => {
  it('logs code, type, subcode, fbtrace_id and no secrets or cursors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonRes({ error: { message: 'm', code: 100, error_subcode: 33, type: 'GraphMethodException', fbtrace_id: 'TRACE' } }, 400),
      ),
    )
    await graphGet('/x', { after: 'CURSORA', before: 'CURSORB' }, SECRET).catch(() => {})
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).toContain('33')
    expect(logged).toContain('TRACE')
    expect(logged).toContain('GraphMethodException')
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain('CURSORA')
    expect(logged).not.toContain('CURSORB')
  })
})
