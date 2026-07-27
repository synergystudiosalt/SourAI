import { describe, expect, it } from 'vitest';

import { createFakeDirectory } from '../test/fakes/fileSystemAccess';
import {
  ESCAPING_PATHS,
  REACT_PROJECT_FILES,
  SILENTLY_ACCEPTED_UNSAFE_PATHS,
} from '../test/fixtures/virtualProject';
import {
  createRealFolder,
  deleteRealEntry,
  isDirectoryPickerSupported,
  pickDirectory,
  readRealFile,
  renameRealEntry,
  scanDirectoryTree,
  uploadFilesToReal,
  writeRealFile,
} from './realFs';

describe('capability detection', () => {
  it('reports the picker as unsupported when the browser lacks it', async () => {
    expect(isDirectoryPickerSupported()).toBe(false);
    // Callers must feature-detect, but `pickDirectory` also refuses on its own
    // rather than throwing an unhandled TypeError.
    await expect(pickDirectory()).resolves.toBeNull();
  });
});

describe('scanDirectoryTree', () => {
  it('lists names without reading file contents', async () => {
    const { root, fs } = createFakeDirectory(REACT_PROJECT_FILES);
    const { nodes, truncated } = await scanDirectoryTree(root);

    expect(truncated).toBe(false);
    const src = nodes.find((n) => n.name === 'src');
    expect(src?.type).toBe('folder');
    expect(src?.children?.map((c) => c.name)).toEqual(['components', 'styles', 'utils', 'App.tsx', 'main.tsx']);

    // Not a single file was opened during the scan.
    expect(fs.calls.filter((c) => c.op === 'read')).toHaveLength(0);
    const appNode = src?.children?.find((c) => c.name === 'App.tsx');
    expect(appNode?.isLoaded).toBe(false);
    expect(appNode?.content).toBeUndefined();
  });

  it('skips heavy directories that should never be indexed', async () => {
    const { root } = createFakeDirectory({
      'src/App.tsx': 'x',
      'node_modules/react/index.js': 'x',
      '.git/HEAD': 'ref: refs/heads/main',
      'dist/bundle.js': 'x',
    });
    const { nodes } = await scanDirectoryTree(root);
    expect(nodes.map((n) => n.name)).toEqual(['src']);
  });

  it('stops and reports truncation past the entry cap', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 4100; i++) many[`f${i}.txt`] = '';
    const { root } = createFakeDirectory(many);
    const { nodes, truncated } = await scanDirectoryTree(root);
    expect(truncated).toBe(true);
    expect(nodes.length).toBeLessThanOrEqual(4000);
  });
});

