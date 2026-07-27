import {
  queryOnly,
  type StorageDatabase,
  type StorageKey,
  type StorageQuery,
  type StorageTransaction,
} from '../database';
import { StorageError } from '../errors';
import {
  STORAGE_SCHEMA_VERSION,
  STORE_DEFINITIONS,
  STORE_NAMES,
  type IndexDefinition,
  type StorageStoreName,
} from '../schema';

interface StoredEntry {
  key: StorageKey;
  value: unknown;
}

type StoreMap = Map<string, StoredEntry>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function keyToken(key: StorageKey): string {
  const encode = (value: StorageKey): unknown => {
    if (value instanceof Date) return ['date', value.getTime()];
    if (Array.isArray(value)) return ['array', ...value.map((item) => encode(item))];
    if (value instanceof ArrayBuffer) return ['bytes', ...new Uint8Array(value)];
    if (ArrayBuffer.isView(value)) {
      return ['bytes', ...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
    }
    return [typeof value, value];
  };
  return JSON.stringify(encode(key));
}

function compareKeys(left: StorageKey, right: StorageKey): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const compared = compareKeys(left[index], right[index]);
      if (compared !== 0) return compared;
    }
    return left.length - right.length;
  }
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
}

function matchesQuery(key: StorageKey, query?: StorageQuery): boolean {
  if (!query) return true;
  if (query.type === 'only') return compareKeys(key, query.value) === 0;
  const lower = compareKeys(key, query.lower);
  const upper = compareKeys(key, query.upper);
  return (query.lowerOpen ? lower > 0 : lower >= 0) && (query.upperOpen ? upper < 0 : upper <= 0);
}

function valueAtKeyPath(value: unknown, keyPath: string | readonly string[]): StorageKey | undefined {
  const read = (path: string): StorageKey | undefined => {
    let current: unknown = value;
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object' || !(part in current)) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current as StorageKey | undefined;
  };
  if (typeof keyPath !== 'string') {
    const values = keyPath.map((path) => read(path));
    return values.some((item) => item === undefined) ? undefined : (values as StorageKey[]);
  }
  return read(keyPath);
}

function requirePrimaryKey(store: StorageStoreName, value: unknown): StorageKey {
  const key = valueAtKeyPath(value, STORE_DEFINITIONS[store].keyPath);
  if (key === undefined) {
    throw new StorageError(
      'record_corrupt',
      `Record for ${store} is missing primary key ${STORE_DEFINITIONS[store].keyPath}.`
    );
  }
  return key;
}

class InMemoryTransaction implements StorageTransaction {
  constructor(
    private readonly stores: Map<StorageStoreName, StoreMap>,
    private readonly allowedStores: ReadonlySet<StorageStoreName>,
    private readonly mode: IDBTransactionMode
  ) {}

  private store(name: StorageStoreName): StoreMap {
    if (!this.allowedStores.has(name)) {
      throw new StorageError('transaction_failed', `Store ${name} is outside this transaction.`);
    }
    const store = this.stores.get(name);
    if (!store) throw new StorageError('transaction_failed', `Store ${name} does not exist.`);
    return store;
  }

  private assertWritable(): void {
    if (this.mode === 'readonly') {
      throw new StorageError('transaction_failed', 'Cannot mutate a readonly transaction.');
    }
  }

  async get<T>(store: StorageStoreName, key: StorageKey): Promise<T | undefined> {
    const entry = this.store(store).get(keyToken(key));
    return entry ? clone(entry.value as T) : undefined;
  }

  async put<T>(store: StorageStoreName, value: T): Promise<StorageKey> {
    this.assertWritable();
    const key = requirePrimaryKey(store, value);
    this.assertUniqueIndexes(store, key, value);
    this.store(store).set(keyToken(key), { key: clone(key), value: clone(value) });
    return clone(key);
  }

  async add<T>(store: StorageStoreName, value: T): Promise<StorageKey> {
    this.assertWritable();
    const key = requirePrimaryKey(store, value);
    if (this.store(store).has(keyToken(key))) {
      throw new DOMException('Primary key already exists.', 'ConstraintError');
    }
    return this.put(store, value);
  }

  async delete(store: StorageStoreName, key: StorageKey): Promise<void> {
    this.assertWritable();
    this.store(store).delete(keyToken(key));
  }

