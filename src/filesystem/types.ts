export type WorkspacePath = string & { readonly __workspacePath: unique symbol };
export type FileChangeOrigin = 'editor' | 'agent' | 'local-external' | 'runtime' | 'git';

export interface FileSystemCapabilities {
  readonly persistent: boolean;
  readonly localFolder: boolean;
  readonly atomicTransactions: boolean;
  readonly watch: boolean;
}

export interface FileStat {
  readonly path: WorkspacePath;
  readonly kind: 'file' | 'directory';
  readonly size: number;
  readonly modifiedAt: number;
  readonly contentHash?: string;
}

export interface FileReadResult {
  readonly path: WorkspacePath;
  readonly data: Uint8Array;
  readonly version: FileVersion;
}

export interface DirectoryEntry extends FileStat {
  readonly name: string;
}

export interface FileVersion {
  readonly revision: number;
  readonly contentHash: string;
}

export type WritePrecondition =
  | { readonly type: 'create-only'; readonly projectRevision: number }
  | { readonly type: 'match'; readonly projectRevision: number; readonly contentHash: string };

export interface DeletePrecondition {
  readonly projectRevision: number;
  readonly contentHash?: string;
}

export interface MovePrecondition extends DeletePrecondition {
  readonly destinationMustNotExist: true;
}

export interface CreateDirectoryPrecondition {
  readonly projectRevision: number;
  readonly destinationMustNotExist: true;
}

export interface SnapshotEntry {
  readonly path: WorkspacePath;
  readonly kind: 'file' | 'directory';
  readonly contentHash?: string;
  readonly size: number;
}

export interface SnapshotManifest {
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly entries: readonly SnapshotEntry[];
}

export interface FileChange {
  readonly path: WorkspacePath;
  readonly type: 'created' | 'modified' | 'deleted' | 'moved';
  readonly revision: number;
  readonly origin: FileChangeOrigin;
  readonly from?: WorkspacePath;
}

export type FileChangeListener = (change: FileChange) => void;
export type Unsubscribe = () => void;

export interface WorkspaceFileSystem {
  capabilities(): FileSystemCapabilities;
  revision(): Promise<number>;
  stat(path: WorkspacePath): Promise<FileStat>;
  readFile(path: WorkspacePath): Promise<FileReadResult>;
  readDirectory(path?: WorkspacePath): Promise<DirectoryEntry[]>;
  writeFile(
    path: WorkspacePath,
    data: Uint8Array,
    precondition: WritePrecondition,
    origin?: FileChangeOrigin
  ): Promise<FileVersion>;
  createDirectory(path: WorkspacePath, precondition?: CreateDirectoryPrecondition): Promise<void>;
  deletePath(
    path: WorkspacePath,
    precondition: DeletePrecondition,
    origin?: FileChangeOrigin
  ): Promise<void>;
  movePath(
    from: WorkspacePath,
    to: WorkspacePath,
    precondition: MovePrecondition,
    origin?: FileChangeOrigin
  ): Promise<void>;
  snapshot(paths?: readonly WorkspacePath[]): Promise<SnapshotManifest>;
  restore(snapshot: SnapshotManifest): Promise<void>;
  watch?(listener: FileChangeListener): Unsubscribe;
}

export type WorkspaceMutation =
  | {
      readonly type: 'write';
      readonly path: WorkspacePath;
      readonly data: Uint8Array;
      readonly expectedHash?: string;
      readonly createOnly?: boolean;
    }
  | { readonly type: 'delete'; readonly path: WorkspacePath; readonly expectedHash?: string }
  | {
      readonly type: 'move';
      readonly from: WorkspacePath;
      readonly to: WorkspacePath;
      readonly expectedHash?: string;
    }
  | { readonly type: 'create-directory'; readonly path: WorkspacePath };

export interface WorkspaceTransaction {
  readonly id: string;
  readonly projectRevision: number;
  readonly origin: FileChangeOrigin;
  readonly reason: string;
  readonly mutations: readonly WorkspaceMutation[];
}

export interface TransactionResult {
  readonly transactionId: string;
  readonly previousRevision: number;
  readonly revision: number;
  readonly checkpoint: SnapshotManifest;
  readonly changedPaths: readonly WorkspacePath[];
}
