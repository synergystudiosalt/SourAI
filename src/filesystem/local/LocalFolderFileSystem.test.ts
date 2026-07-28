import { describe, expect, it, vi } from 'vitest';
import { WorkspaceFsError } from '../errors';
import { workspacePath, workspaceRoot } from '../path';
import { LocalFolderFileSystem } from './LocalFolderFileSystem';

class MemoryFileHandle {
  readonly kind = 'file' as const;
  constructor(readonly name: string, private bytes = new Uint8Array()) {}
  async getFile(): Promise<File> {
    return new File([this.bytes], this.name, { lastModified: 1 });
  }
  async createWritable(): Promise<FileSystemWritableFileStream> {
    let next = new Uint8Array();
    return {
      write: async (value: FileSystemWriteChunkType) => {
        if (value instanceof Uint8Array) next = new Uint8Array(value);
        else if (value instanceof Blob) next = new Uint8Array(await value.arrayBuffer());
        else throw new Error('Unsupported test write');
      },
      close: async () => {
        this.bytes = next;
      },
      abort: async () => undefined,
      seek: async () => undefined,
      truncate: async () => undefined,
      locked: false,
      getWriter: () => {
        throw new Error('unused');
      },
    } as unknown as FileSystemWritableFileStream;
  }
  externalWrite(value: string): void {
    this.bytes = new TextEncoder().encode(value);
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, MemoryDirectoryHandle | MemoryFileHandle>();
  permission: 'granted' | 'denied' | 'prompt' = 'granted';
  constructor(readonly name = 'root') {}
  async queryPermission(): Promise<'granted' | 'denied' | 'prompt'> {
    return this.permission;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectoryHandle> {
    const found = this.entries.get(name);
    if (found instanceof MemoryDirectoryHandle) return found;
    if (found || !options?.create) throw new DOMException('missing', found ? 'TypeMismatchError' : 'NotFoundError');
    const created = new MemoryDirectoryHandle(name);
    this.entries.set(name, created);
    return created;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
    const found = this.entries.get(name);
    if (found instanceof MemoryFileHandle) return found;
    if (found || !options?.create) throw new DOMException('missing', found ? 'TypeMismatchError' : 'NotFoundError');
    const created = new MemoryFileHandle(name);
    this.entries.set(name, created);
    return created;
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.entries.delete(name)) throw new DOMException('missing', 'NotFoundError');
  }
  async *values(): AsyncIterableIterator<MemoryDirectoryHandle | MemoryFileHandle> {
    yield* this.entries.values();
  }
}

const bytes = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const asRoot = (value: MemoryDirectoryHandle) => value as unknown as FileSystemDirectoryHandle;

describe('LocalFolderFileSystem', () => {
  it('rechecks permission and never prompts on an agent operation', async () => {
    const root = new MemoryDirectoryHandle();
    root.permission = 'prompt';
    const fs = new LocalFolderFileSystem(asRoot(root));

    await expect(fs.readDirectory()).rejects.toMatchObject({
      code: 'permission_denied',
    } satisfies Partial<WorkspaceFsError>);
  });

  it('creates, reads, hashes and revision-checks files', async () => {
    const root = new MemoryDirectoryHandle();
    const fs = new LocalFolderFileSystem(asRoot(root));
    const path = workspacePath('src/app.ts');
    await fs.createDirectory(workspacePath('src'));
    const version = await fs.writeFile(path, bytes('one'), {
      type: 'create-only',
      projectRevision: 1,
    });

    expect(version.revision).toBe(2);
    expect(version.contentHash).toHaveLength(64);
    expect(text((await fs.readFile(path)).data)).toBe('one');
    await expect(
      fs.writeFile(path, bytes('two'), {
        type: 'match',
        projectRevision: 1,
        contentHash: version.contentHash,
      })
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('detects external changes instead of overwriting them', async () => {
    const root = new MemoryDirectoryHandle();
    const fs = new LocalFolderFileSystem(asRoot(root));
    const path = workspacePath('note.txt');
    const version = await fs.writeFile(path, bytes('original'), {
      type: 'create-only',
      projectRevision: 0,
    });
    (root.entries.get('note.txt') as MemoryFileHandle).externalWrite('external');

    await expect(
      fs.writeFile(path, bytes('agent'), {
        type: 'match',
        projectRevision: 1,
        contentHash: version.contentHash,
      })
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(text((await fs.readFile(path)).data)).toBe('external');
  });

  it('persists a checkpoint through the hook before mutation', async () => {
    const root = new MemoryDirectoryHandle();
    const order: string[] = [];
    const hook = vi.fn(async () => {
      order.push('checkpoint');
      expect(root.entries.has('new.txt')).toBe(false);
    });
    const fs = new LocalFolderFileSystem(asRoot(root), {
      checkpointBeforeMutation: hook,
      randomId: () => 'checkpoint-1',
      now: () => 10,
    });

    await fs.writeFile(workspacePath('new.txt'), bytes('value'), {
      type: 'create-only',
      projectRevision: 0,
    });
    order.push('written');
    expect(order).toEqual(['checkpoint', 'written']);
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'checkpoint-1', revision: 0 }),
      expect.objectContaining({ operation: 'write' })
    );
  });

  it('fails restore safely without deleting newer local-folder data', async () => {
    const root = new MemoryDirectoryHandle();
    const fs = new LocalFolderFileSystem(asRoot(root), { randomId: () => crypto.randomUUID() });
    const path = workspacePath('a.txt');
    let version = await fs.writeFile(path, bytes('before'), {
      type: 'create-only',
      projectRevision: 0,
    });
    const snapshot = await fs.snapshot([workspaceRoot()]);
    version = await fs.writeFile(path, bytes('after'), {
      type: 'match',
      projectRevision: 1,
      contentHash: version.contentHash,
    });
    expect(version.revision).toBe(2);

    await expect(fs.restore(snapshot)).rejects.toMatchObject({ code: 'unsupported' });
    expect(text((await fs.readFile(path)).data)).toBe('after');
    expect(await fs.revision()).toBe(2);
  });

  it('reports moves honestly as unsupported', async () => {
    const fs = new LocalFolderFileSystem(asRoot(new MemoryDirectoryHandle()));
    await expect(
      fs.movePath(workspacePath('a'), workspacePath('b'), {
        projectRevision: 0,
        destinationMustNotExist: true,
      })
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('runtime-rejects traversal and reserved paths before touching a handle', async () => {
    const root = new MemoryDirectoryHandle();
    const fs = new LocalFolderFileSystem(asRoot(root));

    await expect(fs.readFile('../secret' as never)).rejects.toMatchObject({
      code: 'permission_denied',
    });
    await expect(
      fs.writeFile('.sourai/private' as never, bytes('x'), {
        type: 'create-only',
        projectRevision: 0,
      })
    ).rejects.toMatchObject({ code: 'permission_denied' });
    expect(root.entries.size).toBe(0);
  });

  it('requires and rechecks a recursive directory tree hash', async () => {
    const root = new MemoryDirectoryHandle();
    const fs = new LocalFolderFileSystem(asRoot(root));
    const directory = workspacePath('docs');
    await fs.createDirectory(directory);
    await fs.writeFile(workspacePath('docs/a.txt'), bytes('a'), {
      type: 'create-only',
      projectRevision: 1,
    });
    const reviewedHash = (await fs.stat(directory)).contentHash!;

    await expect(
      fs.deletePath(directory, { projectRevision: 2 })
    ).rejects.toMatchObject({ code: 'conflict' });
    (root.entries.get('docs') as MemoryDirectoryHandle).entries.set(
      'external.txt',
      new MemoryFileHandle('external.txt', bytes('external'))
    );
    await expect(
      fs.deletePath(directory, { projectRevision: 2, contentHash: reviewedHash })
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(root.entries.has('docs')).toBe(true);
  });

  it('returns immutable checkpoints and rejects forged checkpoint metadata', async () => {
    const root = new MemoryDirectoryHandle();
    const fs = new LocalFolderFileSystem(asRoot(root), { randomId: () => 'snapshot' });
    await fs.writeFile(workspacePath('a.txt'), bytes('a'), {
      type: 'create-only',
      projectRevision: 0,
    });
    const snapshot = await fs.snapshot([workspaceRoot()]);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    const forged = {
      ...snapshot,
      entries: [...snapshot.entries, { path: workspacePath('forged'), kind: 'directory' as const, size: 0 }],
    };
    await expect(fs.restore(forged)).rejects.toMatchObject({ code: 'corrupt_checkpoint' });
    expect(text((await fs.readFile(workspacePath('a.txt'))).data)).toBe('a');
  });
});
