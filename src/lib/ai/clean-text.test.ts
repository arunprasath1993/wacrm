import { describe, it, expect } from 'vitest'
import { cleanPages, cleanText } from './clean-text'

describe('cleanPages', () => {
  it('removes repeated headers and footers', () => {
    const pages = [1, 2, 3].map(
      (n) => `ACME Corp Handbook\nSection ${n} body text.\nPage ${n} of 3`,
    )
    const out = cleanPages(pages)
    expect(out).not.toContain('ACME Corp Handbook')
    expect(out).not.toContain('Page')
    expect(out).toContain('Section 1 body text.')
    expect(out).toContain('Section 3 body text.')
  })

  it('keeps a line that repeats on fewer than half the pages', () => {
    const out = cleanPages(['Note: bring ID\nA', 'B', 'C'])
    expect(out).toContain('Note: bring ID')
  })

  it('keeps a line repeated on exactly half the pages', () => {
    const out = cleanPages(['Price: ₹499\nA', 'Price: ₹499\nB', 'C', 'D'])
    expect(out.match(/Price: ₹499/g)).toHaveLength(2)
  })

  it('does not drop repeated lines when there are fewer than 3 pages', () => {
    const out = cleanPages(['Same line\nA', 'Same line\nB'])
    expect(out.match(/Same line/g)).toHaveLength(2)
  })
})

describe('cleanText', () => {
  it('drops standalone page numbers but keeps numbers inside content', () => {
    const out = cleanText('Intro\n\n3\n\nPage 4 of 10\n\n- 5 -\n\nPrice: 3')
    expect(out).toBe('Intro\n\nPrice: 3')
  })

  it('strips dot-leader TOC lines', () => {
    expect(cleanText('Refunds ........ 12\n\nBody')).toBe('Body')
  })

  it('joins hyphenated line breaks', () => {
    expect(cleanText('Deposits are refund-\nable on request.')).toBe(
      'Deposits are refundable on request.',
    )
  })

  it('rejoins hard-wrapped paragraph lines but keeps list items and headings on their own lines', () => {
    const out = cleanText(
      '# Returns\nWe accept returns\nwithin 7 days.\n- Unused items\n- With bill\n1. Call us\nA | B',
    )
    expect(out).toBe(
      '# Returns\nWe accept returns within 7 days.\n- Unused items\n- With bill\n1. Call us\nA | B',
    )
  })

  it('collapses runs of blank lines', () => {
    expect(cleanText('A\n\n\n\n\nB')).toBe('A\n\nB')
  })

  it('normalises non-breaking spaces and ligatures', () => {
    expect(cleanText('of ﬁce')).toBe('of fice')
  })
})
