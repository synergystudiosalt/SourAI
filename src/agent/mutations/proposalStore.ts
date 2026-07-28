import type { StorageDatabase } from '../../storage/database';
import { canonicalJson, parseFileChangeProposal, type FileChangeProposalV1 } from './proposal';

/**
 * Durable storage for proposals awaiting review.
 *
 * Events record that a proposal exists — its digest, paths, and summary — but
 * not its content, because a change's file bodies do not belong in an
 * append-only log. They are kept here instead so a reload during review can
 * rebuild the exact diff the user was looking at, and are removed as soon as
 * the proposal is settled.
 */

interface StoredProposalRecord {
  readonly id: string;
  readonly recordType: 'agent-proposal';
  readonly projectId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly digest: string;
  readonly createdAt: number;
  readonly proposal: string;
}

const PREFIX = 'agent-proposal:';

export class ProposalStore {
  constructor(private readonly database: StorageDatabase) {}

  async save(input: {
    readonly proposalId: string;
    readonly approvalId: string;
    readonly projectId: string;
    readonly threadId: string;
    readonly runId: string;
    readonly toolCallId: string;
    readonly digest: string;
    readonly proposal: FileChangeProposalV1;
  }): Promise<void> {
    await this.database.transaction(['artifacts'], 'readwrite', async (transaction) => {
      await transaction.put<StoredProposalRecord>('artifacts', {
        id: `${PREFIX}${input.approvalId}`,
        recordType: 'agent-proposal',
        projectId: input.projectId,
        threadId: input.threadId,
        runId: input.runId,
        approvalId: input.approvalId,
        toolCallId: input.toolCallId,
        digest: input.digest,
        createdAt: Date.now(),
        proposal: canonicalJson(input.proposal),
      });
    });
  }

  async load(approvalId: string): Promise<
    | {
        readonly proposal: FileChangeProposalV1;
        readonly runId: string;
        readonly threadId: string;
        readonly projectId: string;
        readonly toolCallId: string;
        readonly digest: string;
      }
    | undefined
  > {
    const record = await this.database.transaction(
      ['artifacts'],
      'readonly',
      async (transaction) =>
        transaction.get<StoredProposalRecord>('artifacts', `${PREFIX}${approvalId}`)
    );
    if (!record || record.recordType !== 'agent-proposal') return undefined;
    try {
      // Stored data is re-parsed rather than trusted: a corrupt or tampered
      // record must fail review, not produce an unreviewable change.
      const proposal = parseFileChangeProposal(JSON.parse(record.proposal));
      return {
        proposal,
        runId: record.runId,
        threadId: record.threadId,
        projectId: record.projectId,
        toolCallId: record.toolCallId,
        digest: record.digest,
      };
    } catch {
      return undefined;
    }
  }

  async delete(approvalId: string): Promise<void> {
    await this.database.transaction(['artifacts'], 'readwrite', async (transaction) => {
      await transaction.delete('artifacts', `${PREFIX}${approvalId}`);
    });
  }
}
