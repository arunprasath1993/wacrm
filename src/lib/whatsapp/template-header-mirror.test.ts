import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The SSRF guard does a real DNS lookup, so stub it — the fixtures below use
// a `.test` hostname that would never resolve. Each test sets the verdict.
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import { mirrorTemplateHeaderMedia } from './template-header-mirror';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

const MB = 1024 * 1024;
const ACCOUNT = 'acct-1';
const SAMPLE_URL = 'https://scontent.test/sample.jpg?oe=abc';

function mediaResponse(type: string | null = 'image/jpeg', size = 1024, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) },
    arrayBuffer: async () => new ArrayBuffer(size),
  } as unknown as Response;
}

function fakeStorage(uploadError: { message: string } | null = null) {
  const upload = vi.fn(async () => ({ error: uploadError }));
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://cdn.test/${path}` },
  }));
  const from = vi.fn(() => ({ upload, getPublicUrl }));
  return { storage: { from }, from, upload };
}

function mirror(storage: ReturnType<typeof fakeStorage>['storage'], over = {}) {
  return mirrorTemplateHeaderMedia({
    storage,
    accountId: ACCOUNT,
    metaTemplateId: '894263507012256',
    kind: 'image',
    sampleUrl: SAMPLE_URL,
    ...over,
  });
}

describe('mirrorTemplateHeaderMedia', () => {
  beforeEach(() => {
    vi.mocked(isDeliverableUrl).mockClear();
    vi.mocked(isDeliverableUrl).mockResolvedValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('copies the sample into chat-media and returns its public URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mediaResponse('image/jpeg')));
    const { storage, from, upload } = fakeStorage();

    const url = await mirror(storage);

    const path = 'account-acct-1/template-headers/894263507012256.jpg';
    expect(url).toBe(`https://cdn.test/${path}`);
    expect(from).toHaveBeenCalledWith('chat-media');
    expect(upload).toHaveBeenCalledWith(
      path,
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: true }),
    );
  });

  it('names the object after the kind-specific extension', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mediaResponse('application/pdf')));
    const { storage } = fakeStorage();

    const url = await mirror(storage, { kind: 'document', metaTemplateId: '42' });

    expect(url).toBe('https://cdn.test/account-acct-1/template-headers/42.pdf');
  });

  it('never follows a redirect, so a 3xx cannot bounce to an internal address', async () => {
    const fetchMock = vi.fn(async () => mediaResponse());
    vi.stubGlobal('fetch', fetchMock);

    await mirror(fakeStorage().storage);

    expect(fetchMock).toHaveBeenCalledWith(
      SAMPLE_URL,
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('refuses a URL the SSRF guard rejects, without fetching it', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { storage, upload } = fakeStorage();

    expect(await mirror(storage)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns null when Meta answers with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mediaResponse('image/jpeg', 1024, false, 403)));
    const { storage, upload } = fakeStorage();

    expect(await mirror(storage)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns null when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));

    expect(await mirror(fakeStorage().storage)).toBeNull();
  });

  it('returns null for a content type the header kind does not accept', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mediaResponse('text/html')));
    const { storage, upload } = fakeStorage();

    expect(await mirror(storage)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns null for an empty sample', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mediaResponse('image/jpeg', 0)));
    const { storage, upload } = fakeStorage();

    expect(await mirror(storage)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns null past the header kind's size ceiling", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mediaResponse('image/jpeg', 5 * MB + 1)));
    const { storage, upload } = fakeStorage();

    expect(await mirror(storage)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('holds documents to the 16 MB bucket limit, not the 100 MB Meta cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mediaResponse('application/pdf', 16 * MB + 1)));
    const { storage, upload } = fakeStorage();

    expect(await mirror(storage, { kind: 'document' })).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns null when the bucket refuses the upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mediaResponse()));

    expect(await mirror(fakeStorage({ message: 'denied' }).storage)).toBeNull();
  });
});
