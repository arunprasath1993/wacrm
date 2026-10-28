# KB PDF / DOCX Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins upload PDF/DOCX files into the AI knowledge base, extracted and cleaned in code (zero AI tokens), with smaller, budgeted retrieval for every reply.

**Architecture:** Browser uploads each file to a private `ai-knowledge` Storage bucket, then calls `POST /api/ai/knowledge/files`, which downloads the file, sniffs it, extracts text (`unpdf` / `mammoth`), cleans it, inserts an `ai_knowledge_documents` row and runs the existing `ingestDocument`. Chunking gains heading breadcrumbs and smaller chunks; retrieval gains a character budget.

**Tech Stack:** Next 16 route handlers, Supabase (Postgres + Storage), vitest, `unpdf`, `mammoth`, next-intl.

**Spec:** `docs/superpowers/specs/2026-10-28-kb-file-upload-design.md`

## Global Constraints

- Formats: `.pdf` (`application/pdf`) and `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) only; `.doc` rejected with "save as .docx".
- Limits: 10 files per batch, 10 MB per file, 300 PDF pages, 300,000 extracted characters (reject, never truncate).
- Chunk default `maxChars` 800 (was 1200). Retrieval: `k = 5`, total budget 3,200 characters.
- Zero AI calls during extraction/cleaning. Cleaning never removes real content.
- Writes admin+; bucket private; object paths `account-<account_id>/<timestamp>-<slug>.<ext>`.
- Every new UI/API string in `messages/{en,es,pt,ko}.json` (files are CRLF — preserve).
- Migration `062_ai_knowledge_files.sql` idempotent; code must degrade if not yet applied.

## Review Focus

1. Import path pointing at another account's folder (`account-<other>/x.pdf`) → 403, nothing read.
2. A `.docx` renamed to `.pdf` (or random bytes) → sniffed by magic bytes, clear "unsupported/corrupt file" error, object deleted.
3. Scanned PDF with no text layer → "no text found — scanned PDF?" error, object deleted, no empty document row.
4. One bad file in a batch of several → others still import; UI shows per-file failure.
5. Same file name uploaded twice → two separate documents/objects, no overwrite.

---

### Task 1: Text cleaning

**Files:** Create `src/lib/ai/clean-text.ts`, Test `src/lib/ai/clean-text.test.ts`

**Interfaces — Produces:**
- `cleanPages(pages: string[]): string` — page-aware clean (PDF): drops lines that (after trimming and collapsing digits to `#`) appear on more than 50% of pages when `pages.length >= 3`, then runs `cleanText` on the joined pages.
- `cleanText(text: string): string` — NFKC, NBSP→space, standalone page-number lines removed (`/^\s*(page\s+)?\d+(\s*(of|\/)\s*\d+)?\s*$/i`, `/^\s*[-–]\s*\d+\s*[-–]\s*$/`), dot-leader lines (`/\.{4,}\s*\d+\s*$/`) removed, `word-\nword` joined, single newlines inside a paragraph joined with a space unless the next line starts a list item (`- `, `• `, `\d+[.)] `) or a Markdown heading (`#`) or a table row (contains ` | `), 3+ newlines → `\n\n`, trailing spaces trimmed.

- [ ] Step 1: Tests: `removes repeated headers and footers` (3 pages each starting "ACME Corp Handbook" and ending "Page N of 3" → neither in output, body kept); `keeps a line that repeats on fewer than half the pages`; `drops standalone page numbers but keeps "Price: 3"`; `strips dot-leader TOC lines`; `joins hyphenated line breaks` ("refund-\nable" → "refundable"); `rejoins hard-wrapped paragraph lines but keeps list items and headings on their own lines`; `collapses runs of blank lines`; `keeps a line repeated on exactly half the pages` ("Price: ₹499" on 2 of 4 pages survives — threshold is strictly more than half).
- [ ] Step 2: run `npx vitest run src/lib/ai/clean-text.test.ts` → FAIL (module missing).
- [ ] Step 3: implement.
- [ ] Step 4: same command → PASS.

### Task 2: Heading-aware chunking

