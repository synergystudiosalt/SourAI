import { describe, expect, it } from 'vitest';

import { InMemoryStorageDatabase } from '../../storage/testing/inMemoryDatabase';
import { parseFileChangeProposal } from './proposal';
import { ProposalStore } from './proposalStore';

const proposal = parseFileChangeProposal({
  summary: 'Add a file',
  changes: [
    { operation: 'write_file', path: 'src/new.ts', content: 'hello\n', reason: 'why' },
  ],
});

const input = {
  proposalId: 'proposal-1',
  approvalId: 'approval-1',
  projectId: 'project-1',
  threadId: 'thread-1',
  runId: 'run-1',
  toolCallId: 'call-1',
  digest: 'a'.repeat(64),
  proposal,
};

describe('ProposalStore', () => {
  it('round-trips a proposal so a reload can rebuild the same diff', async () => {
    const store = new ProposalStore(new InMemoryStorageDatabase());
    await store.save(input);

    const loaded = await store.load('approval-1');

    expect(loaded?.proposal).toEqual(proposal);
    expect(loaded?.runId).toBe('run-1');
    expect(loaded?.toolCallId).toBe('call-1');
  });

  it('returns nothing for an unknown approval', async () => {
    const store = new ProposalStore(new InMemoryStorageDatabase());
    expect(await store.load('never-saved')).toBeUndefined();
  });

  it('forgets a settled proposal', async () => {
    const store = new ProposalStore(new InMemoryStorageDatabase());
    await store.save(input);

    await store.delete('approval-1');

    expect(await store.load('approval-1')).toBeUndefined();
  });

  it('refuses a corrupted record rather than returning an unreviewable change', async () => {
    const database = new InMemoryStorageDatabase();
    const store = new ProposalStore(database);
    await store.save(input);
    await database.transaction(['artifacts'], 'readwrite', async (transaction) => {
      const record = await transaction.get<Record<string, unknown>>(
        'artifacts',
        'agent-proposal:approval-1'
      );
      await transaction.put('artifacts', {
        ...record,
        proposal: JSON.stringify({ summary: 'x', changes: [{ operation: 'write_file' }] }),
      });
    });

    expect(await store.load('approval-1')).toBeUndefined();
  });
});
