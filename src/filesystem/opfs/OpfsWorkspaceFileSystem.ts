import {
  OpfsContentAddressedBlobStore,
  sha256Hex,
  type OpfsDirectoryHandle,
} from '../../storage/blobStore';
import { WorkspaceFsError } from '../errors';
import { baseName, parentPath, workspacePath, workspaceRoot } from '../path';
import type {
  CreateDirectoryPrecondition,
  DeletePrecondition,
  DirectoryEntry,
  FileChange,
  FileChangeListener,
  FileChangeOrigin,
  FileReadResult,
  FileStat,
  FileVersion,
  MovePrecondition,
  SnapshotEntry,
  SnapshotManifest,
  Unsubscribe,
  WorkspaceFileSystem,
  WorkspacePath,
  WritePrecondition,
} from '../types';

interface StoredEntry extends SnapshotEntry {
  readonly modifiedAt: number;
}

interface StoredManifest {
  readonly format: 1;
  readonly revision: number;
  readonly createdAt: number;
  readonly entries: readonly StoredEntry[];
}

interface Journal {
  readonly format: 1;
  readonly baseRevision: number;
  readonly target: StoredManifest;
}

interface ScopedSnapshotManifest extends SnapshotManifest {
  /** null means a complete workspace snapshot; otherwise only these roots are restored. */
  readonly scopeRoots: readonly WorkspacePath[] | null;
}

export interface OpfsWorkspaceFileSystemOptions {
  readonly projectId: string;
  readonly getRoot?: () => Promise<OpfsDirectoryHandle>;
  readonly blobStore?: OpfsContentAddressedBlobStore;
  readonly digest?: (bytes: Uint8Array) => Promise<string>;
  readonly now?: () => number;
  readonly createId?: () => string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const HASH = /^[a-f0-9]{64}$/;
const contextLockTails = new Map<string, Promise<void>>();

function browserRoot(): Promise<OpfsDirectoryHandle> {
  const storage = globalThis.navigator?.storage as
    | (StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> })
    | undefined;
  if (!storage?.getDirectory) {
    throw new WorkspaceFsError('unsupported', 'OPFS is unavailable in this browser.');
  }
  return storage.getDirectory() as unknown as Promise<OpfsDirectoryHandle>;
}

function fail(code: ConstructorParameters<typeof WorkspaceFsError>[0], message: string, path?: string) {
  return new WorkspaceFsError(code, message, path);
}