**Files:** Modify `src/lib/ai/chunk.ts`, `src/lib/ai/knowledge.ts` (ingest signature), `src/app/api/ai/knowledge/route.ts`, `src/app/api/ai/knowledge/[id]/route.ts`, `src/app/api/ai/knowledge/reindex/route.ts` (+ its test's docs fixture gains `title`). Test: existing chunk tests (find with `grep -rl chunkText src --include=*.test.ts`) + new cases.

**Interfaces — Produces:**
- `chunkText(content: string, opts?: { maxChars?: number; title?: string }): string[]` — default `maxChars` 800. Paragraph lines matching `/^#{1,3}\s+(.+)$/` are headings: they set the heading path (level 1 resets 2/3, level 2 resets 3) and flush the current chunk; they are not emitted as chunk text on their own. Every chunk is prefixed with `"<crumb>:\n"` where crumb = `[title, ...headings].filter(Boolean)` keeping title + last two headings joined by ` › `; no prefix when crumb is empty. Prefix length counts toward `maxChars`. Identical chunks (after prefix) within one document are emitted once.
- `ingestDocument(db, accountId, config, documentId, content, title?: string)` — passes `title` to `chunkText`. All three routes pass the document title (PATCH: fetch current title when only content changes — use the `.select('id, title')` on the update result).

- [ ] Step 1: Tests: `prefixes chunks with title and heading breadcrumb` (`"# Refunds\n\n## Timelines\n\nWithin 7 days."`, title "Policy" → `["Policy › Refunds › Timelines:\nWithin 7 days."]`); `starts a new chunk at each heading`; `keeps title + last two headings only`; `no prefix without title or headings` (existing behaviour preserved); `respects maxChars including the prefix`; `dedupes identical chunks`; `defaults to 800 chars`.
- [ ] Step 2: run chunk tests → FAIL.
- [ ] Step 3: implement; update callers and reindex route (`select('id, title, content')`).
- [ ] Step 4: `npx vitest run src/lib/ai src/app/api/ai/knowledge` → PASS.

### Task 3: Retrieval budget

**Files:** Modify `src/lib/ai/knowledge.ts`; Test `src/lib/ai/knowledge.test.ts`.

**Interfaces — Produces:** `retrieveKnowledge(db, accountId, config, queryText, k = 5, budgetChars = 3200)` — after semantic + lexical picking, take excerpts in rank order while the running total of `content.length` stays ≤ `budgetChars`; always include the first excerpt even if it alone exceeds the budget (truncated to `budgetChars`).

- [ ] Step 1: Tests: `stops adding excerpts once the character budget is reached` (5 × 1000-char rows → 3 returned); `always returns the top excerpt, truncated to the budget`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: run → PASS.

### Task 4: File extraction

**Files:** Create `src/lib/ai/extract-file.ts`; Test `src/lib/ai/extract-file.test.ts`. `npm i unpdf mammoth`.

**Interfaces — Produces:**
- `type KbFileKind = 'pdf' | 'docx'`
- `sniffKbFile(bytes: Uint8Array): KbFileKind | null` — `%PDF-` prefix → pdf; ZIP `PK\x03\x04` → docx (confirmed later by mammoth); else null.
- `extractKbFile(bytes: Uint8Array): Promise<{ kind: KbFileKind; text: string; pageCount: number | null }>` — throws `KbExtractError` with `code: 'unsupported' | 'too_many_pages' | 'no_text' | 'too_long' | 'corrupt'`. PDF: `unpdf` `getDocumentProxy` + `extractText(pdf, { mergePages: false })`, reject `> 300` pages, `cleanPages`. DOCX: `mammoth.convertToHtml({ buffer })` → `htmlToText` → `cleanText`. Empty after clean → `no_text`; `> 300_000` chars → `too_long`.
- `htmlToText(html: string): string` (exported for tests) — `h1–h3` → `#`/`##`/`###` lines, `li` → `- ` lines, `tr` → cells joined with ` | `, `p`/`br`/block ends → newlines, tags stripped, entities `&amp; &lt; &gt; &quot; &#39; &nbsp;` decoded.
- `export const KB_MAX_FILE_BYTES = 10 * 1024 * 1024`, `KB_MAX_FILES = 10`, `KB_MAX_PAGES = 300`, `KB_MAX_CHARS = 300_000`.

- [ ] Step 1: Tests: `sniffs pdf, zip, and rejects other bytes`; `htmlToText converts headings, lists and tables`; `extracts text from a DOCX` (build fixture in-test with `jszip` — a mammoth dependency — containing minimal `[Content_Types].xml`, `_rels/.rels`, `word/document.xml` with a `Heading1` paragraph + body paragraph; expect `# Refunds` and body); `extracts text from a PDF` (hand-written single-page PDF string with `BT /F1 12 Tf (Refunds within 7 days) Tj ET`, xref offsets computed in-test); `throws no_text for a PDF without text`; `throws unsupported for random bytes`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: run → PASS.

### Task 5: Migration 062

**Files:** Create `supabase/migrations/062_ai_knowledge_files.sql`.

Contents (idempotent): bucket `ai-knowledge` (`public false`, `file_size_limit 10485760`, the two mime types, `ON CONFLICT DO UPDATE`); storage policies on `storage.objects` for `bucket_id = 'ai-knowledge'`: SELECT for members (`EXISTS profiles p WHERE p.user_id = auth.uid() AND 'account-'||p.account_id = (storage.foldername(name))[1]`), INSERT/DELETE additionally `AND p.account_role IN ('owner','admin')`; `ALTER TABLE ai_knowledge_documents ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'text'`, `file_path text`, `file_name text`, `file_size integer`, `page_count integer`; check constraint `ai_knowledge_documents_source_type_check` (drop-if-exists then add) `source_type IN ('text','pdf','docx')`. Header comment in the style of 030.

- [ ] Step 1: write file. Step 2: in the handoff, tell the owner to run it in the Supabase SQL Editor before deploying.

### Task 6: API routes

**Files:** Create `src/app/api/ai/knowledge/files/route.ts` (+ `route.test.ts`), `src/app/api/ai/knowledge/[id]/file/route.ts`; Modify `src/app/api/ai/knowledge/route.ts` (GET select adds `source_type, file_name, file_size`; on error code `42703` fall back to old select), `src/app/api/ai/knowledge/[id]/route.ts` (DELETE: select `file_path` first, remove object best-effort after row delete). Add `Api.ai.knowledge.*` strings.

**Interfaces — Consumes:** Task 4 `extractKbFile`, `KbExtractError`, limits; Task 2 `ingestDocument(..., title)`.
**Produces:**
- `POST /api/ai/knowledge/files` body `{ file_path: string, file_name: string }` → `200 { success: true, id, warning? , keyword_only? }` | `400 { error }` (bad body / extract errors, mapped per `code`) | `403` (path not under `account-<accountId>/`) | `413` (object > 10 MB). Admin+, rate limit key `ai-kb:${userId}`. Download via the caller's `supabase.storage.from('ai-knowledge').download(path)`. On any failure after download, remove the object. Title = `file_name` without extension, trimmed, max 200 chars, fallback "Document".
- `GET /api/ai/knowledge/[id]/file` → `302` redirect to `createSignedUrl(file_path, 60, { download: file_name })`, `404` when no file.

- [ ] Step 1: Tests for files route (mock style of `reindex/route.test.ts`): `rejects a path outside the caller's account` (403, download not called); `imports a pdf and ingests with the title` (ingest called with `'Price List'` for `Price List.pdf`); `maps no_text to a 400 and deletes the object`; `rejects files over 10 MB with 413`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: `npx vitest run src/app/api/ai/knowledge` → PASS.

### Task 7: UI + strings

**Files:** Modify `src/components/settings/ai-knowledge.tsx`, `messages/{en,es,pt,ko}.json` (`Settings.aiKnowledge.*`).

- "Upload files" button (Upload icon) beside "Add document", hidden `<input type="file" multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">`, and drag-drop onto the card content (highlight while dragging).
- Client checks before upload: ≤ 10 files (toast, take none), each ≤ 10 MB and extension pdf/docx (`.doc` → "save as .docx" message); invalid ones listed as failed, valid ones proceed.
- Sequential per file: `uploadAccountMedia('ai-knowledge', file)` → `POST /files` → status row (`uploading | processing | done | failed` + message, warnings shown as warning). After the batch, `fetchDocs()`; done rows can be dismissed ("Clear").
- List rows: `FileText` icon + `PDF`/`DOCX` badge + human file size for file docs; download button → `window.open('/api/ai/knowledge/<id>/file')`.
- Help line under the buttons: supported formats + limits + "scanned PDFs and images aren't supported yet".

- [ ] Step 1: implement + strings in 4 locales. Step 2: `npx tsc --noEmit`, `npx eslint` on touched files, `npx vitest run` → all green (known flaky: `src/app/api/ai/usage/route.test.ts` timeout under full-suite load).
- [ ] Step 3: manual check in the browser: upload a real PDF + DOCX, see them listed, open/edit extracted text, download original, delete.
