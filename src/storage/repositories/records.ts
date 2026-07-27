import { StorageError } from '../errors';
import { RECORD_SCHEMA_VERSION, type StorageStoreName } from '../schema';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface VersionedRecord {
  readonly schemaVersion: typeof RECORD_SCHEMA_VERSION;
}

export interface SettingRecord<T extends JsonValue = JsonValue> extends VersionedRecord {
  readonly key: string;
  readonly scope: string;
  readonly value: T;
  readonly updatedAt: number;
}

export interface ThreadRecord extends VersionedRecord {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archivedAt?: number | null;
  readonly metadata?: Record<string, JsonValue>;
}

export interface MessageRecord extends VersionedRecord {
  readonly id: string;
  readonly threadId: string;
  readonly sequence: number;
  readonly role: string;
  readonly content: string;
  readonly createdAt: number;
  readonly data?: Record<string, JsonValue>;
}

export interface EventRecord extends VersionedRecord {
  readonly id: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly globalSequence: number;
  readonly type: string;
  readonly createdAt: number;
  readonly causationId?: string;
  readonly correlationId?: string;
  readonly payload: JsonValue;
}

export type MigrationState = 'running' | 'cleaning' | 'completed' | 'rolled_back';

export interface MigrationIssue {
  readonly key: string;
  readonly code: string;
  readonly message: string;
}

export interface MigrationRecord extends VersionedRecord {
  readonly version: number;
  readonly name: string;
  readonly state: MigrationState;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
  readonly backupId: string;
  readonly cursor: number;
  readonly cleanupCursor: number;
  readonly issues: readonly MigrationIssue[];
  readonly lastError?: string;
}

export interface MigrationBackupRecord extends VersionedRecord {
  readonly id: string;
  readonly migrationVersion: number;
  readonly createdAt: number;
  readonly entries: Readonly<Record<string, string>>;
}

export interface MemoryRecord extends VersionedRecord {
  readonly id: string;
  readonly projectId: string;
  readonly kind: string;
  readonly key: string;
  readonly value: string;
  readonly contentHash: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function assertCurrentRecord<T extends VersionedRecord>(
  value: unknown,
  store: StorageStoreName
): asserts value is T {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as Partial<VersionedRecord>).schemaVersion !== RECORD_SCHEMA_VERSION
  ) {
    throw new StorageError(
      'record_corrupt',
      `${store} contains a record with an unsupported or missing schema version.`
    );
  }
}

export function assertNonEmptyId(value: string, field: string): void {
  if (!value.trim()) {
    throw new StorageError('record_corrupt', `${field} must be a non-empty string.`);
  }
}

export function assertSequence(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StorageError('record_corrupt', `${field} must be a non-negative safe integer.`);
  }
}
