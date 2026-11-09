import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyReferral } from './classify'
import type { ClassifiedReferral, WaReferral } from './types'

const BATCH_SIZE = 500

interface TouchRow {
  id: string
  contact_id: string
  referral: WaReferral | null
}

/**
 * Re-classify an account's 'unknown'-platform touches (e.g. after new
 * PLATFORM_PATTERNS ship). Updates only `platform`, then recomputes the
 * first-touch of each affected contact once. Never throws; returns the
 * number of touches updated.
 */
export async function reclassifyUnknownTouchesWith(
  db: SupabaseClient,
  accountId: string,
  classify: (r: WaReferral) => ClassifiedReferral,
): Promise<number> {
  let updated = 0
  const affected = new Set<string>()
  let lastId: string | null = null

  try {
    // Keyset pagination on id: updated rows leave the 'unknown' set, but unchanged
    // rows stay, so offset paging would skip rows.
    for (;;) {
      let q = db
        .from('contact_touches')
        .select('id, contact_id, referral')
        .eq('account_id', accountId)
        .eq('platform', 'unknown')
        .not('referral', 'is', null)
        .order('id', { ascending: true })
        .limit(BATCH_SIZE)
      if (lastId) q = q.gt('id', lastId)
      const { data, error } = await q
      if (error) {
        console.error('[ads] reclassify read failed', error.code)
        break
      }
      const rows = (data ?? []) as TouchRow[]
      for (const row of rows) {
        if (!row.referral) continue
        const { platform } = classify(row.referral)
        if (platform === 'unknown') continue
        const { error: upErr } = await db
          .from('contact_touches')
          .update({ platform })
          .eq('id', row.id)
          .eq('account_id', accountId)
          .eq('platform', 'unknown')
        if (upErr) {
          console.error('[ads] reclassify update failed', upErr.code)
          continue
        }
        updated++
        affected.add(row.contact_id)
      }
      if (rows.length < BATCH_SIZE) break
      lastId = rows[rows.length - 1].id
    }

    for (const contactId of affected) {
      const { error } = await db.rpc('recompute_contact_first_touch', {
        p_account_id: accountId,
        p_contact_id: contactId,
      })
      if (error) console.error('[ads] reclassify recompute failed', error.code)
    }
  } catch (err) {
    console.error('[ads] reclassify failed', err instanceof Error ? err.name : 'unknown')
  }
  return updated
}

export function reclassifyUnknownTouches(db: SupabaseClient, accountId: string): Promise<number> {
  return reclassifyUnknownTouchesWith(db, accountId, classifyReferral)
}
