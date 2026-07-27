import {
  STORAGE_DATABASE_NAME,
  STORAGE_SCHEMA_VERSION,
  STORE_DEFINITIONS,
  STORE_NAMES,
  type IndexDefinition,
  type StorageStoreName,
} from './schema';
import { normalizeStorageError, StorageError } from './errors';

export type StorageKey = IDBValidKey;

export type StorageQuery =
  | { readonly type: 'only'; readonly value: StorageKey }
  | {
      readonly type: 'bound';
      readonly lower: StorageKey;
      readonly upper: StorageKey;
      readonly lowerOpen?: boolean;
      readonly upperOpen?: boolean;
    };

export const queryOnly = (value: StorageKey): StorageQuery => ({ type: 'only', value });

export const queryBound = (
  lower: StorageKey,
  upper: StorageKey,
  options: Pick<Extract<StorageQuery, { type: 'bound' }>, 'lowerOpen' | 'upperOpen'> = {}
): StorageQuery => ({ type: 'bound', lower, upper, ...options });

export interface StorageTransaction {
  get<T>(store: StorageStoreName, key: StorageKey): Promise<T | undefined>;
  put<T>(store: StorageStoreName, value: T): Promise<StorageKey>;
  add<T>(store: StorageStoreName, value: T): Promise<StorageKey>;
  delete(store: StorageStoreName, key: StorageKey): Promise<void>;
  clear(store: StorageStoreName): Promise<void>;
  getAll<T>(store: StorageStoreName): Promise<T[]>;
  getAllFromIndex<T>(
    store: StorageStoreName,
    indexName: string,
    query?: StorageQuery,
    count?: number
  ): Promise<T[]>;
  getFromIndex<T>(
    store: StorageStoreName,
    indexName: string,
    query: StorageQuery
  ): Promise<T | undefined>;
}

export interface StorageDatabase {
  readonly name: string;
  readonly version: number;
  transaction<T>(
    stores: readonly StorageStoreName[],
    mode: IDBTransactionMode,
    operation: (transaction: StorageTransaction) => Promise<T> | T
  ): Promise<T>;
  close(): void;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true }
    );
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new DOMException('Transaction aborted.', 'AbortError')),
      { once: true }
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
      { once: true }
    );
  });
}

function toIdbQuery(query?: StorageQuery): IDBValidKey | IDBKeyRange | undefined {
  if (!query) return undefined;
  if (query.type === 'only') return IDBKeyRange.only(query.value);
  return IDBKeyRange.bound(
    query.lower,
    query.upper,
    query.lowerOpen ?? false,
    query.upperOpen ?? false
  );
}

class BrowserStorageTransaction implements StorageTransaction {
  constructor(private readonly transactionValue: IDBTransaction) {}

  private store(name: StorageStoreName): IDBObjectStore {
    return this.transactionValue.objectStore(name);
  }

  async get<T>(store: StorageStoreName, key: StorageKey): Promise<T | undefined> {
    return (await requestResult(this.store(store).get(key))) as T | undefined;
  }

  async put<T>(store: StorageStoreName, value: T): Promise<StorageKey> {
    return await requestResult(this.store(store).put(value));
  }

  async add<T>(store: StorageStoreName, value: T): Promise<StorageKey> {
    return await requestResult(this.store(store).add(value));
  }

  async delete(store: StorageStoreName, key: StorageKey): Promise<void> {
    await requestResult(this.store(store).delete(key));
  }

  async clear(store: StorageStoreName): Promise<void> {
    await requestResult(this.store(store).clear());
  }

  async getAll<T>(store: StorageStoreName): Promise<T[]> {
    return (await requestResult(this.store(store).getAll())) as T[];
  }

  async getAllFromIndex<T>(
    store: StorageStoreName,
    indexName: string,
    query?: StorageQuery,
    count?: number
  ): Promise<T[]> {
    return (await requestResult(
      this.store(store).index(indexName).getAll(toIdbQuery(query), count)
    )) as T[];
  }

  async getFromIndex<T>(
    store: StorageStoreName,
    indexName: string,
    query: StorageQuery
  ): Promise<T | undefined> {
    return (await requestResult(
      this.store(store).index(indexName).get(toIdbQuery(query)!)
    )) as T | undefined;
  }
}

class BrowserStorageDatabase implements StorageDatabase {
  readonly name: string;
  readonly version: number;

  constructor(private readonly database: IDBDatabase) {
    this.name = database.name;
    this.version = database.version;
    database.addEventListener('versionchange', () => database.close());
  }

