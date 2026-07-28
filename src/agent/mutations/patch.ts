import { SourError } from '../../contracts/errors';
import type { ProposedHunk } from './proposal';

/**
 * Deterministic line patching.
 *
 * There is no fuzzy matching anywhere in this file. A hunk either matches its
 * recorded anchor lines exactly at the recorded position, or the patch fails
 * and the user is asked for a fresh proposal. Silently relocating an edit is
 * the failure mode that turns an approved diff into an unapproved one.
 */

export type LineEnding = '\n' | '\r\n';

export interface DecodedText {
  readonly lines: readonly string[];
  readonly ending: LineEnding;
  readonly finalNewline: boolean;
}

export function patchError(reason: string, details?: Record<string, unknown>): never {
  throw new SourError({
    code: 'patch_not_applicable',
    message: 'The proposed patch no longer matches the file.',
    causeCategory: 'validation',
    retryable: false,
    userAction: 'Ask the agent for a fresh proposal against the current file.',
    details: { reason, ...details },
  });
}

/**
 * Splits text into lines so that joining them again is exactly reversible.
 *
 * A trailing newline is represented as a final empty line rather than as a
 * separate flag. That is what makes `encodeText(decodeText(x)) === x` hold for
 * every input, including the empty file, so selecting every hunk of a change
 * reproduces the approved bytes rather than something one newline different.
 *
 * The dominant line ending is preserved too, so patching a CRLF file does not
 * silently rewrite every line.
 */
export function decodeText(value: string): DecodedText {
  const crlf = (value.match(/\r\n/g) ?? []).length;
  const lf = (value.match(/(?<!\r)\n/g) ?? []).length;
  const ending: LineEnding = crlf > lf ? '\r\n' : '\n';
  const normalized = value.replace(/\r\n/g, '\n');
  return Object.freeze({
    lines: Object.freeze(normalized.split('\n')),
    ending,
    finalNewline: normalized.endsWith('\n'),
  });
}

export function encodeText(lines: readonly string[], source: DecodedText): string {
  return lines.join(source.ending);
}

/** Lines without the phantom trailing entry, for display and line counts. */
export function visibleLines(decoded: DecodedText): readonly string[] {
  // An empty file decodes to a single empty line; it has no visible lines.
  if (decoded.lines.length === 1 && decoded.lines[0] === '') return [];
  return decoded.finalNewline ? decoded.lines.slice(0, -1) : decoded.lines;
}

/**
 * Applies hunks to the original text.
 *
 * Hunks are applied from the end backwards so earlier line numbers stay valid,
 * and every anchor is verified against the current content first.
 */
export function applyHunks(original: string, hunks: readonly ProposedHunk[]): string {
  const decoded = decodeText(original);
  const lines = [...decoded.lines];
  const ordered = [...hunks].sort((left, right) => right.startLine - left.startLine);

  for (const hunk of ordered) {
    const start = hunk.startLine - 1;
    const end = start + hunk.originalLines.length;
    if (start < 0 || end > lines.length) {
      patchError('anchor_out_of_range', {
        startLine: hunk.startLine,
        fileLines: lines.length,
      });
    }
    for (const [offset, expected] of hunk.originalLines.entries()) {
      if (lines[start + offset] !== expected) {
        patchError('anchor_mismatch', { line: hunk.startLine + offset });
      }
    }
    lines.splice(start, hunk.originalLines.length, ...hunk.replacementLines);
  }
  return encodeText(lines, decoded);
}

export interface DiffLine {
  readonly kind: 'context' | 'added' | 'removed';
  readonly text: string;
  readonly originalLine?: number;
  readonly updatedLine?: number;
}

export interface DiffHunkView {
  readonly id: string;
  readonly header: string;
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
}

const CONTEXT_LINES = 3;

