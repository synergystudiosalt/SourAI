import { describe, expect, it } from 'vitest';

import { createFakeDirectory } from './fileSystemAccess';

describe('Fake File System Access handles', () => {
  it('rejects non-canonical seed paths without leaving partial entries', () => {
    for (const path of ['/absolute.txt', 'a//b.txt', 'a/b.txt/', 'a/../b.txt']) {
      const { fs } = createFakeDirectory();
      expect(() => fs.seed(path, 'body'), path).toThrow(/Invalid project-relative path/);
      expect(fs.paths(), path).toEqual([]);
    }
  });

  it('preserves entry identity across separately-created handles', async () => {
    const { root } = createFakeDirectory({ 'src/a.txt': 'body' });
    const firstSrc = await root.getDirectoryHandle('src');
    const secondSrc = await root.getDirectoryHandle('src');
    const firstFile = await firstSrc.getFileHandle('a.txt');
    const secondFile = await secondSrc.getFileHandle('a.txt');

    await expect(firstSrc.isSameEntry(secondSrc)).resolves.toBe(true);
    await expect(firstFile.isSameEntry(secondFile)).resolves.toBe(true);
    await expect(firstSrc.isSameEntry(firstFile)).resolves.toBe(false);
  });

  it('resolves descendants relative to the receiving directory', async () => {
    const { root } = createFakeDirectory({ 'src/deep/a.txt': 'body', 'other.txt': 'x' });
    const src = await root.getDirectoryHandle('src');
    const deep = await src.getDirectoryHandle('deep');
    const file = await deep.getFileHandle('a.txt');
    const other = await root.getFileHandle('other.txt');

    await expect(root.resolve(file)).resolves.toEqual(['src', 'deep', 'a.txt']);
    await expect(src.resolve(file)).resolves.toEqual(['deep', 'a.txt']);
    await expect(deep.resolve(deep)).resolves.toEqual([]);
    await expect(src.resolve(other)).resolves.toBeNull();
  });
});

describe('Fake FileSystemWritableFileStream', () => {
  it('writes at the cursor and supports seek, positioned writes, and truncate', async () => {
    const { root, fs } = createFakeDirectory({ 'a.txt': 'abcdef' });
    const handle = await root.getFileHandle('a.txt');
    const writable = await handle.createWritable({ keepExistingData: true });

    await writable.write('XY');
    await writable.seek(4);
    await writable.write('Z');
    await writable.write({ type: 'write', position: 2, data: 'Q' });
    await writable.truncate(4);
    await writable.close();

    expect(fs.snapshot()['a.txt']).toBe('XYQd');
  });

  it('extends with zero bytes and discards an aborted temporary file', async () => {
    const { root } = createFakeDirectory({ 'a.txt': 'abc' });
    const handle = await root.getFileHandle('a.txt');

    const extending = await handle.createWritable({ keepExistingData: true });
    await extending.truncate(5);
    await extending.close();
    expect(new Uint8Array(await (await handle.getFile()).arrayBuffer())).toEqual(
      new Uint8Array([97, 98, 99, 0, 0])
    );

    const aborted = await handle.createWritable();
    await aborted.write('replacement');
    await aborted.abort();
    expect(new Uint8Array(await (await handle.getFile()).arrayBuffer())).toEqual(
      new Uint8Array([97, 98, 99, 0, 0])
    );
  });

  it('clamps the cursor when truncate shrinks the file', async () => {
    const { root, fs } = createFakeDirectory({ 'a.txt': 'abcdef' });
    const handle = await root.getFileHandle('a.txt');
    const writable = await handle.createWritable({ keepExistingData: true });

    await writable.seek(6);
    await writable.truncate(2);
    await writable.write('Z');
    await writable.close();

    expect(fs.snapshot()['a.txt']).toBe('abZ');
  });
});
