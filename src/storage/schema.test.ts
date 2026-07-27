import { describe, expect, it } from 'vitest';

import { STORE_DEFINITIONS, STORE_NAMES, STORAGE_SCHEMA_VERSION } from './schema';

describe('storage schema', () => {
  it('declares every Phase 1 store and its required primary key', () => {
    expect(STORAGE_SCHEMA_VERSION).toBe(1);
    expect(STORE_NAMES).toEqual([
      'settings',
      'projects',
      'projectHandles',
      'threads',
      'messages',
      'runs',
      'events',
      'toolCalls',
      'approvals',
      'checkpoints',
      'artifacts',
      'memories',
      'profiles',
      'skills',
      'instructions',
      'mcpServers',
      'providerConfigs',
      'usageEvents',
      'auditEvents',
      'indexManifests',
      'leases',
      'migrations',
      'migrationBackups',
    ]);
    for (const name of STORE_NAMES) {
      expect(STORE_DEFINITIONS[name].name).toBe(name);
      expect(STORE_DEFINITIONS[name].keyPath).toBeTruthy();
      expect(new Set(STORE_DEFINITIONS[name].indexes.map((index) => index.name)).size).toBe(
        STORE_DEFINITIONS[name].indexes.length
      );
    }
  });

  it('enforces durable ordering with unique compound indexes', () => {
    expect(STORE_DEFINITIONS.messages.indexes).toContainEqual({
      name: 'byThreadSequence',
      keyPath: ['threadId', 'sequence'],
      unique: true,
    });
    expect(STORE_DEFINITIONS.events.indexes).toEqual(
      expect.arrayContaining([
        { name: 'byRunSequence', keyPath: ['runId', 'sequence'], unique: true },
        {
          name: 'byThreadGlobalSequence',
          keyPath: ['threadId', 'globalSequence'],
          unique: true,
        },
        { name: 'byType', keyPath: 'type' },
      ])
    );
  });
});
