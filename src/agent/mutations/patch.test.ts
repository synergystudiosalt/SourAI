import { describe, expect, it } from 'vitest';

import {
  applyHunks,
  decodeText,
  diffToHunks,
  encodeText,
  isBinaryLike,
  visibleLines,
} from './patch';
import type { ProposedHunk } from './proposal';

const hunk = (partial: Partial<ProposedHunk> & Pick<ProposedHunk, 'startLine'>): ProposedHunk => ({
  id: partial.id ?? 'h1',
  startLine: partial.startLine,
  originalLines: partial.originalLines ?? [],
  replacementLines: partial.replacementLines ?? [],
});

describe('decodeText / encodeText', () => {
  it('preserves a missing final newline', () => {
    const decoded = decodeText('a\nb');
    expect(decoded.lines).toEqual(['a', 'b']);
    expect(decoded.finalNewline).toBe(false);
    expect(encodeText(decoded.lines, decoded)).toBe('a\nb');
  });

  it('preserves a trailing newline as a final empty line', () => {
    const decoded = decodeText('a\nb\n');
    expect(visibleLines(decoded)).toEqual(['a', 'b']);
    expect(decoded.finalNewline).toBe(true);
    expect(encodeText(decoded.lines, decoded)).toBe('a\nb\n');
  });

  it('detects and restores CRLF files', () => {
    const decoded = decodeText('a\r\nb\r\n');
    expect(decoded.ending).toBe('\r\n');
    expect(visibleLines(decoded)).toEqual(['a', 'b']);
    expect(encodeText(['a', 'b', 'c', ''], decoded)).toBe('a\r\nb\r\nc\r\n');
  });

  it('round-trips an empty file', () => {
    const decoded = decodeText('');
    expect(visibleLines(decoded)).toEqual([]);
    expect(encodeText(decoded.lines, decoded)).toBe('');
  });

  it('round-trips every shape of input exactly', () => {
    for (const value of ['', '\n', 'a', 'a\n', 'a\nb', 'a\nb\n', '\n\n', 'a\r\nb\r\n']) {
      const decoded = decodeText(value);
      expect(encodeText(decoded.lines, decoded)).toBe(value);
    }
  });
});

describe('applyHunks', () => {
  const original = 'one\ntwo\nthree\nfour\n';

  it('replaces the anchored lines only', () => {
    const result = applyHunks(original, [
      hunk({ startLine: 2, originalLines: ['two'], replacementLines: ['TWO', 'TWO.5'] }),
    ]);
    expect(result).toBe('one\nTWO\nTWO.5\nthree\nfour\n');
  });

  it('applies several hunks without shifting each other', () => {
    const result = applyHunks(original, [
      hunk({ id: 'a', startLine: 1, originalLines: ['one'], replacementLines: ['ONE', 'extra'] }),
      hunk({ id: 'b', startLine: 4, originalLines: ['four'], replacementLines: ['FOUR'] }),
    ]);
    expect(result).toBe('ONE\nextra\ntwo\nthree\nFOUR\n');
  });

  it('refuses when the anchor text no longer matches', () => {
    expect(() =>
      applyHunks('one\nCHANGED\nthree\n', [
        hunk({ startLine: 2, originalLines: ['two'], replacementLines: ['TWO'] }),
      ])
    ).toThrowError(/no longer matches/);
  });

  it('refuses rather than relocating an edit that moved', () => {
    // The same text exists one line lower. Fuzzy matching would silently patch
    // it; deterministic patching must not.
    expect(() =>
      applyHunks('inserted\none\ntwo\nthree\n', [
        hunk({ startLine: 2, originalLines: ['two'], replacementLines: ['TWO'] }),
      ])
    ).toThrowError(/no longer matches/);
  });

  it('refuses an anchor past the end of the file', () => {
    expect(() =>
      applyHunks('one\n', [hunk({ startLine: 9, originalLines: ['x'], replacementLines: ['y'] })])
    ).toThrowError(/no longer matches/);
  });

  it('supports pure insertion and pure deletion', () => {
    expect(
      applyHunks(original, [hunk({ startLine: 2, originalLines: ['two'], replacementLines: [] })])
    ).toBe('one\nthree\nfour\n');
  });

  it('keeps CRLF endings when patching a CRLF file', () => {
    expect(
      applyHunks('a\r\nb\r\n', [hunk({ startLine: 2, originalLines: ['b'], replacementLines: ['B'] })])
    ).toBe('a\r\nB\r\n');
  });
});

describe('diffToHunks', () => {
  it('produces hunks that reconstruct the target exactly', () => {
    const before = 'alpha\nbeta\ngamma\ndelta\n';
    const after = 'alpha\nBETA\ngamma\ndelta\nepsilon\n';
    const hunks = diffToHunks(before, after);
    expect(hunks.length).toBeGreaterThan(0);
    expect(applyHunks(before, hunks)).toBe(after);
  });

  it('isolates independent edits into separate hunks', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\n';
    const after = 'A\nb\nc\nd\ne\nf\nG\n';
    const hunks = diffToHunks(before, after);
    expect(hunks).toHaveLength(2);
    expect(applyHunks(before, hunks)).toBe(after);
  });

  it('applying only one hunk changes only that region', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\n';
    const after = 'A\nb\nc\nd\ne\nf\nG\n';
    const [first] = diffToHunks(before, after);
    expect(applyHunks(before, [first])).toBe('A\nb\nc\nd\ne\nf\ng\n');
  });

  it('returns no hunks for identical text', () => {
    expect(diffToHunks('same\n', 'same\n')).toHaveLength(0);
  });

  it('handles creating content from an empty file', () => {
    const hunks = diffToHunks('', 'new\nlines\n');
    expect(applyHunks('', hunks)).toBe('new\nlines\n');
  });
});

describe('isBinaryLike', () => {
  it('flags control bytes but not ordinary text', () => {
    expect(isBinaryLike('plain text\n\twith tabs\r\n')).toBe(false);
    expect(isBinaryLike(`PNG${String.fromCharCode(0)}data`)).toBe(true);
  });
});
