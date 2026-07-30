import { AgentFileOp } from '../types';

/**
 * Parses agent responses into structured operations and display text.
 * Preserves visible XML tags (<think>, <check_for_errors>, <subagent_request/response>)
 * while extracting file ops, tool calls, and subagent tasks.
 */

const FILE_BLOCK_RE = /```[ \t]*([\w+-]*)[ \t]*path=["']([^"'\n]+)["'][^\n]*\n([\s\S]*?)\n?```/g;
const FILE_BLOCK_OPEN_RE = /```[ \t]*[\w+-]*[ \t]+path=["'][^"'\n]+["'][^\n]*\n/i;
const DELETE_RE = /^@@delete:\s*(.+?)\s*$/gm;
const READFILE_RE = /^@@readfile:\s*(.+?)\s*$/gm;
const FINDALL_RE = /^@@findall:\s*(.+?)\s*$/gm;
const LISTDIR_RE = /^@@listdir:\s*(.+?)\s*$/gm;
const GLOB_RE = /^@@glob:\s*(.+?)\s*$/gm;
const FILEINFO_RE = /^@@fileinfo:\s*(.+?)\s*$/gm;
const CHECK_ERRORS_RE = /<check_for_errors>([\s\S]*?)<\/check_for_errors>/gi;
const CONTEXT_STORE_RE = /^@@context_store:\s*([^=\r\n]+?)\s*=\s*(.+?)\s*$/gm;
const CONTEXT_GET_RE = /^@@context_get:\s*(.+?)\s*$/gm;
const CONTEXT_LIST_RE = /^@@context_list\s*$/gm;
const CONTEXT_CLEAR_RE = /^@@context_clear:\s*(.+?)\s*$/gm;
/**
 * Start of a replace directive. The two `|||`-separated halves that follow are
 * read by extractReplaceRequests, not by this pattern.
 *
 * A single regex cannot do it. With the `m` flag `$` matches at the first line
 * boundary, so a lazy trailing group stopped there and a multi-line replacement
 * captured only its first line — the edit still applied, silently replacing the
 * target with that one line and discarding the rest, while the remainder leaked
 * into the visible reply.
 */
const REPLACE_START_RE = /^@@replace:[ \t]*(.+?)[ \t]*\|\|\|/gm;
/** Any directive or fence that must end an unterminated replace block. */
const NEXT_DIRECTIVE_RE = /^(?:@@\w+|```)/m;

export interface ParsedReplaceRequest {
  readonly path: string;
  readonly search: string;
  readonly replace: string;
}

/**
 * Pulls every replace directive out of `text`, returning the requests and the
 * text with those directives removed.
 *
 * Scans forward from each opener rather than pattern-matching the whole block,
 * so both halves may span any number of lines. A block is bounded by the next
 * directive or fence, which stops one malformed request from swallowing the
 * rest of the reply.
 */
export function extractReplaceRequests(
  text: string
): { requests: ParsedReplaceRequest[]; text: string } {
  const requests: ParsedReplaceRequest[] = [];
  let output = '';
  let cursor = 0;

  REPLACE_START_RE.lastIndex = 0;
  let opener: RegExpExecArray | null;
  while ((opener = REPLACE_START_RE.exec(text)) !== null) {
    const bodyStart = opener.index + opener[0].length;
    const rest = text.slice(bodyStart);

    // A later directive or fence bounds this block; otherwise it runs to the end.
    const boundary = rest.search(NEXT_DIRECTIVE_RE);
    const block = boundary === -1 ? rest : rest.slice(0, boundary);

    const separator = block.indexOf('|||');
    if (separator === -1) {
      // No closing separator: leave the directive visible rather than applying
      // half an edit, so the malformed request is obvious.
      continue;
    }

    const path = normalizePath(opener[1]);
    const search = block.slice(0, separator);
    const replace = block.slice(separator + 3);
    if (path && search.trim()) {
      requests.push({ path, search: search.trim(), replace: replace.trim() });
      output += text.slice(cursor, opener.index);
      cursor = bodyStart + (boundary === -1 ? rest.length : boundary);
      REPLACE_START_RE.lastIndex = cursor;
    }
  }

  output += text.slice(cursor);
  return { requests, text: output };
}
const SEARCH_IMPORTS_RE = /^@@search_imports:\s*(.+?)\s*$/gm;
const RENAME_RE = /^@@rename:\s*(.+?)\s*\|\|\|\s*(.+?)\s*$/gm;
const TODO_RE = /^@@todo:\s*\[(\w+)\]\s*(.+?)\s*$/gm;
const INLINE_TOOL_SEQUENCE_RE =
  /^(@@(?:delete|readfile|findall|listdir|glob|fileinfo|context_store|context_get|context_list|context_clear|replace|search_imports|rename|todo)(?::|\b)[^\r\n]*?)[ \t]+(?=@@(?:delete|readfile|findall|listdir|glob|fileinfo|context_store|context_get|context_list|context_clear|replace|search_imports|rename|todo)(?::|\b))/gim;

