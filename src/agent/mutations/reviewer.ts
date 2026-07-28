import { SourError } from '../../contracts/errors';
import { MemoryWorkspaceFileSystem } from '../../filesystem/memory/MemoryWorkspaceFileSystem';
import { InMemoryTransactionJournal, WorkspaceTransactionEngine } from '../../filesystem/sync';
import type { TransactionJournal } from '../../filesystem/sync';
import { ApprovalCoordinator } from './approval';
import { MutationApplier, type ApplyOutcome } from './applier';
import { applyHunks, diffToHunks, decodeText, describeHunk, visibleLines } from './patch';
import {
  parseFileChangeProposal,
  proposalDigest,
  type FileChangeProposalV1,
  type ProposedChange,
} from './proposal';
import type { DiffHunkView } from './patch';

/**
 * The trusted reviewer that stands between a proposal and the workspace.
 *
 * It runs on the host, next to the project and the UI, because that is where
 * the authoritative files live and where a human can actually see a diff. The
 * model runs in a worker and can only send it a proposal; it can never call
 * `approve`.
 */

export interface PendingReview {
  readonly approvalId: string;
  readonly proposalId: string;
  readonly runId: string;
  readonly threadId: string;
  readonly toolCallId: string;
  readonly summary: string;
  readonly digest: string;
  readonly projectRevision: number;
  readonly proposal: FileChangeProposalV1;
  readonly files: readonly ReviewFile[];
  readonly expiresAt: number;
  readonly totalAdded: number;
  readonly totalRemoved: number;
  readonly hasConflict: boolean;
}

export interface ReviewFile {
  readonly path: string;
  readonly operation: ProposedChange['operation'];
  readonly kind: 'create' | 'modify' | 'delete' | 'move' | 'directory';
  readonly hunks: readonly DiffHunkView[];
  readonly added: number;
  readonly removed: number;
  readonly conflict?: string;
  readonly binary: boolean;
  readonly truncated: boolean;
  /** Move destination, for a rename. */
  readonly destination?: string;
}

export interface ReviewSelection {
  /** Paths to keep. Omitted means every file. */
  readonly paths?: readonly string[];
  /** Hunk ids to keep, per path. Omitted for a path means every hunk. */
  readonly hunks?: Readonly<Record<string, readonly string[]>>;
}

export interface ReviewerOptions {
  readonly filesystem: MemoryWorkspaceFileSystem;
  readonly journal?: TransactionJournal;
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly ttlMs?: number;
}

const MAX_REVIEW_LINES = 2_000;

export class MutationReviewer {
  readonly #coordinator: ApprovalCoordinator;
  readonly #applier: MutationApplier;
  readonly #filesystem: MemoryWorkspaceFileSystem;
  readonly #createId: () => string;