  async transaction<T>(
    stores: readonly StorageStoreName[],
    mode: IDBTransactionMode,
    operation: (transaction: StorageTransaction) => Promise<T> | T
  ): Promise<T> {
    if (stores.length === 0) {
      throw new StorageError('transaction_failed', 'A transaction requires at least one store.');
    }
    let transaction: IDBTransaction;
    try {
      transaction = this.database.transaction([...new Set(stores)], mode);
    } catch (error) {
      throw normalizeStorageError(error, 'transaction_failed', 'Could not start IndexedDB transaction.');
    }

    const completed = transactionCompletion(transaction);
    try {
      const result = await operation(new BrowserStorageTransaction(transaction));
      await completed;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // It may already have aborted or committed; preserve the first failure.
      }
      await completed.catch(() => undefined);
      throw normalizeStorageError(error, 'transaction_failed', 'IndexedDB transaction failed.');
    }
  }

  close(): void {
    this.database.close();
  }
}

function sameKeyPath(
  existing: string | string[] | null,
  expected: string | readonly string[]
): boolean {
  const current = Array.isArray(existing) ? existing : [existing];
  const next = Array.isArray(expected) ? expected : [expected];
  return current.length === next.length && current.every((value, index) => value === next[index]);
}

function ensureIndex(store: IDBObjectStore, definition: IndexDefinition): void {
  if (store.indexNames.contains(definition.name)) {
    const current = store.index(definition.name);
    if (
      sameKeyPath(current.keyPath, definition.keyPath) &&
      current.unique === (definition.unique ?? false) &&
      current.multiEntry === (definition.multiEntry ?? false)
    ) {
      return;
    }
    store.deleteIndex(definition.name);
  }
  store.createIndex(definition.name, definition.keyPath as string | string[], {
    unique: definition.unique ?? false,
    multiEntry: definition.multiEntry ?? false,
  });
}

function upgradeSchema(database: IDBDatabase, transaction: IDBTransaction): void {
  for (const name of STORE_NAMES) {
    const definition = STORE_DEFINITIONS[name];
    const store = database.objectStoreNames.contains(name)
      ? transaction.objectStore(name)
      : database.createObjectStore(name, {
          keyPath: definition.keyPath,
          autoIncrement: definition.autoIncrement ?? false,
        });
    for (const indexDefinition of definition.indexes) ensureIndex(store, indexDefinition);
  }
}

export interface OpenStorageDatabaseOptions {
  /** `null` explicitly disables the browser factory, useful for capability tests. */
  readonly indexedDb?: IDBFactory | null;
  readonly name?: string;
  readonly version?: number;
}

export function openStorageDatabase(
  options: OpenStorageDatabaseOptions = {}
): Promise<StorageDatabase> {
  const factory =
    options.indexedDb === undefined ? globalThis.indexedDB : options.indexedDb;
  if (!factory) {
    return Promise.reject(
      new StorageError(
        'indexeddb_unsupported',
        'IndexedDB is unavailable. Durable local threads and settings cannot be opened.'
      )
    );
  }
  const name = options.name ?? STORAGE_DATABASE_NAME;
  const version = options.version ?? STORAGE_SCHEMA_VERSION;

  return new Promise<StorageDatabase>((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, version);
    } catch (error) {
      reject(
        normalizeStorageError(error, 'indexeddb_open_failed', 'Could not open the local database.')
      );
      return;
    }

    request.addEventListener('upgradeneeded', () => {
      if (!request.transaction) return;
      try {
        upgradeSchema(request.result, request.transaction);
      } catch (error) {
        request.transaction.abort();
        if (!settled) {
          settled = true;
          reject(
            normalizeStorageError(error, 'indexeddb_open_failed', 'Could not upgrade local storage.')
          );
        }
      }
    });
    request.addEventListener('blocked', () => {
      if (settled) return;
      settled = true;
      reject(
        new StorageError(
          'indexeddb_blocked',
          'Another SourAI tab is blocking a storage upgrade. Close older tabs and retry.',
          { retryable: true }
        )
      );
    });
    request.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      const error = request.error;
      reject(
        error?.name === 'VersionError'
          ? new StorageError(
              'database_version_too_new',
              'This local database was created by a newer SourAI version.',
              { cause: error }
            )
          : normalizeStorageError(
              error,
              'indexeddb_open_failed',
              'Could not open the local database.'
            )
      );
    });
    request.addEventListener('success', () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(new BrowserStorageDatabase(request.result));
    });
  });
}