describe('read and write', () => {
  it('round-trips a nested file', async () => {
    const { root, fs } = createFakeDirectory({ 'src/App.tsx': 'original' });
    expect(await readRealFile(root, 'src/App.tsx')).toBe('original');

    await writeRealFile(root, 'src/App.tsx', 'updated');
    expect(fs.snapshot()['src/App.tsx']).toBe('updated');
  });

  it('replaces file contents rather than appending to them', async () => {
    const { root, fs } = createFakeDirectory({ 'a.txt': 'a much longer original value' });
    await writeRealFile(root, 'a.txt', 'short');
    expect(fs.snapshot()['a.txt']).toBe('short');
  });

  it('creates missing parent directories on write', async () => {
    const { root, fs } = createFakeDirectory();
    await writeRealFile(root, 'a/b/c/file.txt', 'hi');
    expect(fs.snapshot()['a/b/c/file.txt']).toBe('hi');
  });

  it('raises NotFoundError for a file that does not exist', async () => {
    const { root } = createFakeDirectory({ 'a.txt': '' });
    await expect(readRealFile(root, 'missing.txt')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(readRealFile(root, 'nodir/missing.txt')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('path safety', () => {
  it('cannot escape the picked directory', async () => {
    // The File System Access API rejects `.`, `..`, and separators inside a
    // single name segment, which is the browser-level backstop. No traversal
    // write is possible through this adapter today.
    const { root, fs } = createFakeDirectory({ 'safe.txt': 'keep' });
    const before = fs.snapshot();

    for (const attempt of ESCAPING_PATHS) {
      await expect(
        writeRealFile(root, attempt, 'payload'),
        `traversal write should be rejected: ${attempt}`
      ).rejects.toThrow();
      await expect(
        readRealFile(root, attempt),
        `traversal read should be rejected: ${attempt}`
      ).rejects.toThrow();
      await expect(
        deleteRealEntry(root, attempt, false),
        `traversal delete should be rejected: ${attempt}`
      ).rejects.toThrow();
    }

    // Nothing was written, and no file outside the fixture was touched.
    expect(Object.keys(fs.snapshot())).toEqual(Object.keys(before));
  });

  it('KNOWN WEAKNESS: accepts malformed paths that the browser does not reject', async () => {
    // Phase 2 adds canonical path validation ahead of every handle call. Until
    // then these are accepted silently. This test asserts the CURRENT, WRONG
    // behaviour so the fix is detectable: when Phase 2 lands, it fails and gets
    // rewritten as a rejection assertion.
    for (const { path, writtenAs, why } of SILENTLY_ACCEPTED_UNSAFE_PATHS) {
      const { root, fs } = createFakeDirectory();
      await expect(writeRealFile(root, path, 'payload'), why).resolves.toBeUndefined();
      expect(fs.snapshot(), why).toHaveProperty([writtenAs], 'payload');
    }
  });

  it('KNOWN WEAKNESS: a rejected write still creates the directories it walked through', async () => {
    // `resolveDirHandle` creates each segment as it descends, so a path that is
    // rejected at its final segment leaves partial directories behind. A
    // transactional change layer (Phase 2) removes this class of side effect.
    const { root, fs } = createFakeDirectory();
    await expect(writeRealFile(root, 'src/deep/../../escape.txt', 'payload')).rejects.toThrow();
    expect(fs.paths()).toContain('src');
    expect(fs.paths()).toContain('src/deep');
  });
});

describe('delete, folder creation, and rename', () => {
  it('creates a nested folder', async () => {
    const { root, fs } = createFakeDirectory();
    await createRealFolder(root, 'src/components/ui');
    expect(fs.paths()).toContain('src/components/ui');
  });

  it('deletes a file, and a folder only when recursion is requested', async () => {
    const { root, fs } = createFakeDirectory({ 'src/a.ts': '', 'src/nested/b.ts': '' });

    await deleteRealEntry(root, 'src/a.ts', false);
    expect(fs.snapshot()['src/a.ts']).toBeUndefined();

    await expect(deleteRealEntry(root, 'src/nested', false)).rejects.toMatchObject({
      name: 'InvalidModificationError',
    });

    await deleteRealEntry(root, 'src/nested', true);
    expect(fs.paths()).not.toContain('src/nested');
  });

  it('moves a file by copying then removing the original', async () => {
    const { root, fs } = createFakeDirectory({ 'src/a.ts': 'body' });
    await renameRealEntry(root, { id: 'src/a.ts', name: 'a.ts', path: 'src/a.ts', type: 'file' }, 'src/a.ts', 'src/b.ts');

    expect(fs.snapshot()).toEqual({ 'src/b.ts': 'body' });
  });

  it('moves a folder together with its subtree', async () => {
    const { root, fs } = createFakeDirectory({ 'old/a.ts': 'a', 'old/deep/b.ts': 'b' });
    await renameRealEntry(root, { id: 'old', name: 'old', path: 'old', type: 'folder' }, 'old', 'new');

    expect(fs.snapshot()).toEqual({ 'new/a.ts': 'a', 'new/deep/b.ts': 'b' });
    expect(fs.paths()).not.toContain('old');
  });

  it('uploads files under a base path and returns what it wrote', async () => {
    const { root, fs } = createFakeDirectory();
    const result = await uploadFilesToReal(root, 'src', [new File(['hello'], 'greet.txt')]);

    expect(result).toEqual([{ path: 'src/greet.txt', content: 'hello' }]);
    expect(fs.snapshot()['src/greet.txt']).toBe('hello');
  });
});

describe('permission handling', () => {
  it('surfaces a revoked permission as NotAllowedError rather than silent data loss', async () => {
    // Permission can lapse between page loads. Today the failure propagates as
    // a raw DOMException; Phase 2 turns it into a recoverable, re-promptable
    // state instead of an unhandled rejection.
    const { root, fs } = createFakeDirectory({ 'a.txt': 'keep' });
    fs.setPermission('denied');

    await expect(writeRealFile(root, 'a.txt', 'overwrite')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(fs.snapshot()['a.txt']).toBe('keep');
  });
});
