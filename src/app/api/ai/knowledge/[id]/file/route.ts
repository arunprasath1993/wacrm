import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { KB_BUCKET } from '@/lib/ai/kb-files'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ai/knowledge/[id]/file — download the original PDF / DOCX
 * of a file-backed document (any member).
 *
 * The bucket is private, so this redirects to a short-lived signed URL
 * rather than exposing a permanent public link.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const { data } = await supabase
      .from('ai_knowledge_documents')
      .select('file_path, file_name')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (!data?.file_path) {
      return NextResponse.json({ error: t('ai.knowledge.noFile') }, { status: 404 })
    }

    const { data: signed, error } = await supabase.storage
      .from(KB_BUCKET)
      .createSignedUrl(data.file_path, 60, { download: data.file_name ?? true })
    if (error || !signed?.signedUrl) {
      console.error('[ai/knowledge/[id]/file] sign error:', error)
      return NextResponse.json({ error: t('ai.knowledge.fileNotFound') }, { status: 404 })
    }
    return NextResponse.redirect(signed.signedUrl, 302)
  } catch (err) {
    return toErrorResponse(err)
  }
}
