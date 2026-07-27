export type StorageErrorCode =
  | 'indexeddb_unsupported'
  | 'indexeddb_open_failed'
  | 'indexeddb_blocked'
  | 'database_version_too_new'
  | 'transaction_failed'
  | 'record_corrupt'
  | 'record_conflict'
  | 'opfs_unsupported'
  | 'storage_quota_exceeded'
  | 'blob_not_found'
  | 'blob_corrupt'
  | 'migration_failed'
  | 'migration_restore_failed';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly retryable: boolean;
  readonly causeValue?: unknown;

  constructor(
    code: StorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.causeValue = options.cause;
  }
}

export function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

export function normalizeStorageError(
  error: unknown,
  fallbackCode: StorageErrorCode,
  fallbackMessage: string
): StorageError {
  if (error instanceof StorageError) return error;
  if (isQuotaError(error)) {
    return new StorageError(
      'storage_quota_exceeded',
      'Browser storage quota was exceeded. Free local storage or export and remove old data.',
      { cause: error }
    );
  }
  return new StorageError(fallbackCode, fallbackMessage, {
    retryable: fallbackCode === 'transaction_failed' || fallbackCode === 'indexeddb_open_failed',
    cause: error,
  });
}
