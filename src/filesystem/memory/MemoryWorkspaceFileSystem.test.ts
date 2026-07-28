import { describe, expect, it } from 'vitest';

import { workspacePath, workspaceRoot, type FileChange } from '../index';
import { MemoryWorkspaceFileSystem } from './MemoryWorkspaceFileSystem';

const encoder = new TextEncoder();
const seed = [
  { path: 'src/app.ts', content: 'app\n' },
  { path: 'src/deep/util.ts', content: 'util\n' },
];

const load = () => MemoryWorkspaceFileSystem.fromFiles(seed);

describe('MemoryWorkspaceFileSystem', () => {
  it('starts at revision zero and exposes seeded content', async () => {
    const filesystem = await load();
    expect(await filesystem.revision()).toBe(0);
    const read = await filesystem.readFile(workspacePath('src/app.ts'));
    expect(new TextDecoder().decode(read.data)).toBe('app\n');
    expect(read.version.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates parent directories for seeded and written files', async () => {
    const filesystem = await load();
    expect((await filesystem.stat(workspacePath('src/deep'))).kind).toBe('directory');
    const root = await filesystem.readDirectory(workspaceRoot());
    expect(root.map((entry) => entry.name)).toEqual(['src']);
  });

  it('advances the revision once per accepted mutation', async () => {
    const filesystem = await load();
    await filesystem.writeFile(workspacePath('a.ts'), encoder.encode('a'), {
      type: 'create-only',
      projectRevision: 0,
    });
    expect(await filesystem.revision()).toBe(1);
    await filesystem.deletePath(workspacePath('a.ts'), { projectRevision: 1 });
    expect(await filesystem.revision()).toBe(2);
  });

  it('refuses a write whose expected revision is stale', async () => {
    const filesystem = await load();
    await filesystem.writeFile(workspacePath('a.ts'), encoder.encode('a'), {
      type: 'create-only',
      projectRevision: 0,
    });
    await expect(
      filesystem.writeFile(workspacePath('b.ts'), encoder.encode('b'), {
        type: 'create-only',
        projectRevision: 0,
      })
    ).rejects.toThrow(/revision/);
  });

  it('refuses a write whose expected content hash is stale', async () => {
    const filesystem = await load();
    await expect(
      filesystem.writeFile(workspacePath('src/app.ts'), encoder.encode('changed'), {
        type: 'match',
        projectRevision: 0,
        contentHash: 'b'.repeat(64),
      })
    ).rejects.toThrow(/changed since it was read/);
    expect(filesystem.readText('src/app.ts')).toBe('app\n');
  });

  it('refuses to create a file that already exists', async () => {
    const filesystem = await load();
    await expect(
      filesystem.writeFile(workspacePath('src/app.ts'), encoder.encode('x'), {
        type: 'create-only',
        projectRevision: 0,
      })
    ).rejects.toThrow(/already exists/);
  });

  it('rejects paths that escape the project root', async () => {
    const filesystem = await load();
    for (const path of ['../escape.ts', '/etc/passwd', 'C:/x.txt']) {
      await expect(filesystem.readFile(path as never)).rejects.toThrow();
      await expect(
        filesystem.writeFile(path as never, encoder.encode('x'), {
          type: 'create-only',
          projectRevision: 0,
        })
      ).rejects.toThrow();
    }
  });

  it('moves a file and refuses an occupied destination', async () => {
    const filesystem = await load();
    await filesystem.movePath(
      workspacePath('src/app.ts'),
      workspacePath('src/main.ts'),
      { projectRevision: 0, destinationMustNotExist: true }
    );
    expect(filesystem.readText('src/main.ts')).toBe('app\n');
    expect(filesystem.readText('src/app.ts')).toBeUndefined();

    await expect(
      filesystem.movePath(workspacePath('src/main.ts'), workspacePath('src/deep/util.ts'), {
        projectRevision: 1,
        destinationMustNotExist: true,
      })
    ).rejects.toThrow(/already exists/);
  });

  it('deletes a directory subtree', async () => {
    const filesystem = await load();
    await filesystem.deletePath(workspacePath('src/deep'), { projectRevision: 0 });
    expect(filesystem.readText('src/deep/util.ts')).toBeUndefined();
  });

  it('restores a snapshot byte-for-byte, including deletions', async () => {
    const filesystem = await load();
    const before = filesystem.listFiles().map((file) => ({ ...file }));
    const checkpoint = await filesystem.snapshot();

    await filesystem.writeFile(workspacePath('src/app.ts'), encoder.encode('mutated\n'), {
      type: 'match',
      projectRevision: 0,
      contentHash: (await filesystem.stat(workspacePath('src/app.ts'))).contentHash!,
    });
    await filesystem.deletePath(workspacePath('src/deep/util.ts'), { projectRevision: 1 });
    await filesystem.writeFile(workspacePath('extra.ts'), encoder.encode('extra'), {
      type: 'create-only',
      projectRevision: 2,
    });

    await filesystem.restore(checkpoint);

    expect(filesystem.listFiles()).toEqual(before);
    expect(filesystem.readText('extra.ts')).toBeUndefined();
  });

  it('announces every accepted change with its revision', async () => {
    const filesystem = await load();
    const changes: FileChange[] = [];
    filesystem.watch((change) => changes.push(change));

    await filesystem.writeFile(workspacePath('new.ts'), encoder.encode('n'), {
      type: 'create-only',
      projectRevision: 0,
    });

    expect(changes).toEqual([
      { path: 'new.ts', type: 'created', revision: 1, origin: 'agent' },
    ]);
  });

  it('serializes concurrent mutations so only one can win a revision', async () => {
    const filesystem = await load();
    const results = await Promise.allSettled([
      filesystem.writeFile(workspacePath('a.ts'), encoder.encode('a'), {
        type: 'create-only',
        projectRevision: 0,
      }),
      filesystem.writeFile(workspacePath('b.ts'), encoder.encode('b'), {
        type: 'create-only',
        projectRevision: 0,
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await filesystem.revision()).toBe(1);
  });

  it('reports itself as capable of atomic transactions', async () => {
    const filesystem = await load();
    expect(filesystem.capabilities().atomicTransactions).toBe(true);
  });
});