function splitInlineToolSequences(raw: string): string {
  let result = raw;
  let previous = '';
  while (result !== previous) {
    previous = result;
    result = result.replace(INLINE_TOOL_SEQUENCE_RE, '$1\n');
  }
  return result;
}

function normalizePath(raw: string): string {
  return raw.trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
}

/**
 * Models occasionally emit the same full-file mutation more than once in a
 * turn. Only the final action for a normalized path is meaningful.
 */
export function collapseAgentFileOps(operations: readonly AgentFileOp[]): AgentFileOp[] {
  const finalByPath = new Map<string, AgentFileOp>();
  for (const operation of operations) {
    const key = normalizePath(operation.path)
      .replace(/\\/g, '/')
      .normalize('NFC')
      .toLowerCase();
    if (!key) continue;
    // Reinsert so the displayed order follows each path's final occurrence.
    finalByPath.delete(key);
    finalByPath.set(key, operation);
  }
  return [...finalByPath.values()];
}

/** Resolves optional model-added line ranges without accepting guessed paths. */
export function resolveKnownFileRequest(raw: string, knownPaths: string[]): string | null {
  const normalized = normalizePath(raw);
  const withoutRange = normalized
    .replace(/\s*\|\s*\d+(?:\s*\|\s*\d+)?\s*$/, '')
    .replace(/:\d+(?::\d+)?\s*$/, '')
    .trim();
  return (
    knownPaths.find((path) => path.toLocaleLowerCase() === withoutRange.toLocaleLowerCase()) ??
    null
  );
}

/** Extract file paths mentioned in check_for_errors content. */
export function extractPathsFromCheckContent(content: string): string[] {
  const paths: string[] = [];
  const pathPatterns = [
    /(?:file|path|src|read|check|validate|fix)\s*[:=]?\s*["']?([\/\\]?[\w./-]+\.\w+)["']?/gi,
    /[\w./-]+\.\w+/g,
  ];
  for (const re of pathPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const p = normalizePath(m[1] || m[0]);
      if (p && !paths.includes(p)) paths.push(p);
    }
  }
  return paths;
}

export interface ParsedAgentResponse {
  displayText: string;
  ops: AgentFileOp[];
  /** A path-qualified file fence opened but never closed. */
  incompleteFileBlock: boolean;
  fileRequests: string[];
  findRequests: string[];
  listDirRequests: string[];
  globRequests: string[];
  fileInfoRequests: string[];
  checkErrorsContent: string[];
  contextStore: { key: string; value: string }[];
  contextGet: string[];
  contextList: boolean;
  contextClear: string[];
  replaceRequests: { path: string; search: string; replace: string }[];
  searchImportsRequests: string[];
  renameRequests: { oldPath: string; newPath: string }[];
  todoItems: { action: 'add' | 'done' | 'remove'; priority: string; text: string }[];
}

export interface FilteredAgentRequests {
  response: ParsedAgentResponse;
  newRequestCount: number;
  repeatedRequestCount: number;
}

/**
 * Removes tool requests already executed during the current agent run.
 * This is the progress gate that prevents a model from reading/searching the
 * same workspace targets forever.
 */
