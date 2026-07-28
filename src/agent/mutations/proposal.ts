import { SourError } from '../../contracts/errors';
import { workspacePath, type WorkspacePath } from '../../filesystem';
import { sha256Hex } from '../../storage/blobStore';

/**
 * The canonical, versioned representation of a proposed workspace change.
 *
 * A proposal arrives as provider output, so it is untrusted until it has been
 * through `parseFileChangeProposal`. Every later stage — approval, digest,
 * transaction — consumes the parsed value only, which is why the parser is
 * strict about shape rather than forgiving: a change that cannot be described
 * exactly cannot be approved exactly.
 */

export const PROPOSAL_VERSION = 1 as const;

export type ProposalOperation =
  | 'write_file'
  | 'patch_file'
  | 'delete_file'
  | 'move_file'
  | 'create_directory';

export interface ProposedChangeBase {
  readonly reason: string;
  /** Hash of the file as the proposal author saw it. Absent for creations. */
  readonly expectedHash?: string;
}

export interface WriteFileChange extends ProposedChangeBase {
  readonly operation: 'write_file';
  readonly path: WorkspacePath;
  readonly content: string;
  /** True when the author believes the file does not exist yet. */
  readonly createOnly: boolean;
}

export interface PatchFileChange extends ProposedChangeBase {
  readonly operation: 'patch_file';
  readonly path: WorkspacePath;
  readonly hunks: readonly ProposedHunk[];
  readonly expectedHash: string;
}

export interface DeleteFileChange extends ProposedChangeBase {
  readonly operation: 'delete_file';
  readonly path: WorkspacePath;
}

export interface MoveFileChange extends ProposedChangeBase {
  readonly operation: 'move_file';
  readonly from: WorkspacePath;
  readonly to: WorkspacePath;
}

export interface CreateDirectoryChange extends ProposedChangeBase {
  readonly operation: 'create_directory';
  readonly path: WorkspacePath;
}

export type ProposedChange =
  | WriteFileChange
  | PatchFileChange
  | DeleteFileChange
  | MoveFileChange
  | CreateDirectoryChange;

/**
 * A contiguous replacement anchored to exact original lines.
 *
 * `originalLines` is what makes placement unambiguous: the applier verifies the
 * anchor matches byte for byte and refuses rather than searching nearby.
 */
export interface ProposedHunk {
  readonly id: string;
  /** 1-based line number in the original file where `originalLines` begins. */
  readonly startLine: number;
  readonly originalLines: readonly string[];
  readonly replacementLines: readonly string[];
}

export interface FileChangeProposalV1 {
  readonly version: typeof PROPOSAL_VERSION;
  readonly summary: string;
  readonly changes: readonly ProposedChange[];
  /** Checks the author recommends after the change is applied. */
  readonly verification: readonly string[];
}

export const PROPOSAL_LIMITS = Object.freeze({
  maxChanges: 50,
  maxContentBytes: 256 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxHunks: 200,
  maxHunkLines: 2_000,
  maxPathLength: 1024,
  maxSummaryLength: 4_000,
  maxReasonLength: 1_000,
  maxVerificationItems: 10,
});

const encoder = new TextEncoder();
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function proposalError(reason: string, details?: Record<string, unknown>): never {
  throw new SourError({
    code: 'proposal_invalid',
    message: 'The proposed change was rejected before review.',
    causeCategory: 'validation',
    retryable: false,
    details: { reason, ...details },
  });
}

/** Rejects accessors and prototype tricks before any property is read. */
function plainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    proposalError('expected_object', { field });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    proposalError('unexpected_prototype', { field });
  }
  for (const key of Object.keys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) proposalError('accessor_property', { field, key });
  }
  return value as Record<string, unknown>;
}

function exact(
  value: unknown,
  field: string,
  allowed: readonly string[],
  required: readonly string[]
): Record<string, unknown> {
  const record = plainRecord(value, field);
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) proposalError('unknown_property', { field, key });
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      proposalError('missing_property', { field, key });
    }
  }
  return record;
}

