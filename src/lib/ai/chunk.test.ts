import { describe, it, expect } from 'vitest'
import { chunkText } from './chunk'

describe('chunkText', () => {
  it('returns nothing for empty / whitespace input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  ')).toEqual([])
  })

  it('keeps a short document as a single chunk', () => {
    expect(chunkText('Hello world')).toEqual(['Hello world'])
  })

  it('packs multiple paragraphs up to the char budget', () => {
    const a = 'A'.repeat(400)
    const b = 'B'.repeat(400)
    const c = 'C'.repeat(400)
    // 400 + 2 + 400 = 802 <= 900, but adding c would exceed → new chunk.
    const out = chunkText(`${a}\n\n${b}\n\n${c}`, { maxChars: 900 })
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(`${a}\n\n${b}`)
    expect(out[1]).toBe(c)
  })

  it('hard-splits a paragraph larger than the budget', () => {
    const big = 'x'.repeat(2500)
    const out = chunkText(big, { maxChars: 1000 })
    expect(out).toHaveLength(3)
    expect(out.every((c) => c.length <= 1000)).toBe(true)
    expect(out.join('')).toBe(big)
  })

  it('collapses extra blank lines without emitting an empty chunk', () => {
    // Two short paragraphs pack into one chunk; the extra blank lines
    // must not produce an empty paragraph/chunk.
    const out = chunkText('one\n\n\n\ntwo')
    expect(out).toEqual(['one\n\ntwo'])
  })

  it('defaults to 800 chars', () => {
    const a = 'A'.repeat(500)
    const b = 'B'.repeat(500)
    expect(chunkText(`${a}\n\n${b}`)).toEqual([a, b])
  })

  it('prefixes chunks with title and heading breadcrumb', () => {
    expect(
      chunkText('# Refunds\n\n## Timelines\n\nWithin 7 days.', { title: 'Policy' }),
    ).toEqual(['Policy › Refunds › Timelines:\nWithin 7 days.'])
  })

  it('handles a heading line directly above its paragraph', () => {
    expect(chunkText('# Refunds\nWithin 7 days.')).toEqual([
      'Refunds:\nWithin 7 days.',
    ])
  })

  it('starts a new chunk at each heading', () => {
    expect(chunkText('# A\n\none\n\n# B\n\ntwo')).toEqual(['A:\none', 'B:\ntwo'])
  })

  it('resets deeper headings when a shallower one starts', () => {
    expect(
      chunkText('# A\n\n## A1\n\nx\n\n# B\n\ny', { title: 'T' }),
    ).toEqual(['T › A › A1:\nx', 'T › B:\ny'])
  })

  it('keeps title + last two headings only', () => {
    expect(
      chunkText('# A\n\n## B\n\n### C\n\nbody', { title: 'T' }),
    ).toEqual(['T › B › C:\nbody'])
  })

  it('respects maxChars including the prefix', () => {
    const out = chunkText('x'.repeat(250), { title: 'Title', maxChars: 100 })
    expect(out.length).toBeGreaterThan(1)
    expect(out.every((c) => c.length <= 100 && c.startsWith('Title:\n'))).toBe(true)
    expect(out.map((c) => c.slice('Title:\n'.length)).join('')).toBe('x'.repeat(250))
  })

  it('dedupes identical chunks', () => {
    expect(chunkText('# A\n\nsame\n\n# A\n\nsame')).toEqual(['A:\nsame'])
  })
})