  constructor(options: ReviewerOptions) {
    this.#filesystem = options.filesystem;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#coordinator = new ApprovalCoordinator({
      ...(options.now ? { now: options.now } : {}),
      ...(options.createId ? { createId: options.createId } : {}),
      ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}),
    });
    this.#applier = new MutationApplier({
      filesystem: options.filesystem,
      engine: new WorkspaceTransactionEngine(options.filesystem, {
        journal: options.journal ?? new InMemoryTransactionJournal(),
      }),
      coordinator: this.#coordinator,
    });
  }

  get filesystem(): MemoryWorkspaceFileSystem {
    return this.#filesystem;
  }

  /**
   * Registers an incoming proposal and builds everything the UI needs to show
   * it: per-file diffs, line counts, and any conflict already present.
   */
  async prepare(input: {
    readonly approvalId: string;
    readonly proposalId: string;
    readonly runId: string;
    readonly threadId: string;
    readonly projectId: string;
    readonly toolCallId: string;
    readonly proposal: unknown;
  }): Promise<PendingReview> {
    const proposal = parseFileChangeProposal(input.proposal);
    const projectRevision = await this.#filesystem.revision();
    const request = await this.#coordinator.request({
      proposal,
      approvalId: input.approvalId,
      proposalId: input.proposalId,
      projectId: input.projectId,
      threadId: input.threadId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      projectRevision,
    });
    const files = await this.describe(proposal);

    return Object.freeze({
      approvalId: request.approvalId,
      proposalId: request.proposalId,
      runId: input.runId,
      threadId: input.threadId,
      toolCallId: input.toolCallId,
      summary: proposal.summary,
      digest: request.proposalDigest,
      projectRevision,
      proposal,
      files,
      expiresAt: request.expiresAt,
      totalAdded: files.reduce((total, file) => total + file.added, 0),
      totalRemoved: files.reduce((total, file) => total + file.removed, 0),
      hasConflict: files.some((file) => file.conflict !== undefined),
    });
  }

  /** Builds the reviewable diff for each change against current content. */
  async describe(proposal: FileChangeProposalV1): Promise<readonly ReviewFile[]> {
    const files: ReviewFile[] = [];
    for (const change of proposal.changes) {
      const path = change.operation === 'move_file' ? change.from : change.path;
      const current = this.#filesystem.readText(String(path));

      if (change.operation === 'create_directory') {
        files.push({
          path: String(path),
          operation: change.operation,
          kind: 'directory',
          hunks: [],
          added: 0,
          removed: 0,
          binary: false,
          truncated: false,
        });
        continue;
      }

      if (change.operation === 'delete_file') {
        const lines = current === undefined ? [] : visibleLines(decodeText(current));
        files.push({
          path: String(path),
          operation: change.operation,
          kind: 'delete',
          hunks: [],
          added: 0,
          removed: lines.length,
          binary: false,
          truncated: false,
          ...(current === undefined ? { conflict: 'This file no longer exists.' } : {}),
        });
        continue;
      }

      if (change.operation === 'move_file') {
        files.push({
          path: String(change.from),
          destination: String(change.to),
          operation: change.operation,
          kind: 'move',
          hunks: [],
          added: 0,
          removed: 0,
          binary: false,
          truncated: false,
          ...(current === undefined ? { conflict: 'This file no longer exists.' } : {}),
        });
        continue;
      }

      const conflict = await this.conflictFor(change, current);
      const before = current ?? '';
      const after =
        change.operation === 'write_file'
          ? change.content
          : this.previewPatched(before, change) ?? before;
      const originalLines = decodeText(before).lines;
      const resultingLines = decodeText(after).lines;
      const tooLarge =
        originalLines.length > MAX_REVIEW_LINES ||
        resultingLines.length > MAX_REVIEW_LINES ||
        before.length > 256_000 ||
        after.length > 256_000;
      const hunks = tooLarge
        ? []
        : (change.operation === 'patch_file' ? change.hunks : diffToHunks(before, after)).map(
            (hunk, index) => describeHunk(originalLines, hunk, index)
          );

      files.push({
        path: String(path),
        operation: change.operation,
        kind: current === undefined ? 'create' : 'modify',
        hunks,
        added: hunks.reduce((total, hunk) => total + hunk.added, 0),
        removed: hunks.reduce((total, hunk) => total + hunk.removed, 0),
        binary: false,
        truncated: tooLarge,
        ...(conflict ? { conflict } : {}),
      });
    }
    return Object.freeze(files);
  }

  private previewPatched(before: string, change: ProposedChange): string | undefined {
    if (change.operation !== 'patch_file') return undefined;
    try {
      return applyHunks(before, change.hunks);
    } catch {
      // A patch that no longer applies is surfaced as a conflict, not a diff.
      return undefined;
    }
  }

  private async conflictFor(
    change: ProposedChange,
    current: string | undefined
  ): Promise<string | undefined> {
    if (change.operation === 'create_directory') return undefined;
    if (change.expectedHash === undefined) {
      return change.operation === 'write_file' && current !== undefined
        ? 'This file already exists and the proposal did not record the version it replaces.'
        : undefined;
    }
    if (current === undefined) return 'This file no longer exists.';
    const path = change.operation === 'move_file' ? change.from : change.path;
    const stat = await this.#filesystem.stat(path);
    return stat.contentHash === change.expectedHash
      ? undefined
      : 'This file changed after the proposal was created.';
  }

  /**
   * Applies a review decision.
   *
   * When the user keeps only some files or hunks, a *new* proposal is built
   * from the selection and approved instead; its digest differs, so what gets
   * applied is exactly what was selected and nothing else.
   */
  async approve(
    pending: PendingReview,
    selection: ReviewSelection = {}
  ): Promise<{ readonly outcome: ApplyOutcome; readonly digest: string }> {
    const selected = this.select(pending.proposal, selection);
    const digest = await proposalDigest(selected);
    const artifact = await this.#coordinator.approve(pending.approvalId, selected);
    const outcome = await this.#applier.apply({
      proposal: selected,
      artifact,
      projectId: artifact.projectId,
      threadId: pending.threadId,
      runId: pending.runId,
      toolCallId: pending.toolCallId,
      transactionId: this.#createId(),
    });
    return { outcome, digest };
  }

  deny(approvalId: string): void {
    this.#coordinator.deny(approvalId);
  }

  forgetRun(runId: string): void {
    this.#coordinator.forgetRun(runId);
  }

  /** Restores a checkpoint captured by an applied transaction. */
  async restore(checkpointId: string): Promise<{ readonly revision: number }> {
    await this.#filesystem.restore({
      id: checkpointId,
      revision: 0,
      createdAt: 0,
      entries: [],
    });
    return { revision: await this.#filesystem.revision() };
  }

  /**
   * Builds a proposal containing only the selected files and hunks.
   *
   * A partially-kept `write_file` becomes a `patch_file` carrying just the kept
   * hunks, so the applier still verifies every anchor before writing.
   */
  select(proposal: FileChangeProposalV1, selection: ReviewSelection): FileChangeProposalV1 {
    if (selection.paths === undefined && selection.hunks === undefined) return proposal;

    const keptPaths = selection.paths ? new Set(selection.paths) : undefined;
    const changes: unknown[] = [];

    for (const change of proposal.changes) {
      const path = String(change.operation === 'move_file' ? change.from : change.path);
      if (keptPaths && !keptPaths.has(path)) continue;

      const keptHunkIds = selection.hunks?.[path];
      if (keptHunkIds === undefined) {
        changes.push(serializeChange(change));
        continue;
      }
      const kept = new Set(keptHunkIds);
      if (kept.size === 0) continue;

      if (change.operation === 'patch_file') {
        const hunks = change.hunks.filter((hunk, index) => kept.has(hunk.id || `hunk-${index + 1}`));
        if (hunks.length === 0) continue;
        changes.push({
          operation: 'patch_file',
          path,
          expectedHash: change.expectedHash,
          reason: change.reason,
          hunks: hunks.map((hunk) => ({
            startLine: hunk.startLine,
            originalLines: [...hunk.originalLines],
            replacementLines: [...hunk.replacementLines],
          })),
        });
        continue;
      }

      if (change.operation === 'write_file' && change.expectedHash !== undefined) {
        const before = this.#filesystem.readText(path) ?? '';
        const hunks = diffToHunks(before, change.content).filter((hunk, index) =>
          kept.has(hunk.id || `hunk-${index + 1}`)
        );
        if (hunks.length === 0) continue;
        changes.push({
          operation: 'patch_file',
          path,
          expectedHash: change.expectedHash,
          reason: change.reason,
          hunks: hunks.map((hunk) => ({
            startLine: hunk.startLine,
            originalLines: [...hunk.originalLines],
            replacementLines: [...hunk.replacementLines],
          })),
        });
        continue;
      }

      changes.push(serializeChange(change));
    }

    if (changes.length === 0) {
      throw new SourError({
        code: 'selection_empty',
        message: 'Select at least one change to apply.',
        causeCategory: 'validation',
        retryable: false,
      });
    }

    return parseFileChangeProposal({
      version: 1,
      summary: proposal.summary,
      verification: [...proposal.verification],
      changes,
    });
  }
}

function serializeChange(change: ProposedChange): unknown {
  switch (change.operation) {
    case 'write_file':
      return {
        operation: change.operation,
        path: String(change.path),
        content: change.content,
        reason: change.reason,
        createOnly: change.createOnly,
        ...(change.expectedHash === undefined ? {} : { expectedHash: change.expectedHash }),
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
        reason: change.reason,
        ...(change.expectedHash === undefined ? {} : { expectedHash: change.expectedHash }),
      };
    default:
      return {
        operation: change.operation,
        path: String(change.path),
        reason: change.reason,
        ...(change.expectedHash === undefined ? {} : { expectedHash: change.expectedHash }),
      };
  }
}
