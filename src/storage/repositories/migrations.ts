import type { StorageDatabase } from '../database';
import {
  assertCurrentRecord,
  type MigrationBackupRecord,
  type MigrationRecord,
} from './records';

export class MigrationsRepository {
  constructor(private readonly database: StorageDatabase) {}

  async get(version: number): Promise<MigrationRecord | undefined> {
    return this.database.transaction(['migrations'], 'readonly', async (transaction) => {
      const value = await transaction.get<MigrationRecord>('migrations', version);
      if (value) assertCurrentRecord<MigrationRecord>(value, 'migrations');
      return value;
    });
  }

  async put(record: MigrationRecord): Promise<void> {
    assertCurrentRecord<MigrationRecord>(record, 'migrations');
    await this.database.transaction(['migrations'], 'readwrite', async (transaction) => {
      await transaction.put('migrations', record);
    });
  }

  async listCompleted(): Promise<MigrationRecord[]> {
    const values = await this.database.transaction(['migrations'], 'readonly', (transaction) =>
      transaction.getAll<MigrationRecord>('migrations')
    );
    return values.filter((record) => {
      assertCurrentRecord<MigrationRecord>(record, 'migrations');
      return record.completedAt !== undefined;
    });
  }

  async getBackup(id: string): Promise<MigrationBackupRecord | undefined> {
    return this.database.transaction(['migrationBackups'], 'readonly', async (transaction) => {
      const value = await transaction.get<MigrationBackupRecord>('migrationBackups', id);
      if (value) assertCurrentRecord<MigrationBackupRecord>(value, 'migrationBackups');
      return value;
    });
  }

  async putBackup(record: MigrationBackupRecord): Promise<void> {
    assertCurrentRecord<MigrationBackupRecord>(record, 'migrationBackups');
    await this.database.transaction(['migrationBackups'], 'readwrite', async (transaction) => {
      await transaction.put('migrationBackups', record);
    });
  }
}
