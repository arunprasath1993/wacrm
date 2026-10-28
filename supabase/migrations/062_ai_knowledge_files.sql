-- ============================================================
-- 062_ai_knowledge_files.sql — PDF / DOCX uploads for the AI
-- knowledge base (migration 030).
--
-- Admins can upload PDF and Word (.docx) files instead of pasting text.
-- The browser uploads the original into a PRIVATE `ai-knowledge` bucket,
-- then POST /api/ai/knowledge/files extracts + cleans the text in code
-- (no AI tokens) and stores it as a normal `ai_knowledge_documents` row,
-- so chunking, retrieval and editing work exactly as for pasted text.
--
-- 1. `ai-knowledge` bucket — private (KB files are internal business
--    documents, unlike chat/flow media which Meta must fetch), 10 MB,
--    PDF + DOCX only.
-- 2. Storage RLS on the `account-<account_id>/…` first path segment
--    (same convention as 016/023): members read, admins+ write/delete,
--    matching the KB table's own RLS from 030.
-- 3. File metadata columns on `ai_knowledge_documents`. Pasted-text
--    rows keep `source_type = 'text'` and NULL file columns.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-knowledge',
  'ai-knowledge',
  false,
  10485760, -- 10 MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 2. Storage RLS
-- ============================================================
DROP POLICY IF EXISTS "Members can read AI knowledge files" ON storage.objects;
CREATE POLICY "Members can read AI knowledge files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'ai-knowledge'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins can upload AI knowledge files" ON storage.objects;
CREATE POLICY "Admins can upload AI knowledge files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ai-knowledge'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins can delete AI knowledge files" ON storage.objects;
CREATE POLICY "Admins can delete AI knowledge files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'ai-knowledge'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ============================================================
-- 3. File metadata on documents
-- ============================================================
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS file_path   text,
  ADD COLUMN IF NOT EXISTS file_name   text,
  ADD COLUMN IF NOT EXISTS file_size   integer,
  ADD COLUMN IF NOT EXISTS page_count  integer;

ALTER TABLE ai_knowledge_documents
  DROP CONSTRAINT IF EXISTS ai_knowledge_documents_source_type_check;
ALTER TABLE ai_knowledge_documents
  ADD CONSTRAINT ai_knowledge_documents_source_type_check
  CHECK (source_type IN ('text', 'pdf', 'docx'));