  async clear(store: StorageStoreName): Promise<void> {
    this.assertWritable();
    this.store(store).clear();
  }

  async getAll<T>(store: StorageStoreName): Promise<T[]> {
    return [...this.store(store).values()]
      .sort((left, right) => compareKeys(left.key, right.key))
      .map((entry) => clone(entry.value as T));
  }

  async getAllFromIndex<T>(
    store: StorageStoreName,
    indexName: string,
    query?: StorageQuery,
    count?: number
  ): Promise<T[]> {
    const definition = this.indexDefinition(store, indexName);
    const matching = [...this.store(store).values()]
      .map((entry) => ({
        entry,
        indexKey: valueAtKeyPath(entry.value, definition.keyPath),
      }))
      .filter(
        (candidate): candidate is { entry: StoredEntry; indexKey: StorageKey } =>
          candidate.indexKey !== undefined && matchesQuery(candidate.indexKey, query)
      )
      .sort((left, right) => {
        const indexComparison = compareKeys(left.indexKey, right.indexKey);
        return indexComparison || compareKeys(left.entry.key, right.entry.key);
      });
    return matching.slice(0, count).map((candidate) => clone(candidate.entry.value as T));
  }

  async getFromIndex<T>(
    store: StorageStoreName,
    indexName: string,
    query: StorageQuery
  ): Promise<T | undefined> {
    return (await this.getAllFromIndex<T>(store, indexName, query, 1))[0];
  }

  private indexDefinition(store: StorageStoreName, indexName: string): IndexDefinition {
    const definition = STORE_DEFINITIONS[store].indexes.find((candidate) => candidate.name === indexName);
    if (!definition) {
      throw new StorageError('transaction_failed', `Index ${store}.${indexName} does not exist.`);
    }
    return definition;
  }

  private assertUniqueIndexes<T>(store: StorageStoreName, primaryKey: StorageKey, value: T): void {
    for (const definition of STORE_DEFINITIONS[store].indexes) {
      if (!definition.unique) continue;
      const nextKey = valueAtKeyPath(value, definition.keyPath);
      if (nextKey === undefined) continue;
      const collision = [...this.store(store).values()].find((entry) => {
        if (compareKeys(entry.key, primaryKey) === 0) return false;
        const existingKey = valueAtKeyPath(entry.value, definition.keyPath);
        return existingKey !== undefined && compareKeys(existingKey, nextKey) === 0;
      });
      if (collision) throw new DOMException(`Unique index ${definition.name} collided.`, 'ConstraintError');
    }
  }
}

export class InMemoryStorageDatabase implements StorageDatabase {
  readonly name = 'in-memory-sourai';
  readonly version = STORAGE_SCHEMA_VERSION;
  private stores = new Map<StorageStoreName, StoreMap>(
    STORE_NAMES.map((name) => [name, new Map()])
  );
  private closed = false;
  /** IndexedDB serializes overlapping transactions; the fake must not lose writes that production keeps. */
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(
    stores: readonly StorageStoreName[],
    mode: IDBTransactionMode,
    operation: (transaction: StorageTransaction) => Promise<T> | T
  ): Promise<T> {
    if (this.closed) throw new StorageError('transaction_failed', 'Database is closed.');
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const allowed = new Set(stores);
      const working =
        mode === 'readonly'
          ? this.stores
          : new Map(
              [...this.stores].map(([name, values]) => [
                name,
                allowed.has(name)
                  ? new Map(
                      [...values].map(([token, entry]) => [
                        token,
                        { key: clone(entry.key), value: clone(entry.value) },
                      ])
                    )
                  : values,
              ])
            );
      const result = await operation(new InMemoryTransaction(working, allowed, mode));
      if (mode !== 'readonly') this.stores = working;
      return result;
    } finally {
      release();
    }
  }

  close(): void {
    this.closed = true;
  }

  async dump<T>(store: StorageStoreName): Promise<T[]> {
    return this.transaction([store], 'readonly', (transaction) => transaction.getAll<T>(store));
  }

  async getByIndex<T>(
    store: StorageStoreName,
    indexName: string,
    key: StorageKey
  ): Promise<T[]> {
    return this.transaction([store], 'readonly', (transaction) =>
      transaction.getAllFromIndex<T>(store, indexName, queryOnly(key))
    );
  }
}
