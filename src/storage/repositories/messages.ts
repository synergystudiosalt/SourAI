import { queryBound, queryOnly, type StorageDatabase, type StorageTransaction } from '../database';
import { StorageError } from '../errors';
import {
  assertCurrentRecord,
  assertNonEmptyId,
  assertSequence,
  type MessageRecord,
} from './records';

const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function validateMessage(record: MessageRecord): void {
  assertCurrentRecord<MessageRecord>(record, 'messages');
  assertNonEmptyId(record.id, 'Message id');
  assertNonEmptyId(record.threadId, 'Message threadId');
  assertNonEmptyId(record.role, 'Message role');
  assertSequence(record.sequence, 'Message sequence');
  if (!Number.isFinite(record.createdAt) || record.createdAt < 0) {
    throw new StorageError('record_corrupt', 'Message createdAt is invalid.');
  }
}

async function putMessage(transaction: StorageTransaction, record: MessageRecord): Promise<boolean> {
  const byId = await transaction.get<MessageRecord>('messages', record.id);
  if (byId) {
    validateMessage(byId);
    if (byId.threadId !== record.threadId || byId.sequence !== record.sequence) {
      throw new StorageError('record_conflict', `Message id ${record.id} was reused.`);
    }
    await transaction.put('messages', record);
    return false;
  }
  const bySequence = await transaction.getFromIndex<MessageRecord>(
    'messages',
    'byThreadSequence',
    queryOnly([record.threadId, record.sequence])
  );
  if (bySequence) {
    throw new StorageError(
      'record_conflict',
      `Thread ${record.threadId} already has message sequence ${record.sequence}.`
    );
  }
  await transaction.add('messages', record);
  return true;
}

export class MessagesRepository {
  constructor(private readonly database: StorageDatabase) {}

  async get(id: string): Promise<MessageRecord | undefined> {
    return this.database.transaction(['messages'], 'readonly', async (transaction) => {
      const record = await transaction.get<MessageRecord>('messages', id);
      if (record) validateMessage(record);
      return record;
    });
  }

  async put(record: MessageRecord): Promise<boolean> {
    validateMessage(record);
    return this.database.transaction(['messages'], 'readwrite', (transaction) =>
      putMessage(transaction, record)
    );
  }

  async putMany(records: readonly MessageRecord[]): Promise<void> {
    for (const record of records) validateMessage(record);
    await this.database.transaction(['messages'], 'readwrite', async (transaction) => {
      for (const record of records) await putMessage(transaction, record);
    });
  }

  async listByThread(threadId: string): Promise<MessageRecord[]> {
    const records = await this.database.transaction(['messages'], 'readonly', (transaction) =>
      transaction.getAllFromIndex<MessageRecord>(
        'messages',
        'byThreadSequence',
        queryBound([threadId, 0], [threadId, MAX_SEQUENCE])
      )
    );
    for (const record of records) validateMessage(record);
    return records;
  }

  async deleteByThread(threadId: string): Promise<void> {
    await this.database.transaction(['messages'], 'readwrite', async (transaction) => {
      const records = await transaction.getAllFromIndex<MessageRecord>(
        'messages',
        'byThreadSequence',
        queryBound([threadId, 0], [threadId, MAX_SEQUENCE])
      );
      for (const record of records) await transaction.delete('messages', record.id);
    });
  }
}
