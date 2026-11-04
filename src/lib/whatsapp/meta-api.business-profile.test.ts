import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getBusinessProfile,
  MetaApiError,
  resolveMetaAppId,
  updateBusinessProfile,
} from './meta-api'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('resolveMetaAppId', () => {
  it('uses META_APP_ID without calling Meta when it is set', async () => {
    vi.stubEnv('META_APP_ID', ' app-env ')
    expect(await resolveMetaAppId('tok')).toBe('app-env')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks GET /app for the token app when META_APP_ID is unset', async () => {
    vi.stubEnv('META_APP_ID', '')
    fetchMock.mockResolvedValue(Response.json({ id: '1234567890' }))
    expect(await resolveMetaAppId('tok')).toBe('1234567890')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/app\?fields=id$/)
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('falls back to debug_token when GET /app fails', async () => {
    vi.stubEnv('META_APP_ID', '')
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: { message: 'nope' } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ data: { app_id: '555', is_valid: true } }))
    expect(await resolveMetaAppId('tok')).toBe('555')
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/debug_token\?input_token=tok$/)
  })

  it('falls back to debug_token when GET /app throws', async () => {
    vi.stubEnv('META_APP_ID', '')
    fetchMock
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(Response.json({ data: { app_id: '555' } }))
    expect(await resolveMetaAppId('tok')).toBe('555')
  })

  it('returns null when neither lookup yields an id', async () => {
    vi.stubEnv('META_APP_ID', '')
    fetchMock
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ error: { message: 'bad token' } }, { status: 400 }))
    expect(await resolveMetaAppId('tok')).toBeNull()
  })
})

describe('getBusinessProfile', () => {
  it('reads the first entry of Meta data array', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: [{ about: 'Open 9-6', messaging_product: 'whatsapp' }] }),
    )
    const profile = await getBusinessProfile({ phoneNumberId: 'pn-1', accessToken: 'tok' })
    expect(profile).toMatchObject({ about: 'Open 9-6' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/pn-1\/whatsapp_business_profile\?fields=.*profile_picture_url/)
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('returns an empty profile when Meta sends no entry', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [] }))
    expect(await getBusinessProfile({ phoneNumberId: 'pn-1', accessToken: 'tok' })).toEqual({})
  })

  it('throws a MetaApiError on failure', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { message: 'Invalid OAuth', code: 190 } }, { status: 401 }),
    )
    await expect(
      getBusinessProfile({ phoneNumberId: 'pn-1', accessToken: 'tok' }),
    ).rejects.toBeInstanceOf(MetaApiError)
  })
})

describe('updateBusinessProfile', () => {
  it('posts only the given fields plus the photo handle', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true }))
    await updateBusinessProfile({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      fields: { about: 'Open 9-6' },
      profilePictureHandle: '4::aW1h',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/pn-1\/whatsapp_business_profile$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      about: 'Open 9-6',
      profile_picture_handle: '4::aW1h',
    })
  })

  it('omits the handle when no photo was uploaded', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true }))
    await updateBusinessProfile({ phoneNumberId: 'pn-1', accessToken: 'tok', fields: { email: '' } })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      messaging_product: 'whatsapp',
      email: '',
    })
  })

  it('throws a MetaApiError on failure', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { message: 'Invalid parameter', code: 100 } }, { status: 400 }),
    )
    await expect(
      updateBusinessProfile({ phoneNumberId: 'pn-1', accessToken: 'tok', fields: { about: 'x' } }),
    ).rejects.toMatchObject({ code: 100 })
  })
})
