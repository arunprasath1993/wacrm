import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { extractKbFile, htmlToText, KbExtractError, sniffKbFile } from './extract-file'

/** Minimal one-page PDF whose content stream is `stream` (offsets computed). */
function makePdf(stream: string): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefAt = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

async function makeDocx(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  )
  zip.file(
    'word/styles.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>',
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Refunds</w:t></w:r></w:p><w:p><w:r><w:t>Within 7 days &amp; with bill.</w:t></w:r></w:p></w:body></w:document>',
  )
  return zip.generateAsync({ type: 'uint8array' })
}

async function extractError(bytes: Uint8Array): Promise<KbExtractError> {
  try {
    await extractKbFile(bytes)
  } catch (err) {
    if (err instanceof KbExtractError) return err
    throw err
  }
  throw new Error('expected extractKbFile to throw')
}

describe('sniffKbFile', () => {
  it('sniffs pdf, zip, and rejects other bytes', () => {
    expect(sniffKbFile(new TextEncoder().encode('%PDF-1.7 ...'))).toBe('pdf')
    expect(sniffKbFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe('docx')
    expect(sniffKbFile(new TextEncoder().encode('hello'))).toBeNull()
  })
})

describe('htmlToText', () => {
  it('converts headings, lists and tables', () => {
    const html =
      '<h1>Menu</h1><p>Fresh &amp; hot</p><ul><li>Idli</li><li>Dosa</li></ul>' +
      '<table><tr><td>Item</td><td>Price</td></tr><tr><td>Tea</td><td>₹20</td></tr></table><h2>Hours</h2><p>9&nbsp;am<br/>to 9 pm</p>'
    expect(htmlToText(html)).toBe(
      '# Menu\n\nFresh & hot\n\n- Idli\n- Dosa\n\nItem | Price\nTea | ₹20\n\n## Hours\n\n9 am\nto 9 pm',
    )
  })

  it('decodes numeric entities and leaves out-of-range ones alone', () => {
    expect(htmlToText('<p>&#8377;99 &#x20B9;5 &#99999999;</p>')).toBe('₹99 ₹5 &#99999999;')
  })
})

describe('extractKbFile', () => {
  it('extracts text from a DOCX', async () => {
    const out = await extractKbFile(await makeDocx())
    expect(out.kind).toBe('docx')
    expect(out.pageCount).toBeNull()
    expect(out.text).toBe('# Refunds\n\nWithin 7 days & with bill.')
  })

  it('extracts text from a PDF', async () => {
    const out = await extractKbFile(
      makePdf('BT /F1 12 Tf 72 720 Td (Refunds within 7 days) Tj ET'),
    )
    expect(out.kind).toBe('pdf')
    expect(out.pageCount).toBe(1)
    expect(out.text).toContain('Refunds within 7 days')
  })

  it('throws no_text for a PDF without text', async () => {
    expect((await extractError(makePdf('0 0 m 10 10 l S'))).code).toBe('no_text')
  })

  it('throws unsupported for random bytes', async () => {
    expect((await extractError(new TextEncoder().encode('not a file'))).code).toBe(
      'unsupported',
    )
  })

  it('throws corrupt for a zip that is not a Word document', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'hi')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    expect((await extractError(bytes)).code).toBe('corrupt')
  })
})
