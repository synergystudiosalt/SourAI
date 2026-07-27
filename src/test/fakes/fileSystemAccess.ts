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

export type PermissionState = 'granted' | 'denied' | 'prompt';

interface FakeFileEntry {
  kind: 'file';
  name: string;
  contents: string;
  lastModified: number;
}

interface FakeDirEntry {
  kind: 'directory';
  name: string;
  children: Map<string, FakeEntry>;
}

type FakeEntry = FakeFileEntry | FakeDirEntry;

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
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error(`Cannot seed a directory as a file: ${path}`);
    let dir = this.root;
    for (const part of parts) {
      let next = dir.children.get(part);
      if (!next) {
        next = { kind: 'directory', name: part, children: new Map() };
        dir.children.set(part, next);
      }
      if (next.kind !== 'directory') throw typeMismatch(part);
      dir = next;
    }
    dir.children.set(fileName, { kind: 'file', name: fileName, contents, lastModified: 1_700_000_000_000 });
  }

  /** Flat snapshot of every file, for assertions. */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: FakeDirEntry, prefix: string) => {
      for (const [name, entry] of dir.children) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'file') out[path] = entry.contents;
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

  private makeFileHandle(entry: FakeFileEntry, path: string) {
    const fs = this;
    return {
      kind: 'file' as const,
      name: entry.name,
      isSameEntry(other: unknown) {
        return Promise.resolve(other === this);
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
        return new File([entry.contents], entry.name, { lastModified: entry.lastModified });
      },
      async createWritable(options?: { keepExistingData?: boolean }) {
        fs.ensurePermitted();
        let buffer = options?.keepExistingData ? entry.contents : '';
        let closed = false;
        return {
          async write(data: unknown) {
            if (closed) throw new TypeError('The stream is closed.');
            if (typeof data === 'string') {
              buffer += data;
            } else if (data instanceof Blob) {
              buffer += await data.text();
            } else if (data instanceof Uint8Array) {
              buffer += new TextDecoder().decode(data);
            } else if (data instanceof ArrayBuffer) {
              buffer += new TextDecoder().decode(new Uint8Array(data));
            } else if (data && typeof data === 'object' && 'type' in data) {
              // WriteParams — only the shapes the app actually uses.
              const params = data as { type: string; data?: unknown };
              if (params.type === 'write' && params.data !== undefined) {
                await this.write(params.data);
                return;
              }
              throw new Error(`FakeFileSystem does not implement WriteParams type "${params.type}"`);
            } else {
              throw new TypeError('Unsupported data passed to write()');
            }
          },
          async truncate(size: number) {
            buffer = buffer.slice(0, size);
          },
          async seek() {
            throw new Error('FakeFileSystem does not implement seek()');
          },
          async abort() {
            closed = true;
          },
          async close() {
            if (closed) throw new TypeError('The stream is closed.');
            closed = true;
            entry.contents = buffer;
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
      kind: 'directory' as const,
      name: dir.name,
      isSameEntry(other: unknown) {
        return Promise.resolve(other === this);
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
        const created: FakeFileEntry = { kind: 'file', name, contents: '', lastModified: 1_700_000_000_000 };
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
      async resolve() {
        return null;
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
