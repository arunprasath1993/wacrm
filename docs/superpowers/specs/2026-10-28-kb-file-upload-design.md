# Knowledge base: PDF / DOCX file upload — design

Date: 2026-10-28 · Status: awaiting approval

## Intent

Today the AI knowledge base (Settings → AI → Knowledge base) only accepts
pasted text: one `title + content` row per document
(`ai_knowledge_documents`, migration 030), chunked by `chunkText` and
retrieved by `retrieveKnowledge` into every draft / auto-reply prompt.

The owner wants to upload their existing **PDF and Word (.docx) files**,
several at once, and have the text prepared for the AI automatically.
They also want it **token-efficient**: AI calls cost money on their own
key, so neither ingest nor reply should waste tokens.

## Goals

1. Upload multiple PDF / DOCX files in one go from the Knowledge base card.
2. Each file becomes one KB document. Title = file name without extension
   (editable later). Text is extracted, cleaned, chunked and indexed with
   the existing pipeline (FTS always, embeddings when a key is set).
3. **Zero AI tokens at ingest.** Extraction and cleaning are plain code.
4. **Fewer tokens per reply** (applies to every KB doc, not only files):
   - cleaner text (no page numbers, repeated headers/footers, broken
     hyphenation, dot-leaders, runs of blank lines);
   - smaller, self-describing chunks (heading breadcrumb prefix);
   - a hard character budget on what `retrieveKnowledge` returns.
5. The extracted text is visible and editable in the existing editor, and
   the original file can be downloaded again.

## Non-goals

- Images and scanned (image-only) PDFs. No OCR, no vision model (owner
  ruled this out for token cost). A PDF with no extractable text fails
  with a clear "looks scanned — no text found" message.
- Legacy `.doc` (Word 97-2003 binary). Rejected with "save as .docx".
- Excel / PowerPoint.
- AI summarisation / rewriting of documents (that was approach B; maybe later).
- Replacing a document's file after upload (delete + re-upload instead).

## Anti-goals

- Changing the business's wording. Prices and policy text must reach the
  model exactly as written: cleaning removes noise only, never content.
- Files publicly readable. KB files are private to the account.
- One bad file sinking the whole batch. Each file succeeds or fails on its own.

## Constraints

- Self-hosted on Hostinger Node hosting behind a site gate. Large request
  bodies through the Next proxy/middleware are risky, so the file bytes
  should not pass through a Next route.
- DB migrations are applied by hand in the Supabase SQL Editor (no CLI).
  The new migration must be idempotent like the others (next number: 062).
