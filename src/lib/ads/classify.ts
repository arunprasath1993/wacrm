import type { ClassifiedReferral, Platform, WaReferral } from './types'

export type PlatformPattern = { host: RegExp; platform: Exclude<Platform, 'unknown'> }

// Fill ONLY from real captured payloads at Checkpoint A (spec section 2 platform rule):
// never guess URL patterns. While empty, every referral classifies as platform 'unknown'.
export const PLATFORM_PATTERNS: ReadonlyArray<PlatformPattern> = []

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function platformFor(url: string | undefined, patterns: ReadonlyArray<PlatformPattern>): Platform {
  const host = hostnameOf(url)
  if (!host) return 'unknown'
  const matched = new Set<Platform>()
  for (const p of patterns) {
    if (p.host.test(host)) matched.add(p.platform)
  }
  // Shared host across platforms is ambiguous: never guess.
  return matched.size === 1 ? [...matched][0] : 'unknown'
}

export function classifyReferralWith(
  referral: WaReferral,
  patterns: ReadonlyArray<PlatformPattern>,
): ClassifiedReferral {
  const isAd = referral.source_type === 'ad' && !!referral.source_id
  return {
    sourceType: isAd ? 'ad' : 'post',
    platform: platformFor(referral.source_url, patterns),
    adId: isAd ? (referral.source_id as string) : null,
  }
}

export function classifyReferral(referral: WaReferral): ClassifiedReferral {
  return classifyReferralWith(referral, PLATFORM_PATTERNS)
}
