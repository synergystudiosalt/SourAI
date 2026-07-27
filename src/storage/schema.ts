export const STORAGE_DATABASE_NAME = 'sourai-local';
export const STORAGE_SCHEMA_VERSION = 1;
export const RECORD_SCHEMA_VERSION = 1 as const;

export interface IndexDefinition {
  readonly name: string;
  readonly keyPath: string | readonly string[];
  readonly unique?: boolean;
  readonly multiEntry?: boolean;
}

export interface StoreDefinition {
  readonly name: StorageStoreName;
  readonly keyPath: string;
  readonly autoIncrement?: boolean;
  readonly indexes: readonly IndexDefinition[];
}

export const STORE_NAMES = [
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
] as const;

export type StorageStoreName = (typeof STORE_NAMES)[number];

const index = (
  name: string,
  keyPath: string | readonly string[],
  options: Pick<IndexDefinition, 'unique' | 'multiEntry'> = {}
): IndexDefinition => ({ name, keyPath, ...options });

export const STORE_DEFINITIONS: Readonly<Record<StorageStoreName, StoreDefinition>> = {
  settings: {
    name: 'settings',
    keyPath: 'key',
    indexes: [index('byScope', 'scope')],
  },
  projects: {
    name: 'projects',
    keyPath: 'id',
    indexes: [
      index('byLastOpenedAt', 'lastOpenedAt'),
      index('byAdapterType', 'adapterType'),
      index('byArchivedAt', 'archivedAt'),
    ],
  },
  projectHandles: {
    name: 'projectHandles',
    keyPath: 'projectId',
    indexes: [index('byPermissionState', 'permissionState')],
  },
  threads: {
    name: 'threads',
    keyPath: 'id',
    indexes: [
      index('byProjectUpdatedAt', ['projectId', 'updatedAt']),
      index('byStatus', 'status'),
      index('byArchivedAt', 'archivedAt'),
    ],
  },
  messages: {
    name: 'messages',
    keyPath: 'id',
    indexes: [index('byThreadSequence', ['threadId', 'sequence'], { unique: true })],
  },
  runs: {
    name: 'runs',
    keyPath: 'id',
    indexes: [
      index('byThreadCreatedAt', ['threadId', 'createdAt']),
      index('byProjectStatus', ['projectId', 'status']),
    ],
  },
  events: {
    name: 'events',
    keyPath: 'id',
    indexes: [
      index('byRunSequence', ['runId', 'sequence'], { unique: true }),
      index('byThreadGlobalSequence', ['threadId', 'globalSequence'], { unique: true }),
      index('byType', 'type'),
    ],
  },
  toolCalls: {
    name: 'toolCalls',
    keyPath: 'id',
    indexes: [
      index('byRunSequence', ['runId', 'sequence'], { unique: true }),
      index('byStatus', 'status'),
      index('byToolName', 'toolName'),
    ],
  },
  approvals: {
    name: 'approvals',
    keyPath: 'id',
    indexes: [
      index('byRunStatus', ['runId', 'status']),
      index('byExpiresAt', 'expiresAt'),
    ],
  },
  checkpoints: {
    name: 'checkpoints',
    keyPath: 'id',
    indexes: [
      index('byProjectCreatedAt', ['projectId', 'createdAt']),
      index('byRunId', 'runId'),
    ],
  },
  artifacts: {
    name: 'artifacts',
    keyPath: 'id',
    indexes: [
      index('byProjectId', 'projectId'),
      index('byThreadId', 'threadId'),
      index('byContentHash', 'contentHash'),
    ],
  },
  memories: {
    name: 'memories',
    keyPath: 'id',
    indexes: [
      index('byProjectKind', ['projectId', 'kind']),
      index('byContentHash', 'contentHash'),
    ],
  },
  profiles: {
    name: 'profiles',
    keyPath: 'id',
    indexes: [
      index('byName', 'name', { unique: true }),
      index('byBuiltIn', 'builtIn'),
    ],
  },
  skills: {
    name: 'skills',
    keyPath: 'id',
    indexes: [
      index('byScopeName', ['scope', 'name'], { unique: true }),
      index('byEnabled', 'enabled'),
    ],
  },
  instructions: {
    name: 'instructions',
    keyPath: 'id',
    indexes: [index('byProjectPriority', ['projectId', 'priority'])],
  },
  mcpServers: {
    name: 'mcpServers',
    keyPath: 'id',
    indexes: [
      index('byEnabled', 'enabled'),
      index('byOrigin', 'origin'),
    ],
  },
  providerConfigs: {
    name: 'providerConfigs',
    keyPath: 'id',
    indexes: [
      index('byProviderType', 'providerType'),
      index('byEnabled', 'enabled'),
    ],
  },
  usageEvents: {
    name: 'usageEvents',
    keyPath: 'id',
    indexes: [
      index('byProviderCreatedAt', ['providerId', 'createdAt']),
      index('byRunId', 'runId'),
    ],
  },
  auditEvents: {
    name: 'auditEvents',
    keyPath: 'id',
    indexes: [
      index('byProjectSequence', ['projectId', 'sequence'], { unique: true }),
      index('byCategory', 'category'),
    ],
  },
  indexManifests: {
    name: 'indexManifests',
    keyPath: 'projectId',
    indexes: [
      index('byVersion', 'version'),
      index('byUpdatedAt', 'updatedAt'),
    ],
  },
  leases: {
    name: 'leases',
    keyPath: 'resourceKey',
    indexes: [
      index('byOwnerTabId', 'ownerTabId'),
      index('byExpiresAt', 'expiresAt'),
    ],
  },
  migrations: {
    name: 'migrations',
    keyPath: 'version',
    indexes: [index('byCompletedAt', 'completedAt')],
  },
  migrationBackups: {
    name: 'migrationBackups',
    keyPath: 'id',
    indexes: [
      index('byMigrationVersion', 'migrationVersion'),
      index('byCreatedAt', 'createdAt'),
    ],
  },
};

export function getStoreDefinition(name: StorageStoreName): StoreDefinition {
  return STORE_DEFINITIONS[name];
}