export function filterRepeatedAgentRequests(
  response: ParsedAgentResponse,
  seen: Set<string>
): FilteredAgentRequests {
  let newRequestCount = 0;
  let repeatedRequestCount = 0;
  const keep = <T,>(items: T[], prefix: string, key: (item: T) => string): T[] =>
    items.filter((item) => {
      const signature = `${prefix}:${key(item)}`;
      if (seen.has(signature)) {
        repeatedRequestCount += 1;
        return false;
      }
      seen.add(signature);
      newRequestCount += 1;
      return true;
    });

  const contextList = response.contextList && !seen.has('context:list');
  if (response.contextList) {
    if (contextList) {
      seen.add('context:list');
      newRequestCount += 1;
    } else {
      repeatedRequestCount += 1;
    }
  }

  return {
    response: {
      ...response,
      fileRequests: keep(response.fileRequests, 'read', String),
      findRequests: keep(response.findRequests, 'find', String),
      listDirRequests: keep(response.listDirRequests, 'dir', String),
      globRequests: keep(response.globRequests, 'glob', String),
      fileInfoRequests: keep(response.fileInfoRequests, 'info', String),
      checkErrorsContent: keep(response.checkErrorsContent, 'check', String),
      contextStore: keep(response.contextStore, 'context-store', (item) => `${item.key}=${item.value}`),
      contextGet: keep(response.contextGet, 'context-get', String),
      contextList,
      contextClear: keep(response.contextClear, 'context-clear', String),
      replaceRequests: keep(
        response.replaceRequests,
        'replace',
        (item) => `${item.path}\u0000${item.search}\u0000${item.replace}`
      ),
      searchImportsRequests: keep(response.searchImportsRequests, 'imports', String),
      renameRequests: keep(
        response.renameRequests,
        'rename',
        (item) => `${item.oldPath}\u0000${item.newPath}`
      ),
      todoItems: keep(
        response.todoItems,
        'todo',
        (item) => `${item.action}\u0000${item.priority}\u0000${item.text}`
      ),
    },
    newRequestCount,
    repeatedRequestCount,
  };
}

