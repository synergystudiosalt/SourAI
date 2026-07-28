import { describe, expect, it } from 'vitest';

import { OpfsContentAddressedBlobStore, type OpfsDirectoryHandle } from '../../storage/blobStore';
import { InMemoryOpfs } from '../../storage/testing/inMemoryOpfs';
import { workspacePath } from '../path';
import type { SnapshotManifest } from '../types';
import { OpfsWorkspaceFileSystem } from './OpfsWorkspaceFileSystem';

const encode = (value: string) => Uint8Array.from(new TextEncoder().encode(value));
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const digest = async (bytes: Uint8Array): Promise<string> => {
  let value = 2166136261;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0;
  return value.toString(16).padStart(64, '0');
};

function setup(opfs = new InMemoryOpfs()) {
  let now = 1_000;
  let id = 0;
  const fs = new OpfsWorkspaceFileSystem({
    projectId: 'project-1',
    getRoot: opfs.getRoot,
    digest,
    now: () => ++now,
    createId: () => `checkpoint-${++id}`,
  });
  return { fs, opfs };
}

async function directoryAt(
  root: OpfsDirectoryHandle,
  path: readonly string[]
): Promise<OpfsDirectoryHandle> {
  let directory = root;
  for (const name of path) directory = await directory.getDirectoryHandle(name, { create: true });
  return directory;
}

async function writeJson(
  opfs: InMemoryOpfs,
  path: readonly string[],
  name: string,
  value: unknown
): Promise<void> {
  const directory = await directoryAt(await opfs.getRoot(), path);
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  await writable.write(encode(JSON.stringify(value)));
  await writable.close();
}

