import { describe, expect, it } from 'vitest';

import { RECORD_SCHEMA_VERSION } from '../schema';
import { InMemoryStorageDatabase } from '../testing/inMemoryDatabase';
import { EventsRepository } from './events';
import { MessagesRepository } from './messages';
import { MigrationsRepository } from './migrations';
import type { EventRecord, MessageRecord, ThreadRecord } from './records';
import { SettingsRepository } from './settings';
import { ThreadsRepository } from './threads';

const message = (
  id: string,
  threadId: string,
  sequence: number,
  content = id
): MessageRecord => ({
  schemaVersion: RECORD_SCHEMA_VERSION,
  id,
  threadId,
  sequence,
  role: sequence % 2 ? 'assistant' : 'user',
  content,
  createdAt: 100 + sequence,
});

const event = (
  id: string,
  runId: string,
  threadId: string,
  sequence: number,
  globalSequence = sequence
): EventRecord => ({
  schemaVersion: RECORD_SCHEMA_VERSION,
  id,
  projectId: 'project-1',
  threadId,
  runId,
  sequence,
  globalSequence,
  type: 'message.persisted',
  createdAt: 100 + sequence,
  payload: { id },
});

describe('storage repositories', () => {
  it('rolls back an in-memory readwrite transaction after failure', async () => {
    const database = new InMemoryStorageDatabase();

    await expect(
      database.transaction(['settings'], 'readwrite', async (transaction) => {
        await transaction.put('settings', {
          schemaVersion: 1,
          key: 'partial',
          scope: 'test',
          value: true,
          updatedAt: 1,
        });
        throw new Error('interrupt');
      })
    ).rejects.toThrow('interrupt');

    expect(await database.dump('settings')).toEqual([]);
  });

  it('serializes concurrent fake transactions without losing unrelated writes', async () => {
    const database = new InMemoryStorageDatabase();
    await Promise.all([
      database.transaction(['settings'], 'readwrite', async (transaction) => {
        await Promise.resolve();
        await transaction.put('settings', {
          schemaVersion: 1,
          key: 'first',
          scope: 'test',
          value: true,
          updatedAt: 1,
        });
      }),
      database.transaction(['settings'], 'readwrite', async (transaction) => {
        await transaction.put('settings', {
          schemaVersion: 1,
          key: 'second',
          scope: 'test',
          value: true,
          updatedAt: 1,
        });
      }),
    ]);

    expect((await database.dump<{ key: string }>('settings')).map((record) => record.key)).toEqual([
      'first',
      'second',
    ]);
  });

  it('stores typed settings and lists them by scope', async () => {
    const database = new InMemoryStorageDatabase();
    const settings = new SettingsRepository(database, () => 123);

    await settings.set('agent.mode', 'agent', 'plan');
    await settings.set('ui.compact', 'ui', true);

    expect(await settings.getValue('agent.mode')).toBe('plan');
    expect(await settings.list('agent')).toEqual([
      {
        schemaVersion: 1,
        key: 'agent.mode',
        scope: 'agent',
        value: 'plan',
        updatedAt: 123,
      },
    ]);
  });

  it('orders threads by update time within a project', async () => {
    const database = new InMemoryStorageDatabase();
    const threads = new ThreadsRepository(database);
    const records: ThreadRecord[] = [
      {
        schemaVersion: 1,
        id: 'old',
        projectId: 'p1',
        title: 'Old',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
      },
      {
        schemaVersion: 1,
        id: 'new',
        projectId: 'p1',
        title: 'New',
        status: 'idle',
        createdAt: 1,
        updatedAt: 5,
      },
      {
        schemaVersion: 1,
        id: 'other',
        projectId: 'p2',
        title: 'Other',
        status: 'idle',
        createdAt: 1,
        updatedAt: 9,
      },
    ];
    for (const record of records) await threads.put(record);

    expect((await threads.listByProject('p1')).map((record) => record.id)).toEqual([
      'new',
      'old',
    ]);
  });

  it('keeps message sequence unique and returns deterministic order', async () => {
    const database = new InMemoryStorageDatabase();
    const messages = new MessagesRepository(database);

    await messages.put(message('m2', 'thread', 2));
    await messages.put(message('m0', 'thread', 0));
    await messages.put(message('m1', 'thread', 1));
    expect((await messages.listByThread('thread')).map((record) => record.id)).toEqual([
      'm0',
      'm1',
      'm2',
    ]);

    await expect(messages.put(message('collision', 'thread', 1))).rejects.toMatchObject({
      code: 'record_conflict',
    });
    expect(await messages.put(message('m1', 'thread', 1, 'updated'))).toBe(false);
    expect((await messages.get('m1'))?.content).toBe('updated');
  });

  it('appends events idempotently without overwriting sequence collisions', async () => {
    const database = new InMemoryStorageDatabase();
    const events = new EventsRepository(database);

    expect(await events.append(event('e1', 'run', 'thread', 1))).toBe(true);
    expect(await events.append(event('e1', 'run', 'thread', 1))).toBe(false);
    await events.append(event('e0', 'run', 'thread', 0));

    expect((await events.listByRun('run')).map((record) => record.id)).toEqual(['e0', 'e1']);
    await expect(events.append(event('other', 'run', 'thread', 1, 2))).rejects.toMatchObject({
      code: 'record_conflict',
    });
  });

  it('persists migration progress and backup records', async () => {
    const database = new InMemoryStorageDatabase();
    const migrations = new MigrationsRepository(database);
    await migrations.putBackup({
      schemaVersion: 1,
      id: 'backup',
      migrationVersion: 1,
      createdAt: 10,
      entries: { legacy: 'raw' },
    });
    await migrations.put({
      schemaVersion: 1,
      version: 1,
      name: 'legacy',
      state: 'completed',
      startedAt: 10,
      updatedAt: 20,
      completedAt: 20,
      backupId: 'backup',
      cursor: 1,
      cleanupCursor: 1,
      issues: [],
    });

    expect((await migrations.getBackup('backup'))?.entries).toEqual({ legacy: 'raw' });
    expect((await migrations.listCompleted()).map((record) => record.version)).toEqual([1]);
  });
});
