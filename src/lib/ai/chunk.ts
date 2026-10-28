// ============================================================
// Knowledge-base chunking.
//
// Splits a document into retrieval-sized pieces. Paragraph-aware
// (FAQ/policy docs are naturally paragraph-delimited, and each Q&A stays
// intact), greedily packed up to `maxChars`, with oversized paragraphs
// hard-split as a fallback. Pure + deterministic so it's trivially
// testable and produces stable chunk boundaries across re-ingests.
//
// Markdown-style heading lines (`#`..`###`, which the PDF/DOCX extractor
// emits for Word headings) start a new chunk and are carried as a
// breadcrumb prefix — `Policy › Refunds › Timelines:` — so a small chunk
// still says what it is about. That keeps chunks small (fewer prompt
// tokens per retrieved excerpt) without losing their context, and puts
// heading words in the FTS index of every chunk under that heading.
// ============================================================

const DEFAULT_MAX_CHARS = 800
const HEADING_RE = /^(#{1,3})\s+(.+)$/
const MAX_CRUMB_CHARS = 120

export function chunkText(
  content: string,
  opts: { maxChars?: number; title?: string } = {},
): string[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const title = opts.title?.trim() ?? ''
  const text = content.replace(/\r\n/g, '\n').trim()
  if (!text) return []

  const chunks: string[] = []
  const seen = new Set<string>()
  const headings: string[] = [] // index = level - 1
  let paragraphs: string[] = []

  // Whole repeated sections (a FAQ pasted twice, a boilerplate block on
  // every page) are emitted once. Hard-split windows are not deduped —
  // they're consecutive slices of one paragraph, so dropping one would
  // cut content out of the middle.
  const emit = (chunk: string, dedupe = true) => {
    if (dedupe && seen.has(chunk)) return
    seen.add(chunk)
    chunks.push(chunk)
  }

  // Pack the paragraphs gathered under the current heading path.
  const flushSection = () => {
    if (paragraphs.length === 0) return
    const crumb = [title, ...headings.filter(Boolean).slice(-2)]
      .filter(Boolean)
      .join(' › ')
      .slice(0, MAX_CRUMB_CHARS)
    const prefix = crumb ? `${crumb}:\n` : ''
    const budget = Math.max(maxChars - prefix.length, 1)

    let current = ''
    const flush = () => {
      const trimmed = current.trim()
      if (trimmed) emit(prefix + trimmed)
      current = ''
    }
    for (const para of paragraphs) {
      if (para.length > budget) {
        // Paragraph alone exceeds the budget — flush what we have, then
        // hard-split it into fixed windows.
        flush()
        for (let i = 0; i < para.length; i += budget) {
          const slice = para.slice(i, i + budget).trim()
          if (slice) emit(prefix + slice, false)
        }
        continue
      }
      // +2 accounts for the "\n\n" joiner we add between paragraphs.
      if (current && current.length + 2 + para.length > budget) flush()
      current = current ? `${current}\n\n${para}` : para
    }
    flush()
    paragraphs = []
  }

  let lines: string[] = []
  const endParagraph = () => {
    const para = lines.join('\n').trim()
    if (para) paragraphs.push(para)
    lines = []
  }

  for (const line of text.split('\n')) {
    const heading = HEADING_RE.exec(line.trim())
    if (heading) {
      endParagraph()
      flushSection()
      const level = heading[1].length
      headings.length = level - 1
      headings[level - 1] = heading[2].trim()
    } else if (!line.trim()) {
      endParagraph()
    } else {
      lines.push(line)
    }
  }
  endParagraph()
  flushSection()

  return chunks
}