describe('OpfsWorkspaceFileSystem', () => {
  it('persists files by content hash and reopens from the atomic manifest', async () => {
    const { fs, opfs } = setup();
    await fs.createDirectory(workspacePath('src'));
    const version = await fs.writeFile(
      workspacePath('src/main.ts'),
      encode('export const answer = 42;\n'),
      { type: 'create-only', projectRevision: 1 },
      'agent'
    );

    expect(version.revision).toBe(2);
    expect((await fs.stat(workspacePath('src/main.ts'))).contentHash).toBe(version.contentHash);
    expect(decode((await fs.readFile(workspacePath('src/main.ts'))).data)).toBe(
      'export const answer = 42;\n'
    );
    expect(await fs.readDirectory(workspacePath('src'))).toMatchObject([
      { name: 'main.ts', kind: 'file', size: 26 },
    ]);

    const reopened = new OpfsWorkspaceFileSystem({
      projectId: 'project-1',
      getRoot: opfs.getRoot,
      digest,
    });
    expect(await reopened.revision()).toBe(2);
    expect(decode((await reopened.readFile(workspacePath('src/main.ts'))).data)).toBe(
      'export const answer = 42;\n'
    );

    const files = Object.keys(await opfs.snapshot());
    expect(files).toContain(`blobs/${version.contentHash.slice(0, 2)}/${version.contentHash.slice(2)}`);
    expect(files).toContain('workspaces/project-1/current.json');
    expect(files).toContain('workspaces/project-1/manifests/revision-0000000000000002.json');
    expect(files).not.toContain('workspaces/project-1/journal/pending.json');
  });

  it('enforces optimistic preconditions without changing revision', async () => {
    const { fs } = setup();
    const created = await fs.writeFile(workspacePath('a.txt'), encode('one'), {
      type: 'create-only',
      projectRevision: 0,
    });

    await expect(
      fs.writeFile(workspacePath('a.txt'), encode('two'), {
        type: 'create-only',
        projectRevision: 1,
      })
    ).rejects.toMatchObject({ code: 'already_exists' });
    await expect(
      fs.writeFile(workspacePath('a.txt'), encode('two'), {
        type: 'match',
        projectRevision: 1,
        contentHash: '0'.repeat(64),
      })
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      fs.deletePath(workspacePath('a.txt'), {
        projectRevision: 0,
        contentHash: created.contentHash,
      })
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await fs.revision()).toBe(1);
    expect(decode((await fs.readFile(workspacePath('a.txt'))).data)).toBe('one');
  });

  it('serializes two instances and rejects the stale concurrent writer', async () => {
    const opfs = new InMemoryOpfs();
    const first = new OpfsWorkspaceFileSystem({
      projectId: 'shared-project',
      getRoot: opfs.getRoot,
      digest,
    });
    const second = new OpfsWorkspaceFileSystem({
      projectId: 'shared-project',
      getRoot: opfs.getRoot,
      digest,
    });

    const results = await Promise.allSettled([
      first.writeFile(workspacePath('first.txt'), encode('first'), {
        type: 'create-only',
        projectRevision: 0,
      }),
      second.writeFile(workspacePath('second.txt'), encode('second'), {
        type: 'create-only',
        projectRevision: 0,
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'conflict' } },
    ]);
    expect(await first.revision()).toBe(1);
    const entries = await second.readDirectory();
    expect(entries).toHaveLength(1);
    expect(['first.txt', 'second.txt']).toContain(entries[0].name);
  });

  it('moves and recursively deletes directory trees and reports changes', async () => {
    const { fs } = setup();
    const changes: string[] = [];
    const unsubscribe = fs.watch?.((change) => changes.push(`${change.type}:${change.path}`));
    await fs.createDirectory(workspacePath('src'));
    await fs.createDirectory(workspacePath('src/lib'));
    await fs.writeFile(workspacePath('src/lib/a.ts'), encode('a'), {
      type: 'create-only',
      projectRevision: 2,
    });
    await fs.movePath(workspacePath('src'), workspacePath('app'), {
      projectRevision: 3,
      destinationMustNotExist: true,
    });

    expect(decode((await fs.readFile(workspacePath('app/lib/a.ts'))).data)).toBe('a');
    await expect(fs.stat(workspacePath('src/lib/a.ts'))).rejects.toMatchObject({
      code: 'not_found',
    });
    await fs.deletePath(workspacePath('app'), { projectRevision: 4 });
    expect(await fs.readDirectory()).toEqual([]);
    expect(changes).toEqual([
      'created:src',
      'created:src/lib',
      'created:src/lib/a.ts',
      'moved:app',
      'deleted:app',
    ]);
    unsubscribe?.();
  });

  it('creates durable checkpoints and restores byte-identical content', async () => {
    const { fs, opfs } = setup();
    await fs.createDirectory(workspacePath('data'));
    const original = new Uint8Array([0, 255, 1, 2, 128, 10]);
    const first = await fs.writeFile(workspacePath('data/raw.bin'), original, {
      type: 'create-only',
      projectRevision: 1,
    });
    const checkpoint = await fs.snapshot();

    await fs.writeFile(workspacePath('data/raw.bin'), encode('changed'), {
      type: 'match',
      projectRevision: 2,
      contentHash: first.contentHash,
    });
    await fs.writeFile(workspacePath('extra.txt'), encode('remove me'), {
      type: 'create-only',
      projectRevision: 3,
    });
    await fs.restore(checkpoint);

    expect((await fs.readFile(workspacePath('data/raw.bin'))).data).toEqual(original);
    await expect(fs.stat(workspacePath('extra.txt'))).rejects.toMatchObject({ code: 'not_found' });
    expect(await fs.revision()).toBe(5);
    expect(Object.keys(await opfs.snapshot())).toContain(
      'workspaces/project-1/checkpoints/checkpoint-1.json'
    );
  });

  it('restores a partial checkpoint without deleting unrelated files', async () => {
    const { fs } = setup();
    await fs.writeFile(workspacePath('keep.txt'), encode('keep'), {
      type: 'create-only',
      projectRevision: 0,
    });
    const original = await fs.writeFile(workspacePath('target.txt'), encode('original'), {
      type: 'create-only',
      projectRevision: 1,
    });
    const checkpoint = await fs.snapshot([workspacePath('target.txt')]);
    await fs.writeFile(workspacePath('target.txt'), encode('changed'), {
      type: 'match',
      projectRevision: 2,
      contentHash: original.contentHash,
    });
    await fs.writeFile(workspacePath('later.txt'), encode('later'), {
      type: 'create-only',
      projectRevision: 3,
    });

    await fs.restore(checkpoint);

    expect(decode((await fs.readFile(workspacePath('target.txt'))).data)).toBe('original');
    expect(decode((await fs.readFile(workspacePath('keep.txt'))).data)).toBe('keep');
    expect(decode((await fs.readFile(workspacePath('later.txt'))).data)).toBe('later');
    expect(await fs.revision()).toBe(5);
  });

  it('rejects corrupt checkpoints before modifying the workspace', async () => {
    const { fs } = setup();
    await fs.writeFile(workspacePath('safe.txt'), encode('safe'), {
      type: 'create-only',
      projectRevision: 0,
    });
    const corrupt: SnapshotManifest = {
      id: 'bad',
      revision: 1,
      createdAt: 1,
      entries: [
        {
          path: workspacePath('lost.txt'),
          kind: 'file',
          size: 4,
          contentHash: 'f'.repeat(64),
        },
      ],
    };

    await expect(fs.restore(corrupt)).rejects.toMatchObject({ code: 'corrupt_checkpoint' });
    expect(await fs.revision()).toBe(1);
    expect(decode((await fs.readFile(workspacePath('safe.txt'))).data)).toBe('safe');
  });

  it('finishes an interrupted journal transaction exactly once on reopen', async () => {
    const { fs, opfs } = setup();
    await fs.writeFile(workspacePath('before.txt'), encode('before'), {
      type: 'create-only',
      projectRevision: 0,
    });
    const blobStore = new OpfsContentAddressedBlobStore({ getRoot: opfs.getRoot, digest });
    const after = await blobStore.put(encode('after'));
    const target = {
      format: 1,
      revision: 2,
      createdAt: 2_000,
      entries: [
        {
          path: 'after.txt',
          kind: 'file',
          size: 5,
          contentHash: after.hash,
          modifiedAt: 2_000,
        },
      ],
    };
    await writeJson(
      opfs,
      ['workspaces', 'project-1', 'journal'],
      'pending.json',
      { format: 1, baseRevision: 1, target }
    );

    const recovered = new OpfsWorkspaceFileSystem({
      projectId: 'project-1',
      getRoot: opfs.getRoot,
      digest,
    });
    expect(await recovered.revision()).toBe(2);
    expect(decode((await recovered.readFile(workspacePath('after.txt'))).data)).toBe('after');
    await expect(recovered.stat(workspacePath('before.txt'))).rejects.toMatchObject({
      code: 'not_found',
    });

    const reopened = new OpfsWorkspaceFileSystem({
      projectId: 'project-1',
      getRoot: opfs.getRoot,
      digest,
    });
    expect(await reopened.revision()).toBe(2);
    expect(Object.keys(await opfs.snapshot())).not.toContain(
      'workspaces/project-1/journal/pending.json'
    );
  });
});
