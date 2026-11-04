import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument, type IngestResult } from '@/lib/ai/knowledge'
import { extractKbFile, KbExtractError, type KbExtractResult } from '@/lib/ai/extract-file'
import { KB_BUCKET, KB_MAX_FILE_BYTES, titleFromFileName } from '@/lib/ai/kb-files'
import { AiError } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ai/knowledge/files  (admin+)
 *
 * Import a PDF / DOCX the browser already uploaded to the private
 * `ai-knowledge` bucket (migration 062). Body: `{ file_path, file_name }`.
 *
 * The bytes go browser → Storage directly, never through this route, so
 * large files don't depend on the host's proxy body limits. Here we
 * download the object, sniff + extract + clean it in code (no AI
 * tokens), store the text as a normal KB document, and index it.
 *
 * On any failure after the upload the object is removed, so a rejected
 * file never lingers in the bucket. Response shape matches
 * POST /api/ai/knowledge (`warning` / `keyword_only` on degraded indexing).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const filePath = typeof body?.file_path === 'string' ? body.file_path : ''
    const fileName = typeof body?.file_name === 'string' ? body.file_name.trim() : ''
    if (!filePath || !fileName) {
      return NextResponse.json(
        { error: t('ai.knowledge.fileBodyRequired') },
        { status: 400 },
      )
    }
    // Storage RLS also scopes reads to the caller's account, but check
    // here too so a foreign path is refused before any I/O.
    if (
      !filePath.startsWith(`account-${accountId}/`) ||
      filePath.split('/').some((seg: string) => seg === '..' || seg === '.')
    ) {
      return NextResponse.json(
        { error: t('ai.knowledge.forbiddenPath') },
        { status: 403 },
      )
    }

    // One document per object: deleting a document removes its file,
    // so two rows sharing a path would break each other.
    const { data: existing } = await supabase
      .from('ai_knowledge_documents')
      .select('id')
      .eq('account_id', accountId)
      .eq('file_path', filePath)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: t('ai.knowledge.alreadyImported') },
        { status: 409 },
      )
    }

    const bucket = supabase.storage.from(KB_BUCKET)
    const discard = async () => {
      const { error } = await bucket.remove([filePath])
      if (error) console.error('[ai/knowledge/files] cleanup failed:', error)
    }

    const { data: blob, error: dlErr } = await bucket.download(filePath)
    if (dlErr || !blob) {
      console.error('[ai/knowledge/files] download error:', dlErr)
      return NextResponse.json(
        { error: t('ai.knowledge.fileNotFound') },
        { status: 404 },
      )
    }
    if (blob.size > KB_MAX_FILE_BYTES) {
      await discard()
      return NextResponse.json(
        { error: t('ai.knowledge.fileTooLarge', { mb: KB_MAX_FILE_BYTES / 1024 / 1024 }) },
        { status: 413 },
      )
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())

    let extracted: KbExtractResult
    try {
      extracted = await extractKbFile(bytes)
    } catch (err) {
      await discard()
      if (err instanceof KbExtractError) {
        if (err.code === 'corrupt') {
          console.error('[ai/knowledge/files] corrupt file:', err.message)
        }
        return NextResponse.json(
          { error: t(`ai.knowledge.extract.${err.code}`) },
          { status: 400 },
        )
      }
      throw err
    }

    const title = titleFromFileName(fileName) ?? t('ai.knowledge.untitledFile')
    const { data: doc, error } = await supabase
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        created_by: userId,
        title,
        content: extracted.text,
        source_type: extracted.kind,
        file_path: filePath,
        file_name: fileName,
        file_size: bytes.length,
        page_count: extracted.pageCount,
      })
      .select('id')
      .single()
    if (error || !doc) {
      console.error('[ai/knowledge/files] insert error:', error)
      await discard()
      // PGRST204 / 42703: the file columns don't exist — 062 not applied.
      const missingColumns = error?.code === 'PGRST204' || error?.code === '42703'
      return NextResponse.json(
        {
          error: missingColumns
            ? t('ai.knowledge.migrationMissing')
            : t('ai.knowledge.saveDocFailed'),
        },
        { status: 500 },
      )
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
      supabase,
      accountId,
    )
    let ingest: IngestResult
    try {
      ingest = await ingestDocument(
        supabase,
        accountId,
        { embeddingsApiKey },
        doc.id,
        extracted.text,
        title,
      )
    } catch (err) {
      const message = err instanceof AiError ? err.message : t('ai.knowledge.indexingFailed')
      console.error('[ai/knowledge/files] ingest error:', err)
      return NextResponse.json({
        success: true,
        id: doc.id,
        warning: t('ai.knowledge.savedNotIndexed', { message }),
      })
    }
    if (ingest.keywordOnly) {
      const message =
        ingest.embedError instanceof AiError
          ? ingest.embedError.message
          : t('ai.knowledge.indexingFailed')
      console.error('[ai/knowledge/files] embedding error:', ingest.embedError)
      return NextResponse.json({
        success: true,
        id: doc.id,
        keyword_only: true,
        warning: t('ai.knowledge.savedIndexFailed', { message }),
      })
    }
    if (corrupt) {
      return NextResponse.json({
        success: true,
        id: doc.id,
        warning: t('ai.knowledge.savedKeywordOnly'),
      })
    }
    return NextResponse.json({ success: true, id: doc.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
