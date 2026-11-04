import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  blob: null as Blob | null,
  existing: null as { id: string } | null,
  inserted: null as Record<string, unknown> | null,
  insertError: null as { code?: string; message: string } | null,
  download: vi.fn(),
  remove: vi.fn(),
  ingest: vi.fn(),
  extract: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
    supabase: {
      storage: {
        from: () => ({ download: h.download, remove: h.remove }),
      },
      from: () => ({
        // duplicate-path guard
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: h.existing, error: null }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          h.inserted = row
          return {
            select: () => ({
              single: async () =>
                h.insertError
                  ? { data: null, error: h.insertError }
                  : { data: { id: 'doc-1' }, error: null },
            }),
          }
        },
      }),
    },
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 500,
  }),
}))

vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsKey: async () => ({ key: null, corrupt: false }),
}))

vi.mock('@/lib/ai/knowledge', () => ({ ingestDocument: h.ingest }))

vi.mock('@/lib/ai/extract-file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/extract-file')>()),
  extractKbFile: h.extract,
}))

import { POST } from './route'
import { KbExtractError } from '@/lib/ai/extract-file'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

type Res = { status: number; body: Record<string, unknown> }

function importFile(body: unknown) {
  return POST(
    new Request('http://x/api/ai/knowledge/files', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<Res>
}

const PATH = 'account-acc-1/123-Price_List.pdf'

beforeEach(() => {
  __resetRateLimitForTests()
  h.blob = new Blob([new Uint8Array([1, 2, 3])])
  h.existing = null
  h.inserted = null
  h.insertError = null
  h.download.mockReset()
  h.download.mockImplementation(async () => ({ data: h.blob, error: null }))
  h.remove.mockReset()
  h.remove.mockResolvedValue({ error: null })
  h.ingest.mockReset()
  h.ingest.mockResolvedValue({ keywordOnly: false, embedError: null })
  h.extract.mockReset()
  h.extract.mockResolvedValue({ kind: 'pdf', text: 'Tea ₹20', pageCount: 2 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/ai/knowledge/files', () => {
  it('rejects a path outside the caller account', async () => {
    const res = await importFile({ file_path: 'account-other/x.pdf', file_name: 'x.pdf' })
    expect(res.status).toBe(403)
    expect(h.download).not.toHaveBeenCalled()
  })

  it('rejects path traversal inside the account folder', async () => {
    const res = await importFile({
      file_path: 'account-acc-1/../account-other/x.pdf',
      file_name: 'x.pdf',
    })
    expect(res.status).toBe(403)
    expect(h.download).not.toHaveBeenCalled()
  })

  it('requires file_path and file_name', async () => {
    expect((await importFile({ file_path: PATH })).status).toBe(400)
  })

  it('imports a pdf and ingests with the title', async () => {
    const res = await importFile({ file_path: PATH, file_name: 'Price List.pdf' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, id: 'doc-1' })
    expect(h.inserted).toMatchObject({
      account_id: 'acc-1',
      title: 'Price List',
      content: 'Tea ₹20',
      source_type: 'pdf',
      file_path: PATH,
      file_name: 'Price List.pdf',
      file_size: 3,
      page_count: 2,
    })
    expect(h.ingest).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      { embeddingsApiKey: null },
      'doc-1',
      'Tea ₹20',
      'Price List',
    )
    expect(h.remove).not.toHaveBeenCalled()
  })

  it('maps no_text to a 400 and deletes the object', async () => {
    h.extract.mockRejectedValue(new KbExtractError('no_text'))
    const res = await importFile({ file_path: PATH, file_name: 'scan.pdf' })
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toMatch(/scanned/i)
    expect(h.remove).toHaveBeenCalledWith([PATH])
    expect(h.inserted).toBeNull()
  })

  it('rejects files over 10 MB with 413 and deletes the object', async () => {
    h.blob = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])
    const res = await importFile({ file_path: PATH, file_name: 'big.pdf' })
    expect(res.status).toBe(413)
    expect(h.extract).not.toHaveBeenCalled()
    expect(h.remove).toHaveBeenCalledWith([PATH])
  })

  it('returns 409 when the file was already imported', async () => {
    h.existing = { id: 'doc-0' }
    const res = await importFile({ file_path: PATH, file_name: 'Price List.pdf' })
    expect(res.status).toBe(409)
    expect(h.download).not.toHaveBeenCalled()
  })

  it('explains a missing migration when the insert hits an unknown column', async () => {
    h.insertError = { code: 'PGRST204', message: "Could not find the 'file_path' column" }
    const res = await importFile({ file_path: PATH, file_name: 'Price List.pdf' })
    expect(res.status).toBe(500)
    expect(String(res.body.error)).toMatch(/062/)
    expect(h.remove).toHaveBeenCalledWith([PATH])
  })
})
