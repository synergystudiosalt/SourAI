import { workspacePath, type WorkspacePath } from '../../filesystem';
import { sha256Hex } from '../../storage/blobStore';
import { ContextScope, type ScopeDenialReason } from './scope';

/**
 * A bounded, already-scoped copy of the project that the agent worker is
 * allowed to see.
 *
 * The host builds it, so excluded and sensitive files never cross into the
 * worker at all. Everything the worker can read — and therefore everything a
 * provider can be shown — is enumerated here, which is what makes an exact
 * egress preview possible before a request is made.
 */

export const WORKSPACE_SNAPSHOT_VERSION = 1 as const;

export interface WorkspaceSnapshotFileV1 {
  readonly path: WorkspacePath;
  readonly content: string;
  readonly size: number;
  readonly contentHash: string;
}

export interface WorkspaceSnapshotExclusionV1 {
  readonly path: string;
  readonly reason: ScopeDenialReason | 'too-large' | 'not-loaded' | 'binary' | 'limit';
}

export interface WorkspaceSnapshotV1 {
  readonly version: typeof WORKSPACE_SNAPSHOT_VERSION;
  readonly projectId: string;
  readonly revision: number;
  readonly files: readonly WorkspaceSnapshotFileV1[];
  readonly excluded: readonly WorkspaceSnapshotExclusionV1[];
  readonly totalBytes: number;
  readonly truncated: boolean;
}

export interface SnapshotLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = Object.freeze({
  maxFiles: 1_500,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
});

export interface SnapshotSourceFile {
  readonly path: string;
  /** `undefined` means a real on-disk file whose content has not been read yet. */
  readonly content?: string;
  readonly isLoaded?: boolean;
}

const encoder = new TextEncoder();
/** NUL and other control characters, excluding tab, newline, and carriage return. */
const CONTROL_BINARY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export async function buildWorkspaceSnapshot(
  projectId: string,
  revision: number,
  files: readonly SnapshotSourceFile[],
  scope: ContextScope = ContextScope.projectDefault(),
  limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
  digest: (bytes: Uint8Array) => Promise<string> = sha256Hex
): Promise<WorkspaceSnapshotV1> {
  const accepted: WorkspaceSnapshotFileV1[] = [];
  const excluded: WorkspaceSnapshotExclusionV1[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const decision = scope.decide(file.path);
    if (!decision.allowed) {
      excluded.push({ path: file.path, reason: decision.reason });
      continue;
    }
    if (file.content === undefined || file.isLoaded === false) {
      excluded.push({ path: file.path, reason: 'not-loaded' });
      continue;
    }
    if (CONTROL_BINARY.test(file.content)) {
      excluded.push({ path: file.path, reason: 'binary' });
      continue;
    }
    if (accepted.length >= limits.maxFiles) {
      excluded.push({ path: file.path, reason: 'limit' });
      truncated = true;
      continue;
    }
    const bytes = encoder.encode(file.content);
    if (bytes.byteLength > limits.maxFileBytes) {
      excluded.push({ path: file.path, reason: 'too-large' });
      truncated = true;
      continue;
    }
    if (totalBytes + bytes.byteLength > limits.maxTotalBytes) {
      excluded.push({ path: file.path, reason: 'limit' });
      truncated = true;
      continue;
    }
    totalBytes += bytes.byteLength;
    accepted.push({
      path: workspacePath(file.path),
      content: file.content,
      size: bytes.byteLength,
      contentHash: await digest(bytes),
    });
  }

  return Object.freeze({
    version: WORKSPACE_SNAPSHOT_VERSION,
    projectId,
    revision,
    files: Object.freeze(accepted),
    excluded: Object.freeze(excluded),
    totalBytes,
    truncated,
  });
}

/** Validates a snapshot arriving over the worker boundary. */
export function parseWorkspaceSnapshotV1(value: unknown): WorkspaceSnapshotV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Workspace snapshot must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== WORKSPACE_SNAPSHOT_VERSION) {
    throw new TypeError('Unsupported workspace snapshot version.');
  }
  if (typeof record.projectId !== 'string' || !record.projectId) {
    throw new TypeError('Workspace snapshot needs a project id.');
  }
  if (typeof record.revision !== 'number' || !Number.isFinite(record.revision) || record.revision < 0) {
    throw new TypeError('Workspace snapshot needs a finite revision.');
  }
  if (!Array.isArray(record.files)) throw new TypeError('Workspace snapshot files must be an array.');

  let totalBytes = 0;
  const files = record.files.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('Workspace snapshot entries must be objects.');
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== 'string') throw new TypeError('Snapshot entries need a path.');
    if (typeof entry.content !== 'string') throw new TypeError('Snapshot content must be a string.');
    if (typeof entry.contentHash !== 'string' || !SHA256_HEX.test(entry.contentHash)) {
      throw new TypeError('Snapshot entries need a sha-256 content hash.');
    }
    const path = workspacePath(entry.path);
    const size = encoder.encode(entry.content).byteLength;
    totalBytes += size;
    return Object.freeze({ path, content: entry.content, size, contentHash: entry.contentHash });
  });

  return Object.freeze({
    version: WORKSPACE_SNAPSHOT_VERSION,
    projectId: record.projectId,
    revision: record.revision,
    files: Object.freeze(files),
    excluded: Object.freeze(parseExclusions(record.excluded)),
    totalBytes,
    truncated: record.truncated === true,
  });
}

function parseExclusions(value: unknown): WorkspaceSnapshotExclusionV1[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== 'string' || typeof entry.reason !== 'string') return [];
    return [Object.freeze({ path: entry.path, reason: entry.reason as WorkspaceSnapshotExclusionV1['reason'] })];
  });
}
