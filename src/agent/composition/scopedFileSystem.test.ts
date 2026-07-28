import { describe, expect, it } from 'vitest';

import { SnapshotWorkspaceFileSystem } from '../../filesystem/snapshot/SnapshotWorkspaceFileSystem';
import { workspacePath, workspaceRoot } from '../../filesystem';
import { ContextScope } from '../context/scope';
import { buildWorkspaceSnapshot } from '../context/snapshot';
import { createScopedFileSystem } from './scopedFileSystem';

const digest = async (bytes: Uint8Array) =>
  bytes.byteLength.toString(16).padStart(64, '0').slice(0, 64);

/**
 * The host normally filters excluded files out of the snapshot. These tests
 * deliberately build the snapshot with an empty scope so the wrapper is the
 * only thing standing between a tool and an excluded path.
 */
async function scopedFileSystem(scope: ContextScope) {
  const snapshot = await buildWorkspaceSnapshot(
    'project',
    4,
    [
      { path: 'src/app.ts', content: 'app', isLoaded: true },
      { path: 'src/deep/util.ts', content: 'util', isLoaded: true },
      { path: 'docs/readme.md', content: 'docs', isLoaded: true },
      { path: 'secrets/tls.key', content: 'PRIVATE', isLoaded: true },
    ],
    new ContextScope({ noisePaths: [] }),
    undefined,
    digest
  );
  // Sensitive paths never survive snapshot construction, so re-add one to prove
  // the wrapper blocks it independently.
  const withSecret = {
    ...snapshot,
    files: [
      ...snapshot.files,
      {
        path: workspacePath('secrets/tls.key'),
        content: 'PRIVATE',
        size: 7,
        contentHash: 'a'.repeat(64),
      },
    ],
  };
  return createScopedFileSystem(new SnapshotWorkspaceFileSystem(withSecret), scope);
}

describe('createScopedFileSystem', () => {
  it('reads a file inside the scope', async () => {
    const filesystem = await scopedFileSystem(ContextScope.projectDefault());
    const result = await filesystem.readFile(workspacePath('src/app.ts'));
    expect(new TextDecoder().decode(result.data)).toBe('app');
    expect(result.version.revision).toBe(4);
  });

  it('refuses a sensitive path even when the underlying store has it', async () => {
    const filesystem = await scopedFileSystem(ContextScope.projectDefault());
    await expect(filesystem.readFile(workspacePath('secrets/tls.key'))).rejects.toThrow(
      /credentials/i
    );
  });

  it('refuses a path outside the configured roots', async () => {
    const filesystem = await scopedFileSystem(new ContextScope({ roots: ['src'] }));
    await expect(filesystem.readFile(workspacePath('docs/readme.md'))).rejects.toThrow(
      /outside the approved context scope/
    );
    await expect(filesystem.stat(workspacePath('docs/readme.md'))).rejects.toThrow();
  });

  it('hides out-of-scope entries from directory listings', async () => {
    const filesystem = await scopedFileSystem(new ContextScope({ roots: ['src'] }));
    const entries = await filesystem.readDirectory(workspaceRoot());
    expect(entries.map((entry) => String(entry.path))).toEqual(['src']);
  });

  it('fails every mutation path closed', async () => {
    const filesystem = await scopedFileSystem(ContextScope.projectDefault());
    const path = workspacePath('src/app.ts');
    await expect(
      filesystem.writeFile(path, new Uint8Array([1]), { type: 'create-only', projectRevision: 4 })
    ).rejects.toThrow(/mutation/i);
    await expect(filesystem.deletePath(path, { projectRevision: 4 })).rejects.toThrow(/mutation/i);
    await expect(
      filesystem.movePath(path, workspacePath('src/b.ts'), {
        projectRevision: 4,
        destinationMustNotExist: true,
      })
    ).rejects.toThrow(/mutation/i);
    await expect(filesystem.createDirectory(workspacePath('new'))).rejects.toThrow(/mutation/i);
  });
});
