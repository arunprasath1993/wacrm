import type { SupabaseClient } from '@supabase/supabase-js'
import { syncMetaAds, isSyncDue } from './meta-sync'
import { testMetaConnection } from './graph'

// Re-export syncMetaAds for external use (e.g., API routes)
export { syncMetaAds } from './meta-sync'

/**
 * Run sync for all accounts where `isSyncDue` returns true.
 * Uses the service-role client (passed as `db`).
 */
export async function runDueSyncs(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<void> {
  const { data: configs, error } = await db
    .from('meta_ads_config')
    .select('account_id, last_synced_at, last_sync_failed_at')
  if (error) throw error

  for (const cfg of configs ?? []) {
    if (isSyncDue(cfg, 6, now)) {
      await syncMetaAds(db, cfg.account_id, { now })
    }
  }
}

/**
 * Idempotent scheduler starter. Sets a 30-minute interval; the first run
 * fires after 60 seconds so the server can finish booting.
 */
let started = false
export function startAdsScheduler(): void {
  if (started) return
  started = true

  setTimeout(() => {
    runDueSyncs(getSupabaseAdmin()).catch((err) => {
      console.error('[ads] scheduled sync failed', err instanceof Error ? err.name : 'unknown')
    })
  }, 60_000)

  setInterval(() => {
    runDueSyncs(getSupabaseAdmin()).catch((err) => {
      console.error('[ads] scheduled sync failed', err instanceof Error ? err.name : 'unknown')
    })
  }, 30 * 60_000)
}

// Lazy admin client import to avoid circular deps
const getSupabaseAdmin = (() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _adminClient: any = null
  return () => {
    if (!_adminClient) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require('@supabase/supabase-js')
      _adminClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
    }
    return _adminClient
  }
})()