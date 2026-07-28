import { describe, expect, it } from 'vitest';
import { WorkspaceFsError } from '../errors';
import { workspacePath } from '../path';
import type {
  DirectoryEntry,
  FileChange,
  FileChangeListener,
  FileChangeOrigin,
  FileReadResult,
  FileStat,
  FileSystemCapabilities,
  SnapshotManifest,
  WorkspaceFileSystem,
  WorkspacePath,
  WorkspaceTransaction,
} from '../types';
import { InMemoryTransactionJournal } from './journal';
import { StorageDatabaseTransactionJournal } from './journal';
import { FileChangeLoopGuard } from './loopGuard';
import { WorkspaceTransactionEngine } from './transactionEngine';
import { InMemoryStorageDatabase } from '../../storage/testing/inMemoryDatabase';

const bytes = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const hash = (value: Uint8Array) =>
  [...value].reduce((result, byte) => ((result * 31 + byte) >>> 0), 7).toString(16);

class FakeWorkspace implements WorkspaceFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly events: FileChange[] = [];
  readonly checkpoints = new Map<string, Map<string, Uint8Array>>();
  failAtOperation?: number;
  beforeOperation?: (operation: number) => void;
  restoreCalls = 0;
  private rev = 0;
  private operations = 0;
  private readonly listeners = new Set<FileChangeListener>();

  seed(path: string, value: string): void {
    this.files.set(path, bytes(value));
  }
  capabilities(): FileSystemCapabilities {
    return { persistent: false, localFolder: false, atomicTransactions: true, watch: true };
  }
  async revision(): Promise<number> {
    return this.rev;
  }
  async stat(path: WorkspacePath): Promise<FileStat> {
    const data = this.files.get(path);
    if (!data) throw new WorkspaceFsError('not_found', 'missing', path);
    return { path, kind: 'file', size: data.length, modifiedAt: 0, contentHash: hash(data) };
  }
  async readFile(path: WorkspacePath): Promise<FileReadResult> {
    const stat = await this.stat(path);
    const data = this.files.get(path)!;
    return { path, data: data.slice(), version: { revision: this.rev, contentHash: stat.contentHash! } };
  }
  async readDirectory(): Promise<DirectoryEntry[]> {
    return [];
  }
  async writeFile(
    path: WorkspacePath,
    data: Uint8Array,
    condition: Parameters<WorkspaceFileSystem['writeFile']>[2],
    origin: FileChangeOrigin = 'editor'
  ) {
    this.checkFailure();
    this.checkRevision(condition.projectRevision);
    const current = this.files.get(path);
    if (condition.type === 'create-only' && current) throw new WorkspaceFsError('conflict', 'exists');
    if (condition.type === 'match' && (!current || hash(current) !== condition.contentHash)) {
      throw new WorkspaceFsError('conflict', 'hash mismatch');
    }
    this.files.set(path, data.slice());
    const type = current ? 'modified' : 'created';
    this.emit({ path, type, revision: ++this.rev, origin });
    return { revision: this.rev, contentHash: hash(data) };
  }
  async createDirectory(): Promise<void> {}
  async deletePath(
    path: WorkspacePath,
    condition: Parameters<WorkspaceFileSystem['deletePath']>[1],
    origin: FileChangeOrigin = 'editor'
  ): Promise<void> {
    this.checkFailure();
    this.checkRevision(condition.projectRevision);
    const current = this.files.get(path);
    if (!current || (condition.contentHash && hash(current) !== condition.contentHash)) {
      throw new WorkspaceFsError('conflict', 'delete conflict');
    }
    this.files.delete(path);
    this.emit({ path, type: 'deleted', revision: ++this.rev, origin });
  }
  async movePath(
    from: WorkspacePath,
    to: WorkspacePath,
    condition: Parameters<WorkspaceFileSystem['movePath']>[2],
    origin: FileChangeOrigin = 'editor'
  ): Promise<void> {
    this.checkFailure();
    this.checkRevision(condition.projectRevision);
    const current = this.files.get(from);
    if (!current || this.files.has(to) || (condition.contentHash && hash(current) !== condition.contentHash)) {
      throw new WorkspaceFsError('conflict', 'move conflict');
    }
    this.files.delete(from);
    this.files.set(to, current);
    this.emit({ path: to, from, type: 'moved', revision: ++this.rev, origin });
  }
  async snapshot(): Promise<SnapshotManifest> {
    const id = crypto.randomUUID();
    this.checkpoints.set(
      id,
      new Map([...this.files].map(([path, data]) => [path, data.slice()]))
    );
    return {
      id,
      revision: this.rev,
      createdAt: Date.now(),
      entries: [...this.files].map(([path, data]) => ({
        path: workspacePath(path),
        kind: 'file' as const,
        size: data.length,
        contentHash: hash(data),
      })),
    };
  }
  async restore(snapshot: SnapshotManifest): Promise<void> {
    this.restoreCalls += 1;
    const saved = this.checkpoints.get(snapshot.id);
    if (!saved) throw new WorkspaceFsError('corrupt_checkpoint', 'missing');
    this.files.clear();
    for (const [path, data] of saved) this.files.set(path, data.slice());
    this.rev += 1;
  }
  watch(listener: FileChangeListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private checkFailure(): void {
    this.operations += 1;
    this.beforeOperation?.(this.operations);
    if (this.operations === this.failAtOperation) throw new Error('injected failure');
  }
  externalWrite(path: string, value: string): void {
    this.files.set(path, bytes(value));
    this.rev += 1;
  }
  private checkRevision(expected: number): void {
    if (expected !== this.rev) throw new WorkspaceFsError('conflict', 'revision mismatch');
  }
  private emit(change: FileChange): void {
    this.events.push(change);
    for (const listener of this.listeners) listener(change);
  }
}

