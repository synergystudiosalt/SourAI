import { AgentFileOp } from '../types';

/**
 * Parses agent responses into structured operations and display text.
 * Preserves visible XML tags (<think>, <check_for_errors>, <subagent_request/response>)
 * while extracting file ops, tool calls, and subagent tasks.
 */

const FILE_BLOCK_RE = /```[ \t]*([\w+-]*)[ \t]*path=["']([^"'\n]+)["'][^\n]*\n([\s\S]*?)\n?```/g;
const DELETE_RE = /^@@delete:\s*(.+?)\s*$/gm;
const SUBAGENT_RE = /^@@subagent:\s*(.+?)\s*$/gm;
const READFILE_RE = /^@@readfile:\s*(.+?)\s*$/gm;
const FINDALL_RE = /^@@findall:\s*(.+?)\s*$/gm;

function normalizePath(raw: string): string {
  return raw.trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
}

export interface ParsedAgentResponse {
  displayText: string;
  ops: AgentFileOp[];
  subAgentTasks: string[];
  fileRequests: string[];
  findRequests: string[];
}

export function parseAgentResponse(raw: string): ParsedAgentResponse {
  const ops: AgentFileOp[] = [];
  const subAgentTasks: string[] = [];

  // Don't strip <think> or <check_for_errors> tags — they are visible to the user.
  // Only extract file blocks, delete markers, tool requests, and subagent directives.
  let text = (raw || '');

  text = text.replace(FILE_BLOCK_RE, (_match, lang: string, rawPath: string, content: string) => {
    const path = normalizePath(rawPath);
    if (path) {
      ops.push({ type: 'write', path, content, language: lang || undefined });
    }
    // Replace with a reference badge so the user sees operations were proposed
    return `*📄 File: ${path}*\n`;
  });

  text = text.replace(DELETE_RE, (_match, rawPath: string) => {
    const path = normalizePath(rawPath);
    if (path) ops.push({ type: 'delete', path });
    return `*🗑️ Delete: ${path}*\n`;
  });

  text = text.replace(SUBAGENT_RE, (_match, taskDescription: string) => {
    const task = taskDescription.trim();
    if (task) subAgentTasks.push(task);
    return `*🤖 Subagent: ${task}*\n`;
  });

  const fileRequests: string[] = [];
  text = text.replace(READFILE_RE, (_match, rawPath: string) => {
    const p = normalizePath(rawPath);
    if (p && !fileRequests.includes(p)) fileRequests.push(p);
    // Keep the readfile directive visible so the user sees what's being read
    return `*📖 Read: ${p}*\n`;
  });

  const findRequests: string[] = [];
  text = text.replace(FINDALL_RE, (_match, query: string) => {
    const q = query.trim();
    if (q && !findRequests.includes(q)) findRequests.push(q);
    return `*🔍 Search: ${q}*\n`;
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
