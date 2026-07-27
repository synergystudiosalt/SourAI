import { sha256Hex } from './blobStore';
import {
  queryBound,
  type StorageDatabase,
  type StorageTransaction,
} from './database';
import { normalizeStorageError, StorageError } from './errors';
import {
  MigrationsRepository,
  type EventRecord,
  type JsonValue,
  type MemoryRecord,
  type MessageRecord,
  type MigrationBackupRecord,
  type MigrationIssue,
  type MigrationRecord,
  type SettingRecord,
  type ThreadRecord,
} from './repositories';
import { RECORD_SCHEMA_VERSION } from './schema';

export const LEGACY_LOCAL_STORAGE_MIGRATION_VERSION = 1;
export const LEGACY_LOCAL_STORAGE_BACKUP_ID = 'legacy-local-storage-v1';

const AGENT_THREAD_PREFIX = 'sourbot_agent_thread::';
const CONTEXT_PREFIX = 'sourbot_context::';
const EXACT_SETTING_KEYS = new Set([
  'sourbot_agent_mode',
  'sourbot_agent_model',
  'sour_msg_units',
  'sour_limit_reset_time',
]);

export interface LegacyStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LegacyMigrationHooks {
  /** Test/diagnostic seam called after durable import but before its cursor checkpoint. */
  afterItemImported?(key: string, index: number): void | Promise<void>;
  /** Test/diagnostic seam called after source removal but before cleanup checkpoint. */
  afterSourceRemoved?(key: string, index: number): void | Promise<void>;
}

export interface LegacyMigrationOptions {
  readonly database: StorageDatabase;
  readonly storage?: LegacyStorage;
  readonly now?: () => number;
  readonly digest?: (bytes: Uint8Array) => Promise<string>;
  readonly hooks?: LegacyMigrationHooks;
}

export interface LegacyMigrationResult {
  readonly state: MigrationRecord['state'];
  readonly importedKeys: number;
  readonly sourceKeys: number;
  readonly issues: readonly MigrationIssue[];
  readonly backupId: string;
}

interface ImportedItem {
  readonly issues: MigrationIssue[];
}

function isLegacySourceKey(key: string): boolean {
  return (
    EXACT_SETTING_KEYS.has(key) ||
    key.startsWith(AGENT_THREAD_PREFIX) ||
    key.startsWith(CONTEXT_PREFIX)
  );
}

function safeToken(value: string): string {
  // Encode UTF-16 code units directly. Replacing percent escapes would make
  // distinct names such as "a b" and "a_20b" collide and silently merge data.
  let encoded = '';
  for (let index = 0; index < value.length; index++) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return encoded;
}

function asJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const item of value) {
      const converted = asJsonValue(item);
      if (converted === undefined) return undefined;
      result.push(converted);
    }
    return result;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const converted = asJsonValue(item);
      if (converted === undefined) return undefined;
      result[key] = converted;
    }
    return result;
  }
  return undefined;
}

function issue(key: string, code: string, message: string): MigrationIssue {
  return { key, code, message };
}

function parseJson(key: string, raw: string): { value?: JsonValue; issue?: MigrationIssue } {
  try {
    const value = asJsonValue(JSON.parse(raw));
    return value === undefined
      ? { issue: issue(key, 'invalid_json_value', 'Legacy JSON contains an unsupported value.') }
      : { value };
  } catch {
    return { issue: issue(key, 'invalid_json', 'Legacy value is not valid JSON.') };
  }
}

function initialMigration(now: number): MigrationRecord {
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    version: LEGACY_LOCAL_STORAGE_MIGRATION_VERSION,
    name: 'legacy-local-storage',
    state: 'running',
    startedAt: now,
    updatedAt: now,
    backupId: LEGACY_LOCAL_STORAGE_BACKUP_ID,
    cursor: 0,
    cleanupCursor: 0,
    issues: [],
  };
}

function migrationResult(
  record: MigrationRecord,
  sourceKeys: number
): LegacyMigrationResult {
  return {
    state: record.state,
    importedKeys: record.cursor,
    sourceKeys,
    issues: record.issues,
    backupId: record.backupId,
  };
}

export class LegacyLocalStorageMigration {
  private readonly database: StorageDatabase;
  private readonly storage: LegacyStorage;
  private readonly now: () => number;
  private readonly digest: (bytes: Uint8Array) => Promise<string>;
  private readonly hooks: LegacyMigrationHooks;
  private readonly migrations: MigrationsRepository;

