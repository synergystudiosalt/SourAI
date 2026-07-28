import {
  isWithinRoot,
  workspacePath,
  workspaceRoot,
  type DirectoryEntry,
  type WorkspacePath,
} from '../../filesystem';
import type { ToolContext, ToolDescriptor } from './types';
import {
  exactRecord,
  optionalBoolean,
  optionalInteger,
  optionalPath,
  optionalString,
  requiredString,
  toolValidationError,
  validPath,
} from './validation';

const MAX_READ_BYTES = 256 * 1024;
const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const MAX_MATCH_TEXT = 500;
const decoder = new TextDecoder('utf-8', { fatal: false });

interface ReadFileArguments extends Record<string, unknown> {
  readonly path: WorkspacePath;
  readonly maxBytes?: number;
}

interface ReadDirectoryArguments extends Record<string, unknown> {
  readonly path?: WorkspacePath;
  readonly maxEntries?: number;
}

interface StatArguments extends Record<string, unknown> {
  readonly path: WorkspacePath;
}

interface SearchArguments extends Record<string, unknown> {
  readonly query: string;
  readonly path?: WorkspacePath;
  readonly maxResults?: number;
  readonly caseSensitive?: boolean;
}

interface OptionalPathArguments extends Record<string, unknown> {
  readonly path?: WorkspacePath;
  readonly maxResults?: number;
}

function resolveChildPath(entry: DirectoryEntry): WorkspacePath {
  // Adapters return a full project-relative path. Re-validating prevents a
  // compromised or buggy adapter from turning traversal into a tool result.
  return workspacePath(String(entry.path));
}

const objectSchema = (
  properties: Record<string, Readonly<Record<string, unknown>>>,
  required?: readonly string[]
) =>
  Object.freeze({
    type: 'object' as const,
    properties: Object.freeze(properties),
    required,
    additionalProperties: false as const,
  });

async function collectEntries(
  context: ToolContext,
  root: WorkspacePath,
  maximumFiles = MAX_SEARCH_FILES
): Promise<readonly DirectoryEntry[]> {
  const files: DirectoryEntry[] = [];
  const pending: WorkspacePath[] = [root];
  let visited = 0;
  while (pending.length > 0 && files.length < maximumFiles) {
    const directory = pending.shift()!;
    const entries = await context.filesystem.readDirectory(directory);
    for (const entry of entries) {
      if (++visited > maximumFiles * 2) return files;
      const path = resolveChildPath(entry);
      if (!isWithinRoot(path, root)) {
        toolValidationError('adapter_path_outside_search_root', { path, root });
      }
      if (entry.kind === 'directory') pending.push(path);
      else files.push({ ...entry, path });
      if (files.length >= maximumFiles) break;
    }
  }
  return files;
}

export const readFileTool: ToolDescriptor<ReadFileArguments> = {
  version: 1,
  name: 'read_file',
  description: 'Read a UTF-8 workspace file.',
  risk: 'read',
  inputSchema: objectSchema(
    { path: { type: 'string' }, maxBytes: { type: 'integer', minimum: 1, maximum: MAX_READ_BYTES } },
    ['path']
  ),
  validateArguments(value) {
    const record = exactRecord(value, ['path', 'maxBytes'], ['path']);
    return {
      path: validPath(record.path),
      maxBytes: optionalInteger(record.maxBytes, 'maxBytes', 1, MAX_READ_BYTES),
    };
  },
  async run(arguments_, context) {
    const result = await context.filesystem.readFile(arguments_.path);
    const maximum = arguments_.maxBytes ?? MAX_READ_BYTES;
    const used = result.data.subarray(0, maximum);
    return {
      path: arguments_.path,
      content: decoder.decode(used),
      truncated: result.data.byteLength > maximum,
      size: result.data.byteLength,
      revision: result.version.revision,
      contentHash: result.version.contentHash,
    };
  },
};

export const readDirectoryTool: ToolDescriptor<ReadDirectoryArguments> = {
  version: 1,
  name: 'read_directory',
  description: 'List one workspace directory.',
  risk: 'read',
  inputSchema: objectSchema({
    path: { type: 'string' },
    maxEntries: { type: 'integer', minimum: 1, maximum: MAX_DIRECTORY_ENTRIES },
  }),
  validateArguments(value) {
    const record = exactRecord(value, ['path', 'maxEntries'], []);
    return {
      path: optionalPath(record.path),
      maxEntries: optionalInteger(record.maxEntries, 'maxEntries', 1, MAX_DIRECTORY_ENTRIES),
    };
  },
  async run(arguments_, context) {
    const maximum = arguments_.maxEntries ?? MAX_DIRECTORY_ENTRIES;
    const root = arguments_.path ?? workspaceRoot();
    const entries = await context.filesystem.readDirectory(root);
    const visible = entries.slice(0, maximum).map((entry) => ({
      path: (() => {
        const path = resolveChildPath(entry);
        if (!isWithinRoot(path, root)) {
          toolValidationError('adapter_path_outside_directory', { path, root });
        }
        return path;
      })(),
      name: entry.name,
      kind: entry.kind,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      contentHash: entry.contentHash,
    }));
    return { entries: visible, truncated: entries.length > maximum };
  },
};

export const statTool: ToolDescriptor<StatArguments> = {
  version: 1,
  name: 'stat',
  description: 'Inspect workspace file or directory metadata.',
  risk: 'read',
  inputSchema: objectSchema({ path: { type: 'string' } }, ['path']),
  validateArguments(value) {
    const record = exactRecord(value, ['path']);
    return { path: validPath(record.path) };
  },
  async run(arguments_, context) {
    return context.filesystem.stat(arguments_.path);
  },
};

