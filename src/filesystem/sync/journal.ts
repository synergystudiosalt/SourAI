import type { SnapshotManifest, WorkspacePath, WorkspaceTransaction } from '../types';
import type { StorageDatabase } from '../../storage/database';

export type TransactionJournalPhase =
  | 'preparing'
  | 'applying'
  | 'committed'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed';

export interface TransactionJournalEntry {
  readonly transactionId: string;
  readonly sequence: number;
  readonly phase: TransactionJournalPhase;
  readonly recordedAt: number;
  readonly transaction?: WorkspaceTransaction;
  readonly checkpoint?: SnapshotManifest;
  readonly appliedPaths?: readonly WorkspacePath[];
  readonly appliedMutations?: number;
  readonly error?: string;
}

export interface TransactionJournal {
  append(entry: Omit<TransactionJournalEntry, 'sequence' | 'recordedAt'>): Promise<void>;
  read(transactionId: string): Promise<readonly TransactionJournalEntry[]>;
  incomplete(): Promise<readonly string[]>;
}

export class InMemoryTransactionJournal implements TransactionJournal {
  private readonly records: TransactionJournalEntry[] = [];
  private sequence = 0;

  async append(entry: Omit<TransactionJournalEntry, 'sequence' | 'recordedAt'>): Promise<void> {
    this.records.push(
      Object.freeze({
        ...entry,
        appliedPaths: entry.appliedPaths ? Object.freeze([...entry.appliedPaths]) : undefined,
        sequence: ++this.sequence,
        recordedAt: Date.now(),
      })
    );
  }

  async read(transactionId: string): Promise<readonly TransactionJournalEntry[]> {
    return this.records.filter((entry) => entry.transactionId === transactionId);
  }

  async incomplete(): Promise<readonly string[]> {
    const latest = new Map<string, TransactionJournalPhase>();
    for (const entry of this.records) latest.set(entry.transactionId, entry.phase);
    return [...latest]
      .filter(([, phase]) => !['committed', 'rolled-back', 'failed'].includes(phase))
      .map(([id]) => id);
  }
}

interface DurableJournalRecord {
  readonly id: string;
  readonly recordType: 'workspace-transaction-journal';
  readonly projectId: string;
  readonly runId?: string;
  readonly createdAt: number;
  readonly entries: readonly TransactionJournalEntry[];
}

/**
 * IndexedDB-backed journal. It intentionally reuses the existing checkpoints
 * store so enabling crash recovery does not require a database migration.
 */
export class StorageDatabaseTransactionJournal implements TransactionJournal {
  private readonly prefix: string;

  constructor(
    private readonly database: StorageDatabase,
    readonly projectId: string
  ) {
    if (!projectId.trim()) throw new TypeError('A project id is required for a durable journal.');
    this.prefix = `workspace-transaction:${projectId}:`;
  }

  async append(entry: Omit<TransactionJournalEntry, 'sequence' | 'recordedAt'>): Promise<void> {
    await this.database.transaction(['checkpoints'], 'readwrite', async (transaction) => {
      const id = this.id(entry.transactionId);
      const existing = await transaction.get<DurableJournalRecord>('checkpoints', id);
      this.assertOwnedRecord(existing);
      const records = existing?.entries ?? [];
      const next: TransactionJournalEntry = {
        ...entry,
        appliedPaths: entry.appliedPaths ? [...entry.appliedPaths] : undefined,
        sequence: (records.at(-1)?.sequence ?? 0) + 1,
        recordedAt: Date.now(),
      };
      await transaction.put<DurableJournalRecord>('checkpoints', {
        id,
        recordType: 'workspace-transaction-journal',
        projectId: this.projectId,
        createdAt: existing?.createdAt ?? next.recordedAt,
        entries: [...records, next],
      });
    });
  }

  async read(transactionId: string): Promise<readonly TransactionJournalEntry[]> {
    return this.database.transaction(['checkpoints'], 'readonly', async (transaction) => {
      const record = await transaction.get<DurableJournalRecord>(
        'checkpoints',
        this.id(transactionId)
      );
      this.assertOwnedRecord(record);
      return record?.entries ?? [];
    });
  }

  async incomplete(): Promise<readonly string[]> {
    return this.database.transaction(['checkpoints'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<DurableJournalRecord>('checkpoints');
      return records
        .filter(
          (record) =>
            record?.recordType === 'workspace-transaction-journal' &&
            record.projectId === this.projectId &&
            record.id.startsWith(this.prefix)
        )
        .filter((record) => {
          const phase = record.entries.at(-1)?.phase;
          return phase !== undefined && !['committed', 'rolled-back', 'failed'].includes(phase);
        })
        .map((record) => record.id.slice(this.prefix.length));
    });
  }

  private id(transactionId: string): string {
    return `${this.prefix}${transactionId}`;
  }

  private assertOwnedRecord(record: DurableJournalRecord | undefined): void {
    if (
      record &&
      (record.recordType !== 'workspace-transaction-journal' ||
        record.projectId !== this.projectId ||
        !Array.isArray(record.entries))
    ) {
      throw new TypeError('Transaction journal record is corrupt or belongs to another project.');
    }
  }
}
