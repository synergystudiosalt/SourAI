import { describe, expect, it } from 'vitest';

import { buildDocumentXml, safeFileName, toBlocks } from './exportArtifact';

const artifact = {
  title: 'Study guide',
  kindLabel: 'Study guide',
  notebookTitle: 'Focus',
  text: '# Heading\n\nA paragraph.\n\n- First bullet\n- Second bullet\n\n1. Numbered one',
};

describe('toBlocks', () => {
  it('recognises headings, bullets, numbered items and paragraphs', () => {
    expect(toBlocks(artifact.text).map((block) => block.kind)).toEqual([
      'heading1',
      'paragraph',
      'bullet',
      'bullet',
      'numbered',
    ]);
  });

  it('joins wrapped lines into one paragraph', () => {
    const blocks = toBlocks('One line\ncontinues here.\n\nA second paragraph.');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('One line continues here.');
  });

  it('strips inline markers the exporters cannot style', () => {
    const blocks = toBlocks('**Bold** and `code` and [a link](https://example.com).');
    expect(blocks[0].text).toBe('Bold and code and a link.');
  });

  it('ignores horizontal rules and blank input', () => {
    expect(toBlocks('---')).toEqual([]);
    expect(toBlocks('')).toEqual([]);
  });
});

describe('buildDocumentXml', () => {
  it('produces a WordprocessingML body with the title first', () => {
    const xml = buildDocumentXml(artifact);
    expect(xml).toContain('<w:document');
    expect(xml.indexOf('Study guide')).toBeLessThan(xml.indexOf('A paragraph.'));
    expect(xml).toContain('<w:sectPr>');
  });

  it('escapes XML so a stray angle bracket cannot corrupt the part', () => {
    // Word refuses to open the file at all if the document part is malformed,
    // so this is a "produces nothing" bug rather than a cosmetic one.
    const xml = buildDocumentXml({ ...artifact, text: 'Compare a < b & c > d' });
    expect(xml).toContain('a &lt; b &amp; c &gt; d');
    expect(xml).not.toContain('a < b & c > d');
  });

  it('drops control characters Word rejects outright', () => {
    const xml = buildDocumentXml({ ...artifact, text: 'cleantext' });
    expect(xml).toContain('cleantext');
  });

  it('marks bullets so a list still reads as a list', () => {
    expect(buildDocumentXml(artifact)).toContain('• First bullet');
  });
});

describe('safeFileName', () => {
  it('removes characters a filesystem will not take', () => {
    expect(safeFileName('Quiz: chapter 3/4 <draft>')).toBe('Quiz chapter 3 4 draft');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeFileName('///')).toBe('sour-ai-notebook');
  });

  it('keeps the name short enough to save', () => {
    expect(safeFileName('x'.repeat(200)).length).toBe(80);
  });
});