function text(value: unknown, field: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') proposalError('expected_string', { field });
  const string = value as string;
  if (!allowEmpty && !string.trim()) proposalError('empty_string', { field });
  if (string.length > maxLength) proposalError('string_too_long', { field, maxLength });
  return string;
}

function safePath(value: unknown, field: string): WorkspacePath {
  const raw = text(value, field, PROPOSAL_LIMITS.maxPathLength);
  try {
    // `workspacePath` rejects traversal, absolute paths, drive letters,
    // backslashes, control characters, and reserved namespaces.
    return workspacePath(raw);
  } catch {
    proposalError('invalid_path', { field, path: raw });
  }
}

function hash(value: unknown, field: string): string {
  const raw = text(value, field, 64);
  if (!HASH_PATTERN.test(raw)) proposalError('invalid_hash', { field });
  return raw;
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    proposalError('invalid_number', { field });
  }
  return value as number;
}

function lineArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) proposalError('expected_array', { field });
  const lines = value as unknown[];
  if (lines.length > PROPOSAL_LIMITS.maxHunkLines) {
    proposalError('too_many_lines', { field, maximum: PROPOSAL_LIMITS.maxHunkLines });
  }
  return Object.freeze(
    lines.map((line, index) => {
      if (typeof line !== 'string') proposalError('expected_string', { field: `${field}[${index}]` });
      const string = line as string;
      if (string.includes('\n') || string.includes('\r')) {
        proposalError('line_contains_newline', { field: `${field}[${index}]` });
      }
      return string;
    })
  );
}

function parseHunk(value: unknown, field: string): ProposedHunk {
  const record = exact(
    value,
    field,
    ['id', 'startLine', 'originalLines', 'replacementLines'],
    ['startLine', 'originalLines', 'replacementLines']
  );
  const originalLines = lineArray(record.originalLines, `${field}.originalLines`);
  const replacementLines = lineArray(record.replacementLines, `${field}.replacementLines`);
  if (originalLines.length === 0 && replacementLines.length === 0) {
    proposalError('empty_hunk', { field });
  }
  return Object.freeze({
    id:
      record.id === undefined
        ? `${field}`
        : text(record.id, `${field}.id`, 128),
    startLine: positiveInteger(record.startLine, `${field}.startLine`, 1_000_000),
    originalLines,
    replacementLines,
  });
}

