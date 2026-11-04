import { describe, expect, it } from 'vitest'
import {
  checkProfilePhoto,
  parseBusinessProfileUpdate,
  sniffProfilePhoto,
  toBusinessProfile,
} from './business-profile'
import { PROFILE_PHOTO_MAX_BYTES } from './business-profile-fields'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])

describe('parseBusinessProfileUpdate', () => {
  it('keeps only the known fields that were sent, trimmed', () => {
    const r = parseBusinessProfileUpdate({ about: '  Open 9-6  ', unknown: 'x' })
    expect(r).toEqual({ ok: true, value: { about: 'Open 9-6' } })
  })

  it('accepts an empty object (photo-only update)', () => {
    expect(parseBusinessProfileUpdate({})).toEqual({ ok: true, value: {} })
  })

  it('rejects non-object bodies', () => {
    expect(parseBusinessProfileUpdate(null).ok).toBe(false)
    expect(parseBusinessProfileUpdate([]).ok).toBe(false)
    expect(parseBusinessProfileUpdate('about').ok).toBe(false)
  })

  it('rejects an About longer than 139 characters', () => {
    const r = parseBusinessProfileUpdate({ about: 'x'.repeat(140) })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/about.*139/) })
  })

  it('rejects an empty About but allows clearing other text fields', () => {
    expect(parseBusinessProfileUpdate({ about: '   ' }).ok).toBe(false)
    expect(parseBusinessProfileUpdate({ address: '', description: '', email: '' })).toEqual({
      ok: true,
      value: { address: '', description: '', email: '' },
    })
  })

  it('rejects a non-string text field', () => {
    expect(parseBusinessProfileUpdate({ description: 42 }).ok).toBe(false)
  })

  it('rejects a malformed email', () => {
    expect(parseBusinessProfileUpdate({ email: 'not-an-email' }).ok).toBe(false)
    expect(parseBusinessProfileUpdate({ email: 'hi@shiny.in' }).ok).toBe(true)
  })

  it('drops blank websites and caps the list at two http(s) links', () => {
    expect(parseBusinessProfileUpdate({ websites: ['https://a.in', ' ', ''] })).toEqual({
      ok: true,
      value: { websites: ['https://a.in'] },
    })
    expect(parseBusinessProfileUpdate({ websites: ['https://a.in', 'https://b.in', 'https://c.in'] }).ok).toBe(false)
    expect(parseBusinessProfileUpdate({ websites: ['ftp://a.in'] }).ok).toBe(false)
    expect(parseBusinessProfileUpdate({ websites: ['shiny.in'] }).ok).toBe(false)
    expect(parseBusinessProfileUpdate({ websites: 'https://a.in' }).ok).toBe(false)
  })

  it('accepts only categories from Meta enum', () => {
    expect(parseBusinessProfileUpdate({ vertical: 'PROF_SERVICES' })).toEqual({
      ok: true,
      value: { vertical: 'PROF_SERVICES' },
    })
    expect(parseBusinessProfileUpdate({ vertical: 'SOFTWARE' }).ok).toBe(false)
  })
})

describe('profile photo checks', () => {
  it('identifies JPEG and PNG by magic bytes', () => {
    expect(sniffProfilePhoto(JPEG)).toBe('image/jpeg')
    expect(sniffProfilePhoto(PNG)).toBe('image/png')
    expect(sniffProfilePhoto(new TextEncoder().encode('GIF89a'))).toBeNull()
  })

  it('refuses empty, oversized and non-JPEG/PNG photos', () => {
    expect(checkProfilePhoto(new Uint8Array())).not.toBeNull()
    const big = new Uint8Array(PROFILE_PHOTO_MAX_BYTES + 1)
    big.set(JPEG)
    expect(checkProfilePhoto(big)).toMatch(/5 MB/)
    expect(checkProfilePhoto(new TextEncoder().encode('<svg/>'))).not.toBeNull()
    expect(checkProfilePhoto(PNG)).toBeNull()
  })
})

describe('toBusinessProfile', () => {
  it('fills absent fields with empty values', () => {
    expect(toBusinessProfile({})).toEqual({
      about: '',
      address: '',
      description: '',
      email: '',
      websites: [],
      vertical: '',
      profilePictureUrl: null,
    })
  })

  it('maps Meta fields and drops an unknown vertical', () => {
    expect(
      toBusinessProfile({
        about: 'Hi',
        websites: ['https://a.in'],
        vertical: 'UNDEFINED',
        profile_picture_url: 'https://pps.whatsapp.net/p.jpg',
      }),
    ).toMatchObject({
      about: 'Hi',
      websites: ['https://a.in'],
      vertical: '',
      profilePictureUrl: 'https://pps.whatsapp.net/p.jpg',
    })
  })
})
