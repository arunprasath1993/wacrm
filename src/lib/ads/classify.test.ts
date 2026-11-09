import { describe, it, expect } from 'vitest'
import { classifyReferral, classifyReferralWith, PLATFORM_PATTERNS } from './classify'

describe('classifyReferral (shipped patterns)', () => {
  it('PLATFORM_PATTERNS starts empty', () => {
    expect(PLATFORM_PATTERNS).toHaveLength(0)
  })

  it('ad with id -> ad, platform unknown', () => {
    expect(
      classifyReferral({ source_type: 'ad', source_id: '120', source_url: 'https://www.instagram.com/p/x' }),
    ).toEqual({ sourceType: 'ad', adId: '120', platform: 'unknown' })
  })

  it('post -> post with null adId', () => {
    expect(classifyReferral({ source_type: 'post', source_id: '55' })).toEqual({
      sourceType: 'post',
      adId: null,
      platform: 'unknown',
    })
  })

  it('missing source_type -> post', () => {
    expect(classifyReferral({ source_id: '9' }).sourceType).toBe('post')
    expect(classifyReferral({ source_id: '9' }).adId).toBeNull()
  })

  it('unrecognised source_type -> post', () => {
    expect(classifyReferral({ source_type: 'story', source_id: '9' }).sourceType).toBe('post')
  })

  it('ad without source_id -> post', () => {
    expect(classifyReferral({ source_type: 'ad' })).toEqual({ sourceType: 'post', adId: null, platform: 'unknown' })
    expect(classifyReferral({ source_type: 'ad', source_id: '' }).sourceType).toBe('post')
  })

  it('invalid URL -> unknown', () => {
    expect(classifyReferral({ source_type: 'ad', source_id: '1', source_url: 'not a url' }).platform).toBe('unknown')
  })
})

describe('classifyReferralWith (injected patterns)', () => {
  const patterns = [
    { host: /(^|\.)instagram\.com$/, platform: 'instagram' as const },
    { host: /(^|\.)facebook\.com$/, platform: 'facebook' as const },
  ]

  it('www.instagram.com -> instagram', () => {
    expect(classifyReferralWith({ source_url: 'https://www.instagram.com/p/abc' }, patterns).platform).toBe('instagram')
  })

  it('m.facebook.com -> facebook', () => {
    expect(classifyReferralWith({ source_url: 'https://m.facebook.com/x' }, patterns).platform).toBe('facebook')
  })

  it('host matching two different platforms -> unknown', () => {
    const shared = [
      { host: /example\.com$/, platform: 'facebook' as const },
      { host: /^fb\.example\.com$/, platform: 'instagram' as const },
    ]
    expect(classifyReferralWith({ source_url: 'https://fb.example.com/a' }, shared).platform).toBe('unknown')
  })

  it('host matching two entries of the same platform -> that platform', () => {
    const same = [
      { host: /facebook\.com$/, platform: 'facebook' as const },
      { host: /^m\./, platform: 'facebook' as const },
    ]
    expect(classifyReferralWith({ source_url: 'https://m.facebook.com/' }, same).platform).toBe('facebook')
  })

  it('no match / missing URL -> unknown', () => {
    expect(classifyReferralWith({ source_url: 'https://other.com/' }, patterns).platform).toBe('unknown')
    expect(classifyReferralWith({}, patterns).platform).toBe('unknown')
  })
})
