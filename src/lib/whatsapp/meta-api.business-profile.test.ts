import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBusinessProfile, MetaApiError, updateBusinessProfile } from './meta-api'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
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
