import { describe, expect, it } from 'vitest';

import { OpfsContentAddressedBlobStore } from './blobStore';
import { StorageError } from './errors';
import { InMemoryOpfs } from './testing/inMemoryOpfs';

const digest = async (bytes: Uint8Array): Promise<string> => {
  let value = 0;
  for (const byte of bytes) value = (value * 31 + byte) >>> 0;
  return value.toString(16).padStart(64, '0');
};

describe('OPFS content-addressed blob store', () => {
  it('writes, verifies, reads, and deduplicates by content hash', async () => {
    const opfs = new InMemoryOpfs();
    const store = new OpfsContentAddressedBlobStore({ getRoot: opfs.getRoot, digest });
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const first = await store.put(bytes);
    const second = await store.put(bytes);

    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
    expect(await store.get(first.hash)).toEqual(bytes);
    expect(Object.keys(await opfs.snapshot())).toEqual([
      `blobs/${first.hash.slice(0, 2)}/${first.hash.slice(2)}`,
    ]);
    expect(await store.delete(first.hash)).toBe(true);
    expect(await store.delete(first.hash)).toBe(false);
  });

  it('returns explicit unsupported and quota errors', async () => {
    const unsupported = new OpfsContentAddressedBlobStore({
      getRoot: async () => {
        throw new StorageError('opfs_unsupported', 'not supported');
      },
      digest,
    });
    await expect(unsupported.put(new Uint8Array([1]))).rejects.toMatchObject({
      code: 'opfs_unsupported',
    });

    const tinyOpfs = new InMemoryOpfs(2);
    const quota = new OpfsContentAddressedBlobStore({ getRoot: tinyOpfs.getRoot, digest });
    await expect(quota.put(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'storage_quota_exceeded',
    });
  });

  it('rejects invalid hashes and detects failed post-write verification', async () => {
    const opfs = new InMemoryOpfs();
    const invalid = new OpfsContentAddressedBlobStore({ getRoot: opfs.getRoot, digest });
    await expect(invalid.get('../escape')).rejects.toMatchObject({
      code: 'blob_corrupt',
    });

    let calls = 0;
    const changingDigest = async () => (++calls === 1 ? 'a'.repeat(64) : 'b'.repeat(64));
    const corrupt = new OpfsContentAddressedBlobStore({
      getRoot: opfs.getRoot,
      digest: changingDigest,
    });
    await expect(corrupt.put(new Uint8Array([9]))).rejects.toMatchObject({
      code: 'blob_corrupt',
    });
  });
});
