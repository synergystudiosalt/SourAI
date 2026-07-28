import { SourError } from '../../contracts/errors';
import type {
  MutationReviewGate,
  MutationReviewReport,
  MutationReviewRequest,
} from '../runtime/types';
import type { AgentWorkerResponse, WorkerMessagePort } from './protocol';

/**
 * The worker's view of the reviewer.
 *
 * The worker cannot show a diff or hold a user's decision, so it asks the host
 * and waits. Nothing about the answer is trusted structurally — the host is
 * where the approval artifact is minted and consumed — but the shape is still
 * validated here so a malformed reply cannot corrupt the event log.
 */
export class WorkerMutationGate implements MutationReviewGate {
  readonly #pending = new Map<string, (report: MutationReviewReport) => void>();
  /**
   * Approvals the host has begun applying.
   *
   * Once a transaction is under way, a cancellation must not resolve the review
   * as a denial: the workspace may already have changed, and the run has to
   * record what actually happened rather than what the user asked for a moment
   * too late.
   */
  readonly #committed = new Set<string>();
  #revision = 0;

  constructor(private readonly port: WorkerMessagePort) {}

  /** Latest revision reported by the host; refreshed with each workspace sync. */
  setRevision(revision: number): void {
    if (Number.isSafeInteger(revision) && revision >= 0) this.#revision = revision;
  }

  async projectRevision(): Promise<number> {
    return this.#revision;
  }

  review(request: MutationReviewRequest): Promise<MutationReviewReport> {
    return new Promise<MutationReviewReport>((resolve) => {
      const settle = (report: MutationReviewReport) => {
        if (!this.#pending.delete(request.approvalId)) return;
        resolve(report);
      };
      this.#pending.set(request.approvalId, settle);

      const cancel = () => {
        if (this.#committed.has(request.approvalId)) return;
        settle({ decision: 'denied', reason: 'The run was cancelled.' });
      };
      if (request.signal.aborted) {
        cancel();
        return;
      }
      request.signal.addEventListener('abort', cancel, { once: true });

      this.port.postMessage({
        kind: 'mutation.review',
        request: {
          approvalId: request.approvalId,
          runId: request.runId,
          projectId: request.projectId,
          threadId: request.threadId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          projectRevision: request.projectRevision,
          proposal: {
            id: request.proposal.id,
            digest: request.proposal.digest,
            summary: request.proposal.summary,
            paths: [...request.proposal.paths],
            changeCount: request.proposal.changeCount,
            value: request.proposal.value,
          },
        },
      } satisfies AgentWorkerResponse);
    });
  }

  /** Marks an approval as being applied, closing the cancellation window. */
  commit(approvalId: unknown): void {
    if (typeof approvalId === 'string' && this.#pending.has(approvalId)) {
      this.#committed.add(approvalId);
    }
  }

  /** Routes a host decision to the waiting run. Unknown ids are ignored. */
  resolve(approvalId: unknown, report: unknown): void {
    if (typeof approvalId !== 'string') return;
    this.#committed.delete(approvalId);
    const settle = this.#pending.get(approvalId);
    if (!settle) return;
    try {
      settle(parseReviewReport(report));
    } catch (error) {
      // A reply that cannot be parsed must not leave the run waiting forever,
      // and must never be read as permission to write.
      settle({
        decision: 'denied',
        reason:
          error instanceof Error
            ? `The reviewer returned an unusable result: ${error.message}`
            : 'The reviewer returned an unusable result.',
      });
    }
  }

  /** Fails any outstanding review, used when the composition is torn down. */
  abandon(reason: string): void {
    for (const settle of [...this.#pending.values()]) {
      settle({ decision: 'denied', reason });
    }
    this.#pending.clear();
    this.#committed.clear();
  }
}

function parseReviewReport(value: unknown): MutationReviewReport {
  const record = asRecord(value);
  const decision = record?.decision;
  if (decision !== 'approved' && decision !== 'denied' && decision !== 'expired') {
    // A reply that cannot be understood is treated as a refusal, never as
    // permission to write.
    return { decision: 'denied', reason: 'The reviewer returned an unreadable decision.' };
  }
  return Object.freeze({
    decision,
    ...(typeof record?.digest === 'string' ? { digest: record.digest } : {}),
    ...(typeof record?.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record?.transactionId === 'string' ? { transactionId: record.transactionId } : {}),
    ...(record?.outcome === undefined ? {} : { outcome: parseOutcome(record.outcome) }),
  });
}

function parseOutcome(value: unknown): MutationReviewReport['outcome'] {
  const record = asRecord(value);
  switch (record?.status) {
    case 'applied':
      return Object.freeze({
        status: 'applied' as const,
        transactionId: requireString(record.transactionId, 'transactionId'),
        checkpointId: requireString(record.checkpointId, 'checkpointId'),
        previousRevision: requireInteger(record.previousRevision, 'previousRevision'),
        revision: requireInteger(record.revision, 'revision'),
        changedPaths: stringList(record.changedPaths),
        verification: Array.isArray(record.verification)
          ? Object.freeze(
              record.verification.flatMap((item) => {
                const check = asRecord(item);
                if (!check) return [];
                const status = check.status;
                if (
                  status !== 'passed' &&
                  status !== 'failed' &&
                  status !== 'skipped' &&
                  status !== 'unavailable'
                ) {
                  return [];
                }
                return [
                  Object.freeze({
                    id: requireString(check.id, 'verification.id'),
                    label: requireString(check.label, 'verification.label'),
                    status,
                    detail: typeof check.detail === 'string' ? check.detail : '',
                  }),
                ];
              })
            )
          : Object.freeze([]),
      });
    case 'conflict':
      return Object.freeze({
        status: 'conflict' as const,
        conflicts: Array.isArray(record.conflicts)
          ? Object.freeze(
              record.conflicts.flatMap((item) => {
                const conflict = asRecord(item);
                if (!conflict) return [];
                return [
                  Object.freeze({
                    path: typeof conflict.path === 'string' ? conflict.path : '',
                    reason:
                      typeof conflict.reason === 'string'
                        ? conflict.reason
                        : 'The workspace changed.',
                    ...(typeof conflict.expectedHash === 'string'
                      ? { expectedHash: conflict.expectedHash }
                      : {}),
                    ...(typeof conflict.actualHash === 'string'
                      ? { actualHash: conflict.actualHash }
                      : {}),
                  }),
                ];
              })
            )
          : Object.freeze([]),
      });
    case 'failed': {
      const error = asRecord(record.error);
      return Object.freeze({
        status: 'failed' as const,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'mutation_failed',
          message:
            typeof error?.message === 'string' ? error.message : 'The change could not be applied.',
          retryable: error?.retryable === true,
          causeCategory: 'runtime' as const,
        },
        rolledBack: record.rolledBack === true,
        ...(typeof record.checkpointId === 'string' ? { checkpointId: record.checkpointId } : {}),
        ...(typeof record.transactionId === 'string' ? { transactionId: record.transactionId } : {}),
      });
    }
    default:
      return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new SourError({
      code: 'mutation_report_invalid',
      message: 'The reviewer returned an incomplete result.',
      causeCategory: 'validation',
      retryable: false,
      details: { field },
    });
  }
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SourError({
      code: 'mutation_report_invalid',
      message: 'The reviewer returned an incomplete result.',
      causeCategory: 'validation',
      retryable: false,
      details: { field },
    });
  }
  return value;
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter((item): item is string => typeof item === 'string'));
}
