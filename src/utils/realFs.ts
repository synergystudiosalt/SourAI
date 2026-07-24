import { WorkspaceFileNode } from '../types';
import { createFolderNode, sortNodes } from './workspaceFs';

/**
 * Bridges the browser File System Access API to the workspace's in-memory
 * file tree. Only supported in Chromium-based browsers - always feature
 * detect with `isDirectoryPickerSupported()` before calling `pickDirectory`.
 */

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.nuxt',
  '.cache', '.parcel-cache', '.turbo', 'coverage', 'venv', '.venv', '__pycache__',
  'target', '.idea',
]);

const MAX_ENTRIES = 4000;

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isDirectoryPickerSupported()) return null;
  try {
    return (await window.showDirectoryPicker!({ mode: 'readwrite' })) as FileSystemDirectoryHandle;
  } catch (err) {
    // AbortError = user cancelled the picker, nothing to do.
    if ((err as DOMException)?.name !== 'AbortError') console.warn('Directory picker failed:', err);
    return null;
  }
}

/** Recursively lists a directory's structure (names only, no file contents). */
export async function scanDirectoryTree(
  dirHandle: FileSystemDirectoryHandle
): Promise<{ nodes: WorkspaceFileNode[]; truncated: boolean }> {
  let truncated = false;
  let scanned = 0;

  async function walk(handle: FileSystemDirectoryHandle, path: string): Promise<WorkspaceFileNode[]> {
    const entries: WorkspaceFileNode[] = [];
    for await (const entry of handle.values()) {
      if (truncated) break;
      scanned++;
      if (scanned > MAX_ENTRIES) {
        truncated = true;
        break;
      }
      const entryPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const children = await walk(entry as FileSystemDirectoryHandle, entryPath);
        entries.push(createFolderNode(entryPath, children));
      } else {
        entries.push({ id: entryPath, name: entry.name, path: entryPath, type: 'file', isLoaded: false });
      }
    }
    return sortNodes(entries);
  }

  const nodes = await walk(dirHandle, '');
  return { nodes, truncated };
}

async function resolveDirHandle(
  root: FileSystemDirectoryHandle,
  dirParts: string[],
  create = false
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const part of dirParts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

export async function readRealFile(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const parts = path.split('/').filter(Boolean);
  const dir = await resolveDirHandle(root, parts.slice(0, -1));
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return await file.text();
}

export async function writeRealFile(root: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const dir = await resolveDirHandle(root, parts.slice(0, -1), true);
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function createRealFolder(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  await resolveDirHandle(root, path.split('/').filter(Boolean), true);
}

export async function deleteRealEntry(root: FileSystemDirectoryHandle, path: string, isFolder: boolean): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const dir = await resolveDirHandle(root, parts.slice(0, -1));
  await dir.removeEntry(parts[parts.length - 1], { recursive: isFolder });
}

async function copyRealTree(root: FileSystemDirectoryHandle, srcPath: string, destPath: string): Promise<void> {
  const srcParts = srcPath.split('/').filter(Boolean);
  const srcDir = await resolveDirHandle(root, srcParts);
  for await (const entry of srcDir.values()) {
    const childSrc = `${srcPath}/${entry.name}`;
    const childDest = `${destPath}/${entry.name}`;
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      await writeRealFile(root, childDest, await file.text());
    } else {
      await copyRealTree(root, childSrc, childDest);
    }
  }
}

/** Renames/moves a file or folder on disk (no native rename in the FS Access API, so files are copied then the original is removed). */
export async function renameRealEntry(
  root: FileSystemDirectoryHandle,
  node: WorkspaceFileNode,
  oldPath: string,
  newPath: string
): Promise<void> {
  if (node.type === 'file') {
    const content = node.isLoaded ? node.content ?? '' : await readRealFile(root, oldPath);
    await writeRealFile(root, newPath, content);
    await deleteRealEntry(root, oldPath, false);
    return;
  }
  await copyRealTree(root, oldPath, newPath);
  await deleteRealEntry(root, oldPath, true);
}

export async function uploadFilesToReal(
  root: FileSystemDirectoryHandle,
  basePath: string,
  files: File[]
): Promise<{ path: string; content: string }[]> {
  const results: { path: string; content: string }[] = [];
  for (const file of files) {
    const content = await file.text();
    const path = basePath ? `${basePath}/${file.name}` : file.name;
    await writeRealFile(root, path, content);
    results.push({ path, content });
  }
  return results;
}
