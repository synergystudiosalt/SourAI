import { WorkspaceFileNode } from '../types';

/**
 * Pure, immutable helpers for manipulating the in-memory workspace file
 * tree. Every function returns a new tree rather than mutating its input,
 * so it's safe to use directly inside React state setters.
 */

const splitPath = (path: string): string[] => path.split('/').filter(Boolean);

export const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/');

export const getBaseName = (path: string): string => splitPath(path).pop() || path;

export const getParentPath = (path: string): string => {
  const parts = splitPath(path);
  parts.pop();
  return parts.join('/');
};

export const getExtension = (name: string): string => {
  const base = getBaseName(name);
  const dotIndex = base.lastIndexOf('.');
  return dotIndex > 0 ? base.slice(dotIndex + 1).toLowerCase() : '';
};

export function sortNodes(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

export function createFileNode(path: string, content = '', extra: Partial<WorkspaceFileNode> = {}): WorkspaceFileNode {
  return { id: path, name: getBaseName(path), path, type: 'file', content, isLoaded: true, ...extra };
}

export function createFolderNode(path: string, children: WorkspaceFileNode[] = []): WorkspaceFileNode {
  return { id: path, name: getBaseName(path), path, type: 'folder', children };
}

export function findNode(tree: WorkspaceFileNode[], path: string): WorkspaceFileNode | null {
  if (!path) return null;
  const parts = splitPath(path);
  let level = tree;
  let node: WorkspaceFileNode | null = null;
  for (let i = 0; i < parts.length; i++) {
    const currentPath = parts.slice(0, i + 1).join('/');
    node = level.find((n) => n.path === currentPath) || null;
    if (!node) return null;
    level = node.children || [];
  }
  return node;
}

export function pathExists(tree: WorkspaceFileNode[], path: string): boolean {
  return Boolean(findNode(tree, path));
}

/**
 * Walks down to the node at `path` (creating intermediate folders as
 * needed) and replaces it with the result of `updater`. Returning `null`
 * from `updater` removes the node.
 */
function walkAndUpdate(
  nodes: WorkspaceFileNode[],
  parts: string[],
  depth: number,
  updater: (existing: WorkspaceFileNode | null, currentPath: string) => WorkspaceFileNode | null
): WorkspaceFileNode[] {
  const currentPath = parts.slice(0, depth + 1).join('/');
  const isLast = depth === parts.length - 1;
  const idx = nodes.findIndex((n) => n.path === currentPath);

  if (isLast) {
    const result = updater(idx >= 0 ? nodes[idx] : null, currentPath);
    const next = [...nodes];
    if (result === null) {
      if (idx >= 0) next.splice(idx, 1);
      return next;
    }
    if (idx >= 0) next[idx] = result;
    else next.push(result);
    return sortNodes(next);
  }

  if (idx >= 0 && nodes[idx].type === 'folder') {
    const folder = nodes[idx];
    const next = [...nodes];
    next[idx] = { ...folder, children: walkAndUpdate(folder.children || [], parts, depth + 1, updater) };
    return next;
  }

  // The intermediate folder doesn't exist yet (e.g. the agent created a
  // file inside a brand-new nested folder) - create it implicitly.
  const folder = createFolderNode(currentPath, walkAndUpdate([], parts, depth + 1, updater));
  return sortNodes([...nodes, folder]);
}

export function upsertFile(
  tree: WorkspaceFileNode[],
  path: string,
  content: string,
  extra: Partial<WorkspaceFileNode> = {}
): WorkspaceFileNode[] {
  const parts = splitPath(path);
  if (!parts.length) return tree;
  return walkAndUpdate(tree, parts, 0, (existing) => ({
    ...(existing || createFileNode(path)),
    type: 'file',
    content,
    isLoaded: true,
    ...extra,
  }));
}

export function upsertFolder(tree: WorkspaceFileNode[], path: string): WorkspaceFileNode[] {
  const parts = splitPath(path);
  if (!parts.length) return tree;
  return walkAndUpdate(tree, parts, 0, (existing) => existing || createFolderNode(path));
}

export function updateNode(tree: WorkspaceFileNode[], path: string, patch: Partial<WorkspaceFileNode>): WorkspaceFileNode[] {
  const parts = splitPath(path);
  if (!parts.length) return tree;
  return walkAndUpdate(tree, parts, 0, (existing) => (existing ? { ...existing, ...patch } : null));
}

export function removeNode(tree: WorkspaceFileNode[], path: string): WorkspaceFileNode[] {
  const parts = splitPath(path);
  if (!parts.length) return tree;
  return walkAndUpdate(tree, parts, 0, () => null);
}

function rewritePaths(node: WorkspaceFileNode, oldPrefix: string, newPrefix: string): WorkspaceFileNode {
  const newPath = node.path === oldPrefix ? newPrefix : newPrefix + node.path.slice(oldPrefix.length);
  return {
    ...node,
    id: newPath,
    path: newPath,
    children: node.children ? node.children.map((c) => rewritePaths(c, oldPrefix, newPrefix)) : node.children,
  };
}

export function renameNode(
  tree: WorkspaceFileNode[],
  path: string,
  newName: string
): { tree: WorkspaceFileNode[]; oldPath: string; newPath: string } {
  const parts = splitPath(path);
  const newPath = joinPath(...parts.slice(0, -1), newName);
  const nextTree = walkAndUpdate(tree, parts, 0, (existing) => {
    if (!existing) return null;
    return rewritePaths({ ...existing, name: newName }, path, newPath);
  });
  return { tree: nextTree, oldPath: path, newPath };
}

export function listFiles(tree: WorkspaceFileNode[]): WorkspaceFileNode[] {
  const out: WorkspaceFileNode[] = [];
  const walk = (nodes: WorkspaceFileNode[]) => {
    for (const n of nodes) {
      if (n.type === 'file') out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function countNodes(tree: WorkspaceFileNode[]): number {
  let count = 0;
  const walk = (nodes: WorkspaceFileNode[]) => {
    for (const n of nodes) {
      count++;
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return count;
}

/** Returns `desiredPath` if free, otherwise appends " 2", " 3", etc. before the extension. */
export function generateUniquePath(tree: WorkspaceFileNode[], desiredPath: string): string {
  if (!pathExists(tree, desiredPath)) return desiredPath;
  const parent = getParentPath(desiredPath);
  const base = getBaseName(desiredPath);
  const dotIdx = base.lastIndexOf('.');
  const stem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
  const ext = dotIdx > 0 ? base.slice(dotIdx) : '';
  let counter = 2;
  let candidate = joinPath(parent, `${stem} ${counter}${ext}`);
  while (pathExists(tree, candidate)) {
    counter++;
    candidate = joinPath(parent, `${stem} ${counter}${ext}`);
  }
  return candidate;
}

export function isDescendantOrSelf(path: string, ancestorPath: string): boolean {
  return path === ancestorPath || path.startsWith(`${ancestorPath}/`);
}
