import { describe, expect, it } from 'vitest';

import { composePdfText, joinTextItems, PDF_TRUNCATION_NOTE } from './pdfText';

/**
 * `extractPdf` itself needs pdf.js and a real worker, so it is covered by the
 * browser check rather than here. The pure text assembly it depends on is what
 * decides whether a source reads as prose or as soup, so it is pinned here.
 */

describe('joinTextItems', () => {
  it('keeps words apart without inventing spaces inside them', () => {
    // pdf.js emits a run per style change, so "Deep" / "Work" and "co" / "ncept"
    // both arrive as separate items — only one of them wants a space.
    const joined = joinTextItems([
      { str: 'Deep' },
      { str: ' ' },
      { str: 'Work' },
      { str: ' is a ' },
      { str: 'co' },
      { str: 'ncept' },
    ]);
    expect(joined).toBe('Deep Work is a co ncept');
  });

  it('breaks lines where the page does', () => {
    const joined = joinTextItems([
      { str: 'First line', hasEOL: true },
      { str: 'Second line', hasEOL: true },
    ]);
    expect(joined).toBe('First line\nSecond line\n');
  });

  it('ignores items that are not text', () => {
    expect(joinTextItems([null, 42, { type: 'marker' }, { str: 'kept' }])).toBe('kept');
  });
});

describe('composePdfText', () => {
  const pages = [
    { page: 1, text: 'Opening remarks.', needsTranscription: false },
    { page: 2, text: '', needsTranscription: true },
    { page: 3, text: 'Closing remarks.', needsTranscription: false },
  ];

  it('marks each page so a citation can be traced back to it', () => {
    const composed = composePdfText(pages);
    expect(composed).toContain('[Page 1]\nOpening remarks.');
    expect(composed).toContain('[Page 3]\nClosing remarks.');
  });

  it('leaves out pages with nothing on them', () => {
    expect(composePdfText(pages)).not.toContain('[Page 2]');
  });

  it('says so when the document was cut short', () => {
    expect(composePdfText(pages, true)).toContain(PDF_TRUNCATION_NOTE.trim());
    expect(composePdfText(pages, false)).not.toContain(PDF_TRUNCATION_NOTE.trim());
  });

  it('produces nothing at all for a document with no text', () => {
    expect(composePdfText([{ page: 1, text: '   ', needsTranscription: true }], true)).toBe('');
  });
});
