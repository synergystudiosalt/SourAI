/**
 * In-memory File System Access API fake.
 *
 * Real local-folder behaviour is impossible to exercise in jsdom and painful to
 * exercise in Playwright (the picker needs a user gesture and a real folder).
 * This fake implements enough of the specification for the adapter tests —
 * including the parts that matter for safety:
 *
 *  - `NotFoundError` / `TypeMismatchError` `DOMException`s with the right names
 *  - permission states, so revoked-permission recovery can be tested
 *  - a call log, so "the adapter wrote outside the root" is directly assertable
 *  - name validation, so a path segment containing `/` or `..` is rejected the
 *    way a real implementation rejects it
 */

import { canonicalProjectPath } from '../../utils/realFs';

export type PermissionState = 'granted' | 'denied' | 'prompt';

interface FakeFileEntry {
  kind: 'file';
  name: string;
  contents: Uint8Array;
  lastModified: number;
}

interface FakeDirEntry {
  kind: 'directory';
  name: string;
  children: Map<string, FakeEntry>;
}

type FakeEntry = FakeFileEntry | FakeDirEntry;

const HANDLE_FS = Symbol('fake-file-system');
const HANDLE_ENTRY = Symbol('fake-file-entry');

interface FakeHandleIdentity {
  readonly [HANDLE_FS]: FakeFileSystem;
  readonly [HANDLE_ENTRY]: FakeEntry;
}

export interface FakeFsOptions {
  /** Initial permission state reported by `queryPermission`. */
  permission?: PermissionState;
  /** Whether `requestPermission` succeeds when the state is `prompt`. */
  grantOnRequest?: boolean;
}

/** Records every mutating operation, for assertions about blast radius. */
export interface FsCall {
  op: 'getFileHandle' | 'getDirectoryHandle' | 'removeEntry' | 'write' | 'read';
  path: string;
  create?: boolean;
  recursive?: boolean;
}

function notFound(name: string): DOMException {
  return new DOMException(`A requested file or directory could not be found: ${name}`, 'NotFoundError');
}

function typeMismatch(name: string): DOMException {
  return new DOMException(`The path supplied exists, but was not an entry of the requested type: ${name}`, 'TypeMismatchError');
}

/**
 * Mirrors the name validation a real implementation performs. A single path
 * segment may not be empty, may not be `.` or `..`, and may not contain a path
 * separator — this is the browser-level backstop against traversal.
 */
function assertValidName(name: string): void {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`Name is not allowed: ${JSON.stringify(name)}`);
  }
}

export class FakeFileSystem {
  readonly calls: FsCall[] = [];
  private permission: PermissionState;
  private readonly grantOnRequest: boolean;
  private readonly root: FakeDirEntry = { kind: 'directory', name: '', children: new Map() };

  constructor(initial: Record<string, string> = {}, options: FakeFsOptions = {}) {
    this.permission = options.permission ?? 'granted';
    this.grantOnRequest = options.grantOnRequest ?? true;
    for (const [path, contents] of Object.entries(initial)) this.seed(path, contents);
  }

  /** Adds a file, creating parent directories. Bypasses the handle API. */
  seed(path: string, contents: string): void {
    const parts = canonicalProjectPath(path).split('/');
    const fileName = parts.pop();
    if (!fileName) throw new Error(`Cannot seed a directory as a file: ${path}`);
    let dir = this.root;
    for (const part of parts) {
      assertValidName(part);
      let next = dir.children.get(part);
      if (!next) {
        next = { kind: 'directory', name: part, children: new Map() };
        dir.children.set(part, next);
      }
      if (next.kind !== 'directory') throw typeMismatch(part);
      dir = next;
    }
    assertValidName(fileName);
    dir.children.set(fileName, {
      kind: 'file',
      name: fileName,
      contents: new TextEncoder().encode(contents),
      lastModified: 1_700_000_000_000,
    });
  }

