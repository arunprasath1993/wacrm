import { describe, it, expect } from 'vitest'
import {
  REPLY_CAP_STORAGE_MAX,
  contactPhoneToE164,
  isTestingNumber,
  normalizeTestingNumber,
  normalizeTestingNumbers,
  parseReplyCap,
  resolveReplyCap,
} from './reply-cap'

describe('parseReplyCap', () => {
  it('accepts any whole number >= 1, without clamping', () => {
    expect(parseReplyCap(1)).toBe(1)
    expect(parseReplyCap(20)).toBe(20)
    expect(parseReplyCap(21)).toBe(21)
    expect(parseReplyCap(1000)).toBe(1000)
    expect(parseReplyCap(20000)).toBe(20000)
    expect(parseReplyCap('20000')).toBe(20000)
    expect(parseReplyCap(' 10000 ')).toBe(10000)
    expect(parseReplyCap(REPLY_CAP_STORAGE_MAX)).toBe(REPLY_CAP_STORAGE_MAX)
  })

  it('rejects zero, negatives, fractions and non-numbers', () => {
    for (const v of [0, -1, 1.5, '1.5', '', 'abc', '-3', null, undefined, NaN, Infinity, {}, []]) {
      expect(parseReplyCap(v)).toBeNull()
    }
  })

  it('rejects values the integer column cannot store', () => {
    expect(parseReplyCap(REPLY_CAP_STORAGE_MAX + 1)).toBeNull()
  })
})

describe('normalizeTestingNumber', () => {
  it.each([
    ['+919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['+91 (98765) 43210', '+919876543210'],
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['00919876543210', '+919876543210'],
    ['+14155551212', '+14155551212'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeTestingNumber(raw)).toBe(expected)
  })

  it.each(['', '   ', 'abc', '12345', '+0123456789', '+12', '98765abc10', '+1234567890123456'])(
    'rejects %j',
    (raw) => {
      expect(normalizeTestingNumber(raw)).toBeNull()
    },
  )
})

describe('contactPhoneToE164', () => {
  it.each([
    ['919876543210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['+1 (415) 555.1212', '+14155551212'],
    ['6591234567', '+6591234567'],
  ])('%s → %s', (phone, expected) => {
    expect(contactPhoneToE164(phone)).toBe(expected)
  })

  it.each([null, undefined, '', '   ', 'abc', '0919876543210', '+0123456789', '1234567', '+1234567890123456', '++919876543210'])(
    'rejects %j',
    (phone) => {
      expect(contactPhoneToE164(phone)).toBeNull()
    },
  )
})

describe('normalizeTestingNumbers', () => {
  it('normalizes every entry and drops blanks', () => {
    expect(normalizeTestingNumbers(['9876543210', ' ', '+1 415 555 1212'])).toEqual({
      ok: true,
      numbers: ['+919876543210', '+14155551212'],
    })
  })

  it('has no fixed size limit', () => {
    const many = Array.from({ length: 500 }, (_, i) => `+9198765${String(i).padStart(5, '0')}`)
    const result = normalizeTestingNumbers(many)
    expect(result.ok && result.numbers.length).toBe(500)
  })

  it('rejects duplicates after normalization', () => {
    expect(normalizeTestingNumbers(['+919876543210', '09876543210'])).toEqual({
      ok: false,
      error: 'duplicate',
      value: '09876543210',
    })
  })

  it('rejects an invalid entry', () => {
    expect(normalizeTestingNumbers(['+919876543210', 'abc'])).toEqual({
      ok: false,
      error: 'invalid',
      value: 'abc',
    })
  })

  it('treats a non-array as an empty list', () => {
    expect(normalizeTestingNumbers(undefined)).toEqual({ ok: true, numbers: [] })
  })
})

describe('isTestingNumber / resolveReplyCap', () => {
  const settings = {
    customerCap: 20,
    testingCap: 1000,
    testingNumbers: ['+919876543210'],
  }

  it('uses the customer cap for a customer number', () => {
    expect(resolveReplyCap(settings, '919000000001')).toBe(20)
  })

  it('uses the testing cap for a testing number', () => {
    // Contacts hold Meta's digits-only wa_id form.
    expect(resolveReplyCap(settings, '919876543210')).toBe(1000)
  })

  it.each(['+919876543210', '919876543210', '+91 98765 43210'])(
    'matches an international contact phone in format %j',
    (phone) => {
      expect(isTestingNumber(phone, settings.testingNumbers)).toBe(true)
      expect(resolveReplyCap(settings, phone)).toBe(1000)
    },
  )

  it.each(['+91 98765 43210', '9876543210', '09876543210', '919876543210'])(
    'matches a list entry in format %j',
    (entry) => {
      expect(isTestingNumber('919876543210', [entry])).toBe(true)
      expect(resolveReplyCap({ ...settings, testingNumbers: [entry] }, '919876543210')).toBe(1000)
    },
  )

  it('does not apply the +91 heuristic to a 10-digit international contact', () => {
    // Singapore wa_id: 65 + 8-digit subscriber number = 10 digits.
    expect(isTestingNumber('6591234567', ['+6591234567'])).toBe(true)
    expect(isTestingNumber('6591234567', ['+916591234567'])).toBe(false)
    expect(resolveReplyCap({ ...settings, testingNumbers: ['+916591234567'] }, '6591234567')).toBe(20)
  })

  it('handles a large customer cap like 20000', () => {
    expect(resolveReplyCap({ ...settings, customerCap: 20000 }, '919000000001')).toBe(20000)
    expect(resolveReplyCap({ ...settings, testingCap: 20000 }, '919876543210')).toBe(20000)
  })

  it('falls back to the customer cap without a phone or a list', () => {
    expect(resolveReplyCap(settings, null)).toBe(20)
    expect(resolveReplyCap(settings, '')).toBe(20)
    expect(resolveReplyCap({ ...settings, testingNumbers: [] }, '919876543210')).toBe(20)
    expect(resolveReplyCap({ ...settings, testingNumbers: null }, '919876543210')).toBe(20)
  })

  it('defaults a missing testing cap to 1000', () => {
    expect(resolveReplyCap({ ...settings, testingCap: null }, '919876543210')).toBe(1000)
  })
})
