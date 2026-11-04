import type { SupabaseClient } from '@supabase/supabase-js';

import { ContactError } from '@/lib/api/v1/contacts';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';

export interface ResolvedApp {
  id: string;
  slug: string;
  tagId: string;
}

/**
 * Look up a live app by slug in this account (public API `app` field).
 * A 400 for an unknown/archived app or one whose tag was deleted, so a
 * typo in an integration fails loudly instead of silently dropping the
 * lead's app membership.
 */
export async function resolveAppBySlug(
  db: SupabaseClient,
  accountId: string,
  rawSlug: string
): Promise<ResolvedApp> {
  const slug = rawSlug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
    throw new ContactError("'app' must be an app slug, e.g. \"nixie-crm\"", 400);
  }
  const { data, error } = await db
    .from('crm_apps')
    .select('id, slug, tag_id, archived_at')
    .eq('account_id', accountId)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new ContactError('Failed to look up app', 500);
  if (!data || data.archived_at) {
    throw new ContactError(`Unknown app '${slug}'`, 400);
  }
  if (!data.tag_id) {
    throw new ContactError(
      `App '${slug}' has no tag — open Settings → Apps and re-link it`,
      400
    );
  }
  return { id: data.id as string, slug, tagId: data.tag_id as string };
}

/**
 * Add the app's tag to a contact WITHOUT touching its other tags, and
 * fire "tag added" automations for a newly-joined app (e.g. a welcome
 * template for Nixie CRM sign-ups).
 */
export async function addContactToApp(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  app: ResolvedApp
): Promise<boolean> {
  const result = await addContactTagAndDispatch({
    db,
    accountId,
    contactId,
    tagId: app.tagId,
  });
  return result.added;
}