function parseChange(value: unknown, index: number): ProposedChange {
  const field = `changes[${index}]`;
  const probe = plainRecord(value, field);
  const operation = probe.operation;
  const reasonOf = (record: Record<string, unknown>) =>
    text(record.reason, `${field}.reason`, PROPOSAL_LIMITS.maxReasonLength);

  switch (operation) {
    case 'write_file': {
      const record = exact(
        value,
        field,
        ['operation', 'path', 'content', 'reason', 'expectedHash', 'createOnly'],
        ['operation', 'path', 'content', 'reason']
      );
      const content = text(record.content, `${field}.content`, PROPOSAL_LIMITS.maxContentBytes, true);
      if (encoder.encode(content).byteLength > PROPOSAL_LIMITS.maxContentBytes) {
        proposalError('content_too_large', { field, maximum: PROPOSAL_LIMITS.maxContentBytes });
      }
      const createOnly = record.createOnly === undefined ? false : record.createOnly === true;
      if (createOnly && record.expectedHash !== undefined) {
        proposalError('create_only_with_hash', { field });
      }
      return Object.freeze({
        operation: 'write_file' as const,
        path: safePath(record.path, `${field}.path`),
        content,
        createOnly,
        reason: reasonOf(record),
        ...(record.expectedHash === undefined
          ? {}
          : { expectedHash: hash(record.expectedHash, `${field}.expectedHash`) }),
      });
    }
    case 'patch_file': {
      const record = exact(
        value,
        field,
        ['operation', 'path', 'hunks', 'reason', 'expectedHash'],
        ['operation', 'path', 'hunks', 'reason', 'expectedHash']
      );
      if (!Array.isArray(record.hunks) || record.hunks.length === 0) {
        proposalError('hunks_required', { field });
      }
      const rawHunks = record.hunks as unknown[];
      if (rawHunks.length > PROPOSAL_LIMITS.maxHunks) {
        proposalError('too_many_hunks', { field, maximum: PROPOSAL_LIMITS.maxHunks });
      }
      const hunks = rawHunks.map((hunk, hunkIndex) =>
        parseHunk(hunk, `${field}.hunks[${hunkIndex}]`)
      );
      assertHunksOrdered(hunks, field);
      return Object.freeze({
        operation: 'patch_file' as const,
        path: safePath(record.path, `${field}.path`),
        hunks: Object.freeze(hunks),
        expectedHash: hash(record.expectedHash, `${field}.expectedHash`),
        reason: reasonOf(record),
      });
    }
    case 'delete_file': {
      const record = exact(
        value,
        field,
        ['operation', 'path', 'reason', 'expectedHash'],
        ['operation', 'path', 'reason']
      );
      return Object.freeze({
        operation: 'delete_file' as const,
        path: safePath(record.path, `${field}.path`),
        reason: reasonOf(record),
        ...(record.expectedHash === undefined
          ? {}
          : { expectedHash: hash(record.expectedHash, `${field}.expectedHash`) }),
      });
    }
    case 'move_file': {
      const record = exact(
        value,
        field,
        ['operation', 'from', 'to', 'reason', 'expectedHash'],
        ['operation', 'from', 'to', 'reason']
      );
      const from = safePath(record.from, `${field}.from`);
      const to = safePath(record.to, `${field}.to`);
      if (from === to) proposalError('move_to_self', { field });
      return Object.freeze({
        operation: 'move_file' as const,
        from,
        to,
        reason: reasonOf(record),
        ...(record.expectedHash === undefined
          ? {}
          : { expectedHash: hash(record.expectedHash, `${field}.expectedHash`) }),
      });
    }
    case 'create_directory': {
      const record = exact(
        value,
        field,
        ['operation', 'path', 'reason'],
        ['operation', 'path', 'reason']
      );
      return Object.freeze({
        operation: 'create_directory' as const,
        path: safePath(record.path, `${field}.path`),
        reason: reasonOf(record),
      });
    }
    default:
      proposalError('unknown_operation', { field });
  }
}

function assertHunksOrdered(hunks: readonly ProposedHunk[], field: string): void {
  let cursor = 0;
  for (const [index, hunk] of hunks.entries()) {
    if (hunk.startLine <= cursor) {
      proposalError('overlapping_hunks', { field: `${field}.hunks[${index}]` });
    }
    cursor = hunk.startLine + hunk.originalLines.length - 1;
  }
}

/** Every path a change reads or writes, used for approval binding and locks. */
export function changePaths(change: ProposedChange): readonly WorkspacePath[] {
  return change.operation === 'move_file' ? [change.from, change.to] : [change.path];
}

export function proposalPaths(proposal: FileChangeProposalV1): readonly WorkspacePath[] {
  return Object.freeze([...new Set(proposal.changes.flatMap(changePaths))].sort());
}

function assertNoConflictingChanges(changes: readonly ProposedChange[]): void {
  const touched = new Map<string, ProposalOperation>();
  const removed = new Set<string>();
  for (const [index, change] of changes.entries()) {
    for (const path of changePaths(change)) {
      const key = String(path);
      const previous = touched.get(key);
      if (previous !== undefined) {
        proposalError('duplicate_path', { field: `changes[${index}]`, path: key, previous });
      }
      touched.set(key, change.operation);
    }
    if (change.operation === 'delete_file') removed.add(String(change.path));
    if (change.operation === 'move_file') removed.add(String(change.from));
  }
  // A path that another change removes cannot also be a parent of a write:
  // the batch would depend on apply order rather than being atomic.
  for (const [index, change] of changes.entries()) {
    for (const path of changePaths(change)) {
      for (const gone of removed) {
        if (String(path) !== gone && String(path).startsWith(`${gone}/`)) {
          proposalError('change_under_removed_path', {
            field: `changes[${index}]`,
            path: String(path),
            removed: gone,
          });
        }
      }
    }
  }
}

