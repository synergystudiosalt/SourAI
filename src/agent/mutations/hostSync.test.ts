import { describe, expect, it } from 'vitest';

import { MemoryWorkspaceFileSystem } from '../../filesystem/memory/MemoryWorkspaceFileSystem';
import { workspacePath } from '../../filesystem';
import { MutationReviewer } from './reviewer';

/**
 * Editor edits during a review.
 *
 * The user typing must always win over a proposal made before they typed, and
 * the mechanism is the ordinary revision check rather than a special case.
 */

const SEED = [{ path: 'src/app.ts', content: 'one\ntwo\n' }];

describe('syncFromHost', () => {
  it('reports no change when the editor content is identical', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    expect(await filesystem.syncFromHost(SEED)).toBe(0);
    expect(await filesystem.revision()).toBe(0);
  });

  it('folds an edit in and advances the revision', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);

    const changes = await filesystem.syncFromHost([
      { path: 'src/app.ts', content: 'one\nEDITED\n' },
    ]);

    expect(changes).toBe(1);
    expect(await filesystem.revision()).toBe(1);
    expect(filesystem.readText('src/app.ts')).toBe('one\nEDITED\n');
  });

  it('records added and removed files', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);

    const changes = await filesystem.syncFromHost([{ path: 'src/new.ts', content: 'new\n' }]);

    expect(changes).toBe(2);
    expect(filesystem.readText('src/app.ts')).toBeUndefined();
    expect(filesystem.readText('src/new.ts')).toBe('new\n');
  });

  it('invalidates an approval taken before the user edited the file', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    const reviewer = new MutationReviewer({ filesystem });
    const hash = (await filesystem.stat(workspacePath('src/app.ts'))).contentHash ?? '';
    const pending = await reviewer.prepare({
      approvalId: 'approval-1',
      proposalId: 'proposal-1',
      runId: 'run-1',
      threadId: 'thread-1',
      projectId: 'project-1',
      toolCallId: 'call-1',
      proposal: {
        summary: 'Edit',
        changes: [
          {
            operation: 'patch_file',
            path: 'src/app.ts',
            expectedHash: hash,
            reason: 'r',
            hunks: [{ startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] }],
          },
        ],
      },
    });

    // The user types while the review card is open.
    await filesystem.syncFromHost([{ path: 'src/app.ts', content: 'typed by the user\n' }]);

    const { outcome } = await reviewer.approve(pending);

    expect(outcome.status).toBe('conflict');
    expect(filesystem.readText('src/app.ts')).toBe('typed by the user\n');
  });
});
