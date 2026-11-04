import { describe, expect, it } from 'vitest';
import { changedFields, toForm } from './whatsapp-business-profile';
import type { BusinessProfile } from '@/lib/whatsapp/business-profile-fields';

const SAVED: BusinessProfile = {
  about: 'Open 9-6',
  address: '',
  description: 'We build software',
  email: 'hi@shiny.in',
  websites: ['https://shiny.in'],
  vertical: 'PROF_SERVICES',
  profilePictureUrl: null,
};

describe('changedFields', () => {
  it('reports nothing for an untouched form', () => {
    expect(changedFields(toForm(SAVED), SAVED)).toEqual({});
  });

  it('is not dirty when Meta stored a value with surrounding whitespace', () => {
    const saved = { ...SAVED, about: ' Open 9-6 ' };
    expect(changedFields(toForm(saved), saved)).toEqual({});
  });

  it('returns only the edited fields, trimmed', () => {
    const form = { ...toForm(SAVED), about: '  Open 10-7 ', address: 'Chennai' };
    expect(changedFields(form, SAVED)).toEqual({ about: 'Open 10-7', address: 'Chennai' });
  });

  it('sends a cleared text field as an empty string', () => {
    const form = { ...toForm(SAVED), email: '' };
    expect(changedFields(form, SAVED)).toEqual({ email: '' });
  });

  it('sends the website list when either website changes', () => {
    const form = { ...toForm(SAVED), website2: 'https://blog.shiny.in' };
    expect(changedFields(form, SAVED)).toEqual({
      websites: ['https://shiny.in', 'https://blog.shiny.in'],
    });
  });

  it('ignores a blank category instead of sending it', () => {
    const form = { ...toForm(SAVED), vertical: '' as const };
    expect(changedFields(form, SAVED)).toEqual({});
  });

  it('sends a new category', () => {
    const form = { ...toForm(SAVED), vertical: 'RETAIL' as const };
    expect(changedFields(form, SAVED)).toEqual({ vertical: 'RETAIL' });
  });
});