- Writes are admin+ (same as today's KB routes and RLS).
- All UI and API strings go in all four catalogues (`en`, `es`, `pt`, `ko`).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Server-side extraction + cleaning + heading-aware chunking. Original kept in Storage. | No AI cost. Exact wording kept. Adds two small server deps. |
| B | A, plus an LLM condenses each doc into compact Q&A at ingest | Smaller prompts later, but a token cost per upload and a risk of dropped or invented details. |
| C | Extract in the browser, send text to the existing POST | No server deps, but heavier client bundle, original file not stored, cleaning logic lives client-side. |

Owner picked **A**.

## Design (decided)

### Upload path: browser → Storage → import route

1. The browser uploads each file directly to a new **private** bucket
   `ai-knowledge` at `account-<account_id>/<timestamp>-<slug>.<ext>`, using
   the same account-scoped path convention as `src/lib/storage/upload-media.ts`.
2. The browser then calls `POST /api/ai/knowledge/files` with
   `{ file_path, file_name }`. The route (admin+, rate-limited like POST):
   - checks that the path's first segment is the caller's `account-<id>`;
   - downloads the object, re-checks size and **magic bytes** (`%PDF-` or a
     ZIP header containing `word/document.xml`);
   - extracts → cleans → inserts the `ai_knowledge_documents` row →
     `ingestDocument` (existing). It reuses the existing warning semantics
     (`savedNotIndexed`, `keyword_only`, …);
   - if extraction fails, deletes the uploaded object and returns a
     per-file error.
3. The client uploads and imports files **sequentially**, showing per-file
   status (uploading / processing / done / failed + reason).

### Limits (builder's call, defaults below)

- 10 files per batch, 10 MB per file (bucket `file_size_limit` matches).
- Extracted text cap: 300k characters. Beyond that, reject with a
  "split the file" message rather than truncating silently.
- PDF page cap: 300.

### Extraction

- PDF: `unpdf` (pure-JS pdf.js build, no native deps). Get per-page text so
  header/footer detection can work page by page.
- DOCX: `mammoth` → HTML → simple HTML-to-text where `h1`–`h3` become
  Markdown `#`/`##`/`###` lines, list items become `- ` lines, and tables
  become `cell | cell` rows. Headings drive the breadcrumbs.

### Cleaning (`src/lib/ai/clean-text.ts`, pure, unit-tested)

- Normalise whitespace and Unicode (NFKC, non-breaking spaces, ligatures).
- Drop lines that repeat on ≥50% of pages (headers/footers). Drop
  standalone page numbers ("3", "Page 3 of 10", "- 3 -").
- Join words hyphenated across line breaks. Rejoin hard-wrapped lines
  inside a paragraph.
- Strip dot-leader TOC lines ("Refunds ........ 12").
- Collapse 3+ blank lines into one paragraph break.

### Chunking (extend `chunkText`)

- Track the current heading path while splitting. Prefix every chunk with
  a breadcrumb such as `Returns Policy › Timelines:`, using the doc title
  plus up to two headings, so a small chunk still says what it is about.
  This also helps FTS match on heading words.
- Lower the default chunk size from 1200 to about 800 characters. Existing
  pasted docs keep their old chunks until they are edited or reindexed.
  Reindex already exists.
- Skip duplicate chunks within a document.

### Retrieval budget (`retrieveKnowledge`)

- Keep `k = 5`, and add a total budget of about **3,200 characters**
  (roughly 800 tokens). Add excerpts in rank order until the budget is
  reached. Today's worst case is 5 × 1200 = 6,000 characters.

### Data model — migration `062_ai_knowledge_files.sql`

- Bucket `ai-knowledge`: `public = false`, 10 MB, mime types `application/pdf`
  and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
  Storage RLS: read for account members, insert/delete for account admins,
  matched on the `account-<uuid>` first path segment (same pattern as 023).
- `ai_knowledge_documents` gets new nullable columns: `source_type text NOT
  NULL DEFAULT 'text' CHECK (source_type IN ('text','pdf','docx'))`,
  `file_path text`, `file_name text`, `file_size integer`, `page_count integer`.

### API changes

- `POST /api/ai/knowledge/files`: new, described above.
- `GET /api/ai/knowledge`: also returns `source_type, file_name, file_size`.
- `GET /api/ai/knowledge/[id]/file`: new; any member; redirects to a
  short-lived signed URL (60 s) for the original file.
- `DELETE /api/ai/knowledge/[id]`: also removes the Storage object
  (best-effort; the row delete is what matters).
- `PATCH` is unchanged. Editing a file document's text re-ingests it and
  keeps the file reference.

### UI (`src/components/settings/ai-knowledge.tsx`)

- Add an "Upload files" button next to "Add document", plus a drop zone.
  It uses a hidden `<input type="file" multiple accept=".pdf,.docx">`.
- Show the per-file progress list described above.
- In the document list, show a PDF/DOCX badge, the file size, and a
  download icon for file docs. Edit and delete work as they do now.
- Help text names the supported formats and limits, and says scanned
  PDFs and images aren't supported yet.

## Left to the builder

- Exact cleaning heuristics and thresholds, as long as the anti-goal holds
  (never drop real content). Cover each rule with unit tests.
- HTML-to-text implementation for mammoth output: hand-rolled is fine, and
  no new dependency is needed for it.
- Test fixtures: generate a tiny PDF and DOCX inside the tests, or commit
  small fixture files.
- Whether the import route uses the caller's client or the service role
  for the Storage download. RLS must still enforce account scope either way.

## Rollout notes

- The owner runs `062_ai_knowledge_files.sql` in the Supabase SQL Editor
  before deploying, and the code must fail gracefully if the columns or
  bucket are missing.
- New deps: `unpdf`, `mammoth`. Both are pure JS and fine on Hostinger Node 22.
