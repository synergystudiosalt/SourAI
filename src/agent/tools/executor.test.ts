import { describe, expect, it, vi } from 'vitest';

import { clearRegisteredSecrets, registerSecret } from '../../security/redaction';
import {
  workspacePath,
  type SnapshotManifest,
  type WorkspaceFileSystem,
} from '../../filesystem';
import { executeStructuredToolCall, MAX_TOOL_OUTPUT_BYTES } from './executor';
import { ToolRegistry } from './registry';
import type { ToolContext, ToolDescriptor } from './types';

const encoder = new TextEncoder();

function fakeFilesystem() {
  const mutations = {
    writeFile: vi.fn(),
    createDirectory: vi.fn(),
    deletePath: vi.fn(),
    movePath: vi.fn(),
    restore: vi.fn(),
  };
  const snapshot: SnapshotManifest = { id: 'snapshot', revision: 7, createdAt: 1, entries: [] };
  const fs: WorkspaceFileSystem = {
    capabilities: () => ({
      persistent: true,
      localFolder: false,
      atomicTransactions: true,
      watch: false,
    }),
    revision: async () => 7,
    stat: async (path) => ({
      path,
      kind: 'file',
      size: 12,
      modifiedAt: 1,
      contentHash: 'hash',
    }),
    readFile: async (path) => ({
      path,
      data: encoder.encode(path === workspacePath('src/a.ts') ? 'const token = "safe";' : 'hello'),
      version: { revision: 7, contentHash: 'hash' },
    }),
    readDirectory: async (path) =>
      path === workspacePath('src')
        ? [
            {
              path: workspacePath('src/a.ts'),
              name: 'a.ts',
              kind: 'file' as const,
              size: 21,
              modifiedAt: 1,
              contentHash: 'hash',
            },
          ]
        : [
            {
              path: workspacePath('src'),
              name: 'src',
              kind: 'directory' as const,
              size: 0,
              modifiedAt: 1,
            },
          ],
    writeFile: mutations.writeFile,
    createDirectory: mutations.createDirectory,
    deletePath: mutations.deletePath,
    movePath: mutations.movePath,
    snapshot: async () => snapshot,
    restore: mutations.restore,
  };
  return { fs, mutations };
}

function call(name: string, arguments_: Record<string, unknown>, extra = {}) {
  return { version: 1, id: 'call-1', name, arguments: arguments_, ...extra };
}

describe('structured tool boundary', () => {
  it('runs every read-only tool through an injectable context', async () => {
    const { fs } = fakeFilesystem();
    const context: ToolContext = {
      filesystem: fs,
      listOpenFiles: () => ['src/a.ts'],
      inspectDiagnostics: () => [
        { path: 'src/a.ts', severity: 'warning', message: 'Example warning', line: 1 },
      ],
    };
    const cases: Array<[string, Record<string, unknown>]> = [
      ['read_file', { path: 'src/a.ts' }],
      ['read_directory', { path: 'src' }],
      ['stat', { path: 'src/a.ts' }],
      ['search_text', { query: 'token', path: 'src' }],
      ['search_files', { query: 'a.ts', path: 'src' }],
      ['get_project_revision', {}],
      ['list_open_files', {}],
      ['inspect_diagnostics', { path: 'src/a.ts' }],
    ];
    for (const [name, arguments_] of cases) {
      const result = await executeStructuredToolCall(call(name, arguments_), context, {
        profile: 'ask',
      });
      expect(result.status, name).toBe('ok');
    }
  });

  it('rejects an unknown tool and exact-schema violations', async () => {
    const { fs } = fakeFilesystem();
    const context = { filesystem: fs };
    await expect(
      executeStructuredToolCall(call('shell_exec', {}), context, { profile: 'write' })
    ).rejects.toMatchObject({ code: 'unknown_tool' });
    await expect(
      executeStructuredToolCall(call('read_file', { path: 'src/a.ts', surprise: true }), context, {
        profile: 'ask',
      })
    ).rejects.toMatchObject({ code: 'tool_call_invalid' });
    await expect(
      executeStructuredToolCall(call('read_file', { path: 'src/a.ts' }, { forged: true }), context, {
        profile: 'ask',
      })
    ).rejects.toMatchObject({ code: 'tool_call_invalid' });
  });

  it('rejects malformed paths and oversized calls before a handler runs', async () => {
    const { fs } = fakeFilesystem();
    const run = vi.fn();
    const descriptor: ToolDescriptor = {
      version: 1,
      name: 'test_tool',
      description: 'test',
      risk: 'read',
      validateArguments(value) {
        return value as Record<string, unknown>;
      },
      run,
    };
    const registry = new ToolRegistry([descriptor]);
    await expect(
      executeStructuredToolCall(
        call('test_tool', { data: 'x'.repeat(513 * 1024) }),
        { filesystem: fs },
        { profile: 'ask' },
        registry
      )
    ).rejects.toMatchObject({ code: 'tool_call_invalid' });
    expect(run).not.toHaveBeenCalled();

    await expect(
      executeStructuredToolCall(call('read_file', { path: '../secret' }), { filesystem: fs }, {
        profile: 'ask',
      })
    ).rejects.toMatchObject({ code: 'tool_call_invalid' });
  });

  it('redacts and bounds all handler output', async () => {
    const { fs } = fakeFilesystem();
    const secret = 'canary-secret-that-must-never-leak';
    registerSecret(secret);
    try {
      const descriptor: ToolDescriptor = {
        version: 1,
        name: 'test_output',
        description: 'test',
        risk: 'read',
        validateArguments: () => ({}),
        run: () => ({ text: `${secret}:${'x'.repeat(MAX_TOOL_OUTPUT_BYTES * 2)}` }),
      };
      const result = await executeStructuredToolCall(
        call('test_output', {}),
        { filesystem: fs },
        { profile: 'ask' },
        new ToolRegistry([descriptor])
      );
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result.output).toMatchObject({ truncated: true });
      expect(new TextEncoder().encode(JSON.stringify(result.output)).byteLength).toBeLessThan(
        MAX_TOOL_OUTPUT_BYTES
      );
    } finally {
      clearRegisteredSecrets();
    }
  });
});
