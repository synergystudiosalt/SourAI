import { describe, expect, it } from 'vitest';

import {
  PROPOSAL_LIMITS,
  parseFileChangeProposal,
  proposalDigest,
  proposalPaths,
} from './proposal';

const write = (path: string, content = 'hello') => ({
  operation: 'write_file',
  path,
  content,
  reason: 'because',
});

const valid = {
  summary: 'Add a greeting',
  changes: [write('src/app.ts')],
};

describe('parseFileChangeProposal', () => {
  it('accepts each supported operation', () => {
    const proposal = parseFileChangeProposal({
      summary: 'Multi-operation change',
      verification: ['typecheck'],
      changes: [
        write('src/new.ts'),
        {
          operation: 'patch_file',
          path: 'src/app.ts',
          expectedHash: 'a'.repeat(64),
          reason: 'tweak',
          hunks: [{ startLine: 2, originalLines: ['old'], replacementLines: ['new'] }],
        },
        { operation: 'delete_file', path: 'src/old.ts', reason: 'unused' },
        { operation: 'move_file', from: 'src/a.ts', to: 'src/b.ts', reason: 'rename' },
        { operation: 'create_directory', path: 'src/generated', reason: 'output' },
      ],
    });

    expect(proposal.changes).toHaveLength(5);
    expect(proposal.version).toBe(1);
    expect(proposalPaths(proposal)).toContain('src/b.ts');
  });

  it('rejects unknown properties rather than ignoring them', () => {
    expect(() =>
      parseFileChangeProposal({ ...valid, changes: [{ ...write('a.ts'), apply: true }] })
    ).toThrowError(/rejected before review/);
    expect(() => parseFileChangeProposal({ ...valid, applyNow: true })).toThrow();
  });

  it('rejects traversal, absolute paths, and drive letters', () => {
    for (const path of [
      '../escape.ts',
      '/etc/passwd',
      'C:/Windows/system32/x.txt',
      'src\\windows.ts',
      'src/../../out.ts',
      '.sourai/internal.json',
    ]) {
      expect(() => parseFileChangeProposal({ ...valid, changes: [write(path)] })).toThrow();
    }
  });

  it('rejects prototype and accessor tricks', () => {
    const withAccessor = { summary: 'x', changes: [{}] };
    Object.defineProperty(withAccessor.changes[0], 'operation', {
      get: () => 'write_file',
      enumerable: true,
    });
    expect(() => parseFileChangeProposal(withAccessor)).toThrow();

    const nullProto = Object.assign(Object.create(null), valid);
    expect(() => parseFileChangeProposal(nullProto)).not.toThrow();

    const weirdProto = Object.assign(Object.create({ evil: true }), valid);
    expect(() => parseFileChangeProposal(weirdProto)).toThrow();
  });

  it('rejects malformed numbers and hashes', () => {
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [
          {
            operation: 'patch_file',
            path: 'a.ts',
            expectedHash: 'a'.repeat(64),
            reason: 'r',
            hunks: [{ startLine: Number.NaN, originalLines: [], replacementLines: ['x'] }],
          },
        ],
      })
    ).toThrow();
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [{ ...write('a.ts'), expectedHash: 'not-a-hash' }],
      })
    ).toThrow();
  });

  it('rejects duplicate operations on one path', () => {
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [write('src/app.ts'), { operation: 'delete_file', path: 'src/app.ts', reason: 'r' }],
      })
    ).toThrowError(/rejected before review/);
  });

  it('rejects writing under a path the same batch removes', () => {
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [
          { operation: 'delete_file', path: 'src/old', reason: 'r' },
          write('src/old/child.ts'),
        ],
      })
    ).toThrow();
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [
          { operation: 'move_file', from: 'src/a', to: 'src/b', reason: 'r' },
          write('src/a/child.ts'),
        ],
      })
    ).toThrow();
  });

  it('rejects overlapping hunks in one file', () => {
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [
          {
            operation: 'patch_file',
            path: 'a.ts',
            expectedHash: 'a'.repeat(64),
            reason: 'r',
            hunks: [
              { startLine: 1, originalLines: ['a', 'b'], replacementLines: ['x'] },
              { startLine: 2, originalLines: ['b'], replacementLines: ['y'] },
            ],
          },
        ],
      })
    ).toThrow();
  });

  it('rejects hunk lines containing newlines', () => {
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [
          {
            operation: 'patch_file',
            path: 'a.ts',
            expectedHash: 'a'.repeat(64),
            reason: 'r',
            hunks: [{ startLine: 1, originalLines: ['a\nb'], replacementLines: [] }],
          },
        ],
      })
    ).toThrow();
  });

  it('enforces size and count bounds', () => {
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: Array.from({ length: PROPOSAL_LIMITS.maxChanges + 1 }, (_, index) =>
          write(`src/file-${index}.ts`)
        ),
      })
    ).toThrowError(/rejected before review/);

    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [write('big.ts', 'x'.repeat(PROPOSAL_LIMITS.maxContentBytes + 1))],
      })
    ).toThrow();
  });

  it('rejects a create-only write that also claims an expected hash', () => {
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [{ ...write('a.ts'), createOnly: true, expectedHash: 'a'.repeat(64) }],
      })
    ).toThrow();
  });

  it('rejects moving a file onto itself', () => {
    expect(() =>
      parseFileChangeProposal({
        ...valid,
        changes: [{ operation: 'move_file', from: 'a.ts', to: 'a.ts', reason: 'r' }],
      })
    ).toThrow();
  });
});

describe('proposalDigest', () => {
  it('is stable across re-serialization and property order', async () => {
    const first = parseFileChangeProposal(valid);
    const second = parseFileChangeProposal(JSON.parse(JSON.stringify(valid)));
    const reordered = parseFileChangeProposal({
      changes: [{ reason: 'because', content: 'hello', path: 'src/app.ts', operation: 'write_file' }],
      summary: 'Add a greeting',
    });

    expect(await proposalDigest(first)).toBe(await proposalDigest(second));
    expect(await proposalDigest(first)).toBe(await proposalDigest(reordered));
  });

  it('changes when any meaningful field changes', async () => {
    const base = await proposalDigest(parseFileChangeProposal(valid));
    const cases = [
      { ...valid, summary: 'Different' },
      { ...valid, changes: [write('src/app.ts', 'goodbye')] },
      { ...valid, changes: [write('src/other.ts')] },
      { ...valid, changes: [{ ...write('src/app.ts'), createOnly: true }] },
    ];
    for (const variant of cases) {
      expect(await proposalDigest(parseFileChangeProposal(variant))).not.toBe(base);
    }
  });
});
