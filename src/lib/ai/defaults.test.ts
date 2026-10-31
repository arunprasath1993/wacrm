import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './defaults'
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
