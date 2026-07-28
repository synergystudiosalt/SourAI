import { normalizeError, type SourErrorData } from '../../contracts/errors';
import { WorkspaceFsError, type WorkspaceFileSystem, type WorkspaceMutation, type WorkspacePath } from '../../filesystem';
import { WorkspaceTransactionEngine } from '../../filesystem/sync';
import { sha256Hex } from '../../storage/blobStore';
import type { ApprovalArtifactV1, ApprovalCoordinator } from './approval';
import { applyHunks } from './patch';
import {
  canonicalJson,
  parseFileChangeProposal,
  proposalDigest,
  type FileChangeProposalV1,
  type ProposedChange,
} from './proposal';

/**
 * Turns an approved proposal into a verified transaction, or into a conflict.
 *
 * The order here is deliberate and is the whole safety story: re-validate the
 * proposal, consume the approval, re-read the workspace, refuse on any drift,
 * and only then hand a fully-resolved mutation list to the transaction engine,
 * which checkpoints before it writes anything.
 */

export type VerificationStatus = 'passed' | 'failed' | 'skipped' | 'unavailable';

export interface VerificationCheck {
  readonly id: string;
  readonly label: string;
  readonly status: VerificationStatus;
  readonly detail: string;
}

export interface MutationConflict {
  readonly path: string;
  readonly reason: string;
  readonly expectedHash?: string;
  readonly actualHash?: string;
}

export interface AppliedFile {
  readonly path: string;
  readonly operation: ProposedChange['operation'];
  readonly contentHash?: string;
}

export type ApplyOutcome =
  | {
      readonly status: 'applied';
      readonly transactionId: string;
      readonly checkpointId: string;
      readonly previousRevision: number;
      readonly revision: number;
      readonly changedPaths: readonly string[];
      readonly files: readonly AppliedFile[];
      readonly verification: readonly VerificationCheck[];
    }
  | { readonly status: 'conflict'; readonly conflicts: readonly MutationConflict[] }
  | {
      readonly status: 'failed';
      readonly error: SourErrorData;
      readonly rolledBack: boolean;
      readonly checkpointId?: string;
      readonly transactionId?: string;
    };

export interface ApplyRequest {
  readonly proposal: FileChangeProposalV1;
  readonly artifact: ApprovalArtifactV1;
  readonly projectId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly transactionId: string;
  readonly signal?: AbortSignal;
}

