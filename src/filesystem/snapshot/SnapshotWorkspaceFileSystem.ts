import type { WorkspaceSnapshotV1 } from '../../agent/context/snapshot';
import { WorkspaceFsError } from '../errors';
import { parentPath, workspacePath, workspaceRoot } from '../path';
import type {
  DirectoryEntry,
  FileReadResult,
  FileStat,
  FileSystemCapabilities,
  FileVersion,
  SnapshotManifest,
  WorkspaceFileSystem,
  WorkspacePath,
} from '../types';

/**
 * Read-only workspace view over a host-produced snapshot.
 *
 * Phase 4A gives the agent real project content without granting it a mutation
 * path: every write, delete, move, and restore fails closed. When transactional
 * editing lands, this adapter is replaced rather than extended, so a mutation
 * can never quietly start succeeding against an in-memory copy.
 */
export class SnapshotWorkspaceFileSystem implements WorkspaceFileSystem {
  readonly #files: ReadonlyMap<string, { content: string; size: number; contentHash: string }>;
  readonly #directories: ReadonlySet<string>;
  readonly #revision: number;

  constructor(snapshot: WorkspaceSnapshotV1) {
    const files = new Map<string, { content: string; size: number; contentHash: string }>();
    const directories = new Set<string>();
    for (const file of snapshot.files) {
      files.set(String(file.path), {
        content: file.content,
        size: file.size,
        contentHash: file.contentHash,
      });
      let parent = parentPath(file.path);
      while (parent !== workspaceRoot()) {
        if (directories.has(String(parent))) break;
        directories.add(String(parent));
        parent = parentPath(parent);
      }
    }
    this.#files = files;
    this.#directories = directories;
    this.#revision = snapshot.revision;
  }

  capabilities(): FileSystemCapabilities {
    return Object.freeze({
      persistent: false,
      localFolder: false,
      atomicTransactions: false,
      watch: false,
    });
  }

  async revision(): Promise<number> {
    return this.#revision;
  }

  async stat(path: WorkspacePath): Promise<FileStat> {
    const key = String(workspacePath(String(path), true));
    if (key === '') {
      return { path: workspaceRoot(), kind: 'directory', size: 0, modifiedAt: 0 };
    }
    const file = this.#files.get(key);
    if (file) {
      return {
        path: key as WorkspacePath,
        kind: 'file',
        size: file.size,
        modifiedAt: 0,
        contentHash: file.contentHash,
      };
    }
    if (this.#directories.has(key)) {
      return { path: key as WorkspacePath, kind: 'directory', size: 0, modifiedAt: 0 };
    }
    throw new WorkspaceFsError('not_found', `Path ${key} does not exist.`, key);
  }

  async readFile(path: WorkspacePath): Promise<FileReadResult> {
    const key = String(workspacePath(String(path)));
    const file = this.#files.get(key);
    if (!file) throw new WorkspaceFsError('not_found', `File ${key} does not exist.`, key);
    return {
      path: key as WorkspacePath,
      data: new TextEncoder().encode(file.content),
      version: { revision: this.#revision, contentHash: file.contentHash },
    };
  }

  async readDirectory(path: WorkspacePath = workspaceRoot()): Promise<DirectoryEntry[]> {
    const key = String(workspacePath(String(path), true));
    if (key !== '' && !this.#directories.has(key)) {
      throw new WorkspaceFsError('not_found', `Directory ${key} does not exist.`, key);
    }
    const prefix = key === '' ? '' : `${key}/`;
    const entries = new Map<string, DirectoryEntry>();
    for (const [filePath, file] of this.#files) {
      if (!filePath.startsWith(prefix)) continue;
      const remainder = filePath.slice(prefix.length);
      if (!remainder) continue;
      const separator = remainder.indexOf('/');
      if (separator < 0) {
        entries.set(filePath, {
          path: filePath as WorkspacePath,
          name: remainder,
          kind: 'file',
          size: file.size,
          modifiedAt: 0,
          contentHash: file.contentHash,
        });
        continue;
      }
      const name = remainder.slice(0, separator);
      const directoryPath = `${prefix}${name}`;
      entries.set(directoryPath, {
        path: directoryPath as WorkspacePath,
        name,
        kind: 'directory',
        size: 0,
        modifiedAt: 0,
      });
    }
    return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  async writeFile(): Promise<FileVersion> {
    throw readOnly();
  }

  async createDirectory(): Promise<void> {
    throw readOnly();
  }

  async deletePath(): Promise<void> {
    throw readOnly();
  }

  async movePath(): Promise<void> {
    throw readOnly();
  }

  async snapshot(): Promise<SnapshotManifest> {
    throw new WorkspaceFsError(
      'unsupported',
      'Checkpoints require the transactional workspace filesystem.'
    );
  }

  async restore(): Promise<void> {
    throw readOnly();
  }
}

function readOnly(): WorkspaceFsError {
  return new WorkspaceFsError(
    'permission_denied',
    'This run has read-only workspace access. Mutation tools are not enabled yet.'
  );
}
