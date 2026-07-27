import { describe, expect, it } from 'vitest';

import { REACT_PROJECT_FILES, buildTree, reactProjectTree } from '../test/fixtures/virtualProject';
import {
  countNodes,
  findNode,
  generateUniquePath,
  getBaseName,
  getExtension,
  getParentPath,
  isDescendantOrSelf,
  joinPath,
  listFiles,
  pathExists,
  removeNode,
  renameNode,
  sortNodes,
  updateNode,
  upsertFile,
  upsertFolder,
} from './workspaceFs';

/**
 * Characterisation tests for the in-memory workspace tree.
 *
 * This module survives the migration — the OPFS and local-folder adapters in
 * Phase 2 are built beneath it, not instead of it — so these are regression
 * guards, not documentation of behaviour that is about to change.
 */

describe('path helpers', () => {
  it('splits and rejoins paths without leading or duplicate separators', () => {
    expect(joinPath('src', 'components', 'Header.tsx')).toBe('src/components/Header.tsx');
    expect(joinPath('', 'App.tsx')).toBe('App.tsx');
    expect(getParentPath('src/components/Header.tsx')).toBe('src/components');
    expect(getParentPath('App.tsx')).toBe('');
    expect(getBaseName('src/components/Header.tsx')).toBe('Header.tsx');
  });

  it('reads an extension only when the name actually has one', () => {
    expect(getExtension('src/App.tsx')).toBe('tsx');
    expect(getExtension('Makefile')).toBe('');
    expect(getExtension('.gitignore')).toBe('');
    expect(getExtension('archive.tar.gz')).toBe('gz');
  });

  it('recognises descendants without matching a sibling by prefix', () => {
    expect(isDescendantOrSelf('src/a.ts', 'src')).toBe(true);
    expect(isDescendantOrSelf('src', 'src')).toBe(true);
    expect(isDescendantOrSelf('srcfoo/a.ts', 'src')).toBe(false);
  });
});

describe('tree construction', () => {
  it('places folders before files and sorts each level naturally', () => {
    const sorted = sortNodes([
      { id: 'b.ts', name: 'b.ts', path: 'b.ts', type: 'file' },
      { id: 'item10', name: 'item10', path: 'item10', type: 'folder', children: [] },
      { id: 'a.ts', name: 'a.ts', path: 'a.ts', type: 'file' },
      { id: 'item2', name: 'item2', path: 'item2', type: 'folder', children: [] },
    ]);
    expect(sorted.map((n) => n.name)).toEqual(['item2', 'item10', 'a.ts', 'b.ts']);
  });

  it('builds a nested tree from a flat path map', () => {
    const tree = reactProjectTree();
    expect(findNode(tree, 'src/components/Header.tsx')?.type).toBe('file');
    expect(findNode(tree, 'src/components')?.type).toBe('folder');
    expect(listFiles(tree)).toHaveLength(Object.keys(REACT_PROJECT_FILES).length);
  });

  it('returns null for a path that does not exist', () => {
    const tree = reactProjectTree();
    expect(findNode(tree, 'src/components/Missing.tsx')).toBeNull();
    expect(findNode(tree, '')).toBeNull();
    expect(pathExists(tree, 'src/components/Missing.tsx')).toBe(false);
  });
});

describe('mutations', () => {
  it('creates intermediate folders implicitly when writing a nested file', () => {
    const tree = upsertFile([], 'src/deeply/nested/file.ts', 'export {};');
    expect(findNode(tree, 'src')?.type).toBe('folder');
    expect(findNode(tree, 'src/deeply/nested')?.type).toBe('folder');
    expect(findNode(tree, 'src/deeply/nested/file.ts')?.content).toBe('export {};');
  });

  it('never mutates the input tree', () => {
    const original = reactProjectTree();
    const snapshot = JSON.stringify(original);
    upsertFile(original, 'src/App.tsx', 'changed');
    removeNode(original, 'src/utils/format.ts');
    renameNode(original, 'README.md', 'READ.md');
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('overwrites an existing file in place and marks it loaded', () => {
    const tree = upsertFile(reactProjectTree(), 'src/App.tsx', 'export default null;');
    const node = findNode(tree, 'src/App.tsx');
    expect(node?.content).toBe('export default null;');
    expect(node?.isLoaded).toBe(true);
    expect(listFiles(tree)).toHaveLength(Object.keys(REACT_PROJECT_FILES).length);
  });

  it('removes a folder together with its subtree', () => {
    const tree = removeNode(reactProjectTree(), 'src/components');
    expect(findNode(tree, 'src/components')).toBeNull();
    expect(findNode(tree, 'src/components/Header.tsx')).toBeNull();
    expect(findNode(tree, 'src/App.tsx')).not.toBeNull();
  });

  it('rewrites descendant paths when a folder is renamed', () => {
    const { tree, oldPath, newPath } = renameNode(reactProjectTree(), 'src/components', 'ui');
    expect(oldPath).toBe('src/components');
    expect(newPath).toBe('src/ui');
    expect(findNode(tree, 'src/ui/Header.tsx')?.path).toBe('src/ui/Header.tsx');
    expect(findNode(tree, 'src/ui/Header.tsx')?.id).toBe('src/ui/Header.tsx');
    expect(findNode(tree, 'src/components/Header.tsx')).toBeNull();
  });

  it('is a no-op for an empty path', () => {
    const tree = reactProjectTree();
    expect(upsertFile(tree, '', 'x')).toBe(tree);
    expect(upsertFolder(tree, '')).toBe(tree);
    expect(removeNode(tree, '')).toBe(tree);
    expect(updateNode(tree, '', { content: 'x' })).toBe(tree);
  });

  it('counts folders as well as files', () => {
    const tree = buildTree({ 'a/b/c.ts': '', 'a/d.ts': '' });
    // a, a/b, a/b/c.ts, a/d.ts
    expect(countNodes(tree)).toBe(4);
  });
});

describe('generateUniquePath', () => {
  it('returns the requested path when it is free', () => {
    expect(generateUniquePath(reactProjectTree(), 'src/New.tsx')).toBe('src/New.tsx');
  });

  it('suffixes before the extension and keeps counting past the first collision', () => {
    let tree = reactProjectTree();
    expect(generateUniquePath(tree, 'src/App.tsx')).toBe('src/App 2.tsx');
    tree = upsertFile(tree, 'src/App 2.tsx', '');
    expect(generateUniquePath(tree, 'src/App.tsx')).toBe('src/App 3.tsx');
  });

  it('handles extension-less names', () => {
    const tree = buildTree({ Makefile: '' });
    expect(generateUniquePath(tree, 'Makefile')).toBe('Makefile 2');
  });
});
