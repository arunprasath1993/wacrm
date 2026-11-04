import { extractText, getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'
import { cleanPages, cleanText } from './clean-text'
import { KB_MAX_CHARS, KB_MAX_PAGES } from './kb-files'

// ============================================================
// Knowledge-base file extraction (PDF / DOCX → clean text).
//
// Plain code, no AI calls: uploading a file costs zero tokens. The
// output goes straight into `ai_knowledge_documents.content`, so the
// admin can read and fix it in the existing editor, and `chunkText`
// turns its `#` heading lines into chunk breadcrumbs.
//
// Images and scanned (image-only) PDFs are out of scope — they come
// back as `no_text` rather than an empty document.
// ============================================================

export type KbFileKind = 'pdf' | 'docx'

export type KbExtractErrorCode =
  | 'unsupported'
  | 'corrupt'
  | 'too_many_pages'
  | 'no_text'
  | 'too_long'

export class KbExtractError extends Error {
  readonly code: KbExtractErrorCode
  constructor(code: KbExtractErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'KbExtractError'
    this.code = code
  }
}

export interface KbExtractResult {
  kind: KbFileKind
  text: string
  /** PDF page count; null for DOCX (Word has no fixed pages). */
  pageCount: number | null
}

/**
 * Decide the format from the bytes, not the file name or the
 * browser-reported MIME type, both of which the uploader controls. A ZIP
 * is only provisionally DOCX — mammoth confirms it.
 */
export function sniffKbFile(bytes: Uint8Array): KbFileKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'docx' // PK\x03\x04
  return null
}

export async function extractKbFile(bytes: Uint8Array): Promise<KbExtractResult> {
  const kind = sniffKbFile(bytes)
  if (!kind) throw new KbExtractError('unsupported')

  let text: string
  let pageCount: number | null = null
  if (kind === 'pdf') {
    ;({ text, pageCount } = await extractPdf(bytes))
  } else {
    text = await extractDocx(bytes)
  }

  if (!text) throw new KbExtractError('no_text')
  if (text.length > KB_MAX_CHARS) throw new KbExtractError('too_long')
  return { kind, text, pageCount }
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  let pages: string[]
  let pageCount: number
  try {
    // pdf.js detaches the buffer it's given — hand it a copy so the
    // caller's bytes stay usable.
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    pageCount = pdf.numPages
    if (pageCount > KB_MAX_PAGES) throw new KbExtractError('too_many_pages')
    ;({ text: pages } = await extractText(pdf, { mergePages: false }))
  } catch (err) {
    if (err instanceof KbExtractError) throw err
    throw new KbExtractError('corrupt', errorMessage(err))
  }
  return { text: cleanPages(pages), pageCount }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  let html: string
  try {
    ;({ value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }))
  } catch (err) {
    throw new KbExtractError('corrupt', errorMessage(err))
  }
  return cleanText(htmlToText(html))
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
}

/**
 * mammoth's HTML → the plain-text shape the rest of the KB pipeline
 * understands: `#` heading lines (h1–h3), `- ` list items, `a | b`
 * table rows, blank lines between blocks. mammoth emits a small, regular
 * tag set, so a few regexes cover it without an HTML parser dependency.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<h([1-3])[^>]*>/gi, (_, n: string) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-6]>|<h[4-6][^>]*>/gi, '\n\n')
    .replace(/<\/?(ul|ol)[^>]*>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/?(table|thead|tbody)[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const key = e.toLowerCase()
      if (key in ENTITIES) return ENTITIES[key]
      const code = key.startsWith('#x')
        ? parseInt(key.slice(2), 16)
        : key.startsWith('#')
          ? Number(key.slice(1))
          : NaN
      // Out-of-range code points would throw from fromCodePoint.
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    })
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
