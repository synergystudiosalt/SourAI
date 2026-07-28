import { WorkspaceFsError } from '../../filesystem';
import { workspacePath, workspaceRoot } from '../../filesystem';
import type {
  DeletePrecondition,
  DirectoryEntry,
  FileChangeOrigin,
  FileReadResult,
  FileStat,
  FileSystemCapabilities,
  FileVersion,
  MovePrecondition,
  SnapshotManifest,
  WorkspaceFileSystem,
  WorkspacePath,
  WritePrecondition,
} from '../../filesystem';
import type { ContextScope } from '../context/scope';

/**
 * Enforces the run's context scope on every filesystem read.
 *
 * The host already filters the snapshot, so this is the second of two
 * independent checks. It exists because the tool layer, an adapter, or a future
 * filesystem implementation could otherwise reintroduce a path the user never
 * approved; a scope violation must fail rather than be silently trimmed.
 */
export function createScopedFileSystem(
  inner: WorkspaceFileSystem,
  scope: ContextScope
): WorkspaceFileSystem {
  const readable = (path: WorkspacePath): WorkspacePath => scope.assertReadable(String(path));

  return {
    capabilities(): FileSystemCapabilities {
      return inner.capabilities();
    },
    revision(): Promise<number> {
      return inner.revision();
    },
    // These stay `async` so a scope violation rejects like any other
    // filesystem failure instead of throwing synchronously at the call site.
    async stat(path: WorkspacePath): Promise<FileStat> {
      if (String(path) === workspaceRoot()) return inner.stat(path);
      return inner.stat(readable(path));
    },
    async readFile(path: WorkspacePath): Promise<FileReadResult> {
      return inner.readFile(readable(path));
    },
    async readDirectory(path: WorkspacePath = workspaceRoot()): Promise<DirectoryEntry[]> {
      const directory = workspacePath(String(path), true);
      if (directory !== workspaceRoot() && !scope.allowsDirectory(String(directory))) {
        scope.assertReadable(String(directory));
      }
      const entries = await inner.readDirectory(directory);
      return entries.filter((entry) =>
        entry.kind === 'directory'
          ? scope.allowsDirectory(String(entry.path))
          : scope.allows(String(entry.path))
      );
    },
    writeFile(
      _path: WorkspacePath,
      _data: Uint8Array,
      _precondition: WritePrecondition,
      _origin?: FileChangeOrigin
    ): Promise<FileVersion> {
      return Promise.reject(mutationDenied());
    },
    createDirectory(): Promise<void> {
      return Promise.reject(mutationDenied());
    },
    deletePath(
      _path: WorkspacePath,
      _precondition: DeletePrecondition,
      _origin?: FileChangeOrigin
    ): Promise<void> {
      return Promise.reject(mutationDenied());
    },
    movePath(
      _from: WorkspacePath,
      _to: WorkspacePath,
      _precondition: MovePrecondition,
      _origin?: FileChangeOrigin
    ): Promise<void> {
      return Promise.reject(mutationDenied());
    },
    snapshot(paths?: readonly WorkspacePath[]): Promise<SnapshotManifest> {
      return inner.snapshot(paths);
    },
    restore(): Promise<void> {
      return Promise.reject(mutationDenied());
    },
  };
}

function mutationDenied(): WorkspaceFsError {
  return new WorkspaceFsError(
    'permission_denied',
    'Workspace mutation is not available to this run.'
  );
}
