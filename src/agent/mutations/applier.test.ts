import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryWorkspaceFileSystem } from '../../filesystem/memory/MemoryWorkspaceFileSystem';
import { InMemoryTransactionJournal, WorkspaceTransactionEngine } from '../../filesystem/sync';
import { workspacePath } from '../../filesystem';
import { ApprovalCoordinator } from './approval';
import { MutationApplier } from './applier';
import { parseFileChangeProposal, type FileChangeProposalV1 } from './proposal';

const SEED = [
  { path: 'src/app.ts', content: 'one\ntwo\nthree\n' },
  { path: 'src/util.ts', content: 'export const helper = 1;\n' },
  { path: 'package.json', content: '{\n  "name": "demo"\n}\n' },
];

interface Harness {
  filesystem: MemoryWorkspaceFileSystem;
  applier: MutationApplier;
  coordinator: ApprovalCoordinator;
  applyProposal: (
    proposal: FileChangeProposalV1,
    overrides?: { runId?: string; transactionId?: string }
  ) => Promise<ReturnType<MutationApplier['apply']> extends Promise<infer T> ? T : never>;
  hashOf: (path: string) => Promise<string>;
}

async function harness(): Promise<Harness> {
  const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
  const engine = new WorkspaceTransactionEngine(filesystem, {
    journal: new InMemoryTransactionJournal(),
  });
  const coordinator = new ApprovalCoordinator();
  const applier = new MutationApplier({ filesystem, engine, coordinator });
  let counter = 0;

  return {
    filesystem,
    applier,
    coordinator,
    hashOf: async (path) => (await filesystem.stat(workspacePath(path))).contentHash ?? '',
    applyProposal: async (proposal, overrides = {}) => {
      const runId = overrides.runId ?? 'run-1';
      const request = await coordinator.request({
        proposal,
        projectId: 'project-1',
        threadId: 'thread-1',
        runId,
        toolCallId: 'call-1',
        projectRevision: await filesystem.revision(),
      });
      const artifact = await coordinator.approve(request.approvalId, proposal);
      return applier.apply({
        proposal,
        artifact,
        projectId: 'project-1',
        threadId: 'thread-1',
        runId,
        toolCallId: 'call-1',
        transactionId: overrides.transactionId ?? `tx-${++counter}`,
      });
    },
  };
}