  /** Flat snapshot of every file, for assertions. */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: FakeDirEntry, prefix: string) => {
      for (const [name, entry] of dir.children) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'file') out[path] = new TextDecoder().decode(entry.contents);
        else walk(entry, path);
      }
    };
    walk(this.root, '');
    return out;
  }

  /** Sorted list of every existing path, files and directories. */
  paths(): string[] {
    const out: string[] = [];
    const walk = (dir: FakeDirEntry, prefix: string) => {
      for (const [name, entry] of dir.children) {
        const path = prefix ? `${prefix}/${name}` : name;
        out.push(path);
        if (entry.kind === 'directory') walk(entry, path);
      }
    };
    walk(this.root, '');
    return out.sort();
  }

  setPermission(state: PermissionState): void {
    this.permission = state;
  }

  getPermission(): PermissionState {
    return this.permission;
  }

  /** The root handle, typed as the DOM interface the production code expects. */
  get rootHandle(): FileSystemDirectoryHandle {
    return this.makeDirectoryHandle(this.root, '') as unknown as FileSystemDirectoryHandle;
  }

  private record(call: FsCall): void {
    this.calls.push(call);
  }

  private ensurePermitted(): void {
    if (this.permission === 'denied') {
      throw new DOMException('The request is not allowed by the user agent.', 'NotAllowedError');
    }
  }

  private identityOf(value: unknown): FakeHandleIdentity | null {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
    const candidate = value as Partial<FakeHandleIdentity>;
    return candidate[HANDLE_FS] === this && candidate[HANDLE_ENTRY]
      ? (candidate as FakeHandleIdentity)
      : null;
  }

  private pathForEntry(target: FakeEntry): string | null {
    if (target === this.root) return '';
    const visit = (dir: FakeDirEntry, prefix: string): string | null => {
      for (const [name, entry] of dir.children) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry === target) return path;
        if (entry.kind === 'directory') {
          const nested = visit(entry, path);
          if (nested !== null) return nested;
        }
      }
      return null;
    };
    return visit(this.root, '');
  }

  private makeFileHandle(entry: FakeFileEntry, path: string) {
    const fs = this;
    return {
      [HANDLE_FS]: fs,
      [HANDLE_ENTRY]: entry,
      kind: 'file' as const,
      name: entry.name,
      isSameEntry(other: unknown) {
        return Promise.resolve(fs.identityOf(other)?.[HANDLE_ENTRY] === entry);
      },
      queryPermission() {
        return Promise.resolve(fs.permission);
      },
      requestPermission() {
        if (fs.permission === 'prompt' && fs.grantOnRequest) fs.permission = 'granted';
        return Promise.resolve(fs.permission);
      },
      async getFile() {
        fs.ensurePermitted();
        fs.record({ op: 'read', path });
        return new File([entry.contents.slice()], entry.name, { lastModified: entry.lastModified });
      },
      async createWritable(options?: { keepExistingData?: boolean }) {
        fs.ensurePermitted();
        let buffer = options?.keepExistingData ? entry.contents.slice() : new Uint8Array();
        let cursor = 0;
        let closed = false;
        const assertOpen = () => {
          if (closed) throw new TypeError('The stream is closed.');
        };
        const assertPosition = (value: unknown, label: string): number => {
          if (!Number.isSafeInteger(value) || (value as number) < 0) {
            throw new TypeError(`${label} must be a non-negative safe integer.`);
          }
          return value as number;
        };
        const toBytes = async (data: unknown): Promise<Uint8Array> => {
          if (typeof data === 'string') return new TextEncoder().encode(data);
          if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
          if (data instanceof Uint8Array) return data.slice();
          if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
          }
          if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
          throw new TypeError('Unsupported data passed to write()');
        };
        const writeAtCursor = async (data: unknown) => {
          const bytes = await toBytes(data);
          const requiredLength = cursor + bytes.byteLength;
          if (requiredLength > buffer.byteLength) {
            const expanded = new Uint8Array(requiredLength);
            expanded.set(buffer);
            buffer = expanded;
          }
          buffer.set(bytes, cursor);
          cursor = requiredLength;
        };
        return {
          async write(data: unknown) {
            assertOpen();
            if (
              data &&
              typeof data === 'object' &&
              'type' in data &&
              ['write', 'seek', 'truncate'].includes(String((data as { type: unknown }).type))
            ) {
              // WriteParams — only the shapes the app actually uses.
              const params = data as {
                type: string;
                data?: unknown;
                position?: number;
                size?: number;
              };
              if (params.type === 'write' && params.data !== undefined) {
                if (params.position !== undefined) cursor = assertPosition(params.position, 'position');
                await writeAtCursor(params.data);
                return;
              }
              if (params.type === 'seek' && params.position !== undefined) {
                cursor = assertPosition(params.position, 'position');
                return;
              }
              if (params.type === 'truncate' && params.size !== undefined) {
                await this.truncate(params.size);
                return;
              }
              throw new TypeError(`Unsupported WriteParams shape for "${params.type}"`);
            }
            await writeAtCursor(data);
          },
          async truncate(size: number) {
            assertOpen();
            const nextSize = assertPosition(size, 'size');
            const resized = new Uint8Array(nextSize);
            resized.set(buffer.subarray(0, nextSize));
            buffer = resized;
            // FileSystemWritableFileStream clamps the current cursor when a
            // truncate shrinks past it. Keeping the old cursor here would make
            // a later write create a zero-filled gap that real browsers do not.
            cursor = Math.min(cursor, nextSize);
          },
          async seek(position: number) {
            assertOpen();
            cursor = assertPosition(position, 'position');
          },
          async abort() {
            assertOpen();
            closed = true;
          },
          async close() {
            assertOpen();
            closed = true;
            entry.contents = buffer.slice();
            entry.lastModified += 1000;
            fs.record({ op: 'write', path });
          },
        };
      },
    };
  }

  private makeDirectoryHandle(dir: FakeDirEntry, path: string) {
    const fs = this;
    const childPath = (name: string) => (path ? `${path}/${name}` : name);

    return {
      [HANDLE_FS]: fs,
      [HANDLE_ENTRY]: dir,
      kind: 'directory' as const,
      name: dir.name,
      isSameEntry(other: unknown) {
        return Promise.resolve(fs.identityOf(other)?.[HANDLE_ENTRY] === dir);
      },
      queryPermission() {
        return Promise.resolve(fs.permission);
      },
      requestPermission() {
        if (fs.permission === 'prompt' && fs.grantOnRequest) fs.permission = 'granted';
        return Promise.resolve(fs.permission);
      },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        assertValidName(name);
        fs.ensurePermitted();
        fs.record({ op: 'getFileHandle', path: childPath(name), create: options?.create });
        const existing = dir.children.get(name);
        if (existing) {
          if (existing.kind !== 'file') throw typeMismatch(name);
          return fs.makeFileHandle(existing, childPath(name));
        }
        if (!options?.create) throw notFound(name);
        const created: FakeFileEntry = {
          kind: 'file',
          name,
          contents: new Uint8Array(),
          lastModified: 1_700_000_000_000,
        };
        dir.children.set(name, created);
        return fs.makeFileHandle(created, childPath(name));
      },
      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        assertValidName(name);
        fs.ensurePermitted();
        fs.record({ op: 'getDirectoryHandle', path: childPath(name), create: options?.create });
        const existing = dir.children.get(name);
        if (existing) {
          if (existing.kind !== 'directory') throw typeMismatch(name);
          return fs.makeDirectoryHandle(existing, childPath(name));
        }
        if (!options?.create) throw notFound(name);
        const created: FakeDirEntry = { kind: 'directory', name, children: new Map() };
        dir.children.set(name, created);
        return fs.makeDirectoryHandle(created, childPath(name));
      },
      async removeEntry(name: string, options?: { recursive?: boolean }) {
        assertValidName(name);
        fs.ensurePermitted();
        fs.record({ op: 'removeEntry', path: childPath(name), recursive: options?.recursive });
        const existing = dir.children.get(name);
        if (!existing) throw notFound(name);
        if (existing.kind === 'directory' && existing.children.size > 0 && !options?.recursive) {
          throw new DOMException('The object can not be modified in this way.', 'InvalidModificationError');
        }
        dir.children.delete(name);
      },
      async resolve(possibleDescendant: unknown) {
        const descendantIdentity = fs.identityOf(possibleDescendant);
        if (!descendantIdentity) return null;
        const basePath = fs.pathForEntry(dir);
        const descendantPath = fs.pathForEntry(descendantIdentity[HANDLE_ENTRY]);
        if (basePath === null || descendantPath === null) return null;
        if (basePath === descendantPath) return [];
        const prefix = basePath ? `${basePath}/` : '';
        if (!descendantPath.startsWith(prefix)) return null;
        return descendantPath.slice(prefix.length).split('/');
      },
      async *values() {
        fs.ensurePermitted();
        for (const [name, entry] of [...dir.children]) {
          yield entry.kind === 'file'
            ? fs.makeFileHandle(entry, childPath(name))
            : fs.makeDirectoryHandle(entry, childPath(name));
        }
      },
      async *keys() {
        for (const name of [...dir.children.keys()]) yield name;
      },
      async *entries() {
        for (const [name, entry] of [...dir.children]) {
          yield [
            name,
            entry.kind === 'file'
              ? fs.makeFileHandle(entry, childPath(name))
              : fs.makeDirectoryHandle(entry, childPath(name)),
          ] as const;
        }
      },
      [Symbol.asyncIterator]() {
        return this.entries();
      },
    };
  }
}

/** Convenience: a fake filesystem plus its root handle. */
export function createFakeDirectory(
  initial: Record<string, string> = {},
  options: FakeFsOptions = {}
): { fs: FakeFileSystem; root: FileSystemDirectoryHandle } {
  const fs = new FakeFileSystem(initial, options);
  return { fs, root: fs.rootHandle };
}
