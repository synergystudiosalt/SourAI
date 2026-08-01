import { describe, expect, it, vi } from 'vitest';

import { formatRemaining, transcribePdfPages } from './pdfOcr';
import type { PdfDocumentHandle } from './pdfText';

vi.mock('./api', () => ({
  transcribePdfPage: vi.fn(async ({ page }: { page: number }) =>
    page === 3 ? { text: '', empty: true } : { text: `text of page ${page}`, empty: false }
  ),
}));

function fakeHandle(overrides: Partial<PdfDocumentHandle> = {}): PdfDocumentHandle {
  return {
    pageCount: 5,
    renderPage: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
    readText: vi.fn(async () => ''),
    close: vi.fn(async () => {}),
    ...overrides,
  } as unknown as PdfDocumentHandle;
}

describe('transcribePdfPages', () => {
  it('reads every requested page and reports each one as it lands', async () => {
    const pages: number[] = [];
    const summary = await transcribePdfPages({
      handle: fakeHandle(),
      pages: [1, 2],
      intervalMs: 0,
      onPage: ({ page }) => pages.push(page),
    });

    expect(pages).toEqual([1, 2]);
    expect(summary).toMatchObject({ transcribed: 2, blank: 0, failed: 0, cancelled: false });
  });

  it('counts a blank page without emitting empty text into the source', async () => {
    const pages: number[] = [];
    const summary = await transcribePdfPages({
      handle: fakeHandle(),
      pages: [3],
      intervalMs: 0,
      onPage: ({ page }) => pages.push(page),
    });

    expect(pages).toEqual([]);
    expect(summary).toMatchObject({ transcribed: 0, blank: 1 });
  });

  it('keeps going when one page cannot be rendered', async () => {
    // One unreadable page in a 200-page scan must not abandon the other 199.
    const renderPage = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue('data:image/jpeg;base64,AAAA');
    const summary = await transcribePdfPages({
      handle: fakeHandle({ renderPage } as never),
      pages: [1, 2],
      intervalMs: 0,
      onPage: () => {},
    });

    expect(summary).toMatchObject({ failed: 1, transcribed: 1 });
  });

  it('stops when cancelled and reports what it had already read', async () => {
    const controller = new AbortController();
    const summary = await transcribePdfPages({
      handle: fakeHandle(),
      pages: [1, 2, 4],
      intervalMs: 5_000,
      signal: controller.signal,
      onPage: () => controller.abort(),
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.transcribed).toBe(1);
  });

  it('reports progress with a shrinking estimate', async () => {
    const seen: number[] = [];
    await transcribePdfPages({
      handle: fakeHandle(),
      pages: [1, 2],
      intervalMs: 1_000,
      onPage: () => {},
      onProgress: ({ estimatedRemainingMs }) => seen.push(estimatedRemainingMs),
    });

    expect(seen[0]).toBe(2_000);
    expect(seen[seen.length - 1]).toBe(0);
  });
});

describe('formatRemaining', () => {
  it('speaks in the units a long job actually takes', () => {
    expect(formatRemaining(0)).toBe('finishing');
    expect(formatRemaining(30_000)).toBe('less than a minute left');
    expect(formatRemaining(5 * 60_000)).toBe('about 5 min left');
    expect(formatRemaining(90 * 60_000)).toBe('about 1 hr 30 min left');
    expect(formatRemaining(120 * 60_000)).toBe('about 2 hr left');
  });
});
