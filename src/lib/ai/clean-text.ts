// ============================================================
// Knowledge-base text cleaning.
//
// Text pulled out of PDFs / Word files carries layout noise — page
// numbers, running headers and footers, TOC dot-leaders, words split
// across lines, hard-wrapped paragraphs. Every one of those is a token
// the model pays for on every reply that retrieves the chunk, and the
// noise also dilutes keyword matching. This strips the noise and nothing
// else: content lines (prices, policy wording) are never rewritten.
//
// Pure + deterministic, like chunk.ts, so re-ingests are stable.
// ============================================================

const PAGE_NUMBER_RES = [
  /^\s*(page\s+)?\d+(\s*(of|\/)\s*\d+)?\s*$/i,
  /^\s*[-–—]\s*\d+\s*[-–—]\s*$/,
]
const DOT_LEADER_RE = /(\.\s?){4,}\s*\d+\s*$/
const HEADING_RE = /^#{1,6}\s/
const LIST_ITEM_RE = /^([-•*]\s|\d+[.)]\s)/
const TABLE_ROW_RE = / \| /

/**
 * Page-aware clean for PDFs. A running header/footer is the first or
 * last line of a page that recurs on MORE than half the pages (digits
 * ignored, so "Page 3" and "Page 4" match). Only the edge lines are
 * candidates — a body line that happens to repeat is content. Needs at
 * least 3 pages to tell a header from a coincidence.
 */
export function cleanPages(pages: string[]): string {
  const split = pages.map((p) =>
    p
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  )

  const drop = new Set<string>()
  if (split.length >= 3) {
    const counts = new Map<string, number>()
    for (const lines of split) {
      const edges = new Set<string>()
      if (lines.length > 0) edges.add(edgeKey(lines[0]))
      if (lines.length > 1) edges.add(edgeKey(lines[lines.length - 1]))
      for (const key of edges) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const [key, n] of counts) {
      if (n > split.length / 2) drop.add(key)
    }
  }

  const kept = split.map((lines) =>
    lines
      .filter((line, i) => {
        const isEdge = i === 0 || i === lines.length - 1
        return !(isEdge && drop.has(edgeKey(line)))
      })
      .join('\n'),
  )
  return cleanText(kept.join('\n\n'))
}

function edgeKey(line: string): string {
  return line.replace(/\d+/g, '#').toLowerCase()
}

/** Clean already-joined text (DOCX output, or PDF pages after cleanPages). */
export function cleanText(text: string): string {
  const normalised = text
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[   \t]/g, ' ')
    // "refund-\nable" → "refundable". Lower-case continuation only, so
    // a real dash before a new capitalised line survives.
    .replace(/([A-Za-z])-\n([a-z])/g, '$1$2')

  const paragraphs = normalised.split(/\n\s*\n/)
  const out: string[] = []
  for (const para of paragraphs) {
    const lines = para
      .split('\n')
      .map((l) => l.replace(/ {2,}/g, ' ').trim())
      .filter(
        (l) =>
          l &&
          !PAGE_NUMBER_RES.some((re) => re.test(l)) &&
          !DOT_LEADER_RE.test(l),
      )
    if (lines.length === 0) continue

    const merged: string[] = []
    for (const line of lines) {
      const prev = merged[merged.length - 1]
      const joinable =
        prev !== undefined &&
        !isStructural(line) &&
        !HEADING_RE.test(prev) &&
        !TABLE_ROW_RE.test(prev)
      if (joinable) merged[merged.length - 1] = `${prev} ${line}`
      else merged.push(line)
    }
    out.push(merged.join('\n'))
  }
  return out.join('\n\n')
}

function isStructural(line: string): boolean {
  return HEADING_RE.test(line) || LIST_ITEM_RE.test(line) || TABLE_ROW_RE.test(line)
}
