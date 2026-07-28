import { WorkspaceFsError } from '../errors';
import { isWithinRoot, workspacePath, workspaceRoot } from '../path';
import type {
  FileStat,
  TransactionResult,
  WorkspaceFileSystem,
  WorkspaceMutation,
  WorkspacePath,
  WorkspaceTransaction,
} from '../types';
import type { TransactionJournal } from './journal';

function conflict(message: string, path?: string): WorkspaceFsError {
  return new WorkspaceFsError('conflict', message, path);
}

function isNotFound(error: unknown): boolean {
  return error instanceof WorkspaceFsError && error.code === 'not_found';
}

function validatePath(path: WorkspacePath): WorkspacePath {
  try {
    const validated = workspacePath(String(path));
    if (!isWithinRoot(validated, workspaceRoot())) throw new TypeError('Path escapes workspace.');
    return validated;
  } catch {
    throw new WorkspaceFsError('permission_denied', 'Mutation path is outside the workspace.', String(path));
  }
}

function mutationPaths(mutation: WorkspaceMutation): readonly WorkspacePath[] {
  return mutation.type === 'move'
    ? [validatePath(mutation.from), validatePath(mutation.to)]
    : [validatePath(mutation.path)];
}

function overlaps(left: WorkspacePath, right: WorkspacePath): boolean {
  return isWithinRoot(left, right) || isWithinRoot(right, left);
}

