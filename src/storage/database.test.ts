import { describe, expect, it } from 'vitest';

import { openStorageDatabase } from './database';

describe('browser database capability handling', () => {
  it('returns an actionable typed error when IndexedDB is unavailable', async () => {
    await expect(openStorageDatabase({ indexedDb: null })).rejects.toMatchObject({
      code: 'indexeddb_unsupported',
      retryable: false,
    });
  });
});
