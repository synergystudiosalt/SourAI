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
const MAX_PROJECT_PATH_LENGTH = 1024;
const MAX_PATH_SEGMENT_LENGTH = 255;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * Returns the one canonical relative path accepted by every real-folder
 * operation. Validation happens before a handle is opened or a parent is
 * created, so a rejected request has no filesystem side effects.
 */
export function canonicalProjectPath(path: string, allowRoot = false): string {
  const normalized = path.normalize('NFC');
  if (normalized === '' && allowRoot) return '';
  if (
    normalized === '' ||
    normalized.length > MAX_PROJECT_PATH_LENGTH ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('//') ||
    normalized.includes('\\') ||
    CONTROL_CHARACTER.test(normalized) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new TypeError(`Invalid project-relative path: ${JSON.stringify(path)}`);
  }

  const parts = normalized.split('/');
  if (
    parts.some(
      (part) =>
        part === '' ||
        part === '.' ||
        part === '..' ||
        part.length > MAX_PATH_SEGMENT_LENGTH
    )
  ) {
    throw new TypeError(`Invalid project-relative path: ${JSON.stringify(path)}`);
  }
  return normalized;
}

/** Comparison key shared by in-memory and real-folder path allocation. */
export function projectPathReservationKey(path: string): string {
  return canonicalProjectPath(path).toLowerCase();
}

/**
 * Reserves one canonical, case-insensitively unique project path.
 *
 * File System Access handles may target case-insensitive filesystems, so a
 * browser tree must not represent case or Unicode-normalization variants as
 * distinct files when the disk cannot.
 */
export function reserveUniqueProjectPath(
  desiredPath: string,
  reservedKeys: Set<string>
): string {
  const canonicalDesired = canonicalProjectPath(desiredPath);
  const slash = canonicalDesired.lastIndexOf('/');
  const parentPath = slash >= 0 ? canonicalDesired.slice(0, slash + 1) : '';
  const baseName = slash >= 0 ? canonicalDesired.slice(slash + 1) : canonicalDesired;
  const dotIndex = baseName.lastIndexOf('.');
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const extension = dotIndex > 0 ? baseName.slice(dotIndex) : '';
  let path = canonicalDesired;
  let counter = 2;
  while (reservedKeys.has(projectPathReservationKey(path))) {
    path = canonicalProjectPath(`${parentPath}${stem} ${counter}${extension}`);
    counter++;
  }
  reservedKeys.add(projectPathReservationKey(path));
  return path;
}

function pathParts(path: string, allowRoot = false): string[] {
  const canonical = canonicalProjectPath(path, allowRoot);
  return canonical ? canonical.split('/') : [];
}

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
  const parts = pathParts(path);
  const dir = await resolveDirHandle(root, parts.slice(0, -1));
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return await file.text();
}

async function writeRealData(
  root: FileSystemDirectoryHandle,
  path: string,
  content: string | Blob | Uint8Array
): Promise<void> {
  const parts = pathParts(path);
  const dir = await resolveDirHandle(root, parts.slice(0, -1), true);
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function writeRealFile(root: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  await writeRealData(root, path, content);
}

/** Writes bytes without decoding/re-encoding them as text. */
export async function writeRealBlob(
  root: FileSystemDirectoryHandle,
  path: string,
  content: Blob | Uint8Array
): Promise<void> {
  await writeRealData(root, path, content);
}

export async function createRealFolder(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  await resolveDirHandle(root, pathParts(path, true), true);
}

export async function deleteRealEntry(root: FileSystemDirectoryHandle, path: string, isFolder: boolean): Promise<void> {
  const parts = pathParts(path);
  const dir = await resolveDirHandle(root, parts.slice(0, -1));
  await dir.removeEntry(parts[parts.length - 1], { recursive: isFolder });
}

/**
 * The File System Access API exposes no atomic rename primitive. Copy/delete
 * can overwrite a destination created after a check or delete source bytes
 * changed by another tab/process. Keep this operation disabled until Phase 2
 * supplies serialization, revisions, checkpoints, and conflict handling.
 */
export async function renameRealEntry(
  _root: FileSystemDirectoryHandle,
  _node: WorkspaceFileNode,
  _oldPath: string,
  _newPath: string
): Promise<void> {
  throw new DOMException(
    'Safe rename for real folders requires revision-checked transactions and is not available yet.',
    'NotSupportedError'
  );
}

export function isTextLikeFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (file.type.startsWith('text/')) return true;
  if (
    /^(?:application\/(?:json|ld\+json|xml|javascript|x-javascript|typescript|yaml|x-yaml|toml|sql|graphql))$/i.test(
      file.type
    )
  ) {
    return true;
  }
  return /\.(?:txt|md|mdx|csv|tsv|json|jsonl|ya?ml|toml|ini|conf|log|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|mts|cts|py|rb|php|java|c|cc|cpp|h|hpp|cs|go|rs|swift|kt|kts|sh|bash|zsh|fish|ps1|sql|graphql|gql|vue|svelte|env)$/i.test(
    file.name
  );
}

export async function uploadFilesToReal(
  root: FileSystemDirectoryHandle,
  basePath: string,
  files: File[]
): Promise<{ path: string; content?: string }[]> {
  const canonicalBase = canonicalProjectPath(basePath, true);
  const results: { path: string; content?: string }[] = [];
  const reservedKeys = new Set<string>();
  for (const file of files) {
    const path = reserveUniqueProjectPath(
      canonicalBase ? `${canonicalBase}/${file.name}` : file.name,
      reservedKeys
    );
    await writeRealBlob(root, path, file);
    const content = isTextLikeFile(file) ? await file.text() : undefined;
    results.push(content === undefined ? { path } : { path, content });
  }
  return results;
}