  constructor(options: LegacyMigrationOptions) {
    this.database = options.database;
    let storage = options.storage;
    if (!storage) {
      try {
        storage = globalThis.localStorage;
      } catch (error) {
        throw new StorageError(
          'migration_failed',
          'localStorage is unavailable; legacy data cannot be inspected.',
          { cause: error }
        );
      }
    }
    if (!storage) {
      throw new StorageError(
        'migration_failed',
        'localStorage is unavailable; legacy data cannot be inspected.'
      );
    }
    this.storage = storage;
    this.now = options.now ?? Date.now;
    this.digest = options.digest ?? sha256Hex;
    this.hooks = options.hooks ?? {};
    this.migrations = new MigrationsRepository(this.database);
  }

  private snapshotLegacyStorage(): Readonly<Record<string, string>> {
    const entries: Record<string, string> = {};
    try {
      const keys: string[] = [];
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (key && isLegacySourceKey(key)) keys.push(key);
      }
      for (const key of [...new Set(keys)].sort()) {
        const value = this.storage.getItem(key);
        if (value !== null) entries[key] = value;
      }
      return entries;
    } catch (error) {
      throw new StorageError(
        'migration_failed',
        'Legacy localStorage could not be read safely.',
        { cause: error }
      );
    }
  }

  private async ensureBackup(): Promise<MigrationBackupRecord> {
    const existing = await this.migrations.getBackup(LEGACY_LOCAL_STORAGE_BACKUP_ID);
    if (existing) return existing;
    const backup: MigrationBackupRecord = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: LEGACY_LOCAL_STORAGE_BACKUP_ID,
      migrationVersion: LEGACY_LOCAL_STORAGE_MIGRATION_VERSION,
      createdAt: this.now(),
      entries: this.snapshotLegacyStorage(),
    };
    await this.migrations.putBackup(backup);
    return backup;
  }

  async run(): Promise<LegacyMigrationResult> {
    const backup = await this.ensureBackup();
    const entries = Object.entries(backup.entries).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    let record =
      (await this.migrations.get(LEGACY_LOCAL_STORAGE_MIGRATION_VERSION)) ??
      initialMigration(this.now());
    if (record.state === 'completed' || record.state === 'rolled_back') {
      return migrationResult(record, entries.length);
    }

    try {
      if (record.state === 'running') {
        for (let index = record.cursor; index < entries.length; index++) {
          const [key, raw] = entries[index];
          const imported = await this.importEntry(key, raw, record.startedAt);
          await this.hooks.afterItemImported?.(key, index);
          record = {
            ...record,
            cursor: index + 1,
            issues: [...record.issues, ...imported.issues],
            updatedAt: this.now(),
            lastError: undefined,
          };
          await this.migrations.put(record);
        }
        record = { ...record, state: 'cleaning', updatedAt: this.now() };
        await this.migrations.put(record);
      }

      for (let index = record.cleanupCursor; index < entries.length; index++) {
        const [key, originalValue] = entries[index];
        const currentValue = this.storage.getItem(key);
        let cleanupIssue: MigrationIssue | undefined;
        if (currentValue === originalValue) {
          this.storage.removeItem(key);
          await this.hooks.afterSourceRemoved?.(key, index);
        } else if (currentValue !== null) {
          cleanupIssue = issue(
            key,
            'source_changed_after_backup',
            'The legacy value changed after backup and was left untouched.'
          );
        }
        record = {
          ...record,
          cleanupCursor: index + 1,
          issues: cleanupIssue ? [...record.issues, cleanupIssue] : record.issues,
          updatedAt: this.now(),
        };
        await this.migrations.put(record);
      }

      record = {
        ...record,
        state: 'completed',
        completedAt: this.now(),
        updatedAt: this.now(),
        lastError: undefined,
      };
      await this.migrations.put(record);
      return migrationResult(record, entries.length);
    } catch (error) {
      const storageError = normalizeStorageError(
        error,
        'migration_failed',
        'Legacy local data migration was interrupted.'
      );
      await this.migrations
        .put({ ...record, updatedAt: this.now(), lastError: storageError.message })
        .catch(() => undefined);
      throw storageError;
    }
  }

  async exportBackup(): Promise<string> {
    const backup = await this.ensureBackup();
    return `${JSON.stringify(
      {
        format: 'sourai-legacy-local-storage-backup',
        version: backup.migrationVersion,
        createdAt: backup.createdAt,
        entries: backup.entries,
      },
      null,
      2
    )}\n`;
  }

  async rollback(): Promise<LegacyMigrationResult> {
    const backup = await this.migrations.getBackup(LEGACY_LOCAL_STORAGE_BACKUP_ID);
    if (!backup) {
      throw new StorageError('migration_restore_failed', 'No legacy migration backup exists.');
    }
    const entries = Object.entries(backup.entries).sort(([left], [right]) =>
      left.localeCompare(right)
    );

    try {
      // Restore first. Imported records are removed only after every missing
      // source value is safely back in localStorage.
      for (const [key, raw] of entries) {
        if (this.storage.getItem(key) === null) this.storage.setItem(key, raw);
      }
    } catch (error) {
      throw new StorageError(
        'migration_restore_failed',
        'Legacy source data could not be restored; imported records were retained.',
        { cause: error }
      );
    }

    const current =
      (await this.migrations.get(LEGACY_LOCAL_STORAGE_MIGRATION_VERSION)) ??
      initialMigration(this.now());
    const rolledBack: MigrationRecord = {
      ...current,
      state: 'rolled_back',
      updatedAt: this.now(),
      completedAt: undefined,
      lastError: undefined,
    };
    await this.database.transaction(
      ['settings', 'threads', 'messages', 'events', 'memories', 'migrations'],
      'readwrite',
      async (transaction) => {
        for (const [key, raw] of entries) await this.removeImportedEntry(transaction, key, raw);
        await transaction.put('migrations', rolledBack);
      }
    );
    return migrationResult(rolledBack, entries.length);
  }

  private async importEntry(
    key: string,
    raw: string,
    fallbackTimestamp: number
  ): Promise<ImportedItem> {
    if (key.startsWith(AGENT_THREAD_PREFIX)) {
      return this.importAgentThread(key, raw, fallbackTimestamp);
    }
    if (key.startsWith(CONTEXT_PREFIX)) {
      return this.importContext(key, raw, fallbackTimestamp);
    }
    return this.importSetting(key, raw, fallbackTimestamp);
  }

  private async importSetting(
    key: string,
    raw: string,
    updatedAt: number
  ): Promise<ImportedItem> {
    let settingKey: string;
    let scope: string;
    let value: JsonValue;
    if (key === 'sourbot_agent_mode') {
      if (raw !== 'write' && raw !== 'plan') {
        return { issues: [issue(key, 'invalid_setting', 'Unknown legacy agent mode.')] };
      }
      [settingKey, scope, value] = ['agent.mode', 'agent', raw];
    } else if (key === 'sourbot_agent_model') {
      if (!raw.trim() || raw.length > 200) {
        return { issues: [issue(key, 'invalid_setting', 'Legacy agent model is invalid.')] };
      }
      [settingKey, scope, value] = ['agent.model', 'agent', raw];
    } else {
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        return { issues: [issue(key, 'invalid_setting', 'Legacy usage value is invalid.')] };
      }
      [settingKey, scope, value] =
        key === 'sour_msg_units'
          ? ['usage.messageUnits', 'usage', parsed]
          : ['usage.limitResetTime', 'usage', parsed];
    }
    const record: SettingRecord = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      key: settingKey,
      scope,
      value,
      updatedAt,
    };
    await this.database.transaction(['settings'], 'readwrite', async (transaction) => {
      await transaction.put('settings', record);
    });
    return { issues: [] };
  }

  private async importAgentThread(
    sourceKey: string,
    raw: string,
    fallbackTimestamp: number
  ): Promise<ImportedItem> {
    const projectId = sourceKey.slice(AGENT_THREAD_PREFIX.length);
    if (!projectId) {
      return { issues: [issue(sourceKey, 'invalid_thread_key', 'Legacy thread has no project id.')] };
    }
    const parsed = parseJson(sourceKey, raw);
    if (parsed.issue) return { issues: [parsed.issue] };
    if (!Array.isArray(parsed.value)) {
      return { issues: [issue(sourceKey, 'invalid_thread', 'Legacy thread is not an array.')] };
    }

    const token = safeToken(projectId);
    const threadId = `legacy-agent-thread:${token}`;
    const runId = `legacy-agent-run:${token}`;
    const messages: MessageRecord[] = [];
    const events: EventRecord[] = [];
    const issues: MigrationIssue[] = [];

    for (let sourceIndex = 0; sourceIndex < parsed.value.length; sourceIndex++) {
      const candidate = parsed.value[sourceIndex];
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        issues.push(issue(sourceKey, 'invalid_message', `Message ${sourceIndex} is not an object.`));
        continue;
      }
      const object = candidate as Record<string, JsonValue>;
      if (
        (object.role !== 'user' && object.role !== 'assistant') ||
        typeof object.content !== 'string'
      ) {
        issues.push(
          issue(sourceKey, 'invalid_message', `Message ${sourceIndex} has invalid role/content.`)
        );
        continue;
      }
      const sequence = messages.length;
      const createdAt =
        typeof object.createdAt === 'number' &&
        Number.isFinite(object.createdAt) &&
        object.createdAt >= 0
          ? object.createdAt
          : fallbackTimestamp + sequence;
      const messageId = `legacy-agent-message:${token}:${sourceIndex}`;
      const message: MessageRecord = {
        schemaVersion: RECORD_SCHEMA_VERSION,
        id: messageId,
        threadId,
        sequence,
        role: object.role,
        content: object.content,
        createdAt,
        data: { legacy: object },
      };
      messages.push(message);
      events.push({
        schemaVersion: RECORD_SCHEMA_VERSION,
        id: `legacy-agent-event:${token}:${sourceIndex}`,
        projectId,
        threadId,
        runId,
        sequence,
        globalSequence: sequence,
        type: 'message.persisted',
        createdAt,
        payload: {
          messageId,
          role: object.role,
          content: object.content,
        },
      });
    }

    const createdAt = messages[0]?.createdAt ?? fallbackTimestamp;
    const updatedAt = messages.reduce(
      (latest, message) => Math.max(latest, message.createdAt),
      createdAt
    );
    const firstUserMessage = messages.find((message) => message.role === 'user')?.content.trim();
    const thread: ThreadRecord = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: threadId,
      projectId,
      title: firstUserMessage?.slice(0, 80) || 'Imported agent thread',
      status: 'idle',
      createdAt,
      updatedAt,
      archivedAt: null,
      metadata: { source: 'legacy-local-storage', legacyKey: sourceKey },
    };

    await this.database.transaction(
      ['threads', 'messages', 'events'],
      'readwrite',
      async (transaction) => {
        await transaction.put('threads', thread);
        for (const message of messages) await transaction.put('messages', message);
        for (const event of events) await transaction.put('events', event);
      }
    );
    return { issues };
  }

  private async importContext(
    sourceKey: string,
    raw: string,
    timestamp: number
  ): Promise<ImportedItem> {
    const projectName = sourceKey.slice(CONTEXT_PREFIX.length);
    if (!projectName) {
      return { issues: [issue(sourceKey, 'invalid_context_key', 'Legacy context has no project name.')] };
    }
    const parsed = parseJson(sourceKey, raw);
    if (parsed.issue) return { issues: [parsed.issue] };
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return { issues: [issue(sourceKey, 'invalid_context', 'Legacy context is not an object.')] };
    }

    const token = safeToken(projectName);
    const records: MemoryRecord[] = [];
    const issues: MigrationIssue[] = [];
    for (const [memoryKey, value] of Object.entries(parsed.value)) {
      if (typeof value !== 'string') {
        issues.push(issue(sourceKey, 'invalid_memory', `Context value ${memoryKey} is not text.`));
        continue;
      }
      records.push({
        schemaVersion: RECORD_SCHEMA_VERSION,
        id: `legacy-memory:${token}:${safeToken(memoryKey)}`,
        projectId: `legacy-project-name:${token}`,
        kind: 'context',
        key: memoryKey,
        value,
        contentHash: await this.digest(new TextEncoder().encode(value)),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    await this.database.transaction(['memories'], 'readwrite', async (transaction) => {
      for (const record of records) await transaction.put('memories', record);
    });
    return { issues };
  }

  private async removeImportedEntry(
    transaction: StorageTransaction,
    key: string,
    raw: string
  ): Promise<void> {
    if (key.startsWith(AGENT_THREAD_PREFIX)) {
      const projectId = key.slice(AGENT_THREAD_PREFIX.length);
      if (!projectId) return;
      const threadId = `legacy-agent-thread:${safeToken(projectId)}`;
      const messages = await transaction.getAllFromIndex<MessageRecord>(
        'messages',
        'byThreadSequence',
        queryBound([threadId, 0], [threadId, Number.MAX_SAFE_INTEGER])
      );
      const events = await transaction.getAllFromIndex<EventRecord>(
        'events',
        'byThreadGlobalSequence',
        queryBound([threadId, 0], [threadId, Number.MAX_SAFE_INTEGER])
      );
      for (const message of messages) await transaction.delete('messages', message.id);
      for (const event of events) await transaction.delete('events', event.id);
      await transaction.delete('threads', threadId);
      return;
    }
    if (key.startsWith(CONTEXT_PREFIX)) {
      const projectName = key.slice(CONTEXT_PREFIX.length);
      const parsed = parseJson(key, raw);
      if (
        !projectName ||
        !parsed.value ||
        typeof parsed.value !== 'object' ||
        Array.isArray(parsed.value)
      ) {
        return;
      }
      const token = safeToken(projectName);
      for (const memoryKey of Object.keys(parsed.value)) {
        await transaction.delete('memories', `legacy-memory:${token}:${safeToken(memoryKey)}`);
      }
      return;
    }
    const settingKey =
      key === 'sourbot_agent_mode'
        ? 'agent.mode'
        : key === 'sourbot_agent_model'
          ? 'agent.model'
          : key === 'sour_msg_units'
            ? 'usage.messageUnits'
            : 'usage.limitResetTime';
    await transaction.delete('settings', settingKey);
  }
}
