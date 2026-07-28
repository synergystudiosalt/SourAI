import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileSystem } from '../../filesystem';
import { executeStructuredToolCall } from '../tools';

function mutationSpies() {
  const spies = {
    writeFile: vi.fn(),
    createDirectory: vi.fn(),
    deletePath: vi.fn(),
    movePath: vi.fn(),
    restore: vi.fn(),
  };
  const filesystem = {
    revision: vi.fn(async () => 0),
    readFile: vi.fn(),
    readDirectory: vi.fn(),
    stat: vi.fn(),
    snapshot: vi.fn(),
    capabilities: vi.fn(),
    ...spies,
  } as unknown as WorkspaceFileSystem;
  return { filesystem, spies };
}

const call = (changes: unknown[], summary = 'Overwrite a file') => ({
  version: 1,
  id: 'malicious-1',
  name: 'propose_file_changes',
  arguments: { summary, changes },
});

const writeChange = {
  operation: 'write_file',
  path: 'src/main.ts',
  content: 'malicious',
  reason: 'because',
};

describe('profile capability policy', () => {
  it.each(['ask', 'plan'] as const)(
    '%s is refused a mutation tool before its arguments are even parsed',
    async (profile) => {
      const { filesystem, spies } = mutationSpies();

      await expect(
        executeStructuredToolCall(call([writeChange]), { filesystem }, { profile })
      ).rejects.toMatchObject({ code: 'tool_forbidden_for_profile' });

      // A malformed payload in a read-only profile is still a policy refusal,
      // not a parser error: the parser is never reached.
      await expect(
        executeStructuredToolCall(call([{ operation: 'nonsense' }]), { filesystem }, { profile })
      ).rejects.toMatchObject({ code: 'tool_forbidden_for_profile' });

      for (const mutation of Object.values(spies)) expect(mutation).not.toHaveBeenCalled();
    }
  );

  it('lets Write create a proposal without touching the filesystem', async () => {
    const { filesystem, spies } = mutationSpies();

    const result = await executeStructuredToolCall(
      call([writeChange]),
      { filesystem },
      { profile: 'write' }
    );

    expect(result).toMatchObject({
      status: 'ok',
      output: { kind: 'file_change_proposal', applied: false },
    });
    expect(result.proposal?.changes).toHaveLength(1);
    for (const mutation of Object.values(spies)) expect(mutation).not.toHaveBeenCalled();
  });

  it('rejects traversal and smuggled properties in a proposal', async () => {
    const { filesystem, spies } = mutationSpies();

    await expect(
      executeStructuredToolCall(
        call([{ ...writeChange, path: '../../outside' }]),
        { filesystem },
        { profile: 'write' }
      )
    ).rejects.toMatchObject({ code: 'proposal_invalid' });

    await expect(
      executeStructuredToolCall(
        call([{ ...writeChange, command: 'rm -rf /' }]),
        { filesystem },
        { profile: 'write' }
      )
    ).rejects.toMatchObject({ code: 'proposal_invalid' });

    for (const mutation of Object.values(spies)) expect(mutation).not.toHaveBeenCalled();
  });

  it('refuses a proposal that would write a path outside the run scope', async () => {
    const { filesystem, spies } = mutationSpies();

    await expect(
      executeStructuredToolCall(
        call([{ ...writeChange, path: '.env' }]),
        {
          filesystem,
          pathPolicy: { allows: (path) => path !== '.env', reason: () => 'sensitive' },
        },
        { profile: 'write' }
      )
    ).rejects.toMatchObject({ code: 'tool_call_invalid' });

    for (const mutation of Object.values(spies)) expect(mutation).not.toHaveBeenCalled();
  });
});
