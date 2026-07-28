import { WorkspaceFsError } from '../errors';
import { baseName, parentPath, workspacePath, workspaceRoot } from '../path';
import type {
  DeletePrecondition,
  DirectoryEntry,
  FileChangeOrigin,
  FileReadResult,
  FileStat,
  FileSystemCapabilities,
  FileVersion,
  MovePrecondition,
  SnapshotEntry,
  SnapshotManifest,
  WorkspaceFileSystem,
  WorkspacePath,
  WritePrecondition,
} from '../types';

type PermissionStateValue = 'granted' | 'denied' | 'prompt';
type PermissionCapableHandle = FileSystemDirectoryHandle & {
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionStateValue>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionStateValue>;
};

interface StoredSnapshot {
  readonly manifest: SnapshotManifest;
  readonly fingerprint: string;
  readonly complete: boolean;
  readonly files: ReadonlyMap<WorkspacePath, Uint8Array>;
}

export interface LocalFolderAdapterOptions {
  /**
   * Called after all preconditions pass and before the first disk mutation.
   * The caller can persist the returned checkpoint in its durable event log.
   */
  readonly checkpointBeforeMutation?: (
    checkpoint: SnapshotManifest,
    details: {
      readonly operation: 'write' | 'delete' | 'create-directory' | 'restore';
      readonly paths: readonly WorkspacePath[];
    }
  ) => void | Promise<void>;
  readonly now?: () => number;
  readonly randomId?: () => string;
}

function cloneBytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(data);
}

function checkedPath(path: WorkspacePath, allowRoot = false): WorkspacePath {
  try {
    return workspacePath(String(path), allowRoot);
  } catch {
    throw new WorkspaceFsError(
      'permission_denied',
      'Path is outside the workspace or uses a reserved name.',
      String(path)
    );
  }
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function immutableManifest(manifest: SnapshotManifest): SnapshotManifest {
  return Object.freeze({
    ...manifest,
    entries: Object.freeze(manifest.entries.map((entry) => Object.freeze({ ...entry }))),
  });
}

function manifestFingerprint(manifest: SnapshotManifest): string {
  return JSON.stringify({
    id: manifest.id,
    revision: manifest.revision,
    createdAt: manifest.createdAt,
    entries: manifest.entries.map(({ path, kind, size, contentHash }) => ({
      path,
      kind,
      size,
      contentHash: contentHash ?? null,
    })),
  });
}

function mapError(error: unknown, path?: WorkspacePath): WorkspaceFsError {
  if (error instanceof WorkspaceFsError) return error;
  const name = (error as { name?: unknown })?.name;
  if (name === 'NotFoundError') return new WorkspaceFsError('not_found', 'Path does not exist.', path);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new WorkspaceFsError('permission_denied', 'Folder permission was not granted.', path);
  }
  if (name === 'InvalidModificationError') {
    return new WorkspaceFsError('already_exists', 'The destination already exists.', path);
  }
  return new WorkspaceFsError(
    'transaction_failed',
    error instanceof Error ? error.message : `Local folder operation failed: ${String(error)}`,
    path
  );
}

/**
 * A capability-safe File System Access API adapter.
 *
 * The directory handle is deliberately private and no public return value
 * contains it. Agent-facing code receives only workspace paths and bytes.
 */
export class LocalFolderFileSystem implements WorkspaceFileSystem {
  readonly #root: FileSystemDirectoryHandle;
  readonly #checkpointHook?: LocalFolderAdapterOptions['checkpointBeforeMutation'];
  readonly #now: () => number;
  readonly #randomId: () => string;
  readonly #snapshots = new Map<string, StoredSnapshot>();
  #revision = 0;

  constructor(root: FileSystemDirectoryHandle, options: LocalFolderAdapterOptions = {}) {
    this.#root = root;
    this.#checkpointHook = options.checkpointBeforeMutation;
    this.#now = options.now ?? Date.now;
    this.#randomId = options.randomId ?? (() => crypto.randomUUID());
  }

  capabilities(): FileSystemCapabilities {
    return {
      persistent: true,
      localFolder: true,
      atomicTransactions: false,
      watch: false,
    };
  }

  async revision(): Promise<number> {
    return this.#revision;
  }

