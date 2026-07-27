import { queryOnly, type StorageDatabase } from '../database';
import { RECORD_SCHEMA_VERSION } from '../schema';
import {
  assertCurrentRecord,
  assertNonEmptyId,
  type JsonValue,
  type SettingRecord,
} from './records';

export class SettingsRepository {
  constructor(
    private readonly database: StorageDatabase,
    private readonly now: () => number = Date.now
  ) {}

  async get<T extends JsonValue = JsonValue>(key: string): Promise<SettingRecord<T> | undefined> {
    assertNonEmptyId(key, 'Setting key');
    return this.database.transaction(['settings'], 'readonly', async (transaction) => {
      const value = await transaction.get<SettingRecord<T>>('settings', key);
      if (value !== undefined) assertCurrentRecord<SettingRecord<T>>(value, 'settings');
      return value;
    });
  }

  async getValue<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
    return (await this.get<T>(key))?.value;
  }

  async set<T extends JsonValue>(
    key: string,
    scope: string,
    value: T
  ): Promise<SettingRecord<T>> {
    assertNonEmptyId(key, 'Setting key');
    assertNonEmptyId(scope, 'Setting scope');
    const record: SettingRecord<T> = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      key,
      scope,
      value,
      updatedAt: this.now(),
    };
    await this.database.transaction(['settings'], 'readwrite', async (transaction) => {
      await transaction.put('settings', record);
    });
    return record;
  }

  async delete(key: string): Promise<void> {
    await this.database.transaction(['settings'], 'readwrite', (transaction) =>
      transaction.delete('settings', key)
    );
  }

  async list(scope?: string): Promise<SettingRecord[]> {
    return this.database.transaction(['settings'], 'readonly', async (transaction) => {
      const values = scope
        ? await transaction.getAllFromIndex<SettingRecord>(
            'settings',
            'byScope',
            queryOnly(scope)
          )
        : await transaction.getAll<SettingRecord>('settings');
      for (const value of values) assertCurrentRecord<SettingRecord>(value, 'settings');
      return values;
    });
  }
}
