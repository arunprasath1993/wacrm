import { describe, it, expect } from 'vitest'
import { extractBookingMarker } from './marker'

const json = (value: unknown) => `[[BOOKING]]${JSON.stringify(value)}[[/BOOKING]]`

const VALID = {
  type: 'online_demo',
  action: 'save',
  fields: { name: 'Ramu', business: 'NixAqua' },
  scheduled_local: '2026-11-01T11:00',
  scheduled_text: 'Tomorrow at 11 AM',
}

describe('extractBookingMarker', () => {
  it('leaves a reply without a marker untouched', () => {
    expect(extractBookingMarker('Hello there')).toEqual({
      text: 'Hello there',
      marker: null,
      malformed: false,
    })
  })

  it('parses a valid marker and removes it from the reply', () => {
    const result = extractBookingMarker(`Booked!\n${json(VALID)}`)
    expect(result.text).toBe('Booked!')
    expect(result.malformed).toBe(false)
    expect(result.marker).toEqual({
      type: 'online_demo',
      action: 'save',
      fields: { name: 'Ramu', business: 'NixAqua' },
      scheduledLocal: '2026-11-01T11:00',
      scheduledText: 'Tomorrow at 11 AM',
    })
  })

  it('accepts JSON wrapped in a code fence', () => {
    const raw = `Booked!\n[[BOOKING]]\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n[[/BOOKING]]`
    expect(extractBookingMarker(raw).marker?.type).toBe('online_demo')
  })

  it('flags malformed JSON and still strips it', () => {
    const result = extractBookingMarker('Booked!\n[[BOOKING]]{not json[[/BOOKING]]')
    expect(result).toEqual({ text: 'Booked!', marker: null, malformed: true })
  })

  it('removes an unterminated marker through the end of the reply', () => {
    const result = extractBookingMarker('Booked!\n[[BOOKING]]{"type":"online_de')
    expect(result).toEqual({ text: 'Booked!', marker: null, malformed: true })
  })

  it('uses the last marker and removes every one of them', () => {
    const second = { ...VALID, type: 'callback' }
    const result = extractBookingMarker(`A ${json(VALID)} B ${json(second)}`)
    expect(result.marker?.type).toBe('callback')
    expect(result.text).toBe('A  B')
  })

  it('removes a stray closing tag', () => {
    expect(extractBookingMarker('Booked![[/BOOKING]]').text).toBe('Booked!')
  })

  it('treats a marker without a type as malformed', () => {
    const result = extractBookingMarker(`Hi ${json({ action: 'save' })}`)
    expect(result).toEqual({ text: 'Hi', marker: null, malformed: true })
  })

  it('treats an unknown action as malformed', () => {
    const result = extractBookingMarker(`Hi ${json({ ...VALID, action: 'delete_all' })}`)
    expect(result.malformed).toBe(true)
  })

  it('defaults a missing action to save', () => {
    const { action: _omit, ...rest } = VALID
    expect(extractBookingMarker(json(rest)).marker?.action).toBe('save')
  })

  it('drops non-string field values and caps long ones', () => {
    const fields = { name: 'x'.repeat(2000), age: 40, nested: { a: 1 }, empty: '   ' }
    const marker = extractBookingMarker(json({ ...VALID, fields })).marker
    expect(Object.keys(marker!.fields)).toEqual(['name'])
    expect(marker!.fields.name).toHaveLength(500)
  })

  it('treats blank schedule values as absent', () => {
    const marker = extractBookingMarker(
      json({ ...VALID, scheduled_local: ' ', scheduled_text: null }),
    ).marker
    expect(marker?.scheduledLocal).toBeNull()
    expect(marker?.scheduledText).toBeNull()
  })
})