/** Builds a reviewable view of one hunk, with bounded surrounding context. */
export function describeHunk(
  original: readonly string[],
  hunk: ProposedHunk,
  index: number
): DiffHunkView {
  const start = hunk.startLine - 1;
  const contextStart = Math.max(0, start - CONTEXT_LINES);
  const contextEnd = Math.min(original.length, start + hunk.originalLines.length + CONTEXT_LINES);
  const lines: DiffLine[] = [];

  for (let line = contextStart; line < start; line += 1) {
    lines.push({ kind: 'context', text: original[line], originalLine: line + 1 });
  }
  for (const [offset, text] of hunk.originalLines.entries()) {
    lines.push({ kind: 'removed', text, originalLine: hunk.startLine + offset });
  }
  for (const text of hunk.replacementLines) {
    lines.push({ kind: 'added', text });
  }
  for (let line = start + hunk.originalLines.length; line < contextEnd; line += 1) {
    lines.push({ kind: 'context', text: original[line], originalLine: line + 1 });
  }

  return Object.freeze({
    id: hunk.id || `hunk-${index + 1}`,
    header: `@@ -${hunk.startLine},${hunk.originalLines.length} +${hunk.startLine},${hunk.replacementLines.length} @@`,
    lines: Object.freeze(lines),
    added: hunk.replacementLines.length,
    removed: hunk.originalLines.length,
  });
}

/**
 * Turns a whole-file rewrite into hunks so a `write_file` change can be
 * reviewed and accepted hunk by hunk like a patch.
 *
 * This is a straightforward longest-common-subsequence diff; it is used for
 * review and for building selected-hunk proposals, never for placing an edit.
 */
export function diffToHunks(before: string, after: string): readonly ProposedHunk[] {
  const source = decodeText(before).lines;
  const target = decodeText(after).lines;
  const common = longestCommonSubsequence(source, target);

  const hunks: ProposedHunk[] = [];
  let sourceIndex = 0;
  let targetIndex = 0;
  let pending: { start: number; original: string[]; replacement: string[] } | null = null;

  const flush = () => {
    if (!pending) return;
    hunks.push(
      Object.freeze({
        id: `hunk-${hunks.length + 1}`,
        startLine: pending.start + 1,
        originalLines: Object.freeze([...pending.original]),
        replacementLines: Object.freeze([...pending.replacement]),
      })
    );
    pending = null;
  };

  for (const anchor of [...common, { source: source.length, target: target.length }]) {
    const removed: string[] = [];
    const added: string[] = [];
    while (sourceIndex < anchor.source) removed.push(source[sourceIndex++]);
    while (targetIndex < anchor.target) added.push(target[targetIndex++]);
    if (removed.length > 0 || added.length > 0) {
      pending = {
        start: anchor.source - removed.length,
        original: removed,
        replacement: added,
      };
      flush();
    }
    sourceIndex = anchor.source + 1;
    targetIndex = anchor.target + 1;
  }
  flush();
  return Object.freeze(hunks);
}

interface Anchor {
  readonly source: number;
  readonly target: number;
}

const MAX_DIFF_LINES = 5_000;

function longestCommonSubsequence(
  source: readonly string[],
  target: readonly string[]
): readonly Anchor[] {
  // Whole-file replacement is the honest answer for very large files: an
  // O(n*m) table would block the UI thread with no benefit to review quality.
  if (source.length > MAX_DIFF_LINES || target.length > MAX_DIFF_LINES) return [];

  const table: number[][] = Array.from({ length: source.length + 1 }, () =>
    new Array<number>(target.length + 1).fill(0)
  );
  for (let i = source.length - 1; i >= 0; i -= 1) {
    for (let j = target.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        source[i] === target[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const anchors: Anchor[] = [];
  let i = 0;
  let j = 0;
  while (i < source.length && j < target.length) {
    if (source[i] === target[j]) {
      anchors.push({ source: i, target: j });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return anchors;
}

/** True when text cannot be reviewed line by line and needs whole-file handling. */
export function isBinaryLike(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}
