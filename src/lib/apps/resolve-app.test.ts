import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: vi.fn(async () => ({ added: true, dispatched: true })),
}));

import { ContactError } from '@/lib/api/v1/contacts';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { addContactToApp, resolveAppBySlug } from './resolve-app';

function db(row: Record<string, unknown> | null, error: unknown = null) {
  const calls: Array<[string, unknown]> = [];
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      calls.push([col, val]);
      return builder;
    },
    maybeSingle: async () => ({ data: row, error }),
  };
  return { client: { from: () => builder } as never, calls };
}

describe('resolveAppBySlug', () => {
  it('returns the app tag for a live app, scoped to the account', async () => {
    const { client, calls } = db({ id: 'app-1', slug: 'nixie-crm', tag_id: 'tag-1', archived_at: null });
    await expect(resolveAppBySlug(client, 'acct-1', ' Nixie-CRM ')).resolves.toEqual({
      id: 'app-1',
      slug: 'nixie-crm',
      tagId: 'tag-1',
    });
    expect(calls).toContainEqual(['account_id', 'acct-1']);
    expect(calls).toContainEqual(['slug', 'nixie-crm']);
  });

  it('rejects a malformed slug before querying', async () => {
    const { client, calls } = db(null);
    await expect(resolveAppBySlug(client, 'a', 'bad slug!')).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['missing', null],
    ['archived', { id: 'x', slug: 'pay', tag_id: 't', archived_at: '2026-01-01' }],
  ])('400s for an %s app', async (_label, row) => {
    const { client } = db(row as Record<string, unknown> | null);
    const err = await resolveAppBySlug(client, 'a', 'pay').catch((e) => e);
    expect(err).toBeInstanceOf(ContactError);
    expect(err.status).toBe(400);
  });

  it('400s when the app tag was deleted', async () => {
    const { client } = db({ id: 'x', slug: 'pay', tag_id: null, archived_at: null });
    await expect(resolveAppBySlug(client, 'a', 'pay')).rejects.toMatchObject({ status: 400 });
  });
});

describe('addContactToApp', () => {
  it('adds only the app tag (additive) through the dispatching writer', async () => {
    const added = await addContactToApp({} as never, 'acct', 'contact-1', {
      id: 'app-1',
      slug: 'pay',
      tagId: 'tag-9',
    });
    expect(added).toBe(true);
    expect(addContactTagAndDispatch).toHaveBeenCalledWith({
      db: {},
      accountId: 'acct',
      contactId: 'contact-1',
      tagId: 'tag-9',
    });
  });
});
