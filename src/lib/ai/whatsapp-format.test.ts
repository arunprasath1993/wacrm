import { describe, it, expect } from 'vitest'
import { toWhatsAppFormatting } from './whatsapp-format'

describe('toWhatsAppFormatting', () => {
  it('turns Markdown bold into WhatsApp bold', () => {
    expect(toWhatsAppFormatting('1. **Store Registration** — we register')).toBe(
      '1. *Store Registration* — we register',
    )
    expect(toWhatsAppFormatting('__Note__: bring ID')).toBe('*Note*: bring ID')
  })

  it('turns Markdown strikethrough into WhatsApp strikethrough', () => {
    expect(toWhatsAppFormatting('~~₹999~~ ₹499')).toBe('~₹999~ ₹499')
  })

  it('turns headings into bold lines', () => {
    expect(toWhatsAppFormatting('## Step by step\n1. Register')).toBe(
      '*Step by step*\n1. Register',
    )
  })

  it('does not double-wrap a heading that is already bold', () => {
    expect(toWhatsAppFormatting('### **Plans**')).toBe('*Plans*')
  })

  it('turns Markdown links into plain text with the URL', () => {
    expect(toWhatsAppFormatting('See [our site](https://nixie.in) now')).toBe(
      'See our site (https://nixie.in) now',
    )
    expect(
      toWhatsAppFormatting('[https://nixie.in](https://nixie.in)'),
    ).toBe('https://nixie.in')
  })

  it('turns "* item" bullets into "- item"', () => {
    expect(toWhatsAppFormatting('* Idli\n* Dosa')).toBe('- Idli\n- Dosa')
  })

  it('leaves WhatsApp formatting and plain text untouched', () => {
    const text = '*Bold* _italic_ ~strike~ `code`\nPrice: 2 * 3 = 6'
    expect(toWhatsAppFormatting(text)).toBe(text)
  })
})