describe('MutationApplier', () => {
  let context: Harness;

  beforeEach(async () => {
    context = await harness();
  });

  it('applies a multi-file change atomically and verifies the result', async () => {
    const hash = await context.hashOf('src/app.ts');
    const proposal = parseFileChangeProposal({
      summary: 'Rework the app',
      verification: ['npm test'],
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: hash,
          reason: 'shout',
          hunks: [{ startLine: 2, originalLines: ['two'], replacementLines: ['TWO'] }],
        },
        {
          operation: 'write_file',
          path: 'src/new.ts',
          content: 'export const added = true;\n',
          reason: 'add',
        },
      ],
    });

    const outcome = await context.applyProposal(proposal);

    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.changedPaths).toEqual(expect.arrayContaining(['src/app.ts', 'src/new.ts']));
    expect(context.filesystem.readText('src/app.ts')).toBe('one\nTWO\nthree\n');
    expect(context.filesystem.readText('src/new.ts')).toBe('export const added = true;\n');
    expect(outcome.verification.find((check) => check.id === 'applied-content')?.status).toBe(
      'passed'
    );
    expect(outcome.verification.find((check) => check.id === 'recommended-1')).toMatchObject({
      status: 'unavailable',
    });
  });

  it('supports delete, move, and directory creation', async () => {
    const proposal = parseFileChangeProposal({
      summary: 'Reorganize',
      changes: [
        { operation: 'delete_file', path: 'src/util.ts', reason: 'unused' },
        { operation: 'move_file', from: 'src/app.ts', to: 'src/main.ts', reason: 'rename' },
        { operation: 'create_directory', path: 'src/generated', reason: 'output' },
      ],
    });

    const outcome = await context.applyProposal(proposal);

    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(context.filesystem.readText('src/util.ts')).toBeUndefined();
    expect(context.filesystem.readText('src/main.ts')).toBe('one\ntwo\nthree\n');
    // Removals are verified too: the deleted and vacated paths must be gone.
    const applied = outcome.verification.find((check) => check.id === 'applied-content');
    expect(applied?.status).toBe('passed');
    expect(applied?.detail).toContain('3 path(s)');
    expect(
      (await context.filesystem.stat(workspacePath('src/generated'))).kind
    ).toBe('directory');
  });

  it('reports a conflict and changes nothing when a file moved on underneath', async () => {
    const staleHash = await context.hashOf('src/app.ts');
    const proposal = parseFileChangeProposal({
      summary: 'Patch',
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: staleHash,
          reason: 'r',
          hunks: [{ startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] }],
        },
      ],
    });

    const request = await context.coordinator.request({
      proposal,
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      projectRevision: await context.filesystem.revision(),
    });
    const artifact = await context.coordinator.approve(request.approvalId, proposal);

    // Someone edits the file between approval and application.
    await context.filesystem.writeFile(
      workspacePath('src/app.ts'),
      new TextEncoder().encode('edited by the user\n'),
      { type: 'match', projectRevision: await context.filesystem.revision(), contentHash: staleHash }
    );

    const outcome = await context.applier.apply({
      proposal,
      artifact,
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      transactionId: 'tx-conflict',
    });

    // The revision moved, so the approval itself no longer authorizes anything.
    expect(outcome.status).toBe('conflict');
    if (outcome.status !== 'conflict') return;
    expect(outcome.conflicts[0].reason).toMatch(/changed after this change was approved/);
    expect(context.filesystem.readText('src/app.ts')).toBe('edited by the user\n');
  });

  it('reports a hash conflict without touching the workspace', async () => {
    const proposal = parseFileChangeProposal({
      summary: 'Patch a file with a stale hash',
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: 'b'.repeat(64),
          reason: 'r',
          hunks: [{ startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] }],
        },
      ],
    });

    const outcome = await context.applyProposal(proposal);

    expect(outcome.status).toBe('conflict');
    if (outcome.status !== 'conflict') return;
    expect(outcome.conflicts[0]).toMatchObject({ path: 'src/app.ts' });
    expect(context.filesystem.readText('src/app.ts')).toBe('one\ntwo\nthree\n');
    expect(await context.filesystem.revision()).toBe(0);
  });

  it('refuses to overwrite a file the proposal did not read', async () => {
    const proposal = parseFileChangeProposal({
      summary: 'Blind overwrite',
      changes: [
        { operation: 'write_file', path: 'src/app.ts', content: 'clobbered\n', reason: 'r' },
      ],
    });

    const outcome = await context.applyProposal(proposal);

    expect(outcome.status).toBe('conflict');
    expect(context.filesystem.readText('src/app.ts')).toBe('one\ntwo\nthree\n');
  });

  it('leaves no partial commit when one change in a batch fails', async () => {
    const hash = await context.hashOf('src/app.ts');
    const proposal = parseFileChangeProposal({
      summary: 'Half-valid batch',
      changes: [
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: hash,
          reason: 'ok',
          hunks: [{ startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] }],
        },
        { operation: 'delete_file', path: 'src/missing.ts', reason: 'gone' },
      ],
    });

    const outcome = await context.applyProposal(proposal);

    expect(outcome.status).toBe('conflict');
    expect(context.filesystem.readText('src/app.ts')).toBe('one\ntwo\nthree\n');
    expect(await context.filesystem.revision()).toBe(0);
  });

  it('rejects an approval that was already consumed', async () => {
    const proposal = parseFileChangeProposal({
      summary: 'Create a file',
      changes: [
        { operation: 'write_file', path: 'src/once.ts', content: 'once\n', reason: 'r' },
      ],
    });
    const request = await context.coordinator.request({
      proposal,
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      projectRevision: await context.filesystem.revision(),
    });
    const artifact = await context.coordinator.approve(request.approvalId, proposal);
    const send = (transactionId: string) =>
      context.applier.apply({
        proposal,
        artifact,
        projectId: 'project-1',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        transactionId,
      });

    const [first, second] = [await send('tx-a'), await send('tx-b')];

    expect(first.status).toBe('applied');
    expect(second.status).toBe('failed');
    expect(context.filesystem.listFiles().filter((file) => file.path === 'src/once.ts')).toHaveLength(
      1
    );
  });

  it('does not apply anything when cancelled before the transaction', async () => {
    const controller = new AbortController();
    const proposal = parseFileChangeProposal({
      summary: 'Create a file',
      changes: [
        { operation: 'write_file', path: 'src/cancelled.ts', content: 'x\n', reason: 'r' },
      ],
    });
    const request = await context.coordinator.request({
      proposal,
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      projectRevision: await context.filesystem.revision(),
    });
    const artifact = await context.coordinator.approve(request.approvalId, proposal);
    controller.abort();

    const outcome = await context.applier.apply({
      proposal,
      artifact,
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      transactionId: 'tx-cancel',
      signal: controller.signal,
    });

    expect(outcome.status).toBe('failed');
    expect(context.filesystem.readText('src/cancelled.ts')).toBeUndefined();
    expect(await context.filesystem.revision()).toBe(0);
  });

  it('fails verification honestly when a changed JSON file is invalid', async () => {
    const hash = await context.hashOf('package.json');
    const proposal = parseFileChangeProposal({
      summary: 'Break the manifest',
      changes: [
        {
          operation: 'write_file',
          path: 'package.json',
          content: '{ "name": ',
          reason: 'r',
          expectedHash: hash,
        },
      ],
    });

    const outcome = await context.applyProposal(proposal);

    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    const json = outcome.verification.find((check) => check.id === 'json-syntax');
    expect(json?.status).toBe('failed');
    expect(json?.detail).toContain('package.json');
  });

  it('restores a checkpoint byte-for-byte', async () => {
    const before = context.filesystem.listFiles().map((file) => ({ ...file }));
    const hash = await context.hashOf('src/app.ts');
    const proposal = parseFileChangeProposal({
      summary: 'Change then undo',
      changes: [
        {
          operation: 'write_file',
          path: 'src/app.ts',
          content: 'totally different\n',
          reason: 'r',
          expectedHash: hash,
        },
        { operation: 'delete_file', path: 'src/util.ts', reason: 'r' },
      ],
    });

    const outcome = await context.applyProposal(proposal);
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;

    await context.filesystem.restore({
      id: outcome.checkpointId,
      revision: outcome.previousRevision,
      createdAt: 0,
      entries: [],
    });

    expect(context.filesystem.listFiles()).toEqual(before);
  });
});
