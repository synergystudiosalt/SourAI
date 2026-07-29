import { describe, expect, it } from 'vitest';

import {
  LEGACY_LOCAL_STORAGE_MIGRATION_VERSION,
  LegacyLocalStorageMigration,
  type LegacyStorage,
} from './legacyMigration';
import { MigrationsRepository } from './repositories';
import { InMemoryStorageDatabase } from './testing/inMemoryDatabase';

class MemoryLegacyStorage implements LegacyStorage {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
}

const digest = async (bytes: Uint8Array): Promise<string> => {
  let value = 0;
  for (const byte of bytes) value = (value * 33 + byte) >>> 0;
  return value.toString(16).padStart(64, '0');
};

describe('legacy localStorage migration', () => {
  it('completes an empty migration and retains an exportable backup', async () => {
    const database = new InMemoryStorageDatabase();
    const storage = new MemoryLegacyStorage({ sour_dark_mode: 'true', unrelated: 'keep' });
    const migration = new LegacyLocalStorageMigration({
      database,
      storage,
      digest,
      now: () => 100,
    });

    const result = await migration.run();

    expect(result).toMatchObject({ state: 'completed', sourceKeys: 0, importedKeys: 0 });
    expect(storage.snapshot()).toEqual({ sour_dark_mode: 'true', unrelated: 'keep' });
    expect(JSON.parse(await migration.exportBackup())).toMatchObject({
      format: 'sourai-legacy-local-storage-backup',
      version: 1,
      entries: {},
    });
  });

  it('migrates threads, ordered events/messages, context, and settings exactly once', async () => {
    const database = new InMemoryStorageDatabase();
    const storage = new MemoryLegacyStorage({
      'sourbot_agent_thread::project-1': JSON.stringify([
        { id: 'old-user', role: 'user', content: 'Fix the tests', createdAt: 10 },
        { id: 'old-assistant', role: 'assistant', content: 'Done', createdAt: 12 },
      ]),
      'sourbot_context::Project One': JSON.stringify({ framework: 'React', owner: 'Local' }),
      sourbot_agent_mode: 'plan',
      sourbot_agent_model: 'sour-overdrive',
      sour_msg_units: '42',
      sour_limit_reset_time: '9000',
      sour_dark_mode: 'true',
    });
    const migration = new LegacyLocalStorageMigration({
      database,
      storage,
      digest,
      now: () => 100,
    });

    const result = await migration.run();
    const rerun = await migration.run();

    expect(result).toMatchObject({ state: 'completed', sourceKeys: 6, importedKeys: 6 });
    expect(rerun).toEqual(result);
    expect(storage.snapshot()).toEqual({ sour_dark_mode: 'true' });
    expect(await database.dump('threads')).toHaveLength(1);
    expect((await database.dump<{ content: string }>('messages')).map((record) => record.content)).toEqual([
      'Fix the tests',
      'Done',
    ]);
    expect(await database.dump('events')).toHaveLength(2);
    expect(await database.dump('memories')).toHaveLength(2);
    expect(await database.dump('settings')).toHaveLength(4);

    const exported = JSON.parse(await migration.exportBackup());
    expect(exported.entries['sourbot_agent_thread::project-1']).toContain('Fix the tests');
  });

  it('backs up corrupt values, reports them, and never imports malformed records', async () => {
    const database = new InMemoryStorageDatabase();
    const storage = new MemoryLegacyStorage({
      'sourbot_agent_thread::broken': '[{"role":"user"',
      'sourbot_context::broken': '[]',
      sourbot_agent_mode: 'destroy',
    });
    const migration = new LegacyLocalStorageMigration({
      database,
      storage,
      digest,
      now: () => 200,
    });

    const result = await migration.run();

    expect(result.state).toBe('completed');
    expect(result.issues.map((entry) => entry.code).sort()).toEqual([
      'invalid_context',
      'invalid_json',
      'invalid_setting',
    ]);
    expect(storage.snapshot()).toEqual({});
    expect(await database.dump('threads')).toEqual([]);
    expect(await database.dump('memories')).toEqual([]);
    expect(await database.dump('settings')).toEqual([]);
    const exported = await migration.exportBackup();
    expect(exported).toContain('[{\\"role\\":\\"user\\"');
  });

  it('resumes after interruption without duplicate messages or events', async () => {
    const database = new InMemoryStorageDatabase();
    const storage = new MemoryLegacyStorage({
      'sourbot_agent_thread::project': JSON.stringify([
        { role: 'user', content: 'one', createdAt: 1 },
        { role: 'assistant', content: 'two', createdAt: 2 },
      ]),
      'sourbot_context::project': JSON.stringify({ key: 'value' }),
    });
    let interrupt = true;
    const migration = new LegacyLocalStorageMigration({
      database,
      storage,
      digest,
      now: () => 300,
      hooks: {
        afterItemImported: () => {
          if (interrupt) {
            interrupt = false;
            throw new Error('simulated tab close');
          }
        },
      },
    });

    await expect(migration.run()).rejects.toThrow(/interrupted/);
    const progress = await new MigrationsRepository(database).get(
      LEGACY_LOCAL_STORAGE_MIGRATION_VERSION
    );
    expect(progress).toMatchObject({ state: 'running', cursor: 0 });
    expect(await database.dump('messages')).toHaveLength(2);

    const resumed = await migration.run();
    expect(resumed).toMatchObject({ state: 'completed', importedKeys: 2 });
    expect(await database.dump('messages')).toHaveLength(2);
    expect(await database.dump('events')).toHaveLength(2);
    expect(await database.dump('memories')).toHaveLength(1);
    expect(storage.snapshot()).toEqual({});
  });

  it('rolls back from the durable backup without overwriting newer source values', async () => {
    const database = new InMemoryStorageDatabase();
    const rawThread = JSON.stringify([{ role: 'user', content: 'restore me', createdAt: 1 }]);
    const storage = new MemoryLegacyStorage({
      'sourbot_agent_thread::project': rawThread,
      sourbot_agent_mode: 'write',
    });
    const migration = new LegacyLocalStorageMigration({
      database,
      storage,
      digest,
      now: () => 400,
    });
    await migration.run();
    storage.setItem('sourbot_agent_mode', 'plan');

    const result = await migration.rollback();

    expect(result.state).toBe('rolled_back');
    expect(storage.getItem('sourbot_agent_thread::project')).toBe(rawThread);
    expect(storage.getItem('sourbot_agent_mode')).toBe('plan');
    expect(await database.dump('threads')).toEqual([]);
    expect(await database.dump('messages')).toEqual([]);
    expect(await database.dump('events')).toEqual([]);
    expect(await database.dump('settings')).toEqual([]);
    expect(await database.dump('migrationBackups')).toHaveLength(1);
  });

  it('does not delete a source value changed after backup', async () => {
    const database = new InMemoryStorageDatabase();
    const storage = new MemoryLegacyStorage({ sourbot_agent_mode: 'write' });
    const migration = new LegacyLocalStorageMigration({
      database,
      storage,
      digest,
      now: () => 500,
      hooks: {
        afterItemImported: () => storage.setItem('sourbot_agent_mode', 'plan'),
      },
    });

    const result = await migration.run();

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'source_changed_after_backup' })
    );
    expect(storage.getItem('sourbot_agent_mode')).toBe('plan');
  });

  it('keeps distinct legacy project names distinct when their escaped spellings resemble each other', async () => {
    const database = new InMemoryStorageDatabase();
    const storage = new MemoryLegacyStorage({
      'sourbot_agent_thread::a b': JSON.stringify([{ role: 'user', content: 'space' }]),
      'sourbot_agent_thread::a_20b': JSON.stringify([{ role: 'user', content: 'literal' }]),
    });
    const migration = new LegacyLocalStorageMigration({
      database,
      storage,
      digest,
      now: () => 600,
    });

    await migration.run();

    const threads = await database.dump<{ id: string; projectId: string }>('threads');
    expect(threads).toHaveLength(2);
    expect(new Set(threads.map((thread) => thread.id)).size).toBe(2);
    expect(threads.map((thread) => thread.projectId).sort()).toEqual(['a b', 'a_20b']);
  });
});
