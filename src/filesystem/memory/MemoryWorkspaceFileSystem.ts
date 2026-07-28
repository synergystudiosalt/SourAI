import { sha256Hex } from '../../storage/blobStore';
import { WorkspaceFsError } from '../errors';
import { parentPath, workspacePath, workspaceRoot } from '../path';
import type {
  CreateDirectoryPrecondition,
  DeletePrecondition,
  DirectoryEntry,
  FileChange,
  FileChangeListener,
  FileChangeOrigin,
  FileReadResult,
  FileStat,
  FileSystemCapabilities,
  FileVersion,
  MovePrecondition,
  SnapshotEntry,
  SnapshotManifest,
  Unsubscribe,
  WorkspaceFileSystem,
  WorkspacePath,
  WritePrecondition,
} from '../types';

/**
 * The authoritative workspace for browser-native projects.
 *
 * Project content lives in the editor, not in OPFS or on disk, so this adapter
 * is what makes a real transaction possible: it owns a monotonic revision, a
 * content hash per file, and byte-exact snapshot/restore. Because it is
 * in-memory and single-threaded, a checkpoint restore is genuinely
 * byte-identical rather than best effort, which is what `atomicTransactions`
 * claims to callers deciding whether rollback is safe.
 *
 * Every accepted mutation is announced to listeners so the editor state and
 * durable project storage stay in step with the revision that produced them.
 */

interface MemoryEntry {
  readonly kind: 'file' | 'directory';
  readonly content: string;
  readonly contentHash: string;
  readonly size: number;
  readonly modifiedAt: number;
}

export interface MemoryWorkspaceFileSystemOptions {
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly digest?: (value: string) => Promise<string>;
}

export interface MemoryFileSeed {
  readonly path: string;
  readonly content: string;
}

const encoder = new TextEncoder();

function fail(
  code: ConstructorParameters<typeof WorkspaceFsError>[0],
  message: string,
  path?: string
): WorkspaceFsError {
  return new WorkspaceFsError(code, message, path);
}

function checkedPath(value: WorkspacePath | string, allowRoot = false): WorkspacePath {
  try {
    return workspacePath(String(value), allowRoot);
  } catch (error) {
    throw fail(
      'permission_denied',
      error instanceof Error ? error.message : 'Invalid workspace path.',
      String(value)
    );
  }
}

