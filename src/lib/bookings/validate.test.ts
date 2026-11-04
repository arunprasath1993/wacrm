import { describe, it, expect } from 'vitest'
import { resolveBookingPatch, validateBookingType } from './validate'

const VALID = {
  name: 'Site Installation',
  fields: [
    { label: 'Full name', required: true, maps_to: 'name' },
    { label: 'Site address', required: true },
  ],
  time_mode: 'required',
  duration_minutes: 120,
  instructions: '  Monday to Saturday  ',
  assignee_user_id: null,
  handoff_on_confirm: true,
  remind_minutes_before: 30,
  is_active: true,
}

describe('validateBookingType', () => {
  it('normalises a valid type', () => {
    const result = validateBookingType(VALID)
    expect(result).toMatchObject({
      ok: true,
      value: {
        name: 'Site Installation',
        key: 'site_installation',
        time_mode: 'required',
        duration_minutes: 120,
        instructions: 'Monday to Saturday',
        handoff_on_confirm: true,
        remind_minutes_before: 30,
        is_active: true,
        fields: [
          { key: 'full_name', label: 'Full name', required: true, maps_to: 'name' },
          { key: 'site_address', label: 'Site address', required: true, maps_to: null },
        ],
      },
    })
  })

  it('keeps an existing key stable when the type is renamed', () => {
    const result = validateBookingType({ ...VALID, name: 'Renamed' }, { key: 'installation' })
    expect(result).toMatchObject({ ok: true, value: { key: 'installation' } })
  })

  it('keeps a field key the client sends back', () => {
    const fields = [{ key: 'address', label: 'Delivery address', required: true }]
    const result = validateBookingType({ ...VALID, fields })
    expect(result).toMatchObject({ ok: true, value: { fields: [{ key: 'address' }] } })
  })

  it('gives labels that slugify to nothing a usable key', () => {
    const result = validateBookingType({
      ...VALID,
      name: 'நிறுவல்',
      fields: [{ label: 'பெயர்' }, { label: 'முகவரி' }],
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        key: 'type',
        fields: [{ key: 'field_1' }, { key: 'field_2' }],
      },
    })
  })

  it('makes duplicate field keys unique', () => {
    const result = validateBookingType({ ...VALID, fields: [{ label: 'Phone' }, { label: 'phone' }] })
    expect(result).toMatchObject({
      ok: true,
      value: { fields: [{ key: 'phone' }, { key: 'phone_2' }] },
    })
  })

  it('defaults availability to one at a time, Monday to Saturday, 9 to 6', () => {
    expect(validateBookingType(VALID)).toMatchObject({
      ok: true,
      value: {
        slot_capacity: 1,
        available_days: [1, 2, 3, 4, 5, 6],
        available_from: '09:00',
        available_to: '18:00',
      },
    })
  })

  it('normalises availability', () => {
    const result = validateBookingType({
      ...VALID,
      slot_capacity: 3,
      available_days: [5, 1, 1],
      available_from: '10:30',
      available_to: '20:00:00',
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        slot_capacity: 3,
        available_days: [1, 5],
        available_from: '10:30',
        available_to: '20:00',
      },
    })
  })

  it('allows an unlimited slot', () => {
    const result = validateBookingType({ ...VALID, slot_capacity: null })
    expect(result).toMatchObject({ ok: true, value: { slot_capacity: null } })
  })

  it('allows reminders to be turned off', () => {
    const result = validateBookingType({ ...VALID, remind_minutes_before: null })
    expect(result).toMatchObject({ ok: true, value: { remind_minutes_before: null } })
  })

  it.each([
    ['a missing name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(61) }],
    ['an unknown time mode', { time_mode: 'sometimes' }],
    ['too short a duration', { duration_minutes: 1 }],
    ['a fractional duration', { duration_minutes: 30.5 }],
    ['a negative reminder', { remind_minutes_before: -5 }],
    ['long instructions', { instructions: 'x'.repeat(1001) }],
    ['a bad assignee id', { assignee_user_id: 'not-a-uuid' }],
    ['a zero capacity', { slot_capacity: 0 }],
    ['no working days for a timed type', { available_days: [] }],
    ['an unknown weekday', { available_days: [8] }],
    ['a bad opening time', { available_from: '25:00' }],
    ['closing before opening', { available_from: '18:00', available_to: '09:00' }],
    ['hours shorter than a booking', { available_from: '09:00', available_to: '10:00' }],
    ['fields that are not a list', { fields: 'name' }],
    ['a field with no label', { fields: [{ label: ' ' }] }],
    ['an unknown contact mapping', { fields: [{ label: 'x', maps_to: 'password' }] }],
    ['too many fields', { fields: Array.from({ length: 21 }, (_, i) => ({ label: `f${i}` })) }],
  ])('rejects %s', (_name, overrides) => {
    expect(validateBookingType({ ...VALID, ...overrides }).ok).toBe(false)
  })
})

describe('resolveBookingPatch', () => {
  const NOW = new Date('2026-10-31T18:00:00.000Z')
  const patch = (body: Record<string, unknown>) =>
    resolveBookingPatch(body, 'Asia/Kolkata', NOW)

  it('accepts a status change', () => {
    expect(patch({ status: 'done' })).toEqual({ ok: true, update: { status: 'done' } })
  })

  it('converts a reschedule and clears the old wording', () => {
    expect(patch({ scheduled_local: '2026-11-01T11:00' })).toEqual({
      ok: true,
      update: { scheduled_at: '2026-11-01T05:30:00.000Z', scheduled_text: null },
    })
  })

  it('clears the time on null', () => {
    expect(patch({ scheduled_local: null })).toEqual({
      ok: true,
      update: { scheduled_at: null, scheduled_text: null },
    })
  })

  it('accepts a reassignment and an unassignment', () => {
    const id = '3f2b8c1e-9a4d-4e2f-b6a1-0c9d8e7f6a5b'
    expect(patch({ assigned_to: id })).toEqual({ ok: true, update: { assigned_to: id } })
    expect(patch({ assigned_to: null })).toEqual({ ok: true, update: { assigned_to: null } })
  })

  it('keeps only string field values', () => {
    expect(patch({ fields: { name: 'Ramu', age: 4 } })).toEqual({
      ok: true,
      update: { fields: { name: 'Ramu' } },
    })
  })

  it('ignores columns it does not manage', () => {
    expect(patch({ account_id: 'other', reminded_at: null })).toEqual({ ok: true, update: {} })
  })

  it.each([
    ['an unknown status', { status: 'deleted' }],
    ['a past time', { scheduled_local: '2026-10-01T11:00' }],
    ['a free-text time', { scheduled_local: 'tomorrow' }],
    ['a bad assignee', { assigned_to: 'me' }],
    ['non-object fields', { fields: 'x' }],
  ])('rejects %s', (_name, body) => {
    expect(patch(body).ok).toBe(false)
  })
})
