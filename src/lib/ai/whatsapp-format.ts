// ============================================================
// Markdown → WhatsApp formatting.
//
// LLMs default to Markdown (`**bold**`, `## heading`, `[text](url)`).
// WhatsApp has its own, smaller syntax — `*bold*`, `_italic_`,
// `~strike~` — and shows Markdown markers to the customer literally.
// The system prompt asks for WhatsApp formatting, and this converts
// whatever slips through, so every draft / auto-reply reads cleanly.
//
// Only unambiguous Markdown is rewritten; WhatsApp-native formatting
// and plain text (e.g. "2 * 3") pass through unchanged.
// ============================================================

export function toWhatsAppFormatting(text: string): string {
  return (
    text
      // "* item" bullets → "- item" (WhatsApp would read "*" as bold).
      .replace(/^(\s*)\* /gm, '$1- ')
      // [text](url) → "text (url)", or just the URL when they match.
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) =>
        label === url ? url : `${label} (${url})`,
      )
      // "## Heading" → "*Heading*" (no headings in WhatsApp), without
      // double-wrapping a heading that is already bold.
      .replace(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm, (_, heading: string) => {
        const inner = heading.replace(/^(\*\*|__)(.+)\1$/, '$2')
        return `*${inner}*`
      })
      .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '*$1*')
      .replace(/__(\S(?:.*?\S)?)__/g, '*$1*')
      .replace(/~~(\S(?:.*?\S)?)~~/g, '~$1~')
  )
}
