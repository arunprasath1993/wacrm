export type Platform = 'facebook' | 'instagram' | 'whatsapp' | 'unknown'
export type TouchSourceType = 'ad' | 'post' | 'direct' | 'pre_existing'

export interface WaReferral {
  source_url?: string
  source_id?: string
  source_type?: string
  headline?: string
  body?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  ctwa_clid?: string
  welcome_message?: { text?: string }
}

export interface ClassifiedReferral {
  sourceType: 'ad' | 'post'
  platform: Platform
  adId: string | null
}
