import type { WorkspacePath } from './types';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const RESERVED_NAMESPACES = new Set(['.sourai', '.sourai-internal']);
const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;

export function workspacePath(value: string, allowRoot = false): WorkspacePath {
  if (value !== value.normalize('NFC')) throw new TypeError('Workspace path must use NFC Unicode.');
  if (value === '' && allowRoot) return value as WorkspacePath;
  if (
    !value ||
    value.length > MAX_PATH_LENGTH ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    value.includes('\\') ||
    CONTROL_CHARACTER.test(value) ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new TypeError(`Invalid workspace-relative path: ${JSON.stringify(value)}`);
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.length > MAX_SEGMENT_LENGTH
    ) ||
    RESERVED_NAMESPACES.has(segments[0].toLowerCase())
  ) {
    throw new TypeError(`Invalid workspace-relative path: ${JSON.stringify(value)}`);
  }
  return value as WorkspacePath;
}

export function workspaceRoot(): WorkspacePath {
  return workspacePath('', true);
}

export function parentPath(path: WorkspacePath): WorkspacePath {
  const index = path.lastIndexOf('/');
  return workspacePath(index < 0 ? '' : path.slice(0, index), true);
}

export function baseName(path: WorkspacePath): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isWithinRoot(path: WorkspacePath, root: WorkspacePath): boolean {
  return root === '' || path === root || path.startsWith(`${root}/`);
}
