import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/autoreply/[conversationId]/reset-count  (admin+)
 *
 * Reset the AI auto-reply counter for one conversation, giving the bot
 * a fresh reply budget on that thread. Only the counter changes — the
 * pause flag, assignment and handoff note are left as they are (use
 * "Resume AI" to hand the thread back to the bot).
 *
 * Owner/Admin only: the cap is a settings-level guard, so lifting it
 * for a thread is an admin decision. Writes go through the RLS-scoped
 * SSR client and are scoped to the caller's account, so a conversation
 * outside it is simply not found (404).
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-reset-count:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params

    const { data, error } = await supabase
      .from('conversations')
      .update({ ai_reply_count: 0 })
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/autoreply/reset-count] update error:', error)
      return NextResponse.json(
        { error: t('ai.updateConversationFailed') },
        { status: 500 },
      )
    }
    if (!data) {
      return NextResponse.json({ error: t('common.conversationNotFound') }, { status: 404 })
    }

    return NextResponse.json({ success: true, ai_reply_count: 0 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