export function parseAgentResponse(raw: string): ParsedAgentResponse {
  const ops: AgentFileOp[] = [];

  // Don't strip <think> or <check_for_errors> tags — they are visible to the user.
  // Only extract file blocks, delete markers, tool requests, and subagent directives.
  // Providers sometimes put several tool calls on one line. Canonicalise each
  // marker onto its own line before the anchored parsers run so one path can
  // never swallow the next command and raw protocol does not leak into chat.
  let text = splitInlineToolSequences(raw || '');

  text = text.replace(FILE_BLOCK_RE, (_match, lang: string, rawPath: string, content: string) => {
    const path = normalizePath(rawPath);
    if (path) {
      ops.push({ type: 'write', path, content, language: lang || undefined });
    }
    return '';
  });
  const incompleteFileBlock = FILE_BLOCK_OPEN_RE.test(text);

  text = text.replace(DELETE_RE, (_match, rawPath: string) => {
    const path = normalizePath(rawPath);
    if (path) ops.push({ type: 'delete', path });
    return '';
  });

  const fileRequests: string[] = [];
  text = text.replace(READFILE_RE, (_match, rawPath: string) => {
    const p = normalizePath(rawPath);
    if (p && !fileRequests.includes(p)) fileRequests.push(p);
    return '';
  });

  const findRequests: string[] = [];
  text = text.replace(FINDALL_RE, (_match, query: string) => {
    const q = query.trim();
    if (q && !findRequests.includes(q)) findRequests.push(q);
    return '';
  });

  const checkErrorsContent: string[] = [];
  text = text.replace(CHECK_ERRORS_RE, (_match, content: string) => {
    const c = content.trim();
    if (c) checkErrorsContent.push(c);
    return '';
  });

  const listDirRequests: string[] = [];
  text = text.replace(LISTDIR_RE, (_match, rawPath: string) => {
    const p = normalizePath(rawPath);
    if (p && !listDirRequests.includes(p)) listDirRequests.push(p);
    return '';
  });

  const globRequests: string[] = [];
  text = text.replace(GLOB_RE, (_match, pattern: string) => {
    const q = pattern.trim();
    if (q && !globRequests.includes(q)) globRequests.push(q);
    return '';
  });

  const fileInfoRequests: string[] = [];
  text = text.replace(FILEINFO_RE, (_match, rawPath: string) => {
    const p = normalizePath(rawPath);
    if (p && !fileInfoRequests.includes(p)) fileInfoRequests.push(p);
    return '';
  });

  const contextStore: { key: string; value: string }[] = [];
  text = text.replace(CONTEXT_STORE_RE, (_match, key: string, value: string) => {
    const k = key.trim();
    const v = value.trim();
    if (k) contextStore.push({ key: k, value: v });
    return '';
  });

  const contextGet: string[] = [];
  text = text.replace(CONTEXT_GET_RE, (_match, key: string) => {
    const k = key.trim();
    if (k && !contextGet.includes(k)) contextGet.push(k);
    return '';
  });

  let contextList = false;
  text = text.replace(CONTEXT_LIST_RE, () => {
    contextList = true;
    return '';
  });

  const contextClear: string[] = [];
  text = text.replace(CONTEXT_CLEAR_RE, (_match, key: string) => {
    const k = key.trim();
    if (k && !contextClear.includes(k)) contextClear.push(k);
    return '';
  });

  const extractedReplaces = extractReplaceRequests(text);
  const replaceRequests: { path: string; search: string; replace: string }[] = [
    ...extractedReplaces.requests,
  ];
  text = extractedReplaces.text;

  const searchImportsRequests: string[] = [];
  text = text.replace(SEARCH_IMPORTS_RE, (_match, symbol: string) => {
    const s = symbol.trim();
    if (s && !searchImportsRequests.includes(s)) searchImportsRequests.push(s);
    return '';
  });

  const renameRequests: { oldPath: string; newPath: string }[] = [];
  text = text.replace(RENAME_RE, (_match, oldRaw: string, newRaw: string) => {
    const o = normalizePath(oldRaw);
    const n = normalizePath(newRaw);
    if (o && n) renameRequests.push({ oldPath: o, newPath: n });
    return '';
  });

  const todoItems: { action: 'add' | 'done' | 'remove'; priority: string; text: string }[] = [];
  text = text.replace(TODO_RE, (_match, priority: string, taskText: string) => {
    const p = priority.toLowerCase().trim();
    const t = taskText.trim();
    if (!t) return '';
    if (p === 'done') {
      todoItems.push({ action: 'done', priority: 'done', text: t });
    } else if (p === 'remove') {
      todoItems.push({ action: 'remove', priority: 'remove', text: t });
    } else {
      todoItems.push({ action: 'add', priority: p, text: t });
    }
    return '';
  });

  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    displayText: incompleteFileBlock
      ? 'The model response ended before its file block was complete. No changes were applied; please retry.'
      : text,
    ops,
    incompleteFileBlock,
    fileRequests,
    findRequests,
    listDirRequests,
    globRequests,
    fileInfoRequests,
    checkErrorsContent,
    contextStore,
    contextGet,
    contextList,
    contextClear,
    replaceRequests,
    searchImportsRequests,
    renameRequests,
    todoItems,
  };
}

/** Strips large file blocks from a previously-sent assistant message before resending it as history, to keep payloads small. */
export function summarizeForHistory(content: string, ops?: AgentFileOp[]): string {
  if (!ops || ops.length === 0) return content;
  const summary = ops
    .map((op) => (op.type === 'delete' ? `Deleted ${op.path}` : `Updated ${op.path}`))
    .join(', ');
  return content ? `${content}\n\n[${summary}]` : `[${summary}]`;
}

/** Finds `@path/to/file` mentions in a message that match a known project file. */
export function extractMentionedPaths(text: string, knownPaths: string[]): string[] {
  const found: string[] = [];
  const re = /@([\w./-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const candidate = match[1].replace(/[.,;:]+$/, '');
    if (knownPaths.includes(candidate) && !found.includes(candidate)) found.push(candidate);
  }
  return found;
}