export class MemoryWorkspaceFileSystem implements WorkspaceFileSystem {
  #entries = new Map<string, MemoryEntry>();
  #revision = 0;
  readonly #listeners = new Set<FileChangeListener>();
  readonly #snapshots = new Map<string, ReadonlyMap<string, MemoryEntry>>();
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #digest: (value: string) => Promise<string>;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: MemoryWorkspaceFileSystemOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#digest = options.digest ?? ((value) => sha256Hex(encoder.encode(value)));
  }

  /** Loads project content and resets the revision. Not a mutation. */
  static async fromFiles(
    files: readonly MemoryFileSeed[],
    options: MemoryWorkspaceFileSystemOptions = {}
  ): Promise<MemoryWorkspaceFileSystem> {
    const filesystem = new MemoryWorkspaceFileSystem(options);
    await filesystem.reset(files);
    return filesystem;
  }

  async reset(files: readonly MemoryFileSeed[]): Promise<void> {
    const entries = new Map<string, MemoryEntry>();
    for (const file of files) {
      const path = checkedPath(file.path);
      entries.set(String(path), await this.#entry(file.content));
      this.#ensureParents(entries, path);
    }
    this.#entries = entries;
    this.#revision = 0;
    this.#snapshots.clear();
  }

  /**
   * Folds edits made outside the agent — the editor, an import, an undo — into
   * the workspace.
   *
   * Each difference advances the revision exactly as an agent write would, so
   * an approval taken before the user typed is invalidated by the same
   * revision check rather than by a special case. Returns the number of
   * differences applied.
   */
  async syncFromHost(files: readonly MemoryFileSeed[]): Promise<number> {
    return this.#exclusive(async () => {
      const incoming = new Map(files.map((file) => [String(checkedPath(file.path)), file.content]));
      let changes = 0;

      for (const [path, content] of incoming) {
        const existing = this.#entries.get(path);
        if (existing?.kind === 'file' && existing.content === content) continue;
        this.#entries.set(path, await this.#entry(content));
        this.#ensureParents(this.#entries, path as WorkspacePath);
        this.#advance({
          path: path as WorkspacePath,
          type: existing ? 'modified' : 'created',
          origin: 'editor',
        });
        changes += 1;
      }

      for (const [path, entry] of [...this.#entries]) {
        if (entry.kind !== 'file' || incoming.has(path)) continue;
        this.#entries.delete(path);
        this.#advance({ path: path as WorkspacePath, type: 'deleted', origin: 'editor' });
        changes += 1;
      }

      return changes;
    });
  }

  capabilities(): FileSystemCapabilities {
    return Object.freeze({
      persistent: false,
      localFolder: false,
      atomicTransactions: true,
      watch: true,
    });
  }

  async revision(): Promise<number> {
    return this.#revision;
  }

  async stat(path: WorkspacePath): Promise<FileStat> {
    const key = String(checkedPath(path, true));
    if (key === '') return { path: workspaceRoot(), kind: 'directory', size: 0, modifiedAt: 0 };
    const entry = this.#entries.get(key);
    if (!entry) throw fail('not_found', `Path ${key} does not exist.`, key);
    return Object.freeze({
      path: key as WorkspacePath,
      kind: entry.kind,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      ...(entry.kind === 'file' ? { contentHash: entry.contentHash } : {}),
    });
  }

  async readFile(path: WorkspacePath): Promise<FileReadResult> {
    const key = String(checkedPath(path));
    const entry = this.#entries.get(key);
    if (!entry || entry.kind !== 'file') {
      throw fail('not_found', `File ${key} does not exist.`, key);
    }
    return Object.freeze({
      path: key as WorkspacePath,
      data: encoder.encode(entry.content),
      version: { revision: this.#revision, contentHash: entry.contentHash },
    });
  }

  /** Convenience for host code that already holds text, avoiding a re-decode. */
  readText(path: WorkspacePath | string): string | undefined {
    const entry = this.#entries.get(String(path));
    return entry?.kind === 'file' ? entry.content : undefined;
  }

  async readDirectory(path: WorkspacePath = workspaceRoot()): Promise<DirectoryEntry[]> {
    const key = String(checkedPath(path, true));
    if (key !== '' && this.#entries.get(key)?.kind !== 'directory') {
      throw fail('not_found', `Directory ${key} does not exist.`, key);
    }
    const prefix = key === '' ? '' : `${key}/`;
    const entries: DirectoryEntry[] = [];
    for (const [entryPath, entry] of this.#entries) {
      if (!entryPath.startsWith(prefix)) continue;
      const remainder = entryPath.slice(prefix.length);
      if (!remainder || remainder.includes('/')) continue;
      entries.push({
        path: entryPath as WorkspacePath,
        name: remainder,
        kind: entry.kind,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
        ...(entry.kind === 'file' ? { contentHash: entry.contentHash } : {}),
      });
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  writeFile(
    path: WorkspacePath,
    data: Uint8Array,
    precondition: WritePrecondition,
    origin: FileChangeOrigin = 'agent'
  ): Promise<FileVersion> {
    return this.#exclusive(async () => {
      const key = String(checkedPath(path));
      const existing = this.#entries.get(key);
      this.#assertRevision(precondition.projectRevision);
      if (precondition.type === 'create-only') {
        if (existing) throw fail('already_exists', `"${key}" already exists.`, key);
      } else {
        if (!existing || existing.kind !== 'file') {
          throw fail('conflict', `"${key}" no longer exists.`, key);
        }
        if (existing.contentHash !== precondition.contentHash) {
          throw fail('conflict', `"${key}" changed since it was read.`, key);
        }
      }
      if (existing?.kind === 'directory') throw fail('conflict', `"${key}" is a directory.`, key);

      const content = new TextDecoder('utf-8', { fatal: false }).decode(data);
      const entry = await this.#entry(content);
      this.#entries.set(key, entry);
      this.#ensureParents(this.#entries, key as WorkspacePath);
      this.#advance({
        path: key as WorkspacePath,
        type: existing ? 'modified' : 'created',
        origin,
      });
      return Object.freeze({ revision: this.#revision, contentHash: entry.contentHash });
    });
  }

  createDirectory(path: WorkspacePath, precondition?: CreateDirectoryPrecondition): Promise<void> {
    return this.#exclusive(async () => {
      const key = String(checkedPath(path));
      if (precondition) this.#assertRevision(precondition.projectRevision);
      const existing = this.#entries.get(key);
      if (existing?.kind === 'file') throw fail('already_exists', `"${key}" is a file.`, key);
      if (existing && precondition?.destinationMustNotExist) {
        throw fail('already_exists', `"${key}" already exists.`, key);
      }
      if (existing) return;
      this.#entries.set(key, {
        kind: 'directory',
        content: '',
        contentHash: '',
        size: 0,
        modifiedAt: this.#now(),
      });
      this.#ensureParents(this.#entries, key as WorkspacePath);
      this.#advance({ path: key as WorkspacePath, type: 'created', origin: 'agent' });
    });
  }

  deletePath(
    path: WorkspacePath,
    precondition: DeletePrecondition,
    origin: FileChangeOrigin = 'agent'
  ): Promise<void> {
    return this.#exclusive(async () => {
      const key = String(checkedPath(path));
      const existing = this.#entries.get(key);
      this.#assertRevision(precondition.projectRevision);
      if (!existing) throw fail('not_found', `"${key}" no longer exists.`, key);
      if (precondition.contentHash !== undefined && existing.contentHash !== precondition.contentHash) {
        throw fail('conflict', `"${key}" changed since it was read.`, key);
      }
      for (const entryPath of [...this.#entries.keys()]) {
        if (entryPath === key || entryPath.startsWith(`${key}/`)) this.#entries.delete(entryPath);
      }
      this.#advance({ path: key as WorkspacePath, type: 'deleted', origin });
    });
  }

  movePath(
    from: WorkspacePath,
    to: WorkspacePath,
    precondition: MovePrecondition,
    origin: FileChangeOrigin = 'agent'
  ): Promise<void> {
    return this.#exclusive(async () => {
      const source = String(checkedPath(from));
      const destination = String(checkedPath(to));
      const existing = this.#entries.get(source);
      this.#assertRevision(precondition.projectRevision);
      if (!existing) throw fail('not_found', `"${source}" no longer exists.`, source);
      if (precondition.contentHash !== undefined && existing.contentHash !== precondition.contentHash) {
        throw fail('conflict', `"${source}" changed since it was read.`, source);
      }
      if (this.#entries.has(destination)) {
        throw fail('already_exists', `"${destination}" already exists.`, destination);
      }
      if (destination.startsWith(`${source}/`)) {
        throw fail('conflict', 'A path cannot be moved inside itself.', destination);
      }
      for (const [entryPath, entry] of [...this.#entries]) {
        if (entryPath === source) {
          this.#entries.delete(entryPath);
          this.#entries.set(destination, entry);
        } else if (entryPath.startsWith(`${source}/`)) {
          this.#entries.delete(entryPath);
          this.#entries.set(`${destination}${entryPath.slice(source.length)}`, entry);
        }
      }
      this.#ensureParents(this.#entries, destination as WorkspacePath);
      this.#advance({
        path: destination as WorkspacePath,
        type: 'moved',
        origin,
        from: source as WorkspacePath,
      });
    });
  }

  async snapshot(paths?: readonly WorkspacePath[]): Promise<SnapshotManifest> {
    const selected =
      paths === undefined
        ? [...this.#entries]
        : [...this.#entries].filter(([entryPath]) =>
            paths.some((root) => entryPath === String(root) || entryPath.startsWith(`${root}/`))
          );
    const id = this.#createId();
    this.#snapshots.set(id, new Map(selected));
    const entries: SnapshotEntry[] = selected.map(([entryPath, entry]) => ({
      path: entryPath as WorkspacePath,
      kind: entry.kind,
      size: entry.size,
      ...(entry.kind === 'file' ? { contentHash: entry.contentHash } : {}),
    }));
    return Object.freeze({
      id,
      revision: this.#revision,
      createdAt: this.#now(),
      entries: Object.freeze(entries),
    });
  }

  restore(snapshot: SnapshotManifest): Promise<void> {
    return this.#exclusive(async () => {
      const stored = this.#snapshots.get(snapshot.id);
      if (!stored) {
        throw fail('corrupt_checkpoint', 'That checkpoint is no longer available in this session.');
      }
      const changed = new Set<string>([...this.#entries.keys(), ...stored.keys()]);
      this.#entries = new Map(stored);
      this.#revision += 1;
      for (const path of changed) {
        this.#emit({
          path: path as WorkspacePath,
          type: this.#entries.has(path) ? 'modified' : 'deleted',
          revision: this.#revision,
          origin: 'agent',
        });
      }
    });
  }

  watch(listener: FileChangeListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Current content of every file, for pushing back into editor state. */
  listFiles(): readonly MemoryFileSeed[] {
    return Object.freeze(
      [...this.#entries]
        .filter(([, entry]) => entry.kind === 'file')
        .map(([path, entry]) => Object.freeze({ path, content: entry.content }))
        .sort((left, right) => left.path.localeCompare(right.path))
    );
  }

  async #entry(content: string): Promise<MemoryEntry> {
    return Object.freeze({
      kind: 'file' as const,
      content,
      contentHash: await this.#digest(content),
      size: encoder.encode(content).byteLength,
      modifiedAt: this.#now(),
    });
  }

  #ensureParents(entries: Map<string, MemoryEntry>, path: WorkspacePath): void {
    let parent = parentPath(path);
    while (String(parent) !== '') {
      const key = String(parent);
      if (entries.get(key)?.kind === 'file') {
        throw fail('conflict', `"${key}" is a file and cannot contain entries.`, key);
      }
      if (!entries.has(key)) {
        entries.set(key, {
          kind: 'directory',
          content: '',
          contentHash: '',
          size: 0,
          modifiedAt: this.#now(),
        });
      }
      parent = parentPath(parent);
    }
  }

  #assertRevision(expected: number): void {
    if (expected !== this.#revision) {
      throw fail(
        'conflict',
        `Expected project revision ${expected} but the workspace is at ${this.#revision}.`
      );
    }
  }

  #advance(change: Omit<FileChange, 'revision'>): void {
    this.#revision += 1;
    this.#emit({ ...change, revision: this.#revision });
  }

  #emit(change: FileChange): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(change);
      } catch {
        // A failing observer must not roll back an accepted mutation.
      }
    }
  }

  /** Serializes mutations so a revision check and its write cannot interleave. */
  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