function checkedPath(path: WorkspacePath, allowRoot = false): WorkspacePath {
  try {
    return workspacePath(String(path), allowRoot);
  } catch (error) {
    throw fail('permission_denied', error instanceof Error ? error.message : 'Invalid path.', path);
  }
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

function snapshotEntry(entry: StoredEntry): SnapshotEntry {
  return {
    path: entry.path,
    kind: entry.kind,
    size: entry.size,
    ...(entry.contentHash ? { contentHash: entry.contentHash } : {}),
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

export class OpfsWorkspaceFileSystem implements WorkspaceFileSystem {
  private readonly getRoot: () => Promise<OpfsDirectoryHandle>;
  private readonly blobs: OpfsContentAddressedBlobStore;
  private readonly digest: (bytes: Uint8Array) => Promise<string>;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly listeners = new Set<FileChangeListener>();
  private manifest?: StoredManifest;
  private initialization?: Promise<void>;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: OpfsWorkspaceFileSystemOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.projectId)) {
      throw new TypeError('projectId must be a safe, stable OPFS identifier.');
    }
    this.getRoot = options.getRoot ?? browserRoot;
    this.digest = options.digest ?? sha256Hex;
    this.blobs =
      options.blobStore ??
      new OpfsContentAddressedBlobStore({ getRoot: this.getRoot, digest: this.digest });
    this.now = options.now ?? Date.now;
    this.createId =
      options.createId ??
      (() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }

  capabilities() {
    return {
      persistent: true,
      localFolder: false,
      atomicTransactions: true,
      watch: true,
    } as const;
  }

  async revision(): Promise<number> {
    return this.readConsistent(() => this.current().revision);
  }

  async stat(path: WorkspacePath): Promise<FileStat> {
    const safe = checkedPath(path, true);
    return this.readConsistent(() => {
      if (safe === '') {
        return { path: workspaceRoot(), kind: 'directory', size: 0, modifiedAt: 0 };
      }
      const entry = this.find(safe);
      if (!entry) throw fail('not_found', `Path ${safe} does not exist.`, safe);
      return { ...entry };
    });
  }

  async readFile(path: WorkspacePath): Promise<FileReadResult> {
    const safe = checkedPath(path);
    return this.readConsistent(async () => {
      const entry = this.find(safe);
      if (!entry || entry.kind !== 'file' || !entry.contentHash) {
        throw fail('not_found', `File ${safe} does not exist.`, safe);
      }
      const data = await this.readVerifiedBlob(entry.contentHash, entry.size);
      return {
        path: safe,
        data: cloneBytes(data),
        version: { revision: this.current().revision, contentHash: entry.contentHash },
      };
    });
  }

  async readDirectory(path: WorkspacePath = workspaceRoot()): Promise<DirectoryEntry[]> {
    const safe = checkedPath(path, true);
    return this.readConsistent(() => {
      if (safe && this.find(safe)?.kind !== 'directory') {
        throw fail('not_found', `Directory ${safe} does not exist.`, safe);
      }
      const prefix = safe ? `${safe}/` : '';
      return this.current()
        .entries.filter((entry) => {
          if (!entry.path.startsWith(prefix)) return false;
          return !entry.path.slice(prefix.length).includes('/');
        })
        .map((entry) => ({ ...entry, name: baseName(entry.path) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async writeFile(
    path: WorkspacePath,
    data: Uint8Array,
    precondition: WritePrecondition,
    origin: FileChangeOrigin = 'editor'
  ): Promise<FileVersion> {
    const safe = checkedPath(path);
    const input = cloneBytes(data);
    return this.mutate(async () => {
      this.assertRevision(precondition.projectRevision);
      this.assertParentDirectory(safe);
      const existing = this.find(safe);
      if (existing?.kind === 'directory') {
        throw fail('already_exists', `A directory exists at ${safe}.`, safe);
      }
      if (precondition.type === 'create-only' && existing) {
        throw fail('already_exists', `File ${safe} already exists.`, safe);
      }
      if (
        precondition.type === 'match' &&
        (!existing || existing.contentHash !== precondition.contentHash)
      ) {
        throw fail('conflict', `File ${safe} changed since it was read.`, safe);
      }
      const blob = await this.blobs.put(input);
      const nextRevision = this.current().revision + 1;
      const next: StoredEntry = {
        path: safe,
        kind: 'file',
        size: blob.size,
        contentHash: blob.hash,
        modifiedAt: this.now(),
      };
      await this.commit(
        this.current().entries.filter((entry) => entry.path !== safe).concat(next)
      );
      this.emit({
        path: safe,
        type: existing ? 'modified' : 'created',
        revision: nextRevision,
        origin,
      });
      return { revision: nextRevision, contentHash: blob.hash };
    });
  }

  async createDirectory(
    path: WorkspacePath,
    precondition?: CreateDirectoryPrecondition
  ): Promise<void> {
    const safe = checkedPath(path);
    await this.mutate(async () => {
      if (precondition) this.assertRevision(precondition.projectRevision);
      if (this.find(safe)) throw fail('already_exists', `Path ${safe} already exists.`, safe);
      this.assertParentDirectory(safe);
      await this.commit(
        this.current().entries.concat({
          path: safe,
          kind: 'directory',
          size: 0,
          modifiedAt: this.now(),
        })
      );
      this.emit({
        path: safe,
        type: 'created',
        revision: this.current().revision,
        origin: 'editor',
      });
    });
  }

  async deletePath(
    path: WorkspacePath,
    precondition: DeletePrecondition,
    origin: FileChangeOrigin = 'editor'
  ): Promise<void> {
    const safe = checkedPath(path);
    await this.mutate(async () => {
      this.assertRevision(precondition.projectRevision);
      const existing = this.find(safe);
      if (!existing) throw fail('not_found', `Path ${safe} does not exist.`, safe);
      this.assertHash(existing, precondition.contentHash);
      await this.commit(
        this.current().entries.filter(
          (entry) => entry.path !== safe && !entry.path.startsWith(`${safe}/`)
        )
      );
      this.emit({
        path: safe,
        type: 'deleted',
        revision: this.current().revision,
        origin,
      });
    });
  }

  async movePath(
    from: WorkspacePath,
    to: WorkspacePath,
    precondition: MovePrecondition,
    origin: FileChangeOrigin = 'editor'
  ): Promise<void> {
    const source = checkedPath(from);
    const destination = checkedPath(to);
    await this.mutate(async () => {
      this.assertRevision(precondition.projectRevision);
      const existing = this.find(source);
      if (!existing) throw fail('not_found', `Path ${source} does not exist.`, source);
      this.assertHash(existing, precondition.contentHash);
      if (destination === source || destination.startsWith(`${source}/`)) {
        throw fail('conflict', 'A path cannot be moved into itself.', destination);
      }
      if (
        this.find(destination) ||
        this.current().entries.some((entry) => entry.path.startsWith(`${destination}/`))
      ) {
        throw fail('already_exists', `Path ${destination} already exists.`, destination);
      }
      this.assertParentDirectory(destination);
      const changed = this.current().entries.map((entry) => {
        if (entry.path !== source && !entry.path.startsWith(`${source}/`)) return entry;
        const suffix = entry.path.slice(source.length);
        return { ...entry, path: workspacePath(`${destination}${suffix}`), modifiedAt: this.now() };
      });
      await this.commit(changed);
      this.emit({
        path: destination,
        from: source,
        type: 'moved',
        revision: this.current().revision,
        origin,
      });
    });
  }

  async snapshot(paths?: readonly WorkspacePath[]): Promise<SnapshotManifest> {
    return this.mutate(async () => {
      const roots = paths?.map((path) => checkedPath(path, true));
      if (roots) {
        for (const root of roots) {
          if (root && !this.find(root)) throw fail('not_found', `Path ${root} does not exist.`, root);
        }
      }
      const entries = this.current().entries
        .filter(
          (entry) =>
            !roots ||
            roots.some(
              (root) => root === '' || entry.path === root || entry.path.startsWith(`${root}/`)
            )
        )
        .map(snapshotEntry);
      const checkpoint: ScopedSnapshotManifest = {
        id: this.createId(),
        revision: this.current().revision,
        createdAt: this.now(),
        entries,
        scopeRoots: roots && !roots.includes(workspaceRoot()) ? roots : null,
      };
      await this.writeJson(await this.checkpoints(true), `${checkpoint.id}.json`, checkpoint);
      return checkpoint;
    });
  }

  async restore(snapshot: SnapshotManifest): Promise<void> {
    await this.mutate(async () => {
      const { entries: validated, scopeRoots } = await this.validateSnapshot(snapshot);
      const timestamp = this.now();
      const preserved =
        scopeRoots === null
          ? []
          : this.current().entries.filter(
              (entry) =>
                !scopeRoots.some(
                  (root) => entry.path === root || entry.path.startsWith(`${root}/`)
                )
            );
      await this.commit(
        preserved.concat(
          validated.map((entry) => ({
            ...entry,
            modifiedAt: timestamp,
          }))
        )
      );
    });
  }

  watch(listener: FileChangeListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async ready(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.withProjectLock(() => this.initialize());
    }
    await this.initialization;
  }

  private async initialize(): Promise<void> {
    const current = await this.readJson<StoredManifest>(await this.project(true), 'current.json');
    this.manifest = current ? this.validateStoredManifest(current) : this.emptyManifest();
    const journalDir = await this.journal(true);
    const journal = await this.readJson<Journal>(journalDir, 'pending.json');
    if (!journal) return;
    try {
      if (journal.format !== 1) throw new TypeError('Unknown journal format.');
      const target = this.validateStoredManifest(journal.target);
      if (target.revision > this.manifest.revision) {
        if (journal.baseRevision !== this.manifest.revision) {
          throw fail('transaction_failed', 'Journal does not follow the current revision.');
        }
        await this.writeJson(await this.manifests(true), this.manifestName(target.revision), target);
        await this.writeJson(await this.project(true), 'current.json', target);
        this.manifest = target;
      }
      await this.removeFile(journalDir, 'pending.json');
    } catch (error) {
      throw this.wrap(error, 'Failed to recover the OPFS write-ahead journal.');
    }
  }

  private async mutate<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      await this.ready();
      return this.withProjectLock(async () => {
        // Another tab or adapter instance may have committed since this
        // instance initialized. Preconditions must use the durable manifest.
        await this.initialize();
        return task();
      });
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async readConsistent<T>(task: () => T | Promise<T>): Promise<T> {
    await this.ready();
    return this.withProjectLock(async () => {
      await this.initialize();
      return task();
    });
  }

  private withProjectLock<T>(task: () => Promise<T>): Promise<T> {
    const key = `sourai:opfs:${this.options.projectId}`;
    const previous = contextLockTails.get(key) ?? Promise.resolve();
    const run = previous.then(async () => {
      const manager = globalThis.navigator?.locks;
      if (manager?.request) {
        return manager.request(key, async () => task());
      }
      return task();
    });
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    contextLockTails.set(key, tail);
    void tail.finally(() => {
      if (contextLockTails.get(key) === tail) contextLockTails.delete(key);
    });
    return run;
  }

  private current(): StoredManifest {
    if (!this.manifest) throw fail('transaction_failed', 'Workspace is not initialized.');
    return this.manifest;
  }

  private emptyManifest(): StoredManifest {
    return { format: 1, revision: 0, createdAt: this.now(), entries: [] };
  }

  private find(path: WorkspacePath): StoredEntry | undefined {
    return this.current().entries.find((entry) => entry.path === path);
  }

  private assertRevision(expected: number): void {
    if (expected !== this.current().revision) {
      throw fail(
        'conflict',
        `Expected project revision ${expected}, found ${this.current().revision}.`
      );
    }
  }

  private assertParentDirectory(path: WorkspacePath): void {
    const parent = parentPath(path);
    if (parent && this.find(parent)?.kind !== 'directory') {
      throw fail('not_found', `Parent directory ${parent} does not exist.`, parent);
    }
  }

  private assertHash(entry: StoredEntry, expected?: string): void {
    if (expected !== undefined && entry.contentHash !== expected) {
      throw fail('conflict', `Path ${entry.path} changed since it was read.`, entry.path);
    }
  }

  private async commit(entries: readonly StoredEntry[]): Promise<void> {
    const before = this.current();
    const target: StoredManifest = {
      format: 1,
      revision: before.revision + 1,
      createdAt: this.now(),
      entries: [...entries].sort((a, b) => a.path.localeCompare(b.path)),
    };
    const journal: Journal = { format: 1, baseRevision: before.revision, target };
    try {
      const journalDir = await this.journal(true);
      await this.writeJson(journalDir, 'pending.json', journal);
      await this.writeJson(await this.manifests(true), this.manifestName(target.revision), target);
      await this.writeJson(await this.project(true), 'current.json', target);
      this.manifest = target;
      await this.removeFile(journalDir, 'pending.json');
    } catch (error) {
      throw this.wrap(error, 'Atomic OPFS manifest commit failed.');
    }
  }

  private async validateSnapshot(
    snapshot: SnapshotManifest
  ): Promise<{ entries: SnapshotEntry[]; scopeRoots: readonly WorkspacePath[] | null }> {
    if (
      !snapshot ||
      typeof snapshot.id !== 'string' ||
      !snapshot.id ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 ||
      !Number.isFinite(snapshot.createdAt) ||
      !Array.isArray(snapshot.entries)
    ) {
      throw fail('corrupt_checkpoint', 'Checkpoint metadata is invalid.');
    }
    const scoped = snapshot as Partial<ScopedSnapshotManifest>;
    if (scoped.scopeRoots !== null && !Array.isArray(scoped.scopeRoots)) {
      throw fail('corrupt_checkpoint', 'Checkpoint scope is missing or invalid.');
    }
    const scopeRoots =
      scoped.scopeRoots === null
        ? null
        : scoped.scopeRoots.map((root) => {
            try {
              return workspacePath(String(root), true);
            } catch {
              throw fail('corrupt_checkpoint', 'Checkpoint contains an invalid scope root.');
            }
          });
    const seen = new Set<string>();
    const entries: SnapshotEntry[] = [];
    for (const candidate of snapshot.entries) {
      let path: WorkspacePath;
      try {
        path = workspacePath(String(candidate.path));
      } catch {
        throw fail('corrupt_checkpoint', 'Checkpoint contains an invalid path.');
      }
      if (seen.has(path)) throw fail('corrupt_checkpoint', `Duplicate checkpoint path ${path}.`);
      seen.add(path);
      if (
        (candidate.kind !== 'file' && candidate.kind !== 'directory') ||
        !Number.isSafeInteger(candidate.size) ||
        candidate.size < 0
      ) {
        throw fail('corrupt_checkpoint', `Invalid checkpoint entry ${path}.`, path);
      }
      if (candidate.kind === 'directory') {
        if (candidate.size !== 0 || candidate.contentHash !== undefined) {
          throw fail('corrupt_checkpoint', `Invalid directory entry ${path}.`, path);
        }
        entries.push({ path, kind: 'directory', size: 0 });
      } else {
        if (!candidate.contentHash || !HASH.test(candidate.contentHash)) {
          throw fail('corrupt_checkpoint', `Invalid content hash for ${path}.`, path);
        }
        await this.readVerifiedBlob(candidate.contentHash, candidate.size).catch(() => {
          throw fail('corrupt_checkpoint', `Missing or corrupt content for ${path}.`, path);
        });
        entries.push({
          path,
          kind: 'file',
          size: candidate.size,
          contentHash: candidate.contentHash,
        });
      }
    }
    for (const entry of entries) {
      const parent = parentPath(entry.path);
      if (parent && !entries.some((candidate) => candidate.path === parent && candidate.kind === 'directory')) {
        throw fail('corrupt_checkpoint', `Checkpoint parent ${parent} is missing.`, entry.path);
      }
    }
    if (
      scopeRoots &&
      entries.some(
        (entry) =>
          !scopeRoots.some(
            (root) => root === '' || entry.path === root || entry.path.startsWith(`${root}/`)
          )
      )
    ) {
      throw fail('corrupt_checkpoint', 'Checkpoint contains entries outside its declared scope.');
    }
    return { entries, scopeRoots };
  }

  private validateStoredManifest(value: StoredManifest): StoredManifest {
    if (
      value?.format !== 1 ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Number.isFinite(value.createdAt) ||
      !Array.isArray(value.entries)
    ) {
      throw fail('transaction_failed', 'Stored workspace manifest is corrupt.');
    }
    const seen = new Set<string>();
    const entries = value.entries.map((entry) => {
      const path = checkedPath(entry.path);
      if (seen.has(path)) throw fail('transaction_failed', `Duplicate stored path ${path}.`);
      seen.add(path);
      if (
        (entry.kind !== 'file' && entry.kind !== 'directory') ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        !Number.isFinite(entry.modifiedAt) ||
        (entry.kind === 'file' && (!entry.contentHash || !HASH.test(entry.contentHash))) ||
        (entry.kind === 'directory' && (entry.size !== 0 || entry.contentHash !== undefined))
      ) {
        throw fail('transaction_failed', `Stored entry ${path} is corrupt.`, path);
      }
      return { ...entry, path };
    });
    return { ...value, entries };
  }

  private async readVerifiedBlob(hash: string, size: number): Promise<Uint8Array> {
    const bytes = await this.blobs.get(hash);
    if (bytes.byteLength !== size || (await this.digest(bytes)) !== hash) {
      throw fail('corrupt_checkpoint', `Blob ${hash} failed integrity verification.`);
    }
    return bytes;
  }

  private emit(change: FileChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  private async project(create: boolean): Promise<OpfsDirectoryHandle> {
    const root = await this.getRoot();
    const workspaces = await root.getDirectoryHandle('workspaces', { create });
    return workspaces.getDirectoryHandle(this.options.projectId, { create });
  }

  private async manifests(create: boolean): Promise<OpfsDirectoryHandle> {
    return (await this.project(create)).getDirectoryHandle('manifests', { create });
  }

  private async checkpoints(create: boolean): Promise<OpfsDirectoryHandle> {
    return (await this.project(create)).getDirectoryHandle('checkpoints', { create });
  }

  private async journal(create: boolean): Promise<OpfsDirectoryHandle> {
    return (await this.project(create)).getDirectoryHandle('journal', { create });
  }

  private manifestName(revision: number): string {
    return `revision-${revision.toString().padStart(16, '0')}.json`;
  }

  private async writeJson(
    directory: OpfsDirectoryHandle,
    name: string,
    value: unknown
  ): Promise<void> {
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(Uint8Array.from(encoder.encode(JSON.stringify(value))));
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => undefined);
      throw error;
    }
  }

  private async readJson<T>(
    directory: OpfsDirectoryHandle,
    name: string
  ): Promise<T | undefined> {
    try {
      const handle = await directory.getFileHandle(name);
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      return JSON.parse(decoder.decode(bytes)) as T;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async removeFile(directory: OpfsDirectoryHandle, name: string): Promise<void> {
    try {
      await directory.removeEntry(name);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  private wrap(error: unknown, message: string): WorkspaceFsError {
    if (error instanceof WorkspaceFsError) return error;
    return fail('transaction_failed', `${message} ${error instanceof Error ? error.message : ''}`.trim());
  }
}
