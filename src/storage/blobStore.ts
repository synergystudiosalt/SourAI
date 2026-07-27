import { normalizeStorageError, StorageError } from './errors';

export interface OpfsWritable {
  write(data: Uint8Array | ArrayBuffer | Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface OpfsFileHandle {
  getFile(): Promise<Blob>;
  createWritable(): Promise<OpfsWritable>;
}

export interface OpfsDirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface ContentAddressedBlob {
  readonly hash: string;
  readonly size: number;
  readonly created: boolean;
}

export interface OpfsBlobStoreOptions {
  readonly getRoot?: () => Promise<OpfsDirectoryHandle>;
  readonly digest?: (bytes: Uint8Array) => Promise<string>;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

async function browserOpfsRoot(): Promise<OpfsDirectoryHandle> {
  const storage = globalThis.navigator?.storage as
    | (StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> })
    | undefined;
  if (!storage?.getDirectory) {
    throw new StorageError(
      'opfs_unsupported',
      'Origin Private File System storage is unavailable in this browser.'
    );
  }
  try {
    return (await storage.getDirectory()) as unknown as OpfsDirectoryHandle;
  } catch (error) {
    throw normalizeStorageError(error, 'opfs_unsupported', 'Could not open browser file storage.');
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new StorageError(
      'opfs_unsupported',
      'SHA-256 is unavailable, so content-addressed browser storage cannot be used.'
    );
  }
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function toBytes(data: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(await data.arrayBuffer());
}

function assertHash(hash: string): void {
  if (!HASH_PATTERN.test(hash)) {
    throw new StorageError('blob_corrupt', `Invalid content hash: ${JSON.stringify(hash)}.`);
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

export class OpfsContentAddressedBlobStore {
  private readonly getRootValue: () => Promise<OpfsDirectoryHandle>;
  private readonly digestValue: (bytes: Uint8Array) => Promise<string>;

  constructor(options: OpfsBlobStoreOptions = {}) {
    this.getRootValue = options.getRoot ?? browserOpfsRoot;
    this.digestValue = options.digest ?? sha256Hex;
  }

  private async parentForHash(
    hash: string,
    create: boolean
  ): Promise<{ parent: OpfsDirectoryHandle; name: string }> {
    assertHash(hash);
    const root = await this.getRootValue();
    const blobs = await root.getDirectoryHandle('blobs', { create });
    const parent = await blobs.getDirectoryHandle(hash.slice(0, 2), { create });
    return { parent, name: hash.slice(2) };
  }

  async put(data: Uint8Array | ArrayBuffer | Blob): Promise<ContentAddressedBlob> {
    const bytes = await toBytes(data);
    const hash = await this.digestValue(bytes);
    assertHash(hash);
    try {
      if (await this.has(hash)) {
        const existing = await this.get(hash);
        const existingHash = await this.digestValue(existing);
        if (existingHash === hash) return { hash, size: existing.byteLength, created: false };
      }

      const { parent, name } = await this.parentForHash(hash, true);
      const handle = await parent.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch(() => undefined);
        throw error;
      }

      const persisted = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if ((await this.digestValue(persisted)) !== hash) {
        await parent.removeEntry(name).catch(() => undefined);
        throw new StorageError(
          'blob_corrupt',
          `Blob ${hash} failed verification after it was written.`
        );
      }
      return { hash, size: bytes.byteLength, created: true };
    } catch (error) {
      throw normalizeStorageError(error, 'transaction_failed', `Could not store blob ${hash}.`);
    }
  }

  async get(hash: string): Promise<Uint8Array> {
    assertHash(hash);
    try {
      const { parent, name } = await this.parentForHash(hash, false);
      const handle = await parent.getFileHandle(name);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch (error) {
      if (isNotFound(error)) {
        throw new StorageError('blob_not_found', `Blob ${hash} does not exist.`);
      }
      throw normalizeStorageError(error, 'transaction_failed', `Could not read blob ${hash}.`);
    }
  }

  async has(hash: string): Promise<boolean> {
    assertHash(hash);
    try {
      const { parent, name } = await this.parentForHash(hash, false);
      await parent.getFileHandle(name);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw normalizeStorageError(error, 'transaction_failed', `Could not inspect blob ${hash}.`);
    }
  }

  async delete(hash: string): Promise<boolean> {
    assertHash(hash);
    try {
      const { parent, name } = await this.parentForHash(hash, false);
      await parent.removeEntry(name);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw normalizeStorageError(error, 'transaction_failed', `Could not delete blob ${hash}.`);
    }
  }
}
