import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryWorkspaceFileSystem } from '../../filesystem/memory/MemoryWorkspaceFileSystem';
import { workspacePath } from '../../filesystem';
import { MutationReviewer } from './reviewer';
import { parseFileChangeProposal } from './proposal';

const SEED = [
  { path: 'src/app.ts', content: 'a\nb\nc\nd\ne\nf\ng\n' },
  { path: 'src/other.ts', content: 'other\n' },
];

async function setup() {
  const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
  const reviewer = new MutationReviewer({ filesystem });
  const hashOf = async (path: string) =>
    (await filesystem.stat(workspacePath(path))).contentHash ?? '';
  return { filesystem, reviewer, hashOf };
}

describe('MutationReviewer', () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    context = await setup();
  });

  const prepare = (proposal: unknown) =>
    context.reviewer.prepare({
      approvalId: 'approval-1',
      proposalId: 'proposal-1',
      runId: 'run-1',
      threadId: 'thread-1',
      projectId: 'project-1',
      toolCallId: 'call-1',
      proposal,
    });

  it('describes a patch as reviewable hunks with line counts', async () => {
    const pending = await prepare({
      summary: 'Two edits',
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: await context.hashOf('src/app.ts'),
          reason: 'r',
          hunks: [
            { startLine: 1, originalLines: ['a'], replacementLines: ['A'] },
            { startLine: 7, originalLines: ['g'], replacementLines: ['G'] },
          ],
        },
      ],
    });

    expect(pending.files).toHaveLength(1);
    expect(pending.files[0].hunks).toHaveLength(2);
    expect(pending.totalAdded).toBe(2);
    expect(pending.totalRemoved).toBe(2);
    expect(pending.hasConflict).toBe(false);
    expect(pending.files[0].hunks[0].lines.some((line) => line.kind === 'context')).toBe(true);
  });

  it('marks a stale file as conflicted before anything is approved', async () => {
    const pending = await prepare({
      summary: 'Stale patch',
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: 'c'.repeat(64),
          reason: 'r',
          hunks: [{ startLine: 1, originalLines: ['a'], replacementLines: ['A'] }],
        },
      ],
    });

    expect(pending.hasConflict).toBe(true);
    expect(pending.files[0].conflict).toMatch(/changed after the proposal/);
  });

  it('applies only the selected hunks', async () => {
    const pending = await prepare({
      summary: 'Two edits',
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: await context.hashOf('src/app.ts'),
          reason: 'r',
          hunks: [
            { startLine: 1, originalLines: ['a'], replacementLines: ['A'] },
            { startLine: 7, originalLines: ['g'], replacementLines: ['G'] },
          ],
        },
      ],
    });
    const [firstHunk] = pending.files[0].hunks;

    const { outcome, digest } = await context.reviewer.approve(pending, {
      hunks: { 'src/app.ts': [firstHunk.id] },
    });

    expect(outcome.status).toBe('applied');
    expect(context.filesystem.readText('src/app.ts')).toBe('A\nb\nc\nd\ne\nf\ng\n');
    // A different selection is a different change, so it has a new digest.
    expect(digest).not.toBe(pending.digest);
  });

  it('applies only the selected files', async () => {
    const pending = await prepare({
      summary: 'Touch two files',
      changes: [
        {
          operation: 'write_file',
          path: 'src/app.ts',
          content: 'replaced\n',
          reason: 'r',
          expectedHash: await context.hashOf('src/app.ts'),
        },
        {
          operation: 'write_file',
          path: 'src/other.ts',
          content: 'also replaced\n',
          reason: 'r',
          expectedHash: await context.hashOf('src/other.ts'),
        },
      ],
    });

    const { outcome } = await context.reviewer.approve(pending, { paths: ['src/other.ts'] });

    expect(outcome.status).toBe('applied');
    expect(context.filesystem.readText('src/app.ts')).toBe('a\nb\nc\nd\ne\nf\ng\n');
    expect(context.filesystem.readText('src/other.ts')).toBe('also replaced\n');
  });

  it('turns a partially-kept whole-file rewrite into a verified patch', async () => {
    const pending = await prepare({
      summary: 'Rewrite with two regions changed',
      changes: [
        {
          operation: 'write_file',
          path: 'src/app.ts',
          content: 'A\nb\nc\nd\ne\nf\nG\n',
          reason: 'r',
          expectedHash: await context.hashOf('src/app.ts'),
        },
      ],
    });
    expect(pending.files[0].hunks).toHaveLength(2);

    const { outcome } = await context.reviewer.approve(pending, {
      hunks: { 'src/app.ts': [pending.files[0].hunks[1].id] },
    });

    expect(outcome.status).toBe('applied');
    expect(context.filesystem.readText('src/app.ts')).toBe('a\nb\nc\nd\ne\nf\nG\n');
  });

  it('refuses an empty selection instead of applying everything', async () => {
    const pending = await prepare({
      summary: 'Edit',
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: await context.hashOf('src/app.ts'),
          reason: 'r',
          hunks: [{ startLine: 1, originalLines: ['a'], replacementLines: ['A'] }],
        },
      ],
    });

    await expect(
      context.reviewer.approve(pending, { hunks: { 'src/app.ts': [] } })
    ).rejects.toThrow(/at least one change/);
    expect(context.filesystem.readText('src/app.ts')).toBe('a\nb\nc\nd\ne\nf\ng\n');
  });

  it('keeps a denial denied', async () => {
    const pending = await prepare({
      summary: 'Edit',
      changes: [
        {
          operation: 'write_file',
          path: 'src/new.ts',
          content: 'x\n',
          reason: 'r',
        },
      ],
    });

    context.reviewer.deny(pending.approvalId);

    await expect(context.reviewer.approve(pending)).rejects.toThrow(/denied/);
    expect(context.filesystem.readText('src/new.ts')).toBeUndefined();
  });

  it('restores the checkpoint an applied transaction produced', async () => {
    const before = context.filesystem.listFiles().map((file) => ({ ...file }));
    const pending = await prepare({
      summary: 'Replace everything',
      changes: [
        {
          operation: 'write_file',
          path: 'src/app.ts',
          content: 'gone\n',
          reason: 'r',
          expectedHash: await context.hashOf('src/app.ts'),
        },
        { operation: 'delete_file', path: 'src/other.ts', reason: 'r' },
      ],
    });

    const { outcome } = await context.reviewer.approve(pending);
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;

    await context.reviewer.restore(outcome.checkpointId);

    expect(context.filesystem.listFiles()).toEqual(before);
  });

  it('rejects a proposal naming a path the parser refuses', async () => {
    await expect(
      prepare({
        summary: 'Escape',
        changes: [
          { operation: 'write_file', path: '../outside.ts', content: 'x', reason: 'r' },
        ],
      })
    ).rejects.toThrow();
    expect(await context.filesystem.revision()).toBe(0);
  });

  it('describes a delete and a move without inventing a diff', async () => {
    const pending = await prepare({
      summary: 'Remove and rename',
      changes: [
        { operation: 'delete_file', path: 'src/other.ts', reason: 'r' },
        { operation: 'move_file', from: 'src/app.ts', to: 'src/main.ts', reason: 'r' },
      ],
    });

    const [deleted, moved] = pending.files;
    expect(deleted.kind).toBe('delete');
    expect(deleted.removed).toBe(1);
    expect(moved.kind).toBe('move');
    expect(moved.destination).toBe('src/main.ts');
  });
});

describe('MutationReviewer.select', () => {
  it('produces a proposal that parses and contains only what was kept', async () => {
    const { filesystem, reviewer } = await setup();
    const hash = (await filesystem.stat(workspacePath('src/app.ts'))).contentHash ?? '';
    const proposal = parseFileChangeProposal({
      summary: 'Edit two files',
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: hash,
          reason: 'r',
          hunks: [{ startLine: 1, originalLines: ['a'], replacementLines: ['A'] }],
        },
        { operation: 'delete_file', path: 'src/other.ts', reason: 'r' },
      ],
    });

    const selected = reviewer.select(proposal, { paths: ['src/other.ts'] });

    expect(selected.changes).toHaveLength(1);
    expect(selected.changes[0].operation).toBe('delete_file');
  });
});