export function parseFileChangeProposal(value: unknown): FileChangeProposalV1 {
  const record = exact(
    value,
    'proposal',
    ['version', 'summary', 'changes', 'verification'],
    ['summary', 'changes']
  );
  if (record.version !== undefined && record.version !== PROPOSAL_VERSION) {
    proposalError('unsupported_version');
  }
  if (!Array.isArray(record.changes) || record.changes.length === 0) {
    proposalError('changes_required');
  }
  const rawChanges = record.changes as unknown[];
  if (rawChanges.length > PROPOSAL_LIMITS.maxChanges) {
    proposalError('too_many_changes', { maximum: PROPOSAL_LIMITS.maxChanges });
  }
  const changes = rawChanges.map(parseChange);
  assertNoConflictingChanges(changes);

  const totalBytes = changes.reduce((total, change) => {
    if (change.operation === 'write_file') return total + encoder.encode(change.content).byteLength;
    if (change.operation === 'patch_file') {
      return (
        total +
        change.hunks.reduce(
          (sum, hunk) => sum + encoder.encode(hunk.replacementLines.join('\n')).byteLength,
          0
        )
      );
    }
    return total;
  }, 0);
  if (totalBytes > PROPOSAL_LIMITS.maxTotalBytes) {
    proposalError('proposal_too_large', { maximum: PROPOSAL_LIMITS.maxTotalBytes });
  }

  const verification =
    record.verification === undefined
      ? []
      : (() => {
          if (!Array.isArray(record.verification)) proposalError('expected_array', { field: 'verification' });
          const items = record.verification as unknown[];
          if (items.length > PROPOSAL_LIMITS.maxVerificationItems) {
            proposalError('too_many_verification_items');
          }
          return items.map((item, index) => text(item, `verification[${index}]`, 200));
        })();

  return Object.freeze({
    version: PROPOSAL_VERSION,
    summary: text(record.summary, 'summary', PROPOSAL_LIMITS.maxSummaryLength),
    changes: Object.freeze(changes),
    verification: Object.freeze(verification),
  });
}

/**
 * Stable digest of a proposal's meaning.
 *
 * Property order and optional-field presence are normalized so an approval
 * cannot be invalidated by re-serialization, while any change to a path,
 * content, hunk, or precondition produces a different digest and therefore
 * requires a new approval.
 */
export async function proposalDigest(proposal: FileChangeProposalV1): Promise<string> {
  return sha256Hex(encoder.encode(canonicalJson(proposal)));
}

export function canonicalJson(proposal: FileChangeProposalV1): string {
  return JSON.stringify({
    version: proposal.version,
    summary: proposal.summary,
    verification: [...proposal.verification],
    changes: proposal.changes.map((change) => {
      switch (change.operation) {
        case 'write_file':
          return {
            operation: change.operation,
            path: String(change.path),
            content: change.content,
            createOnly: change.createOnly,
            ...(change.expectedHash === undefined ? {} : { expectedHash: change.expectedHash }),
            reason: change.reason,
          };
        case 'patch_file':
          return {
            operation: change.operation,
            path: String(change.path),
            expectedHash: change.expectedHash,
            reason: change.reason,
            hunks: change.hunks.map((hunk) => ({
              startLine: hunk.startLine,
              originalLines: [...hunk.originalLines],
              replacementLines: [...hunk.replacementLines],
            })),
          };
        case 'move_file':
          return {
            operation: change.operation,
            from: String(change.from),
            to: String(change.to),
            ...(change.expectedHash === undefined ? {} : { expectedHash: change.expectedHash }),
            reason: change.reason,
          };
        default:
          return {
            operation: change.operation,
            path: String(change.path),
            ...(change.expectedHash === undefined ? {} : { expectedHash: change.expectedHash }),
            reason: change.reason,
          };
      }
    }),
  });
}
