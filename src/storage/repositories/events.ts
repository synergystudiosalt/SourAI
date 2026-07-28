import { queryBound, queryOnly, type StorageDatabase, type StorageTransaction } from '../database';
import { StorageError } from '../errors';
import {
  assertCurrentRecord,
  assertNonEmptyId,
  assertSequence,
  type EventRecord,
} from './records';

const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function validateEvent(record: EventRecord): void {
  assertCurrentRecord<EventRecord>(record, 'events');
  assertNonEmptyId(record.id, 'Event id');
  assertNonEmptyId(record.projectId, 'Event projectId');
  assertNonEmptyId(record.threadId, 'Event threadId');
  assertNonEmptyId(record.runId, 'Event runId');
  assertNonEmptyId(record.type, 'Event type');
  assertSequence(record.sequence, 'Event run sequence');
  assertSequence(record.globalSequence, 'Event global sequence');
  if (!Number.isFinite(record.createdAt) || record.createdAt < 0) {
    throw new StorageError('record_corrupt', 'Event createdAt is invalid.');
  }
}

async function appendEvent(transaction: StorageTransaction, record: EventRecord): Promise<boolean> {
  if (await transaction.get<EventRecord>('events', record.id)) return false;
  const runCollision = await transaction.getFromIndex<EventRecord>(
    'events',
    'byRunSequence',
    queryOnly([record.runId, record.sequence])
  );
  const threadCollision = await transaction.getFromIndex<EventRecord>(
    'events',
    'byThreadGlobalSequence',
    queryOnly([record.threadId, record.globalSequence])
  );
  if (runCollision || threadCollision) {
    throw new StorageError(
      'record_conflict',
      `Event sequence collision for ${record.id}; append-only history was not overwritten.`
    );
  }
  await transaction.add('events', record);
  return true;
}

export class EventsRepository {
  constructor(private readonly database: StorageDatabase) {}

  async append(record: EventRecord): Promise<boolean> {
    validateEvent(record);
    return this.database.transaction(['events'], 'readwrite', (transaction) =>
      appendEvent(transaction, record)
    );
  }

  /**
   * Allocates the thread sequence and appends in one read/write transaction.
   * IndexedDB serializes overlapping transactions, including across tabs.
   */
  async appendWithNextGlobalSequence(
    record: Omit<EventRecord, 'globalSequence'>
  ): Promise<boolean> {
    return this.database.transaction(['events'], 'readwrite', async (transaction) => {
      const records = await transaction.getAllFromIndex<EventRecord>(
        'events',
        'byThreadGlobalSequence',
        queryBound([record.threadId, 0], [record.threadId, MAX_SEQUENCE])
      );
      const globalSequence =
        records.reduce((maximum, item) => Math.max(maximum, item.globalSequence), -1) + 1;
      const accepted: EventRecord = { ...record, globalSequence };
      validateEvent(accepted);
      return appendEvent(transaction, accepted);
    });
  }

  async appendMany(records: readonly EventRecord[]): Promise<void> {
    for (const record of records) validateEvent(record);
    await this.database.transaction(['events'], 'readwrite', async (transaction) => {
      for (const record of records) await appendEvent(transaction, record);
    });
  }

  async listByRun(runId: string): Promise<EventRecord[]> {
    const records = await this.database.transaction(['events'], 'readonly', (transaction) =>
      transaction.getAllFromIndex<EventRecord>(
        'events',
        'byRunSequence',
        queryBound([runId, 0], [runId, MAX_SEQUENCE])
      )
    );
    for (const record of records) validateEvent(record);
    return records;
  }

  async listByThread(threadId: string): Promise<EventRecord[]> {
    const records = await this.database.transaction(['events'], 'readonly', (transaction) =>
      transaction.getAllFromIndex<EventRecord>(
        'events',
        'byThreadGlobalSequence',
        queryBound([threadId, 0], [threadId, MAX_SEQUENCE])
      )
    );
    for (const record of records) validateEvent(record);
    return records;
  }

  async listByType(type: string): Promise<EventRecord[]> {
    const records = await this.database.transaction(['events'], 'readonly', (transaction) =>
      transaction.getAllFromIndex<EventRecord>('events', 'byType', queryOnly(type))
    );
    for (const record of records) validateEvent(record);
    return records;
  }
}
