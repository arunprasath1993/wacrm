import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildSystemPromptBlocks } from './defaults'
import type { BookingType } from '@/lib/bookings/types'

const TYPE: BookingType = {
  id: 't1',
  key: 'installation',
  name: 'Installation',
  fields: [],
  time_mode: 'required',
  duration_minutes: 120,
  instructions: null,
  assignee_user_id: null,
  handoff_on_confirm: false,
  remind_minutes_before: 60,
  slot_capacity: 1,
  available_days: [1, 2, 3, 4, 5, 6],
  available_from: '09:00',
  available_to: '18:00',
}
const NOW = new Date('2026-10-31T18:00:00.000Z')

describe('buildSystemPrompt — bookings', () => {
  it('leaves the prompt as it was when no booking context is passed', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(prompt).not.toContain('Current date and time')
    expect(prompt).not.toContain('[[BOOKING]]')
    expect(prompt).not.toContain('Customer memory')
  })

  it('teaches the marker in auto-reply mode when the account has types', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      bookingTypes: [TYPE],
    })
    expect(prompt).toContain('[[BOOKING]]')
    expect(prompt).toContain('"installation"')
  })

  it('lists the free times it may offer', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      bookingTypes: [TYPE],
      availability: { installation: ['Mon, 2 Nov, 9:00 am'] },
    })
    expect(prompt).toContain('Mon, 2 Nov, 9:00 am')
  })

  it('ends with the marker reminder, as the last thing the model reads', () => {
    const prompt = buildSystemPrompt({
      userPrompt: 'We sell water purifiers.',
      mode: 'auto_reply',
      bookingTypes: [TYPE],
      knowledge: ['Prices start at 5000.'],
    })
    expect(prompt.trim().split('\n').at(-1)).toMatch(/marker/)
  })

  it('never teaches the marker to an inbox draft', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'draft', bookingTypes: [TYPE] })
    expect(prompt).not.toContain('[[BOOKING]]')
  })

  it('gives every mode the date and the customer memory', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'draft',
      now: NOW,
      timeZone: 'Asia/Kolkata',
      customerMemory: { name: 'Ramu', company: null, bookings: [] },
    })
    expect(prompt).toContain('Current date and time')
    expect(prompt).toContain('Ramu')
  })

  it('skips the date without a timezone', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'draft', now: NOW })
    expect(prompt).not.toContain('Current date and time')
  })
})

describe('buildSystemPromptBlocks — prompt caching', () => {
  const blocks = buildSystemPromptBlocks({
    userPrompt: 'We sell water purifiers.',
    mode: 'auto_reply',
    knowledge: ['Prices start at 5000.'],
    now: NOW,
    timeZone: 'Asia/Kolkata',
    bookingTypes: [TYPE],
    availability: { installation: ['Mon, 2 Nov, 9:00 am'] },
    customerMemory: { name: 'Ramu', company: null, bookings: [] },
  })
  const cached = blocks.filter((b) => b.cache).map((b) => b.text).join('\n')
  const uncached = blocks.filter((b) => !b.cache).map((b) => b.text).join('\n')

  it('caches the scaffold and the business context', () => {
    expect(blocks[0].cache).toBe(true)
    expect(blocks[0].text).toContain('customer-messaging assistant')
    expect(blocks[0].text).toContain('[[HANDOFF]]')
    expect(blocks[1]).toEqual({
      text: 'Business context and instructions:\nWe sell water purifiers.',
      cache: true,
    })
  })

  it('keeps every per-request value out of the cached blocks', () => {
    for (const value of ['Current date and time', 'Mon, 2 Nov, 9:00 am', 'Ramu', 'Prices start at 5000.']) {
      expect(cached).not.toContain(value)
      expect(uncached).toContain(value)
    }
  })

  it('puts the cached blocks first', () => {
    const firstUncached = blocks.findIndex((b) => !b.cache)
    expect(blocks.slice(firstUncached).every((b) => !b.cache)).toBe(true)
  })

  it('caches the same prefix whatever the time and customer', () => {
    const other = buildSystemPromptBlocks({
      userPrompt: 'We sell water purifiers.',
      mode: 'auto_reply',
      now: new Date('2026-11-05T09:00:00.000Z'),
      timeZone: 'Asia/Kolkata',
      bookingTypes: [TYPE],
      customerMemory: { name: 'Somu', company: null, bookings: [] },
    })
    expect(other.filter((b) => b.cache)).toEqual(blocks.filter((b) => b.cache))
  })

  it('joins to the same text as buildSystemPrompt', () => {
    expect(blocks.map((b) => b.text).join('\n\n')).toBe(
      buildSystemPrompt({
        userPrompt: 'We sell water purifiers.',
        mode: 'auto_reply',
        knowledge: ['Prices start at 5000.'],
        now: NOW,
        timeZone: 'Asia/Kolkata',
        bookingTypes: [TYPE],
        availability: { installation: ['Mon, 2 Nov, 9:00 am'] },
        customerMemory: { name: 'Ramu', company: null, bookings: [] },
      }),
    )
  })
})
