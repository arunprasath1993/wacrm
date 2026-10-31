import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Meta's sync payload only carries an expiring sample URL for a media header,
// and the send builder needs `header_media_url`. A template approved on Meta
// and pulled in by sync therefore failed every send with "image header
// requires a media link or id" until sync started mirroring that sample.
// ---------------------------------------------------------------------------

const SAMPLE_URL = 'https://scontent.test/sample.jpg?oe=abc'
const MIRRORED_URL = 'https://cdn.test/template-headers/m-1.jpg'

/** The row sync finds locally, or null for a template new to this app. */
let existingRow: { id: string; header_media_url: string | null } | null = null

const templateUpdates: Record<string, unknown>[] = []
const templateInserts: Record<string, unknown>[] = []

function makeSupabaseMock() {
  function builder(table: string) {
    const result = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: 'admin' },
            error: null,
          }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'whatsapp_config':
          return {
            data: { account_id: 'acct-1', waba_id: 'WABA-1', access_token: 'enc-token' },
            error: null,
          }
        case 'message_templates':
          return { data: existingRow, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = vi.fn(chain)
    b.update = vi.fn((patch: Record<string, unknown>) => {
      if (table === 'message_templates') templateUpdates.push(patch)
      return b
    })
    b.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === 'message_templates') templateInserts.push(row)
      return b
    })
    b.single = vi.fn(async () => result())
    b.maybeSingle = vi.fn(async () => result())
    b.then = (resolve: (v: unknown) => unknown) => resolve({ error: null })
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
    storage: { from: vi.fn() },
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { whatsappAdmin: {} },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plain-token'),
}))
vi.mock('@/lib/whatsapp/template-header-mirror', () => ({
  mirrorTemplateHeaderMedia: vi.fn(),
}))

import { POST } from './route'
import { mirrorTemplateHeaderMedia } from '@/lib/whatsapp/template-header-mirror'

const mirrorMock = vi.mocked(mirrorTemplateHeaderMedia)

function metaTemplate(header: Record<string, unknown>) {
  return {
    id: 'm-1',
    name: 'diwali_offer',
    language: 'ta',
    status: 'APPROVED',
    category: 'MARKETING',
    components: [header, { type: 'BODY', text: 'hello' }],
  }
}

const IMAGE_HEADER = {
  type: 'HEADER',
  format: 'IMAGE',
  example: { header_handle: [SAMPLE_URL] },
}

function stubMeta(template: ReturnType<typeof metaTemplate>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [template] }),
    })),
  )
}

describe('POST /api/whatsapp/templates/sync — media headers', () => {
  beforeEach(() => {
    supabaseMock = makeSupabaseMock()
    existingRow = null
    templateUpdates.length = 0
    templateInserts.length = 0
    mirrorMock.mockReset()
    mirrorMock.mockResolvedValue(MIRRORED_URL)
    stubMeta(metaTemplate(IMAGE_HEADER))
  })

  it('stores a durable URL on a template new to this app', async () => {
    const res = await POST()

    expect(res.status).toBe(200)
    expect(mirrorMock).toHaveBeenCalledWith({
      storage: supabaseMock.storage,
      accountId: 'acct-1',
      metaTemplateId: 'm-1',
      kind: 'image',
      sampleUrl: SAMPLE_URL,
    })
    expect(templateInserts[0].header_media_url).toBe(MIRRORED_URL)
  })

  it('backfills a row synced before media mirroring existed', async () => {
    existingRow = { id: 'row-1', header_media_url: null }

    await POST()

    expect(templateUpdates[0].header_media_url).toBe(MIRRORED_URL)
  })

  it('keeps the URL already on the row and skips the download', async () => {
    existingRow = { id: 'row-1', header_media_url: 'https://cdn.test/mine.jpg' }

    await POST()

    expect(mirrorMock).not.toHaveBeenCalled()
    expect(templateUpdates[0]).not.toHaveProperty('header_media_url')
  })

  it('reports a failed mirror without failing the rest of the sync', async () => {
    existingRow = { id: 'row-1', header_media_url: null }
    mirrorMock.mockResolvedValue(null)

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.updated).toBe(1)
    expect(body.errors).toEqual([
      expect.objectContaining({ name: 'diwali_offer', language: 'ta' }),
    ])
    expect(templateUpdates[0]).not.toHaveProperty('header_media_url')
  })

  it('does not attempt a mirror when Meta returns no sample', async () => {
    stubMeta(metaTemplate({ type: 'HEADER', format: 'IMAGE' }))

    const body = await (await POST()).json()

    expect(mirrorMock).not.toHaveBeenCalled()
    expect(body.errors).toEqual([])
  })

  it('leaves non-media headers alone', async () => {
    stubMeta(metaTemplate({ type: 'HEADER', format: 'TEXT', text: 'Hi' }))

    await POST()

    expect(mirrorMock).not.toHaveBeenCalled()
  })
})