export interface MutationApplierOptions {
  readonly filesystem: WorkspaceFileSystem;
  readonly engine: WorkspaceTransactionEngine;
  readonly coordinator: ApprovalCoordinator;
  readonly digest?: (value: string) => Promise<string>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export class MutationApplier {
  readonly #digest: (value: string) => Promise<string>;

  constructor(private readonly options: MutationApplierOptions) {
    this.#digest = options.digest ?? ((value) => sha256Hex(encoder.encode(value)));
  }

  async apply(request: ApplyRequest): Promise<ApplyOutcome> {
    const { filesystem } = this.options;
    try {
      // 1. The proposal is re-parsed from its canonical form, so what is about
      //    to be applied is provably the same shape that was reviewed.
      const proposal = parseFileChangeProposal(JSON.parse(canonicalJson(request.proposal)));
      const digest = await proposalDigest(proposal);
      const revision = await filesystem.revision();

      // 2. Approval is consumed before any filesystem work. A second attempt,
      //    an expired token, or a token for another run stops here.
      try {
        this.options.coordinator.consume(request.artifact, {
          projectId: request.projectId,
          threadId: request.threadId,
          runId: request.runId,
          toolCallId: request.toolCallId,
          proposalDigest: digest,
          projectRevision: revision,
        });
      } catch (error) {
        // A revision that moved between approval and application is ordinary
        // concurrent editing, so it is reported as a conflict the user can
        // resolve rather than as an unexplained failure.
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'approval_revision_mismatch'
        ) {
          return Object.freeze({
            status: 'conflict' as const,
            conflicts: Object.freeze([
              {
                path: '',
                reason:
                  'The project changed after this change was approved. Ask the agent for a fresh proposal.',
              },
            ]),
          });
        }
        throw error;
      }

      if (request.signal?.aborted) {
        return this.#cancelled();
      }

      // 3. Re-read the workspace and refuse on any drift.
      const resolved = await this.#resolve(proposal);
      if (resolved.conflicts.length > 0) {
        return Object.freeze({ status: 'conflict' as const, conflicts: resolved.conflicts });
      }
      if (request.signal?.aborted) {
        return this.#cancelled();
      }

      // 4. The engine snapshots before it writes and rolls back on failure.
      const result = await this.options.engine.execute({
        id: request.transactionId,
        projectRevision: revision,
        origin: 'agent',
        reason: proposal.summary,
        mutations: resolved.mutations,
      });

      const verification = await this.#verify(
        proposal,
        resolved.expectedHashes,
        resolved.removedPaths
      );
      return Object.freeze({
        status: 'applied' as const,
        transactionId: result.transactionId,
        checkpointId: result.checkpoint.id,
        previousRevision: result.previousRevision,
        revision: result.revision,
        changedPaths: Object.freeze(result.changedPaths.map(String)),
        files: resolved.files,
        verification,
      });
    } catch (error) {
      if (error instanceof WorkspaceFsError && error.code === 'conflict') {
        return Object.freeze({
          status: 'conflict' as const,
          conflicts: Object.freeze([
            { path: error.path ?? '', reason: error.message },
          ]),
        });
      }
      const normalized = normalizeError(error, {
        code: 'mutation_failed',
        message: 'The change could not be applied.',
        causeCategory: 'runtime',
      });
      return Object.freeze({
        status: 'failed' as const,
        error: normalized.toData(),
        // The engine restores its checkpoint before rethrowing, except when it
        // says rollback was unsafe; that case names itself in the message.
        rolledBack: !normalized.message.includes('rollback'),
        // Carried so the run can record which transaction failed rather than
        // only that something did.
        transactionId: request.transactionId,
      });
    }
  }

  #cancelled(): ApplyOutcome {
    return Object.freeze({
      status: 'failed' as const,
      error: {
        code: 'cancelled',
        message: 'The run was cancelled before any change was applied.',
        retryable: false,
        causeCategory: 'cancelled' as const,
      },
      rolledBack: true,
    });
  }

  /**
   * Resolves each proposed change against current content.
   *
   * Patches are materialized into full-content writes here, while the file is
   * known to match its expected hash, so the transaction engine only ever sees
   * unambiguous byte-level operations.
   */
  async #resolve(proposal: FileChangeProposalV1): Promise<{
    readonly mutations: readonly WorkspaceMutation[];
    readonly conflicts: readonly MutationConflict[];
    readonly files: readonly AppliedFile[];
    readonly expectedHashes: ReadonlyMap<string, string>;
    readonly removedPaths: readonly string[];
  }> {
    const mutations: WorkspaceMutation[] = [];
    const conflicts: MutationConflict[] = [];
    const files: AppliedFile[] = [];
    const expectedHashes = new Map<string, string>();
    const removedPaths: string[] = [];

    for (const change of proposal.changes) {
      const path = change.operation === 'move_file' ? change.from : change.path;
      const current = await this.#read(path);

      if (change.operation !== 'create_directory' && change.expectedHash !== undefined) {
        if (current === undefined) {
          conflicts.push({
            path: String(path),
            reason: 'The file no longer exists.',
            expectedHash: change.expectedHash,
          });
          continue;
        }
        if (current.hash !== change.expectedHash) {
          conflicts.push({
            path: String(path),
            reason: 'The file changed after this proposal was created.',
            expectedHash: change.expectedHash,
            actualHash: current.hash,
          });
          continue;
        }
      }

      switch (change.operation) {
        case 'write_file': {
          if (change.createOnly && current !== undefined) {
            conflicts.push({ path: String(path), reason: 'That file already exists.' });
            continue;
          }
          if (!change.createOnly && change.expectedHash === undefined && current !== undefined) {
            conflicts.push({
              path: String(path),
              reason: 'The proposal did not record the version of the file it replaces.',
              actualHash: current.hash,
            });
            continue;
          }
          const hash = await this.#digest(change.content);
          expectedHashes.set(String(path), hash);
          mutations.push({
            type: 'write',
            path,
            data: encoder.encode(change.content),
            ...(current === undefined ? { createOnly: true } : { expectedHash: current.hash }),
          });
          files.push({ path: String(path), operation: change.operation, contentHash: hash });
          break;
        }
        case 'patch_file': {
          if (current === undefined) {
            conflicts.push({ path: String(path), reason: 'The file no longer exists.' });
            continue;
          }
          let patched: string;
          try {
            patched = applyHunks(current.content, change.hunks);
          } catch (error) {
            conflicts.push({
              path: String(path),
              reason:
                error instanceof Error ? error.message : 'The patch no longer applies to this file.',
              expectedHash: change.expectedHash,
              actualHash: current.hash,
            });
            continue;
          }
          const hash = await this.#digest(patched);
          expectedHashes.set(String(path), hash);
          mutations.push({
            type: 'write',
            path,
            data: encoder.encode(patched),
            expectedHash: current.hash,
          });
          files.push({ path: String(path), operation: change.operation, contentHash: hash });
          break;
        }
        case 'delete_file': {
          if (current === undefined) {
            conflicts.push({ path: String(path), reason: 'The file no longer exists.' });
            continue;
          }
          mutations.push({ type: 'delete', path, expectedHash: current.hash });
          files.push({ path: String(path), operation: change.operation });
          removedPaths.push(String(path));
          break;
        }
        case 'move_file': {
          if (current === undefined) {
            conflicts.push({ path: String(change.from), reason: 'The file no longer exists.' });
            continue;
          }
          if ((await this.#read(change.to)) !== undefined) {
            conflicts.push({
              path: String(change.to),
              reason: 'Something already exists at the destination.',
            });
            continue;
          }
          expectedHashes.set(String(change.to), current.hash);
          removedPaths.push(String(change.from));
          mutations.push({
            type: 'move',
            from: change.from,
            to: change.to,
            expectedHash: current.hash,
          });
          files.push({ path: String(change.to), operation: change.operation, contentHash: current.hash });
          break;
        }
        case 'create_directory': {
          // Caught here so the user gets a clear reason rather than a
          // transaction-level conflict from the engine's own guard.
          const existing = await this.#stat(path);
          if (existing !== undefined) {
            conflicts.push({
              path: String(path),
              reason:
                existing === 'directory'
                  ? 'That directory already exists.'
                  : 'A file already exists at that path.',
            });
            continue;
          }
          mutations.push({ type: 'create-directory', path });
          files.push({ path: String(path), operation: change.operation });
          break;
        }
      }
    }

    return { mutations, conflicts, files, expectedHashes, removedPaths };
  }

  async #stat(path: WorkspacePath): Promise<'file' | 'directory' | undefined> {
    try {
      return (await this.options.filesystem.stat(path)).kind;
    } catch (error) {
      if (error instanceof WorkspaceFsError && error.code === 'not_found') return undefined;
      throw error;
    }
  }

  async #read(path: WorkspacePath): Promise<{ content: string; hash: string } | undefined> {
    try {
      const result = await this.options.filesystem.readFile(path);
      return { content: decoder.decode(result.data), hash: result.version.contentHash };
    } catch (error) {
      if (error instanceof WorkspaceFsError && error.code === 'not_found') return undefined;
      throw error;
    }
  }

  /**
   * Checks the applied result against what was approved.
   *
   * These are the checks a browser can actually perform today. Anything that
   * needs a process — a test runner, a type checker — is reported as
   * unavailable rather than silently omitted, so a summary cannot imply that
   * tests passed when none ran.
   */
  async #verify(
    proposal: FileChangeProposalV1,
    expectedHashes: ReadonlyMap<string, string>,
    removedPaths: readonly string[]
  ): Promise<readonly VerificationCheck[]> {
    const checks: VerificationCheck[] = [];

    const mismatches: string[] = [];
    for (const [path, expected] of expectedHashes) {
      const actual = await this.#read(path as WorkspacePath);
      if (!actual || actual.hash !== expected) mismatches.push(path);
    }
    // A removal is only done when the path is actually gone.
    for (const path of removedPaths) {
      if ((await this.#read(path as WorkspacePath)) !== undefined) mismatches.push(path);
    }
    const verifiedCount = expectedHashes.size + removedPaths.length;
    checks.push({
      id: 'applied-content',
      label: 'Applied content matches the approved change',
      status: mismatches.length === 0 ? 'passed' : 'failed',
      detail:
        mismatches.length === 0
          ? `${verifiedCount} path(s) verified against the approved change.`
          : `Content differs at: ${mismatches.join(', ')}.`,
    });

    const jsonPaths = [...expectedHashes.keys()].filter((path) => path.endsWith('.json'));
    if (jsonPaths.length === 0) {
      checks.push({
        id: 'json-syntax',
        label: 'JSON files parse',
        status: 'skipped',
        detail: 'No JSON files were changed.',
      });
    } else {
      const broken: string[] = [];
      for (const path of jsonPaths) {
        const file = await this.#read(path as WorkspacePath);
        try {
          JSON.parse(file?.content ?? '');
        } catch {
          broken.push(path);
        }
      }
      checks.push({
        id: 'json-syntax',
        label: 'JSON files parse',
        status: broken.length === 0 ? 'passed' : 'failed',
        detail:
          broken.length === 0
            ? `${jsonPaths.length} JSON file(s) parsed.`
            : `Invalid JSON in: ${broken.join(', ')}.`,
      });
    }

    for (const [index, recommendation] of proposal.verification.entries()) {
      checks.push({
        id: `recommended-${index + 1}`,
        label: recommendation,
        status: 'unavailable',
        detail: 'Running project commands needs the in-browser runtime, which is not built yet.',
      });
    }

    return Object.freeze(checks);
  }
}
