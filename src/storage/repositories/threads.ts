import { queryBound, queryOnly, type StorageDatabase } from '../database';
import { StorageError } from '../errors';
import {
  assertCurrentRecord,
  assertNonEmptyId,
  type ThreadRecord,
} from './records';

const MAX_TIMESTAMP = Number.MAX_SAFE_INTEGER;

function validateThread(record: ThreadRecord): void {
  assertCurrentRecord<ThreadRecord>(record, 'threads');
  assertNonEmptyId(record.id, 'Thread id');
  assertNonEmptyId(record.projectId, 'Thread projectId');
  assertNonEmptyId(record.status, 'Thread status');
  if (
    !Number.isFinite(record.createdAt) ||
    !Number.isFinite(record.updatedAt) ||
    record.createdAt < 0 ||
    record.updatedAt < record.createdAt
  ) {
    throw new StorageError('record_corrupt', 'Thread timestamps are invalid.');
  }
}

export class ThreadsRepository {
  constructor(private readonly database: StorageDatabase) {}

  async get(id: string): Promise<ThreadRecord | undefined> {
    return this.database.transaction(['threads'], 'readonly', async (transaction) => {
      const record = await transaction.get<ThreadRecord>('threads', id);
      if (record) validateThread(record);
      return record;
    });
  }

  async put(record: ThreadRecord): Promise<void> {
    validateThread(record);
    await this.database.transaction(['threads'], 'readwrite', async (transaction) => {
      await transaction.put('threads', record);
    });
  }

  async listByProject(projectId: string): Promise<ThreadRecord[]> {
    const values = await this.database.transaction(['threads'], 'readonly', (transaction) =>
      transaction.getAllFromIndex<ThreadRecord>(
        'threads',
        'byProjectUpdatedAt',
        queryBound([projectId, 0], [projectId, MAX_TIMESTAMP])
      )
    );
    for (const value of values) validateThread(value);
    return values.reverse();
  }

  async listByStatus(status: string): Promise<ThreadRecord[]> {
    const values = await this.database.transaction(['threads'], 'readonly', (transaction) =>
      transaction.getAllFromIndex<ThreadRecord>('threads', 'byStatus', queryOnly(status))
    );
    for (const value of values) validateThread(value);
    return values;
  }

  async archive(id: string, archivedAt: number): Promise<ThreadRecord> {
    return this.database.transaction(['threads'], 'readwrite', async (transaction) => {
      const current = await transaction.get<ThreadRecord>('threads', id);
      if (!current) throw new StorageError('record_conflict', `Thread ${id} does not exist.`);
      validateThread(current);
      const next = { ...current, archivedAt, updatedAt: Math.max(current.updatedAt, archivedAt) };
      await transaction.put('threads', next);
      return next;
    });
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(['threads'], 'readwrite', (transaction) =>
      transaction.delete('threads', id)
    );
  }
}