function validateSearch(value: unknown): SearchArguments {
  const record = exactRecord(value, ['query', 'path', 'maxResults', 'caseSensitive'], ['query']);
  return {
    query: requiredString(record.query, 'query', 1_000),
    path: optionalPath(record.path),
    maxResults: optionalInteger(record.maxResults, 'maxResults', 1, MAX_SEARCH_RESULTS),
    caseSensitive: optionalBoolean(record.caseSensitive, 'caseSensitive'),
  };
}

export const searchFilesTool: ToolDescriptor<SearchArguments> = {
  version: 1,
  name: 'search_files',
  description: 'Find workspace paths by literal substring.',
  risk: 'read',
  inputSchema: objectSchema(
    {
      query: { type: 'string', maxLength: 1_000 },
      path: { type: 'string' },
      maxResults: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS },
      caseSensitive: { type: 'boolean' },
    },
    ['query']
  ),
  validateArguments: validateSearch,
  async run(arguments_, context) {
    const maximum = arguments_.maxResults ?? MAX_SEARCH_RESULTS;
    const needle = arguments_.caseSensitive ? arguments_.query : arguments_.query.toLocaleLowerCase();
    const entries = await collectEntries(context, arguments_.path ?? workspaceRoot());
    const matches = entries
      .filter((entry) => {
        const candidate = arguments_.caseSensitive
          ? String(entry.path)
          : String(entry.path).toLocaleLowerCase();
        return candidate.includes(needle);
      })
      .slice(0, maximum)
      .map((entry) => ({ path: entry.path, size: entry.size, contentHash: entry.contentHash }));
    return { matches, truncated: matches.length === maximum };
  },
};

export const searchTextTool: ToolDescriptor<SearchArguments> = {
  version: 1,
  name: 'search_text',
  description: 'Search UTF-8 workspace files for a literal string.',
  risk: 'read',
  inputSchema: searchFilesTool.inputSchema,
  validateArguments: validateSearch,
  async run(arguments_, context) {
    const maximum = arguments_.maxResults ?? MAX_SEARCH_RESULTS;
    const files = await collectEntries(context, arguments_.path ?? workspaceRoot());
    const needle = arguments_.caseSensitive ? arguments_.query : arguments_.query.toLocaleLowerCase();
    const matches: Array<{ path: WorkspacePath; line: number; text: string }> = [];
    for (const file of files) {
      if (matches.length >= maximum) break;
      if (file.size > MAX_SEARCH_FILE_BYTES) continue;
      const read = await context.filesystem.readFile(file.path);
      const lines = decoder.decode(read.data).split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < maximum; index++) {
        const candidate = arguments_.caseSensitive ? lines[index] : lines[index].toLocaleLowerCase();
        if (candidate.includes(needle)) {
          matches.push({
            path: file.path,
            line: index + 1,
            text: lines[index].slice(0, MAX_MATCH_TEXT),
          });
        }
      }
    }
    return { matches, truncated: matches.length === maximum };
  },
};

export const projectRevisionTool: ToolDescriptor<Record<string, never>> = {
  version: 1,
  name: 'get_project_revision',
  description: 'Read the canonical workspace revision.',
  risk: 'read',
  inputSchema: objectSchema({}),
  validateArguments(value) {
    exactRecord(value, [], []);
    return {};
  },
  async run(_arguments, context) {
    return { revision: await context.filesystem.revision() };
  },
};

export const listOpenFilesTool: ToolDescriptor<Record<string, never>> = {
  version: 1,
  name: 'list_open_files',
  description: 'List files currently open in the editor.',
  risk: 'read',
  inputSchema: objectSchema({}),
  validateArguments(value) {
    exactRecord(value, [], []);
    return {};
  },
  async run(_arguments, context) {
    const raw = (await context.listOpenFiles?.()) ?? [];
    const paths = raw.slice(0, MAX_DIRECTORY_ENTRIES).map((path) => validPath(path));
    return { paths, truncated: raw.length > MAX_DIRECTORY_ENTRIES };
  },
};

export const inspectDiagnosticsTool: ToolDescriptor<OptionalPathArguments> = {
  version: 1,
  name: 'inspect_diagnostics',
  description: 'Read bounded editor diagnostics.',
  risk: 'read',
  inputSchema: objectSchema({
    path: { type: 'string' },
    maxResults: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS },
  }),
  validateArguments(value) {
    const record = exactRecord(value, ['path', 'maxResults'], []);
    return {
      path: optionalPath(record.path),
      maxResults: optionalInteger(record.maxResults, 'maxResults', 1, MAX_SEARCH_RESULTS),
    };
  },
  async run(arguments_, context) {
    const maximum = arguments_.maxResults ?? MAX_SEARCH_RESULTS;
    const raw = (await context.inspectDiagnostics?.()) ?? [];
    const filtered = raw.filter(
      (diagnostic) => !arguments_.path || diagnostic.path === String(arguments_.path)
    );
    return { diagnostics: filtered.slice(0, maximum), truncated: filtered.length > maximum };
  },
};

export const READ_ONLY_TOOLS = Object.freeze([
  readFileTool,
  readDirectoryTool,
  statTool,
  searchTextTool,
  searchFilesTool,
  projectRevisionTool,
  listOpenFilesTool,
  inspectDiagnosticsTool,
] as const);