async function optionalStat(
  fs: WorkspaceFileSystem,
  path: WorkspacePath
): Promise<FileStat | undefined> {
  try {
    return await fs.stat(path);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function assertHash(path: WorkspacePath, stat: FileStat | undefined, expected?: string): void {
  if (expected === undefined) return;
  if (!stat || stat.contentHash !== expected) {
    throw conflict(`Content changed before transaction at "${path}".`, path);
  }
}

export interface TransactionEngineOptions {
  readonly journal: TransactionJournal;
}

export interface TransactionRecoveryResult {
  readonly transactionId: string;
  readonly outcome: 'rolled-back' | 'unsafe';
  readonly reason?: string;
}

/**
 * Serializes transactions for one workspace. Cross-context safety is provided
 * by the filesystem revision/hash preconditions, while snapshots make a
 * multi-operation transaction atomic when an adapter has no native batch API.
 */
export class WorkspaceTransactionEngine {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fs: WorkspaceFileSystem,
    private readonly options: TransactionEngineOptions
  ) {}

  execute(transaction: WorkspaceTransaction): Promise<TransactionResult> {
    const ownedTransaction: WorkspaceTransaction = Object.freeze({
      ...transaction,
      mutations: Object.freeze(
        transaction.mutations.map((mutation) =>
          mutation.type === 'write'
            ? Object.freeze({ ...mutation, data: mutation.data.slice() })
            : Object.freeze({ ...mutation })
        )
      ),
    });
    const run = this.queue.then(() => this.executeExclusive(ownedTransaction));
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  recoverIncomplete(): Promise<readonly TransactionRecoveryResult[]> {
    const run = this.queue.then(() => this.recoverExclusive());
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async recoverExclusive(): Promise<readonly TransactionRecoveryResult[]> {
    const results: TransactionRecoveryResult[] = [];
    for (const transactionId of await this.options.journal.incomplete()) {
      const entries = await this.options.journal.read(transactionId);
      const latest = entries.at(-1);
      if (!latest) continue;
      const checkpoint = [...entries].reverse().find((entry) => entry.checkpoint)?.checkpoint;
      const appliedMutations = latest.appliedMutations ?? 0;
      if (!checkpoint || appliedMutations === 0) {
        await this.options.journal.append({
          transactionId,
          phase: 'rolled-back',
          checkpoint,
          appliedPaths: latest.appliedPaths,
          appliedMutations: 0,
        });
        results.push({ transactionId, outcome: 'rolled-back' });
        continue;
      }
      const reason = await this.rollbackSafetyReason(checkpoint, appliedMutations);
      if (reason) {
        await this.options.journal.append({
          transactionId,
          phase: 'failed',
          checkpoint,
          appliedPaths: latest.appliedPaths,
          appliedMutations,
          error: reason,
        });
        results.push({ transactionId, outcome: 'unsafe', reason });
        continue;
      }
      await this.fs.restore(checkpoint);
      await this.options.journal.append({
        transactionId,
        phase: 'rolled-back',
        checkpoint,
        appliedPaths: latest.appliedPaths,
        appliedMutations,
      });
      results.push({ transactionId, outcome: 'rolled-back' });
    }
    return Object.freeze(results);
  }

  private async executeExclusive(transaction: WorkspaceTransaction): Promise<TransactionResult> {
    if (!transaction.id.trim()) throw new TypeError('Transaction id is required.');
    if (!transaction.reason.trim()) throw new TypeError('Transaction reason is required.');
    if (!Number.isSafeInteger(transaction.projectRevision) || transaction.projectRevision < 0) {
      throw new TypeError('Project revision must be a non-negative safe integer.');
    }
    if (transaction.mutations.length === 0) throw new TypeError('Transaction has no mutations.');
    if ((await this.options.journal.read(transaction.id)).length > 0) {
      throw conflict(`Transaction id "${transaction.id}" has already been used.`);
    }

    const paths = transaction.mutations.flatMap(mutationPaths);
    for (let left = 0; left < paths.length; left += 1) {
      for (let right = left + 1; right < paths.length; right += 1) {
        if (overlaps(paths[left], paths[right])) {
          throw conflict('A transaction cannot mutate overlapping paths.', paths[right]);
        }
      }
    }

    await this.options.journal.append({
      transactionId: transaction.id,
      phase: 'preparing',
      transaction,
    });

    const currentRevision = await this.fs.revision();
    if (currentRevision !== transaction.projectRevision) {
      await this.options.journal.append({
        transactionId: transaction.id,
        phase: 'failed',
        error: `Expected revision ${transaction.projectRevision}, received ${currentRevision}.`,
      });
      throw conflict('Project changed before transaction.');
    }

    let initialStats: Map<WorkspacePath, FileStat | undefined>;
    let checkpoint: Awaited<ReturnType<WorkspaceFileSystem['snapshot']>>;
    try {
      initialStats = await this.prevalidate(transaction.mutations);
      checkpoint = await this.fs.snapshot();
    } catch (error) {
      await this.options.journal.append({
        transactionId: transaction.id,
        phase: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await this.options.journal.append({
      transactionId: transaction.id,
      phase: 'applying',
      checkpoint,
      appliedPaths: [],
      appliedMutations: 0,
    });

    const changedPaths: WorkspacePath[] = [];
    let appliedMutations = 0;
    try {
      for (let index = 0; index < transaction.mutations.length; index += 1) {
        const mutation = transaction.mutations[index];
        const expectedRevision = currentRevision + index;
        await this.apply(
          mutation,
          expectedRevision,
          transaction.origin,
          initialStats.get(mutation.type === 'move' ? mutation.from : mutation.path)
        );
        appliedMutations += 1;
        changedPaths.push(...mutationPaths(mutation));
        if ((await this.fs.revision()) !== expectedRevision + 1) {
          throw conflict('Filesystem revision did not advance canonically.');
        }
        await this.options.journal.append({
          transactionId: transaction.id,
          phase: 'applying',
          checkpoint,
          appliedPaths: changedPaths,
          appliedMutations,
        });
      }
      const revision = await this.fs.revision();
      await this.options.journal.append({
        transactionId: transaction.id,
        phase: 'committed',
        checkpoint,
        appliedPaths: changedPaths,
        appliedMutations,
      });
      return Object.freeze({
        transactionId: transaction.id,
        previousRevision: currentRevision,
        revision,
        checkpoint,
        changedPaths: Object.freeze([...changedPaths]),
      });
    } catch (error) {
      await this.rollback(transaction.id, checkpoint, changedPaths, appliedMutations, error);
      if (error instanceof WorkspaceFsError) throw error;
      throw new WorkspaceFsError(
        'transaction_failed',
        error instanceof Error ? error.message : 'Transaction failed.'
      );
    }
  }

  private async prevalidate(
    mutations: readonly WorkspaceMutation[]
  ): Promise<Map<WorkspacePath, FileStat | undefined>> {
    const initialStats = new Map<WorkspacePath, FileStat | undefined>();
    for (const mutation of mutations) {
      if (mutation.type === 'write') {
        const path = validatePath(mutation.path);
        const existing = await optionalStat(this.fs, path);
        initialStats.set(path, existing);
        if (mutation.createOnly && existing) throw conflict(`"${path}" already exists.`, path);
        if (existing?.kind === 'directory') throw conflict(`"${path}" is a directory.`, path);
        assertHash(path, existing, mutation.expectedHash);
      } else if (mutation.type === 'delete') {
        const path = validatePath(mutation.path);
        const existing = await optionalStat(this.fs, path);
        initialStats.set(path, existing);
        if (!existing) throw conflict(`"${path}" no longer exists.`, path);
        assertHash(path, existing, mutation.expectedHash);
      } else {
        const from = validatePath(mutation.from);
        const to = validatePath(mutation.to);
        const existing = await optionalStat(this.fs, from);
        initialStats.set(from, existing);
        if (!existing) throw conflict(`"${from}" no longer exists.`, from);
        assertHash(from, existing, mutation.expectedHash);
        if (await optionalStat(this.fs, to)) throw conflict(`"${to}" already exists.`, to);
      }
    }
    return initialStats;
  }

  private async apply(
    mutation: WorkspaceMutation,
    revision: number,
    origin: WorkspaceTransaction['origin'],
    initialStat: FileStat | undefined
  ): Promise<void> {
    if (mutation.type === 'write') {
      const path = validatePath(mutation.path);
      await this.fs.writeFile(
        path,
        mutation.data,
        mutation.createOnly
          ? { type: 'create-only', projectRevision: revision }
          : initialStat
            ? {
                type: 'match',
                projectRevision: revision,
                contentHash: mutation.expectedHash ?? initialStat.contentHash ?? '',
              }
            : { type: 'create-only', projectRevision: revision },
        origin
      );
      return;
    }
    if (mutation.type === 'delete') {
      await this.fs.deletePath(
        validatePath(mutation.path),
        { projectRevision: revision, contentHash: mutation.expectedHash },
        origin
      );
      return;
    }
    await this.fs.movePath(
      validatePath(mutation.from),
      validatePath(mutation.to),
      {
        projectRevision: revision,
        contentHash: mutation.expectedHash,
        destinationMustNotExist: true,
      },
      origin
    );
  }

  private async rollback(
    transactionId: string,
    checkpoint: Awaited<ReturnType<WorkspaceFileSystem['snapshot']>>,
    appliedPaths: readonly WorkspacePath[],
    appliedMutations: number,
    cause: unknown
  ): Promise<void> {
    if (appliedMutations === 0) {
      await this.options.journal.append({
        transactionId,
        phase: 'rolled-back',
        checkpoint,
        appliedPaths,
        appliedMutations: 0,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }
    const unsafeReason = await this.rollbackSafetyReason(checkpoint, appliedMutations);
    if (unsafeReason) {
      await this.options.journal.append({
        transactionId,
        phase: 'failed',
        checkpoint,
        appliedPaths,
        appliedMutations,
        error: unsafeReason,
      });
      throw new WorkspaceFsError('transaction_failed', unsafeReason);
    }
    let journalError: unknown;
    try {
      await this.options.journal.append({
        transactionId,
        phase: 'rolling-back',
        checkpoint,
        appliedPaths,
        appliedMutations,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    } catch (error) {
      journalError = error;
    }
    try {
      await this.fs.restore(checkpoint);
      if (journalError) throw journalError;
      await this.options.journal.append({
        transactionId,
        phase: 'rolled-back',
        checkpoint,
        appliedPaths,
        appliedMutations,
      });
    } catch (rollbackError) {
      await this.options.journal.append({
        transactionId,
        phase: 'failed',
        checkpoint,
        appliedPaths,
        appliedMutations,
        error: `Rollback failed: ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`,
      });
      throw new WorkspaceFsError('transaction_failed', 'Transaction and checkpoint rollback failed.');
    }
  }

  private async rollbackSafetyReason(
    checkpoint: Awaited<ReturnType<WorkspaceFileSystem['snapshot']>>,
    appliedMutations: number
  ): Promise<string | undefined> {
    if (!this.fs.capabilities().atomicTransactions) {
      return 'Automatic rollback is unsafe for this filesystem; the checkpoint was preserved for manual recovery.';
    }
    const expectedRevision = checkpoint.revision + appliedMutations;
    const currentRevision = await this.fs.revision();
    if (currentRevision !== expectedRevision) {
      return `Automatic rollback refused because the workspace advanced from expected revision ${expectedRevision} to ${currentRevision}.`;
    }
    return undefined;
  }
}
