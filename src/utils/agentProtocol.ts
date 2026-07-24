import { AgentFileOp } from '../types';

/**
 * The sour.ai Agent proposes file changes as fenced code blocks annotated
 * with a `path="..."` attribute, e.g.:
 *
 * ```tsx path="src/components/Button.tsx"
 * export default function Button() { ... }
 * ```
 *
 * and deletes files via a standalone `@@delete: path/to/file.ext` line.
 * This module extracts those operations and returns the remaining prose
 * so the UI can render a clean chat message plus a list of file changes.
 */

const FILE_BLOCK_RE = /```[ \t]*([\w+-]*)[ \t]*path=["']([^"'\n]+)["'][^\n]*\n([\s\S]*?)\n?```/g;
const DELETE_RE = /^@@delete:\s*(.+?)\s*$/gm;
const SUBAGENT_RE = /^@@subagent:\s*(.+?)\s*$/gm;
const READFILE_RE = /^@@readfile:\s*(.+?)\s*$/gm;
const FINDALL_RE = /^@@findall:\s*(.+?)\s*$/gm;
const THINK_RE = /<think>([\s\S]*?)<\/think>/i;

function normalizePath(raw: string): string {
  return raw.trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
}

export interface ParsedAgentResponse {
  displayText: string;
  ops: AgentFileOp[];
  /** Sub-task descriptions the agent asked to delegate via `@@subagent:` lines. */
  subAgentTasks: string[];
  /** File paths the agent requested to read via `@@readfile:` lines. */
  fileRequests: string[];
  /** Search queries the agent requested via `@@findall:` lines. */
  findRequests: string[];
}

export function parseAgentResponse(raw: string): ParsedAgentResponse {
  const ops: AgentFileOp[] = [];
  const subAgentTasks: string[] = [];

  // <think> blocks are handled separately by the server (returned as a
  // dedicated `thinking` field), but strip any that slip through anyway.
  let text = (raw || '').replace(new RegExp(THINK_RE.source, 'gi'), '');

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

  text = text.replace(SUBAGENT_RE, (_match, taskDescription: string) => {
    const task = taskDescription.trim();
    if (task) subAgentTasks.push(task);
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

  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return { displayText: text, ops, subAgentTasks, fileRequests, findRequests };
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
