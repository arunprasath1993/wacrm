import { beforeEach, describe, expect, it, vi } from 'vitest'

let storedConfig: Record<string, unknown> | null = null
let callerIsAdmin = true
const getBusinessProfile = vi.fn()
const updateBusinessProfile = vi.fn()
const uploadResumableMedia = vi.fn()
const resolveMetaAppId = vi.fn()

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const ctx = () => ({
    userId: 'user-1',
    accountId: 'acct-1',
    role: callerIsAdmin ? 'admin' : 'viewer',
    account: { id: 'acct-1', name: 'Acme' },
    supabase: {
      from: () => {
        const b: Record<string, unknown> = {}
        b.select = () => b
        b.eq = () => b
        b.maybeSingle = async () => ({ data: storedConfig, error: null })
        return b
      },
    },
  })
  return {
    ...actual,
    getCurrentAccount: vi.fn(async () => ctx()),
    requireRole: vi.fn(async () => {
      if (!callerIsAdmin) throw new actual.ForbiddenError()
      return ctx()
    }),
  }
})

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => {
    if (v === 'bad') throw new Error('bad key')
    return `plain:${v}`
  },
}))
vi.mock('@/lib/whatsapp/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/meta-api')>('@/lib/whatsapp/meta-api')
  return {
    MetaApiError: actual.MetaApiError,
    getBusinessProfile: (args: unknown) => getBusinessProfile(args),
    updateBusinessProfile: (args: unknown) => updateBusinessProfile(args),
    uploadResumableMedia: (args: unknown) => uploadResumableMedia(args),
    resolveMetaAppId: (token: string) => resolveMetaAppId(token),
  }
})

import { MetaApiError } from '@/lib/whatsapp/meta-api'
import { GET, POST } from './route'

const CONNECTED = { phone_number_id: 'pn-1', access_token: 'enc', status: 'connected' }
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function post(parts: { fields?: unknown; photo?: Blob }) {
  const body = new FormData()
  if (parts.fields !== undefined) body.set('fields', JSON.stringify(parts.fields))
  if (parts.photo) body.set('photo', parts.photo, 'me.jpg')
  return POST(new Request('http://localhost/api/whatsapp/business-profile', { method: 'POST', body }))
}

beforeEach(() => {
  storedConfig = CONNECTED
  callerIsAdmin = true
  getBusinessProfile.mockReset().mockResolvedValue({ about: 'Open 9-6' })
  updateBusinessProfile.mockReset().mockResolvedValue(undefined)
  uploadResumableMedia.mockReset().mockResolvedValue({ handle: 'h-1' })
  resolveMetaAppId.mockReset().mockResolvedValue('app-1')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/whatsapp/business-profile', () => {
  it('reports disconnected without calling Meta', async () => {
    storedConfig = null
    const res = await GET()
    expect(await res.json()).toEqual({ state: 'disconnected' })
    expect(getBusinessProfile).not.toHaveBeenCalled()
  })

  it('returns the normalised profile for any member', async () => {
    callerIsAdmin = false
    const res = await GET()
    expect(getBusinessProfile).toHaveBeenCalledWith({ phoneNumberId: 'pn-1', accessToken: 'plain:enc' })
    expect(await res.json()).toEqual({
      state: 'connected',
      profile: {
        about: 'Open 9-6',
        address: '',
        description: '',
        email: '',
        websites: [],
        vertical: '',
        profilePictureUrl: null,
      },
    })
  })

  it('degrades to unavailable with an explained message when Meta fails', async () => {
    getBusinessProfile.mockRejectedValue(
      new MetaApiError('Invalid OAuth', { code: 190, subcode: 463, httpStatus: 401 }),
    )
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/expired/) })
  })

  it('reports a token that cannot be decrypted without calling Meta', async () => {
    storedConfig = { ...CONNECTED, access_token: 'bad' }
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/decrypt/i) })
    expect(getBusinessProfile).not.toHaveBeenCalled()
  })
})

describe('POST /api/whatsapp/business-profile', () => {
  it('is admin-only', async () => {
    callerIsAdmin = false
    const res = await post({ fields: { about: 'x' } })
    expect(res.status).toBe(403)
    expect(updateBusinessProfile).not.toHaveBeenCalled()
  })

  it('updates the text fields and returns the read-back profile', async () => {
    const res = await post({ fields: { about: ' Open 9-6 ' } })
    expect(res.status).toBe(200)
    expect(uploadResumableMedia).not.toHaveBeenCalled()
    expect(updateBusinessProfile).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'plain:enc',
      fields: { about: 'Open 9-6' },
      profilePictureHandle: undefined,
    })
    expect(await res.json()).toMatchObject({ success: true, profile: { about: 'Open 9-6' } })
  })

  it('uploads the photo and passes its handle to Meta', async () => {
    const res = await post({ photo: new Blob([JPEG], { type: 'image/jpeg' }) })
    expect(res.status).toBe(200)
    expect(uploadResumableMedia).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'app-1', accessToken: 'plain:enc', mimeType: 'image/jpeg' }),
    )
    expect(updateBusinessProfile).toHaveBeenCalledWith(
      expect.objectContaining({ fields: {}, profilePictureHandle: 'h-1' }),
    )
  })

  it('refuses a photo that is not really a JPEG/PNG, whatever its type says', async () => {
    const res = await post({ photo: new Blob(['<svg/>'], { type: 'image/jpeg' }) })
    expect(res.status).toBe(400)
    expect(uploadResumableMedia).not.toHaveBeenCalled()
  })

  it('refuses an invalid field before calling Meta', async () => {
    const res = await post({ fields: { websites: ['javascript:alert(1)'] } })
    expect(res.status).toBe(400)
    expect(updateBusinessProfile).not.toHaveBeenCalled()
  })

  it('refuses an empty update', async () => {
    const res = await post({ fields: {} })
    expect(res.status).toBe(400)
  })

  it('resolves the app id from the token only when a photo is sent', async () => {
    await post({ fields: { about: 'x' } })
    expect(resolveMetaAppId).not.toHaveBeenCalled()
    await post({ photo: new Blob([JPEG], { type: 'image/jpeg' }) })
    expect(resolveMetaAppId).toHaveBeenCalledWith('plain:enc')
  })

  it('answers 500 with a META_APP_ID hint when the app id cannot be found', async () => {
    resolveMetaAppId.mockResolvedValue(null)
    const res = await post({ photo: new Blob([JPEG], { type: 'image/jpeg' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/META_APP_ID/)
    expect(uploadResumableMedia).not.toHaveBeenCalled()
    expect(updateBusinessProfile).not.toHaveBeenCalled()
  })

  it('answers 409 when no number is connected', async () => {
    storedConfig = null
    const res = await post({ fields: { about: 'x' } })
    expect(res.status).toBe(409)
  })

  it('surfaces Meta field errors as 400 with Meta wording', async () => {
    updateBusinessProfile.mockRejectedValue(
      new MetaApiError('Param about must be at most 139 characters', { code: 100, httpStatus: 400 }),
    )
    const res = await post({ fields: { about: 'x' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Meta rejected the profile update: Param about/)
  })

  it('still succeeds when the read-back fails', async () => {
    getBusinessProfile.mockRejectedValue(new Error('network'))
    const res = await post({ fields: { about: 'x' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, profile: null })
  })
})