function transaction(
  fs: FakeWorkspace,
  mutations: WorkspaceTransaction['mutations'],
  id = crypto.randomUUID()
): Promise<WorkspaceTransaction> {
  return fs.revision().then((projectRevision) => ({
    id,
    projectRevision,
    origin: 'agent',
    reason: 'test',
    mutations,
  }));
}

describe('WorkspaceTransactionEngine', () => {
  it('commits ordered multi-file mutations with canonical revisions and origin tags', async () => {
    const fs = new FakeWorkspace();
    fs.seed('a.txt', 'old');
    const journal = new InMemoryTransactionJournal();
    const engine = new WorkspaceTransactionEngine(fs, { journal });
    const tx = await transaction(fs, [
      { type: 'write', path: workspacePath('a.txt'), data: bytes('new'), expectedHash: hash(bytes('old')) },
      { type: 'write', path: workspacePath('b.txt'), data: bytes('created'), createOnly: true },
    ]);

    const result = await engine.execute(tx);

    expect(text(fs.files.get('a.txt')!)).toBe('new');
    expect(text(fs.files.get('b.txt')!)).toBe('created');
    expect(result.revision).toBe(2);
    expect(fs.events.map(({ origin }) => origin)).toEqual(['agent', 'agent']);
    expect((await journal.read(tx.id)).at(-1)?.phase).toBe('committed');
  });

  it('rejects stale revisions and content conflicts before writing', async () => {
    const fs = new FakeWorkspace();
    fs.seed('a.txt', 'current');
    const engine = new WorkspaceTransactionEngine(fs, { journal: new InMemoryTransactionJournal() });
    const tx: WorkspaceTransaction = {
      id: 'stale',
      projectRevision: 1,
      origin: 'editor',
      reason: 'stale',
      mutations: [{ type: 'delete', path: workspacePath('a.txt'), expectedHash: 'wrong' }],
    };
    await expect(engine.execute(tx)).rejects.toMatchObject({ code: 'conflict' });
    expect(text(fs.files.get('a.txt')!)).toBe('current');
  });

  it('restores its checkpoint after any partial adapter failure', async () => {
    const fs = new FakeWorkspace();
    fs.seed('a.txt', 'a');
    fs.seed('b.txt', 'b');
    fs.failAtOperation = 2;
    const journal = new InMemoryTransactionJournal();
    const engine = new WorkspaceTransactionEngine(fs, { journal });
    const tx = await transaction(fs, [
      { type: 'write', path: workspacePath('a.txt'), data: bytes('changed'), expectedHash: hash(bytes('a')) },
      { type: 'delete', path: workspacePath('b.txt'), expectedHash: hash(bytes('b')) },
    ]);

    await expect(engine.execute(tx)).rejects.toMatchObject({ code: 'transaction_failed' });
    expect(text(fs.files.get('a.txt')!)).toBe('a');
    expect(text(fs.files.get('b.txt')!)).toBe('b');
    expect((await journal.read(tx.id)).at(-1)?.phase).toBe('rolled-back');
    expect(await journal.incomplete()).toEqual([]);
  });

  it('does not restore when the first operation fails', async () => {
    const fs = new FakeWorkspace();
    fs.seed('safe.txt', 'safe');
    fs.failAtOperation = 1;
    const engine = new WorkspaceTransactionEngine(fs, { journal: new InMemoryTransactionJournal() });
    const tx = await transaction(fs, [
      { type: 'write', path: workspacePath('new.txt'), data: bytes('new'), createOnly: true },
    ]);
    await expect(engine.execute(tx)).rejects.toMatchObject({ code: 'transaction_failed' });
    expect(fs.restoreCalls).toBe(0);
    expect(text(fs.files.get('safe.txt')!)).toBe('safe');
  });

  it('refuses rollback rather than overwriting a concurrent change', async () => {
    const fs = new FakeWorkspace();
    fs.seed('a.txt', 'a');
    fs.seed('b.txt', 'b');
    fs.beforeOperation = (operation) => {
      if (operation === 2) fs.externalWrite('outside.txt', 'concurrent');
    };
    const journal = new InMemoryTransactionJournal();
    const engine = new WorkspaceTransactionEngine(fs, { journal });
    const tx = await transaction(fs, [
      { type: 'write', path: workspacePath('a.txt'), data: bytes('ours'), expectedHash: hash(bytes('a')) },
      { type: 'delete', path: workspacePath('b.txt'), expectedHash: hash(bytes('b')) },
    ]);

    await expect(engine.execute(tx)).rejects.toThrow(/rollback refused/i);
    expect(fs.restoreCalls).toBe(0);
    expect(text(fs.files.get('outside.txt')!)).toBe('concurrent');
    expect((await journal.read(tx.id)).at(-1)?.phase).toBe('failed');
  });

  it('recovers an interrupted durable transaction after engine recreation', async () => {
    const database = new InMemoryStorageDatabase();
    const fs = new FakeWorkspace();
    fs.seed('a.txt', 'before');
    const checkpoint = await fs.snapshot();
    const transactionId = 'crashed';
    const firstJournal = new StorageDatabaseTransactionJournal(database, 'project-1');
    await firstJournal.append({ transactionId, phase: 'preparing' });
    await firstJournal.append({
      transactionId,
      phase: 'applying',
      checkpoint,
      appliedPaths: [],
      appliedMutations: 0,
    });
    await fs.writeFile(
      workspacePath('a.txt'),
      bytes('partial'),
      { type: 'match', projectRevision: 0, contentHash: hash(bytes('before')) },
      'agent'
    );
    await firstJournal.append({
      transactionId,
      phase: 'applying',
      checkpoint,
      appliedPaths: [workspacePath('a.txt')],
      appliedMutations: 1,
    });

    const reopenedJournal = new StorageDatabaseTransactionJournal(database, 'project-1');
    const reopenedEngine = new WorkspaceTransactionEngine(fs, { journal: reopenedJournal });
    expect(await reopenedEngine.recoverIncomplete()).toEqual([
      { transactionId, outcome: 'rolled-back' },
    ]);
    expect(text(fs.files.get('a.txt')!)).toBe('before');
    expect(await reopenedJournal.incomplete()).toEqual([]);
  });

  it('recovers a pre-apply crash without invoking full restore', async () => {
    const database = new InMemoryStorageDatabase();
    const fs = new FakeWorkspace();
    fs.seed('safe.txt', 'safe');
    const checkpoint = await fs.snapshot();
    const journal = new StorageDatabaseTransactionJournal(database, 'project-1');
    await journal.append({ transactionId: 'pre-apply', phase: 'preparing' });
    await journal.append({
      transactionId: 'pre-apply',
      phase: 'applying',
      checkpoint,
      appliedPaths: [],
      appliedMutations: 0,
    });

    const engine = new WorkspaceTransactionEngine(fs, {
      journal: new StorageDatabaseTransactionJournal(database, 'project-1'),
    });
    expect(await engine.recoverIncomplete()).toEqual([
      { transactionId: 'pre-apply', outcome: 'rolled-back' },
    ]);
    expect(fs.restoreCalls).toBe(0);
  });

  it('filters reflected and duplicate watcher changes', () => {
    const guard = new FileChangeLoopGuard();
    const change: FileChange = {
      path: workspacePath('a.txt'),
      type: 'modified',
      revision: 3,
      origin: 'agent',
    };
    expect(guard.shouldProcess(change, 'agent')).toBe(false);
    expect(guard.shouldProcess(change, 'editor')).toBe(true);
    expect(guard.shouldProcess(change, 'editor')).toBe(false);
  });

  it('randomly rejects escape/overlap attempts without partial commits', async () => {
    let seed = 0x51a7;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const attacks = ['../escape', '/absolute', 'C:/drive', 'ok/../../escape', '.sourai/key'];
    for (let run = 0; run < 100; run += 1) {
      const fs = new FakeWorkspace();
      fs.seed('safe.txt', 'untouched');
      const engine = new WorkspaceTransactionEngine(fs, { journal: new InMemoryTransactionJournal() });
      const unsafe = attacks[Math.floor(random() * attacks.length)] as WorkspacePath;
      const tx = await transaction(fs, [
        { type: 'write', path: workspacePath(`valid-${run}.txt`), data: bytes('partial'), createOnly: true },
        { type: 'write', path: unsafe, data: bytes('escape'), createOnly: true },
      ]);
      await expect(engine.execute(tx)).rejects.toMatchObject({ code: 'permission_denied' });
      expect([...fs.files.keys()]).toEqual(['safe.txt']);
    }
  });
});