  async #requirePermission(mode: 'read' | 'readwrite'): Promise<void> {
    const root = this.#root as PermissionCapableHandle;
    try {
      // Recheck on every public operation. Do not unexpectedly open a browser
      // permission prompt; selection/reauthorization belongs to trusted UI.
      if (!root.queryPermission) {
        throw new WorkspaceFsError(
          'permission_denied',
          'This browser cannot verify the current folder permission.'
        );
      }
      const state = await root.queryPermission({ mode });
      if (state !== 'granted') {
        throw new WorkspaceFsError(
          'permission_denied',
          state === 'prompt'
            ? 'Folder permission must be renewed by the user.'
            : 'Folder permission was denied.'
        );
      }
    } catch (error) {
      throw mapError(error);
    }
  }

  async #directory(path: WorkspacePath, create = false): Promise<FileSystemDirectoryHandle> {
    let handle = this.#root;
    if (!path) return handle;
    for (const segment of path.split('/')) {
      handle = await handle.getDirectoryHandle(segment, { create });
    }
    return handle;
  }

  async #fileHandle(path: WorkspacePath, create = false): Promise<FileSystemFileHandle> {
    const parent = await this.#directory(parentPath(path), create);
    return parent.getFileHandle(baseName(path), { create });
  }

  async #existingKind(path: WorkspacePath): Promise<'file' | 'directory' | undefined> {
    if (!path) return 'directory';
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await this.#directory(parentPath(path));
    } catch (error) {
      if ((error as { name?: unknown }).name === 'NotFoundError') return undefined;
      throw error;
    }
    try {
      await parent.getFileHandle(baseName(path));
      return 'file';
    } catch (error) {
      const name = (error as { name?: unknown }).name;
      if (name !== 'NotFoundError' && name !== 'TypeMismatchError') throw error;
    }
    try {
      await parent.getDirectoryHandle(baseName(path));
      return 'directory';
    } catch (error) {
      if ((error as { name?: unknown }).name === 'NotFoundError') return undefined;
      throw error;
    }
  }

  async #readUnchecked(path: WorkspacePath): Promise<FileReadResult> {
    const file = await (await this.#fileHandle(path)).getFile();
    const data = new Uint8Array(await file.arrayBuffer());
    return {
      path,
      data,
      version: { revision: this.#revision, contentHash: await sha256(data) },
    };
  }

  async stat(path: WorkspacePath): Promise<FileStat> {
    await this.#requirePermission('read');
    const safe = checkedPath(path, true);
    try {
      const kind = await this.#existingKind(safe);
      if (!kind) throw new WorkspaceFsError('not_found', 'Path does not exist.', safe);
      if (kind === 'directory') {
        return {
          path: safe,
          kind,
          size: 0,
          modifiedAt: 0,
          contentHash: await this.#directoryHash(safe),
        };
      }
      const file = await (await this.#fileHandle(safe)).getFile();
      const data = new Uint8Array(await file.arrayBuffer());
      return {
        path: safe,
        kind,
        size: file.size,
        modifiedAt: file.lastModified,
        contentHash: await sha256(data),
      };
    } catch (error) {
      throw mapError(error, safe);
    }
  }

  async readFile(path: WorkspacePath): Promise<FileReadResult> {
    await this.#requirePermission('read');
    const safe = checkedPath(path);
    try {
      return await this.#readUnchecked(safe);
    } catch (error) {
      throw mapError(error, safe);
    }
  }

  async readDirectory(path: WorkspacePath = workspaceRoot()): Promise<DirectoryEntry[]> {
    await this.#requirePermission('read');
    const safe = checkedPath(path, true);
    try {
      const directory = await this.#directory(safe);
      const entries: DirectoryEntry[] = [];
      for await (const handle of directory.values()) {
        const childPath = checkedPath(
          (safe ? `${safe}/${handle.name}` : handle.name) as WorkspacePath
        );
        if (handle.kind === 'directory') {
          entries.push({
            name: handle.name,
            path: childPath,
            kind: 'directory',
            size: 0,
            modifiedAt: 0,
            contentHash: await this.#directoryHash(childPath),
          });
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          const bytes = new Uint8Array(await file.arrayBuffer());
          entries.push({
            name: handle.name,
            path: childPath,
            kind: 'file',
            size: file.size,
            modifiedAt: file.lastModified,
            contentHash: await sha256(bytes),
          });
        }
      }
      return entries.sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      throw mapError(error, safe);
    }
  }

  async #assertProjectRevision(expected: number, path: WorkspacePath): Promise<void> {
    if (expected !== this.#revision) {
      throw new WorkspaceFsError('conflict', 'The project changed since this operation was prepared.', path);
    }
  }

  async #checkpoint(
    paths: readonly WorkspacePath[],
    operation: 'write' | 'delete' | 'create-directory' | 'restore'
  ): Promise<SnapshotManifest> {
    const checkpoint = await this.#snapshotUnchecked(paths);
    await this.#checkpointHook?.(checkpoint, { operation, paths });
    return checkpoint;
  }

  async writeFile(
    path: WorkspacePath,
    data: Uint8Array,
    precondition: WritePrecondition,
    _origin: FileChangeOrigin = 'editor'
  ): Promise<FileVersion> {
    await this.#requirePermission('readwrite');
    const safe = checkedPath(path);
    try {
      await this.#assertProjectRevision(precondition.projectRevision, safe);
      const kind = await this.#existingKind(safe);
      if (precondition.type === 'create-only') {
        if (kind) throw new WorkspaceFsError('already_exists', 'Path already exists.', safe);
      } else {
        if (kind !== 'file') throw new WorkspaceFsError('conflict', 'Expected file no longer exists.', safe);
        const current = await this.#readUnchecked(safe);
        if (current.version.contentHash !== precondition.contentHash) {
          throw new WorkspaceFsError('conflict', 'File changed outside SourAI; refusing to overwrite it.', safe);
        }
      }

      await this.#checkpoint(kind ? [safe] : [], 'write');
      // The checkpoint hook may perform durable I/O. Revalidate immediately
      // afterwards so an external edit during that wait is also a conflict.
      const kindAfterCheckpoint = await this.#existingKind(safe);
      if (precondition.type === 'create-only') {
        if (kindAfterCheckpoint) {
          throw new WorkspaceFsError('conflict', 'Path was created outside SourAI.', safe);
        }
      } else {
        if (kindAfterCheckpoint !== 'file') {
          throw new WorkspaceFsError('conflict', 'File changed outside SourAI.', safe);
        }
        const hashAfterCheckpoint = (await this.#readUnchecked(safe)).version.contentHash;
        if (hashAfterCheckpoint !== precondition.contentHash) {
          throw new WorkspaceFsError('conflict', 'File changed outside SourAI; refusing to overwrite it.', safe);
        }
      }
      const handle = await this.#fileHandle(safe, true);
      // createWritable commits its temporary backing file on close in
      // supporting browsers. The API offers no portable rename primitive.
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(cloneBytes(data));
      await writable.close();
      this.#revision++;
      return { revision: this.#revision, contentHash: await sha256(data) };
    } catch (error) {
      throw mapError(error, safe);
    }
  }

  async createDirectory(path: WorkspacePath): Promise<void> {
    await this.#requirePermission('readwrite');
    const safe = checkedPath(path);
    try {
      if (await this.#existingKind(safe)) {
        throw new WorkspaceFsError('already_exists', 'Path already exists.', safe);
      }
      await this.#checkpoint([], 'create-directory');
      if (await this.#existingKind(safe)) {
        throw new WorkspaceFsError('conflict', 'Path was created outside SourAI.', safe);
      }
      await this.#directory(safe, true);
      this.#revision++;
    } catch (error) {
      throw mapError(error, safe);
    }
  }

  async deletePath(
    path: WorkspacePath,
    precondition: DeletePrecondition,
    _origin: FileChangeOrigin = 'editor'
  ): Promise<void> {
    await this.#requirePermission('readwrite');
    const safe = checkedPath(path);
    try {
      await this.#assertProjectRevision(precondition.projectRevision, safe);
      const kind = await this.#existingKind(safe);
      if (!kind) throw new WorkspaceFsError('not_found', 'Path does not exist.', safe);
      if (kind === 'directory' && !precondition.contentHash) {
        throw new WorkspaceFsError(
          'conflict',
          'Recursive directory deletion requires the reviewed tree hash.',
          safe
        );
      }
      if (precondition.contentHash) {
        const actual =
          kind === 'file'
            ? (await this.#readUnchecked(safe)).version.contentHash
            : await this.#directoryHash(safe);
        if (actual !== precondition.contentHash) {
          throw new WorkspaceFsError('conflict', 'Path changed outside SourAI; refusing to delete it.', safe);
        }
      }
      await this.#checkpoint([safe], 'delete');
      const kindAfterCheckpoint = await this.#existingKind(safe);
      if (!kindAfterCheckpoint) {
        throw new WorkspaceFsError('conflict', 'Path changed outside SourAI.', safe);
      }
      if (precondition.contentHash) {
        const hashAfterCheckpoint =
          kindAfterCheckpoint === 'file'
            ? (await this.#readUnchecked(safe)).version.contentHash
            : await this.#directoryHash(safe);
        if (hashAfterCheckpoint !== precondition.contentHash) {
          throw new WorkspaceFsError('conflict', 'Path changed outside SourAI; refusing to delete it.', safe);
        }
      }
      const parent = await this.#directory(parentPath(safe));
      await parent.removeEntry(baseName(safe), { recursive: kind === 'directory' });
      this.#revision++;
    } catch (error) {
      throw mapError(error, safe);
    }
  }

  async movePath(
    _from: WorkspacePath,
    _to: WorkspacePath,
    _precondition: MovePrecondition,
    _origin: FileChangeOrigin = 'editor'
  ): Promise<void> {
    checkedPath(_from);
    checkedPath(_to);
    throw new WorkspaceFsError(
      'unsupported',
      'Safe local-folder moves are unavailable because the File System Access API has no atomic rename.'
    );
  }

  async #directoryHash(path: WorkspacePath): Promise<string> {
    const entries: SnapshotEntry[] = [];
    await this.#collect(path, entries, new Map());
    const canonical = entries
      .map(({ path: entryPath, kind, size, contentHash }) => [
        String(entryPath),
        kind,
        size,
        contentHash ?? '',
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    return sha256(new TextEncoder().encode(JSON.stringify(canonical)));
  }

  async #collect(path: WorkspacePath, entries: SnapshotEntry[], files: Map<WorkspacePath, Uint8Array>): Promise<void> {
    const kind = await this.#existingKind(path);
    if (!kind) return;
    if (kind === 'file') {
      const result = await this.#readUnchecked(path);
      files.set(path, cloneBytes(result.data));
      entries.push({ path, kind, size: result.data.byteLength, contentHash: result.version.contentHash });
      return;
    }
    entries.push({ path, kind, size: 0 });
    for await (const child of (await this.#directory(path)).values()) {
      await this.#collect(workspacePath(path ? `${path}/${child.name}` : child.name), entries, files);
    }
  }

  async #snapshotUnchecked(paths?: readonly WorkspacePath[]): Promise<SnapshotManifest> {
    const entries: SnapshotEntry[] = [];
    const files = new Map<WorkspacePath, Uint8Array>();
    for (const path of paths ?? [workspaceRoot()]) await this.#collect(path, entries, files);
    const canonical = immutableManifest({
      id: this.#randomId(),
      revision: this.#revision,
      createdAt: this.#now(),
      entries,
    });
    const storedFiles = new Map(
      [...files].map(([path, bytes]) => [path, cloneBytes(bytes)] as const)
    );
    this.#snapshots.set(canonical.id, {
      manifest: canonical,
      fingerprint: manifestFingerprint(canonical),
      complete: entries.some((entry) => entry.path === workspaceRoot()),
      files: storedFiles,
    });
    return immutableManifest({
      ...canonical,
      entries: canonical.entries.map((entry) => ({ ...entry })),
    });
  }

  async snapshot(paths?: readonly WorkspacePath[]): Promise<SnapshotManifest> {
    await this.#requirePermission('read');
    try {
      const safePaths = paths?.map((path) => checkedPath(path, true));
      return await this.#snapshotUnchecked(safePaths);
    } catch (error) {
      throw mapError(error);
    }
  }

  async restore(snapshot: SnapshotManifest): Promise<void> {
    await this.#requirePermission('readwrite');
    let stored: StoredSnapshot | undefined;
    let fingerprint: string | undefined;
    try {
      stored = this.#snapshots.get(snapshot.id);
      fingerprint = manifestFingerprint(snapshot);
    } catch {
      throw new WorkspaceFsError('corrupt_checkpoint', 'Checkpoint metadata is invalid.');
    }
    if (!stored || fingerprint !== stored.fingerprint) {
      throw new WorkspaceFsError('corrupt_checkpoint', 'Checkpoint bytes are unavailable or untrusted.');
    }
    if (!stored.complete) {
      throw new WorkspaceFsError('unsupported', 'Only complete local-folder checkpoints can be restored safely.');
    }
    // File System Access exposes neither an atomic directory swap nor a
    // conflict-safe batch rollback. A destructive root rewrite could erase
    // edits made by another tab/process, so restoration is intentionally
    // disabled until a scoped, hash-checked rollback protocol is available.
    throw new WorkspaceFsError(
      'unsupported',
      'Atomic restore is unavailable for local folders; no files were changed.'
    );
  }
}

export function createLocalFolderFileSystem(
  root: FileSystemDirectoryHandle,
  options?: LocalFolderAdapterOptions
): WorkspaceFileSystem {
  return new LocalFolderFileSystem(root, options);
}
