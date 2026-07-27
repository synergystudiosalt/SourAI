import type {
  OpfsDirectoryHandle,
  OpfsFileHandle,
  OpfsWritable,
} from '../blobStore';

interface MemoryFile {
  readonly kind: 'file';
  bytes: Uint8Array;
}

interface MemoryDirectory {
  readonly kind: 'directory';
  readonly children: Map<string, MemoryEntry>;
}

type MemoryEntry = MemoryFile | MemoryDirectory;

const notFound = (name: string) =>
  new DOMException(`OPFS entry ${name} does not exist.`, 'NotFoundError');
const typeMismatch = (name: string) =>
  new DOMException(`OPFS entry ${name} has the wrong kind.`, 'TypeMismatchError');

function assertName(name: string): void {
  if (!name || name === '.' || name === '..' || /[\/\\\0]/.test(name)) {
    throw new TypeError(`Invalid OPFS entry name ${JSON.stringify(name)}.`);
  }
}

async function bytesFrom(data: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(await data.arrayBuffer());
}

export class InMemoryOpfs {
  private readonly root: MemoryDirectory = { kind: 'directory', children: new Map() };

  constructor(private readonly quotaBytes = Number.POSITIVE_INFINITY) {}

  getRoot = async (): Promise<OpfsDirectoryHandle> => this.directoryHandle(this.root);

  private usedBytes(entry: MemoryEntry = this.root): number {
    if (entry.kind === 'file') return entry.bytes.byteLength;
    let total = 0;
    for (const child of entry.children.values()) total += this.usedBytes(child);
    return total;
  }

  private directoryHandle(directory: MemoryDirectory): OpfsDirectoryHandle {
    return {
      getDirectoryHandle: async (name, options) => {
        assertName(name);
        const existing = directory.children.get(name);
        if (existing) {
          if (existing.kind !== 'directory') throw typeMismatch(name);
          return this.directoryHandle(existing);
        }
        if (!options?.create) throw notFound(name);
        const created: MemoryDirectory = { kind: 'directory', children: new Map() };
        directory.children.set(name, created);
        return this.directoryHandle(created);
      },
      getFileHandle: async (name, options) => {
        assertName(name);
        const existing = directory.children.get(name);
        if (existing) {
          if (existing.kind !== 'file') throw typeMismatch(name);
          return this.fileHandle(directory, name, existing);
        }
        if (!options?.create) throw notFound(name);
        const created: MemoryFile = { kind: 'file', bytes: new Uint8Array() };
        directory.children.set(name, created);
        return this.fileHandle(directory, name, created);
      },
      removeEntry: async (name, options) => {
        assertName(name);
        const existing = directory.children.get(name);
        if (!existing) throw notFound(name);
        if (
          existing.kind === 'directory' &&
          existing.children.size > 0 &&
          !options?.recursive
        ) {
          throw new DOMException('Directory is not empty.', 'InvalidModificationError');
        }
        directory.children.delete(name);
      },
    };
  }

  private fileHandle(
    parent: MemoryDirectory,
    name: string,
    file: MemoryFile
  ): OpfsFileHandle {
    return {
      getFile: async () => new Blob([file.bytes.slice()]),
      createWritable: async (): Promise<OpfsWritable> => {
        let pending = new Uint8Array();
        let closed = false;
        return {
          write: async (data) => {
            if (closed) throw new TypeError('Writable is closed.');
            pending = await bytesFrom(data);
          },
          close: async () => {
            if (closed) throw new TypeError('Writable is closed.');
            const projected = this.usedBytes() - file.bytes.byteLength + pending.byteLength;
            if (projected > this.quotaBytes) {
              throw new DOMException('Quota exceeded.', 'QuotaExceededError');
            }
            closed = true;
            file.bytes = pending.slice();
            parent.children.set(name, file);
          },
          abort: async () => {
            closed = true;
          },
        };
      },
    };
  }

  async snapshot(): Promise<Record<string, Uint8Array>> {
    const output: Record<string, Uint8Array> = {};
    const visit = (directory: MemoryDirectory, prefix: string) => {
      for (const [name, entry] of directory.children) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'file') output[path] = entry.bytes.slice();
        else visit(entry, path);
      }
    };
    visit(this.root, '');
    return output;
  }
}
