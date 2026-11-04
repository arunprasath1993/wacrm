// ============================================================
// Knowledge-base file upload constants, shared by the settings UI
// (client-side pre-checks) and the import route. Kept free of the
// extraction libraries so importing it doesn't pull pdf.js / mammoth
// into the browser bundle.
// ============================================================

/** Private Storage bucket for original KB files (migration 062). */
export const KB_BUCKET = 'ai-knowledge'

export const KB_MAX_FILE_BYTES = 10 * 1024 * 1024
export const KB_MAX_FILES = 10
export const KB_MAX_PAGES = 300
export const KB_MAX_CHARS = 300_000

/** Extensions the upload picker accepts (`.doc` is deliberately absent). */
export const KB_FILE_EXTENSIONS = ['pdf', 'docx'] as const

/** "Price List.pdf" → "Price List"; null when nothing is left. */
export function titleFromFileName(fileName: string): string | null {
  const title = fileName.replace(/\.[^.]+$/, '').trim().slice(0, 200)
  return title || null
}
