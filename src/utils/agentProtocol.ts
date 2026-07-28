import { AgentFileOp } from '../types';

/**
 * Parses agent responses into structured operations and display text.
 * Preserves visible XML tags (<think>, <check_for_errors>, <subagent_request/response>)
 * while extracting file ops, tool calls, and subagent tasks.
 */

const FILE_BLOCK_RE = /```[ \t]*([\w+-]*)[ \t]*path=["']([^"'\n]+)["'][^\n]*\n([\s\S]*?)\n?```/g;
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
const REPLACE_RE = /^@@replace:\s*(.+?)\s*\|\|\|\s*([\s\S]+?)\s*\|\|\|\s*([\s\S]+?)\s*$/gm;
const SEARCH_IMPORTS_RE = /^@@search_imports:\s*(.+?)\s*$/gm;
const RENAME_RE = /^@@rename:\s*(.+?)\s*\|\|\|\s*(.+?)\s*$/gm;
const TODO_RE = /^@@todo:\s*\[(\w+)\]\s*(.+?)\s*$/gm;

function normalizePath(raw: string): string {
  return raw.trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
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
  let text = (raw || '');

  text = text.replace(FILE_BLOCK_RE, (_match, lang: string, rawPath: string, content: string) => {
    const path = normalizePath(rawPath);
    if (path) {
      ops.push({ type: 'write', path, content, language: lang || undefined });
    }
    return '';
  });

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

  const replaceRequests: { path: string; search: string; replace: string }[] = [];
  text = text.replace(REPLACE_RE, (_match, rawPath: string, search: string, replace: string) => {
    const p = normalizePath(rawPath);
    if (p) replaceRequests.push({ path: p, search: search.trim(), replace: replace.trim() });
    return '';
  });

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

  return { displayText: text, ops, fileRequests, findRequests, listDirRequests, globRequests, fileInfoRequests, checkErrorsContent, contextStore, contextGet, contextList, contextClear, replaceRequests, searchImportsRequests, renameRequests, todoItems };
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
