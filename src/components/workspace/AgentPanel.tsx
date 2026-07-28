import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, ChevronRight, AtSign, Check, Square, Loader2,
  ArrowLeft, Settings, Mic, MicOff, X, Image as ImageIcon, Brain, CircleHelp,
} from 'lucide-react';
import { AttachmentPopover } from '../AttachmentPopover';
import { AttachmentItem } from '../../types';
import { parseUploadedFile } from '../../utils/fileParser';
import { AgentChatMessage, AgentFileOp, AgentMode, AgentReasoningEffort, AgentToolCall, AIModel, WorkspaceFileNode } from '../../types';
import { EFFORT_ORDER, EFFORT_PROFILES, resolveEffortProfile } from '@/functions/shared/effortProfile';
import {
  collapseAgentFileOps,
  extractMentionedPaths,
  extractPathsFromCheckContent,
  parseAgentResponse,
  resolveKnownFileRequest,
  summarizeForHistory,
} from '../../utils/agentProtocol';
import { customApiManager, type CustomApiConfig } from '../../utils/customApiManager';
import { VoiceRecognizer } from '../../utils/voiceRecognition';
import { apiUrl } from '../../lib/api';
import { isAbortError, normalizeError, type SourError } from '../../contracts/errors';
import Logo from '../Logo';
import PixelBowlIcon from '../PixelBowlIcon';
import { CustomApiModal } from '../CustomApiModal';
import { AgentMessage } from '../agent/AgentMessage';
import { getClientPersistence, type ClientPersistence } from '../../storage/clientPersistence';
import {
  MAX_PROJECT_MEMORY_ENTRIES,
  normalizeProjectMemoryEntry,
  selectProjectMemory,
} from '../../agent/context/projectMemory';
import { splitThinkingAndText } from '../../../functions/shared/responseFormatting';
import { ChatRunController } from '../../agent/runtime/chatRunController';

export { AgentMarkdownImage, MiniMarkdown } from '../agent/MarkdownContent';

export function normalizeAgentProviderError(
  value: unknown,
  fallbackMessage = 'Something went wrong reaching the sour.ai Agent.'
): SourError {
  const candidate =
    value instanceof Error || (typeof value === 'string' && value.trim())
      ? value
      : fallbackMessage;
  return normalizeError(candidate, {
    code: 'agent_provider_failed',
    causeCategory: 'provider',
    message: fallbackMessage,
    retryable: true,
  });
}

/** Parses one SSE payload while ensuring a provider error never escapes raw. */
export function parseAgentStreamEvent(payload: string): Record<string, any> | null {
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const record = event as Record<string, any>;
  if (record.error) throw normalizeAgentProviderError(record.error);
  return record;
}

interface AgentPanelProps {
  isDarkMode: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  projectId: string;
  projectName: string;
  files: WorkspaceFileNode[];
  activeFile: { path: string; content: string } | null;
  onApplyOps: (ops: AgentFileOp[]) => Promise<boolean>;
  onOpenFile: (path: string) => void;
}

const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const SLASH_COMMANDS: { cmd: string; label: string; prompt: string }[] = [
  { cmd: '/explain', label: 'Explain the active file', prompt: 'Explain what the active file does, in simple terms.' },
  { cmd: '/fix', label: 'Find and fix bugs', prompt: 'Find and fix any bugs in the active file.' },
  { cmd: '/tests', label: 'Write tests', prompt: 'Write unit tests for the active file.' },
  { cmd: '/comments', label: 'Add comments', prompt: 'Add clear, helpful comments to the active file.' },
  { cmd: '/refactor', label: 'Refactor for clarity', prompt: 'Refactor the active file for readability and best practices without changing its behavior.' },
  { cmd: '/readme', label: 'Generate a README', prompt: 'Generate a README.md for this project based on the files you can see.' },
];

const MODEL_LABELS: Record<AIModel, string> = {
  'sour-omni-flash': 'Omni-Flash',
  'sour-intelligence': 'Intelligence',
  'sour-ultra': 'Ultra',
  'sour-overclock': 'Overclock',
  'sour-overcode': 'OverCode',
};

const MODEL_OPTIONS: AIModel[] = ['sour-omni-flash', 'sour-intelligence', 'sour-ultra', 'sour-overclock', 'sour-overcode'];

/**
 * Derived from the shared profiles rather than re-declared, so the slider can
 * never advertise an effort level the request layer doesn't actually apply.
 */
const REASONING_OPTIONS = EFFORT_ORDER.map((id) => EFFORT_PROFILES[id]);

export const AgentPanel: React.FC<AgentPanelProps> = ({
  isDarkMode,
  isCollapsed,
  onToggleCollapse,
  projectId,
  projectName,
  files,
  activeFile,
  onApplyOps,
  onOpenFile,
}) => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [mode, setMode] = useState<AgentMode>('write');
  const [selectedModel, setSelectedModel] = useState<AIModel>('sour-omni-flash');
  const [reasoningEffort, setReasoningEffort] = useState<AgentReasoningEffort>('standard');
  const [hydratedProjectId, setHydratedProjectId] = useState<string | null>(null);
  const persistenceRef = useRef<ClientPersistence | null>(null);
  const contextRef = useRef<Record<string, string>>({});
  const [showModelPopover, setShowModelPopover] = useState(false);
  const [showReasoningPopover, setShowReasoningPopover] = useState(false);
  const [showCustomApiModal, setShowCustomApiModal] = useState(false);
  const [customApiConfigs, setCustomApiConfigs] = useState<CustomApiConfig[]>(customApiManager.getConfigs());
  const [isListening, setIsListening] = useState(false);
  const [mentionState, setMentionState] = useState<{ query: string; start: number } | null>(null);
  const [showSlash, setShowSlash] = useState(false);
  const [openXmlTags, setOpenXmlTags] = useState<Set<string>>(new Set());
  const [openToolCalls, setOpenToolCalls] = useState<Set<string>>(new Set());
  const [todoItems, setTodoItems] = useState<{ id: string; text: string; priority: string; done: boolean }[]>([]);

  // Context usage calculation — excludes input to avoid dip after sending
  const MAX_CONTEXT_CHARS = 128000;
  const contextUsage = useMemo(() => {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += (msg.content || '').length;
      if (msg.thinking) totalChars += msg.thinking.length;
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.type === 'readfile') totalChars += 200;
          if (tc.type === 'findall') totalChars += (tc.matches?.length || 0) * 80;
        }
      }
    }
    return Math.min(100, Math.round((totalChars / MAX_CONTEXT_CHARS) * 100));
  }, [messages]);

  const [showAttachmentPopover, setShowAttachmentPopover] = useState(false);
  const [agentAttachments, setAgentAttachments] = useState<AttachmentItem[]>([]);
  const attachmentPopoverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPopoverRef = useRef<HTMLDivElement>(null);
  const reasoningPopoverRef = useRef<HTMLDivElement>(null);
  const voiceRecognizerRef = useRef<VoiceRecognizer | null>(null);
  // Messages generated during this mount get a typewriter effect; messages
  // restored from localStorage on load render instantly.
  const freshMessageIdsRef = useRef<Set<string>>(new Set());
  // Initialize voice recognizer on mount
  useEffect(() => {
    voiceRecognizerRef.current = new VoiceRecognizer({
      onTranscript: (transcript, isFinal) => {
        setInput((prev) => {
          const newInput = prev + transcript;
          return newInput;
        });
        if (isFinal) {
          setIsListening(false);
        }
      },
      onError: (error) => {
        console.error('Voice recognition error:', error);
        setIsListening(false);
      },
      onStart: () => setIsListening(true),
      onEnd: () => setIsListening(false),
    });
  }, []);

  const handleVoiceToggle = () => {
    if (!voiceRecognizerRef.current) return;

    if (isListening) {
      voiceRecognizerRef.current.stop();
      setIsListening(false);
    } else {
      if (!voiceRecognizerRef.current.isSupported()) {
        alert('Speech recognition is not supported in your browser');
        return;
      }
      voiceRecognizerRef.current.start();
    }
  };

  /*
   * Removed: auto-detection of @@ tool calls from the prompt wording.
   *
   * It matched action words (read/check/show/find/…) and then took a "path"
   * from prose with /file\s+([\w.\/-]+)/, so ordinary English became tool
   * calls the user never wrote — "produce runnable file contents" injected
   * `@@readfile: contents`, "the project file list" injected
   * `@@readfile: list`. The fabricated read then failed, and the agent
   * reported it could not find the file instead of doing the task. Asking to
   * build something new was especially prone to it, because such prompts
   * describe files rather than name them.
   *
   * The model has these tools and decides when to call them; a keyword match
   * cannot tell "read src/App.tsx" from "produce runnable file contents".
   */

  useEffect(() => {
    let cancelled = false;
    setHydratedProjectId(null);
    setMessages([]);
    contextRef.current = {};
    void getClientPersistence()
      .then(async (persistence) => {
        persistenceRef.current = persistence;
        const [storedMessages, storedMode, storedModel, storedReasoning, storedContext] = await Promise.all([
          persistence.loadAgentMessages(projectId),
          persistence.settings.getValue<string>('agent.mode'),
          persistence.settings.getValue<string>('agent.model'),
          persistence.settings.getValue<string>('agent.reasoningEffort'),
          persistence.loadContext(projectId, projectName),
        ]);
        if (cancelled) return;
        // Do not erase a prompt submitted while durable state was still loading.
        setMessages((current) => (current.length > 0 ? current : storedMessages));
        if (storedMode === 'write' || storedMode === 'plan') setMode(storedMode);
        if (storedModel && MODEL_OPTIONS.includes(storedModel as AIModel)) {
          setSelectedModel(storedModel as AIModel);
        }
        if (REASONING_OPTIONS.some((option) => option.id === storedReasoning)) {
          setReasoningEffort(storedReasoning as AgentReasoningEffort);
        }
        contextRef.current = Object.fromEntries(
          Object.entries(storedContext)
            .map(([key, value]) => normalizeProjectMemoryEntry(key, value))
            .filter((entry): entry is { key: string; value: string } => Boolean(entry))
            .map((entry) => [entry.key, entry.value])
        );
        setHydratedProjectId(projectId);
      })
      .catch((error) => {
        if (!cancelled) console.error('[sour.ai] Could not hydrate agent storage', error);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectName]);

  useEffect(() => {
    if (hydratedProjectId !== projectId || !persistenceRef.current) return;
    const timer = window.setTimeout(() => {
      void persistenceRef.current
        ?.saveAgentMessages(projectId, projectName, messages)
        .catch((error) => console.error('[sour.ai] Could not persist agent thread', error));
    }, 100);
    return () => window.clearTimeout(timer);
  }, [hydratedProjectId, messages, projectId, projectName]);

  useEffect(() => {
    if (!hydratedProjectId) return;
    void persistenceRef.current?.settings.set('agent.mode', 'agent', mode);
  }, [hydratedProjectId, mode]);

  useEffect(() => {
    if (!hydratedProjectId) return;
    void persistenceRef.current?.settings.set('agent.model', 'agent', selectedModel);
  }, [hydratedProjectId, selectedModel]);

  useEffect(() => {
    if (!hydratedProjectId) return;
    void persistenceRef.current?.settings.set('agent.reasoningEffort', 'agent', reasoningEffort);
  }, [hydratedProjectId, reasoningEffort]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isSending]);

  useEffect(() => {
    if (!showModelPopover) return;
    const onPointerDown = (e: MouseEvent) => {
      if (modelPopoverRef.current && !modelPopoverRef.current.contains(e.target as Node)) {
        setShowModelPopover(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [showModelPopover]);

  useEffect(() => {
    if (!showReasoningPopover) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        reasoningPopoverRef.current &&
        !reasoningPopoverRef.current.contains(event.target as Node)
      ) {
        setShowReasoningPopover(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [showReasoningPopover]);

  useEffect(() => {
    if (!showAttachmentPopover) return;
    const onPointerDown = (e: MouseEvent) => {
      if (attachmentPopoverRef.current && !attachmentPopoverRef.current.contains(e.target as Node)) {
        setShowAttachmentPopover(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [showAttachmentPopover]);

  const mentionMatches = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query;
    const list = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
    return list.slice(0, 6);
  }, [mentionState, files]);

  const markApplied = (messageId: string, paths: string[]) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              appliedPaths: Array.from(new Set([...(m.appliedPaths || []), ...paths])),
              codingPaths: (m.codingPaths || []).filter((p) => !paths.includes(p)),
              approvalStatus: 'applied',
            }
          : m
      )
    );
  };

  const handleApplyAll = async (messageId: string, ops: AgentFileOp[]) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, approvalStatus: 'applying' } : message
      )
    );
    if (await onApplyOps(ops)) {
      markApplied(messageId, ops.map((o) => o.path));
    } else {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, approvalStatus: 'failed' } : message
        )
      );
    }
  };

  const handleRejectAll = (messageId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? { ...message, approvalStatus: 'rejected', codingPaths: [] }
          : message
      )
    );
  };

  const toggleXmlTag = (tagId: string) => {
    setOpenXmlTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const toggleToolCalls = (messageId: string) => {
    setOpenToolCalls((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  /** Resolves @@readfile: requests — reads files from the workspace tree. */
  const resolveFileRequests = (
    paths: string[]
  ): { toolCalls: AgentToolCall[]; resultText: string } => {
    const toolCalls: AgentToolCall[] = [];
    const parts: string[] = [];
    const knownFilePaths = files.filter((file) => file.type === 'file').map((file) => file.path);
    for (const requestedPath of paths) {
      const p = resolveKnownFileRequest(requestedPath, knownFilePaths) ?? requestedPath;
      const node = files.find((f) => f.path === p);
      if (node && node.content !== undefined) {
        toolCalls.push({ type: 'readfile', path: p, found: true });
        parts.push(`[File read: ${p}]\n\`\`\`\n${node.content.slice(0, 6000)}\n\`\`\``);
      } else {
        toolCalls.push({ type: 'readfile', path: p, found: false });
        parts.push(
          `[File not found: ${p}]\nThe runtime did not read anything. Choose an exact path from the supplied Project Files list; do not guess filenames.`
        );
      }
    }
    return { toolCalls, resultText: parts.join('\n\n') };
  };

  /** Resolves @@findall: requests — searches every loaded file for a query. */
  const resolveFindRequests = (
    queries: string[]
  ): { toolCalls: AgentToolCall[]; resultText: string } => {
    const toolCalls: AgentToolCall[] = [];
    const parts: string[] = [];
    for (const query of queries) {
      const matches: { path: string; line: number; text: string }[] = [];
      for (const file of files) {
        if (file.type !== 'file' || file.content === undefined) continue;
        const lines = file.content.split('\n');
        lines.forEach((lineText, idx) => {
          try {
            const hit = new RegExp(query, 'i').test(lineText);
            if (hit) matches.push({ path: file.path, line: idx + 1, text: lineText.trim().slice(0, 120) });
          } catch {
            if (lineText.toLowerCase().includes(query.toLowerCase()))
              matches.push({ path: file.path, line: idx + 1, text: lineText.trim().slice(0, 120) });
          }
        });
      }
      const limited = matches.slice(0, 60);
      const fileSet = new Set(limited.map((m) => m.path));
      toolCalls.push({ type: 'findall', query, matchCount: matches.length, fileCount: fileSet.size, matches: limited });
      if (matches.length === 0) {
        parts.push(`[Search: "${query}"]\nNo matches found across ${files.length} files.`);
      } else {
        const resultLines = [`[Search results for "${query}"] (${matches.length} match${matches.length !== 1 ? 'es' : ''} in ${fileSet.size} file${fileSet.size !== 1 ? 's' : ''}):`];
        for (const m of limited) resultLines.push(`${m.path}:${m.line}: ${m.text}`);
        if (matches.length > 60) resultLines.push(`...and ${matches.length - 60} more matches (truncated).`);
        parts.push(resultLines.join('\n'));
      }
    }
    return { toolCalls, resultText: parts.join('\n\n') };
  };

  /** Resolves @@listdir: requests — lists directory contents from the workspace tree. */
  const resolveListDirRequests = (
    paths: string[]
  ): { toolCalls: AgentToolCall[]; resultText: string } => {
    const toolCalls: AgentToolCall[] = [];
    const parts: string[] = [];
    for (const p of paths) {
      // Models write the project root as ".", "./" or "/". Treated literally
      // these produce a prefix no stored path starts with, so the root reads
      // back as empty and the agent concludes there is nothing to work with.
      const normalized = p.trim().replace(/^\.$/, '').replace(/^\.\//, '').replace(/^\/+/, '');
      const prefix = normalized ? normalized.replace(/\/$/, '') + '/' : '';
      const children = files
        .filter((f) => f.path.startsWith(prefix) && f.path !== prefix)
        .map((f) => {
          const rel = f.path.slice(prefix.length);
          const depth = rel.split('/').length - 1;
          const name = rel.split('/')[0];
          return f.type === 'folder' ? `${name}/` : name;
        });
      const unique = [...new Set(children)].sort((a, b) => {
        if (a.endsWith('/') && !b.endsWith('/')) return -1;
        if (!a.endsWith('/') && b.endsWith('/')) return 1;
        return a.localeCompare(b);
      });
      toolCalls.push({ type: 'listdir', path: p || '/', entries: unique });
      if (unique.length === 0) {
        parts.push(`[Directory: ${p || '/'}]\n(empty or not found)`);
      } else {
        parts.push(`[Directory: ${p || '/'}]\n${unique.join('\n')}`);
      }
    }
    return { toolCalls, resultText: parts.join('\n\n') };
  };

  /** Resolves @@glob: requests — finds files matching a glob pattern. */
  const resolveGlobRequests = (
    patterns: string[]
  ): { toolCalls: AgentToolCall[]; resultText: string } => {
    const toolCalls: AgentToolCall[] = [];
    const parts: string[] = [];
    for (const pattern of patterns) {
      const re = new RegExp(
        '^' +
        pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '{{GLOBSTAR}}')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]')
          .replace(/\{\{GLOBSTAR\}\}/g, '.*')
        + '$', 'i'
      );
      const matches = files
        .filter((f) => f.type === 'file' && re.test(f.path))
        .map((f) => f.path)
        .sort();
      toolCalls.push({ type: 'glob', pattern, matchCount: matches.length, matches });
      if (matches.length === 0) {
        parts.push(`[Glob: ${pattern}]\nNo files matched.`);
      } else {
        parts.push(`[Glob: ${pattern}] (${matches.length} files)\n${matches.join('\n')}`);
      }
    }
    return { toolCalls, resultText: parts.join('\n\n') };
  };

  /** Resolves @@fileinfo: requests — shows file metadata. */
  const resolveFileInfoRequests = (
    paths: string[]
  ): { toolCalls: AgentToolCall[]; resultText: string } => {
    const parts: string[] = [];
    for (const p of paths) {
      const node = files.find((f) => f.path === p);
      if (node && node.content !== undefined) {
        const lines = node.content.split('\n').length;
        const bytes = new TextEncoder().encode(node.content).length;
        const size = bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          : bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB`
          : `${bytes} B`;
        const ext = p.split('.').pop() || '';
        parts.push(`[File info: ${p}]\nLanguage: ${ext || 'unknown'}\nLines: ${lines}\nSize: ${size}`);
      } else {
        parts.push(`[File info: ${p}]\nFile not found`);
      }
    }
    return { toolCalls: [], resultText: parts.join('\n\n') };
  };

  /** Resolves @@context_store: key = value — stores context in persistent memory. */
  const resolveContextStore = async (
    entries: { key: string; value: string }[]
  ): Promise<string> => {
    const stored: string[] = [];
    const refused: string[] = [];
    for (const candidate of entries) {
      const entry = normalizeProjectMemoryEntry(candidate.key, candidate.value);
      if (!entry) {
        refused.push(candidate.key);
        continue;
      }
      const isNew = contextRef.current[entry.key] === undefined;
      if (isNew && Object.keys(contextRef.current).length >= MAX_PROJECT_MEMORY_ENTRIES) {
        refused.push(entry.key);
        continue;
      }
      await persistenceRef.current?.setContext(projectId, entry.key, entry.value);
      contextRef.current[entry.key] = entry.value;
      stored.push(entry.key);
    }
    return [
      ...stored.map((key) => `[Context stored: "${key}"]`),
      ...refused.map((key) => `[Context not stored: "${key}" — invalid or memory is full]`),
    ].join('\n');
  };

  /** Resolves @@context_get: key — retrieves stored context. */
  const resolveContextGet = (keys: string[]): string => {
    const parts: string[] = [];
    for (const k of keys) {
      const val = contextRef.current[k];
      parts.push(val !== undefined
        ? `[Context: "${k}"]\n${val}`
        : `[Context: "${k}"]\nNot found.`);
    }
    return parts.join('\n\n');
  };

  /** Resolves @@context_list — shows all stored context keys. */
  const resolveContextList = (): string => {
    const all = contextRef.current;
    const keys = Object.keys(all);
    if (keys.length === 0) return '[Context store is empty]';
    return `[Stored context keys (${keys.length})]:\n${keys.map(k => `- ${k}`).join('\n')}`;
  };

  /** Resolves @@context_clear: key — removes a context entry. */
  const resolveContextClear = async (keys: string[]): Promise<string> => {
    for (const k of keys) {
      delete contextRef.current[k];
      await persistenceRef.current?.removeContext(projectId, k);
    }
    return keys.map(k => `[Context cleared: "${k}"]`).join('\n');
  };

  /** Resolves @@todo: [priority] task — manages the in-session todo list. */
  const resolveTodo = (items: { action: 'add' | 'done' | 'remove'; priority: string; text: string }[]): string => {
    if (items.length === 0) return '';
    setTodoItems((prev) => {
      let next = [...prev];
      for (const item of items) {
        if (item.action === 'add') {
          const id = `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          next.push({ id, text: item.text, priority: item.priority, done: false });
        } else if (item.action === 'done') {
          const match = next.find(t => t.text.toLowerCase() === item.text.toLowerCase() && !t.done);
          if (match) match.done = true;
        } else if (item.action === 'remove') {
          next = next.filter(t => t.text.toLowerCase() !== item.text.toLowerCase());
        }
      }
      return next;
    });
    return `[Todo updated — ${items.length} item(s)]`;
  };

  /** Resolves @@replace: path ||| search ||| replace — surgical in-file edit. */
  const resolveReplaceRequests = (
    requests: { path: string; search: string; replace: string }[]
  ): { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } => {
    const toolCalls: AgentToolCall[] = [];
    const ops: AgentFileOp[] = [];
    const parts: string[] = [];
    for (const { path, search, replace } of requests) {
      const node = files.find((f) => f.path === path);
      if (!node || node.content === undefined) {
        toolCalls.push({ type: 'replace', path, search, replace, found: false, applied: false });
        parts.push(`[Replace in ${path}]\nFile not found.`);
        continue;
      }
      if (!node.content.includes(search)) {
        toolCalls.push({ type: 'replace', path, search, replace, found: true, applied: false });
        parts.push(`[Replace in ${path}]\nSearch string not found in file. The exact text must match.`);
        continue;
      }
      const newContent = node.content.replace(search, replace);
      const lang = path.split('.').pop() || '';
      ops.push({ type: 'write', path, content: newContent, language: lang });
      toolCalls.push({ type: 'replace', path, search, replace, found: true, applied: true });
      parts.push(`[Replace in ${path}]\nReplaced ${search.length} chars → ${replace.length} chars.`);
    }
    return { toolCalls, ops, resultText: parts.join('\n\n') };
  };

  /** Resolves @@search_imports: symbol — finds all imports/usages across loaded files. */
  const resolveSearchImportsRequests = (
    symbols: string[]
  ): { toolCalls: AgentToolCall[]; resultText: string } => {
    const toolCalls: AgentToolCall[] = [];
    const parts: string[] = [];
    for (const symbol of symbols) {
      const matches: { path: string; line: number; text: string }[] = [];
      for (const file of files) {
        if (file.type !== 'file' || file.content === undefined) continue;
        const lines = file.content.split('\n');
        lines.forEach((lineText, idx) => {
          if (lineText.includes(symbol)) {
            matches.push({ path: file.path, line: idx + 1, text: lineText.trim().slice(0, 120) });
          }
        });
      }
      const limited = matches.slice(0, 80);
      const fileSet = new Set(limited.map((m) => m.path));
      toolCalls.push({ type: 'search_imports', symbol, matchCount: matches.length, matches: limited });
      if (matches.length === 0) {
        parts.push(`[Search imports: "${symbol}"]\nNo usages found across ${files.length} files.`);
      } else {
        const resultLines = [`[Usages of "${symbol}"] (${matches.length} match${matches.length !== 1 ? 'es' : ''} in ${fileSet.size} file${fileSet.size !== 1 ? 's' : ''}):`];
        for (const m of limited) resultLines.push(`${m.path}:${m.line}: ${m.text}`);
        if (matches.length > 80) resultLines.push(`...and ${matches.length - 80} more matches (truncated).`);
        parts.push(resultLines.join('\n'));
      }
    }
    return { toolCalls, resultText: parts.join('\n\n') };
  };

  /** Resolves @@rename: oldPath ||| newPath — produces delete + write ops. */
  const resolveRenameRequests = (
    requests: { oldPath: string; newPath: string }[]
  ): { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } => {
    const toolCalls: AgentToolCall[] = [];
    const ops: AgentFileOp[] = [];
    const parts: string[] = [];
    for (const { oldPath, newPath } of requests) {
      const node = files.find((f) => f.path === oldPath);
      if (!node || node.content === undefined) {
        toolCalls.push({ type: 'rename', oldPath, newPath });
        parts.push(`[Rename ${oldPath} → ${newPath}]\nSource file not found.`);
        continue;
      }
      const lang = newPath.split('.').pop() || '';
      ops.push({ type: 'write', path: newPath, content: node.content, language: lang });
      ops.push({ type: 'delete', path: oldPath });
      toolCalls.push({ type: 'rename', oldPath, newPath });
      parts.push(`[Rename ${oldPath} → ${newPath}]\nFile moved successfully.`);
    }
    return { toolCalls, ops, resultText: parts.join('\n\n') };
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isSending) return;
    setInput('');
    setShowSlash(false);
    setMentionState(null);
    setShowAttachmentPopover(false);

    // The prompt is sent exactly as written. Tool calls are the model's to
    // make; guessing them from the wording here injected reads the user never
    // asked for (see the note on the removed auto-detection helper).
    const promptToSend = text;

    const userMsg: AgentChatMessage = { id: genId(), role: 'user', content: text, createdAt: Date.now() };
    const historyBase = [...messages, userMsg];
    setMessages(historyBase);
    setIsSending(true);

    // Effort decides how much of the project is worth sending, not just how
    // long the agent may run.
    const effort = resolveEffortProfile(reasoningEffort);

    const knownPaths = files.map((f) => f.path);
    const mentionPaths = extractMentionedPaths(text, knownPaths);
    const mentionedFiles = mentionPaths
      .map((p) => files.find((f) => f.path === p))
      .filter((f): f is WorkspaceFileNode => Boolean(f))
      .map((f) => ({ path: f.path, content: (f.content || '').slice(0, effort.context.mentionedFileChars) }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const maxAgentTurns = effort.maxTurns;
      const basePayload = {
        model: selectedModel,
        mode,
        reasoningEffort,
        activeFile: activeFile
          ? { path: activeFile.path, content: activeFile.content.slice(0, effort.context.activeFileChars) }
          : null,
        projectFiles: knownPaths.slice(0, effort.context.maxProjectFiles),
        mentionedFiles,
        projectMemory: selectProjectMemory(contextRef.current, text),
      };

      // ── Agent loop: send prompt, resolve tools, repeat until no more tool calls ──
      // History depth scales with effort so higher tiers keep more of the thread.
      let conversationHistory: { role: 'user' | 'assistant'; content: string }[] =
        historyBase.slice(-effort.context.historyMessages).map((m) => ({
          role: m.role,
          content: m.role === 'assistant' ? summarizeForHistory(m.content, m.ops) : m.content,
        }));
      // Update the last user message with auto-called functions
      if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
        conversationHistory[conversationHistory.length - 1].content = promptToSend;
      }

      const msgId = genId();
      let accumulatedThinking = '';
      let accumulatedThinkingLabel = '';
      let allOps: AgentFileOp[] = [];
      let allToolCalls: AgentToolCall[] = [];
      let finalDisplayText = '';
      let turnCount = 0;
      let hasMoreTools = true;
      const runController = new ChatRunController();
      const appendThinking = (value: string | undefined) => {
        const next = value?.trim();
        if (!next || accumulatedThinking.includes(next)) return;
        accumulatedThinking = accumulatedThinking ? `${accumulatedThinking}\n\n${next}` : next;
      };

      // Create the message placeholder immediately
      const assistantMsg: AgentChatMessage = {
        id: msgId,
        role: 'assistant',
        content: '',
        ops: [],
        appliedPaths: [],
        codingPaths: [],
        thinking: '',
        thinkingLabel: '',
        toolCalls: [],
        isReadingFiles: true,
        createdAt: Date.now(),
      };
      freshMessageIdsRef.current.add(msgId);
      setMessages((prev) => [...prev, assistantMsg]);

      while (hasMoreTools && turnCount < maxAgentTurns) {
        turnCount++;
        hasMoreTools = false;

        // Use streaming for the first turn, non-streaming for tool-result turns
        if (turnCount === 1) {
          const res = await fetch(apiUrl('/api/agent'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...basePayload,
              messages: conversationHistory,
              attachments: agentAttachments,
              stream: true,
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw normalizeAgentProviderError(errData?.error, 'The agent failed to respond.');
          }

          // Read SSE stream
          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let streamBuffer = '';
          let streamText = '';

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              streamBuffer += decoder.decode(value, { stream: true });
              const lines = streamBuffer.split('\n');
              streamBuffer = lines.pop() || '';
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                const event = parseAgentStreamEvent(trimmed.slice(6));
                if (!event) continue;
                try {
                  if (event.token) {
                    streamText += event.token;
                    const { thinking: liveThinking } = splitThinkingAndText(streamText);
                    appendThinking(liveThinking);
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === msgId
                          ? { ...m, content: '', thinking: accumulatedThinking }
                          : m
                      )
                    );
                  }
                  if (event.done) {
                    const responseText = event.text || streamText;
                    const separatedResponse = splitThinkingAndText(responseText);
                    appendThinking(event.thinking);
                    appendThinking(separatedResponse.thinking);
                    accumulatedThinkingLabel = event.thinkingLabel || accumulatedThinkingLabel;
                    const filteredRequests = runController.filter(
                      parseAgentResponse(separatedResponse.text)
                    );
                    const finalParsed = filteredRequests.response;
                    finalDisplayText = finalParsed.displayText;
                    allOps = [...allOps, ...finalParsed.ops];

                    const hasToolCalls = finalParsed.fileRequests.length > 0 || finalParsed.findRequests.length > 0
                      || finalParsed.listDirRequests.length > 0 || finalParsed.globRequests.length > 0 || finalParsed.fileInfoRequests.length > 0
                      || finalParsed.replaceRequests.length > 0 || finalParsed.searchImportsRequests.length > 0 || finalParsed.renameRequests.length > 0;
                    const hasCheckErrors = finalParsed.checkErrorsContent.length > 0;
                    const hasContextOps = finalParsed.contextStore.length > 0 || finalParsed.contextGet.length > 0 || finalParsed.contextList || finalParsed.contextClear.length > 0;
                    const hasTodoOps = finalParsed.todoItems.length > 0;

                    if (hasToolCalls || hasCheckErrors || hasContextOps || hasTodoOps) {
                      appendThinking(finalParsed.displayText);
                      finalDisplayText = '';
                      // Resolve all tool types
                      const { toolCalls: readCalls, resultText: readText } = resolveFileRequests(finalParsed.fileRequests);
                      const { toolCalls: findCalls, resultText: findText } = resolveFindRequests(finalParsed.findRequests);
                      const { toolCalls: listDirCalls, resultText: listDirText } = resolveListDirRequests(finalParsed.listDirRequests);
                      const { toolCalls: globCalls, resultText: globText } = resolveGlobRequests(finalParsed.globRequests);
                      const { resultText: fileInfoText } = resolveFileInfoRequests(finalParsed.fileInfoRequests);
                      const turnToolCalls = [...readCalls, ...findCalls, ...listDirCalls, ...globCalls];

                      const checkResultParts: string[] = [];
                      for (const content of finalParsed.checkErrorsContent) {
                        const paths = extractPathsFromCheckContent(content);
                        if (paths.length === 0) {
                          const recentPaths = allOps.filter(o => o.type === 'write').map(o => o.path);
                          for (const p of recentPaths) {
                            if (!paths.includes(p)) paths.push(p);
                          }
                        }
                        const { toolCalls: checkCalls, resultText: checkText } = resolveFileRequests(paths);
                        turnToolCalls.push(...checkCalls);
              checkResultParts.push(`[DIAGNOSTIC — check_for_errors result for: ${content}]\n${checkText}\n\nReview the above file content. If you find any bugs, type errors, missing imports, or logic issues, output corrected file blocks to fix them. If everything looks correct, confirm with a brief message.`);
                      }

                      allToolCalls = [...allToolCalls, ...turnToolCalls];

                      // Resolve context operations
                      const contextResultParts: string[] = [];
                      if (finalParsed.contextStore.length > 0) contextResultParts.push(await resolveContextStore(finalParsed.contextStore));
                      if (finalParsed.contextGet.length > 0) contextResultParts.push(resolveContextGet(finalParsed.contextGet));
                      if (finalParsed.contextList) contextResultParts.push(resolveContextList());
                      if (finalParsed.contextClear.length > 0) contextResultParts.push(await resolveContextClear(finalParsed.contextClear));

                      // Resolve todo operations
                      const todoResultText = finalParsed.todoItems.length > 0 ? resolveTodo(finalParsed.todoItems) : '';

                      // Resolve replace / search_imports / rename
                      const replaceResult: { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } = finalParsed.replaceRequests.length > 0
                        ? resolveReplaceRequests(finalParsed.replaceRequests) : { toolCalls: [], ops: [], resultText: '' };
                      const importsResult: { toolCalls: AgentToolCall[]; resultText: string } = finalParsed.searchImportsRequests.length > 0
                        ? resolveSearchImportsRequests(finalParsed.searchImportsRequests) : { toolCalls: [], resultText: '' };
                      const renameResult: { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } = finalParsed.renameRequests.length > 0
                        ? resolveRenameRequests(finalParsed.renameRequests) : { toolCalls: [], ops: [], resultText: '' };
                      turnToolCalls.push(...replaceResult.toolCalls, ...importsResult.toolCalls, ...renameResult.toolCalls);
                      allOps = [...allOps, ...replaceResult.ops, ...renameResult.ops];

                      const duplicateNotice = filteredRequests.repeatedRequestCount > 0
                        ? `[Runtime: skipped ${filteredRequests.repeatedRequestCount} duplicate tool request(s). Do not request them again; continue from the results already provided.]`
                        : '';
                      const resultText = [readText, findText, listDirText, globText, fileInfoText, replaceResult.resultText, importsResult.resultText, renameResult.resultText, todoResultText, ...checkResultParts, ...contextResultParts, duplicateNotice].filter(Boolean).join('\n\n');

                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === msgId
                            ? { ...m, toolCalls: allToolCalls, thinking: accumulatedThinking, thinkingLabel: accumulatedThinkingLabel }
                            : m
                        )
                      );

                      conversationHistory = [
                        ...conversationHistory,
                        { role: 'assistant', content: responseText },
                        { role: 'user', content: resultText },
                      ];
                      hasMoreTools = true;
                    } else if (filteredRequests.repeatedRequestCount > 0) {
                      const recovery = runController.consumeRecovery(
                        filteredRequests.repeatedRequestCount,
                        turnCount,
                        maxAgentTurns
                      );
                      if (recovery) {
                        conversationHistory = [
                          ...conversationHistory,
                          { role: 'assistant', content: responseText },
                          { role: 'user', content: recovery },
                        ];
                        finalDisplayText = '';
                        hasMoreTools = true;
                      }
                    }
                    if (!hasMoreTools) {
                      const continuation = runController.consumeIncomplete(
                        Boolean(separatedResponse.thinking),
                        finalDisplayText,
                        finalParsed.ops.length,
                        turnCount,
                        maxAgentTurns
                      );
                      if (continuation) {
                        conversationHistory = [
                          ...conversationHistory,
                          { role: 'assistant', content: responseText },
                          { role: 'user', content: continuation },
                        ];
                        finalDisplayText = '';
                        hasMoreTools = true;
                      }
                    }
                  }
                } catch { /* skip malformed lines */ }
              }
            }
          }
        } else {
          // Non-streaming for tool-result turns (faster)
          const res = await fetch(apiUrl('/api/agent'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...basePayload,
              messages: conversationHistory,
              attachments: agentAttachments,
              stream: false,
            }),
            signal: controller.signal,
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw normalizeAgentProviderError(data?.error, 'The agent failed to respond.');

          const responseText = data.text || '';
          const separatedResponse = splitThinkingAndText(responseText);
          const filteredRequests = runController.filter(
            parseAgentResponse(separatedResponse.text)
          );
          const parsed = filteredRequests.response;

          appendThinking(data.thinking);
          appendThinking(separatedResponse.thinking);
          if (data.thinkingLabel) accumulatedThinkingLabel = data.thinkingLabel;

          const hasToolCalls = parsed.fileRequests.length > 0 || parsed.findRequests.length > 0
            || parsed.listDirRequests.length > 0 || parsed.globRequests.length > 0 || parsed.fileInfoRequests.length > 0
            || parsed.replaceRequests.length > 0 || parsed.searchImportsRequests.length > 0 || parsed.renameRequests.length > 0;
          const hasCheckErrors = parsed.checkErrorsContent.length > 0;
          const hasContextOps = parsed.contextStore.length > 0 || parsed.contextGet.length > 0 || parsed.contextList || parsed.contextClear.length > 0;
          const hasTodoOps = parsed.todoItems.length > 0;

          if (hasToolCalls || hasCheckErrors || hasContextOps || hasTodoOps) {
            appendThinking(parsed.displayText);
            finalDisplayText = '';
            const { toolCalls: readCalls, resultText: readText } = resolveFileRequests(parsed.fileRequests);
            const { toolCalls: findCalls, resultText: findText } = resolveFindRequests(parsed.findRequests);
            const { toolCalls: listDirCalls, resultText: listDirText } = resolveListDirRequests(parsed.listDirRequests);
            const { toolCalls: globCalls, resultText: globText } = resolveGlobRequests(parsed.globRequests);
            const { resultText: fileInfoText } = resolveFileInfoRequests(parsed.fileInfoRequests);
            const turnToolCalls = [...readCalls, ...findCalls, ...listDirCalls, ...globCalls];

            const checkResultParts: string[] = [];
            for (const content of parsed.checkErrorsContent) {
              const paths = extractPathsFromCheckContent(content);
              if (paths.length === 0) {
                const recentPaths = allOps.filter(o => o.type === 'write').map(o => o.path);
                for (const p of recentPaths) {
                  if (!paths.includes(p)) paths.push(p);
                }
              }
              const { toolCalls: checkCalls, resultText: checkText } = resolveFileRequests(paths);
              turnToolCalls.push(...checkCalls);
              checkResultParts.push(`[DIAGNOSTIC — check_for_errors result for: ${content}]\n${checkText}\n\nReview the above file content. If you find any bugs, type errors, missing imports, or logic issues, output corrected file blocks to fix them. If everything looks correct, confirm with a brief message.`);
            }

            allToolCalls = [...allToolCalls, ...turnToolCalls];

            // Resolve context operations
            const contextResultParts: string[] = [];
            if (parsed.contextStore.length > 0) contextResultParts.push(await resolveContextStore(parsed.contextStore));
            if (parsed.contextGet.length > 0) contextResultParts.push(resolveContextGet(parsed.contextGet));
            if (parsed.contextList) contextResultParts.push(resolveContextList());
            if (parsed.contextClear.length > 0) contextResultParts.push(await resolveContextClear(parsed.contextClear));

            // Resolve todo operations
            const todoResultText = parsed.todoItems.length > 0 ? resolveTodo(parsed.todoItems) : '';

            // Resolve replace / search_imports / rename
            const replaceResult: { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } = parsed.replaceRequests.length > 0
              ? resolveReplaceRequests(parsed.replaceRequests) : { toolCalls: [], ops: [], resultText: '' };
            const importsResult: { toolCalls: AgentToolCall[]; resultText: string } = parsed.searchImportsRequests.length > 0
              ? resolveSearchImportsRequests(parsed.searchImportsRequests) : { toolCalls: [], resultText: '' };
            const renameResult: { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } = parsed.renameRequests.length > 0
              ? resolveRenameRequests(parsed.renameRequests) : { toolCalls: [], ops: [], resultText: '' };
            turnToolCalls.push(...replaceResult.toolCalls, ...importsResult.toolCalls, ...renameResult.toolCalls);
            allOps = [...allOps, ...replaceResult.ops, ...renameResult.ops];

            const duplicateNotice = filteredRequests.repeatedRequestCount > 0
              ? `[Runtime: skipped ${filteredRequests.repeatedRequestCount} duplicate tool request(s). Do not request them again; continue from the results already provided.]`
              : '';
            const resultText = [readText, findText, listDirText, globText, fileInfoText, replaceResult.resultText, importsResult.resultText, renameResult.resultText, todoResultText, ...checkResultParts, ...contextResultParts, duplicateNotice].filter(Boolean).join('\n\n');

            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, toolCalls: allToolCalls, thinking: accumulatedThinking, thinkingLabel: accumulatedThinkingLabel }
                  : m
              )
            );

            conversationHistory = [
              ...conversationHistory,
              { role: 'assistant', content: responseText },
              { role: 'user', content: resultText },
            ];
            hasMoreTools = true;
          } else {
            finalDisplayText = parsed.displayText;
            if (filteredRequests.repeatedRequestCount > 0) {
              const recovery = runController.consumeRecovery(
                filteredRequests.repeatedRequestCount,
                turnCount,
                maxAgentTurns
              );
              if (recovery) {
                conversationHistory = [
                  ...conversationHistory,
                  { role: 'assistant', content: responseText },
                  { role: 'user', content: recovery },
                ];
                finalDisplayText = '';
                hasMoreTools = true;
              }
            }
            allOps = [...allOps, ...parsed.ops];
            if (!hasMoreTools) {
              const continuation = runController.consumeIncomplete(
                Boolean(separatedResponse.thinking),
                finalDisplayText,
                parsed.ops.length,
                turnCount,
                maxAgentTurns
              );
              if (continuation) {
                conversationHistory = [
                  ...conversationHistory,
                  { role: 'assistant', content: responseText },
                  { role: 'user', content: continuation },
                ];
                finalDisplayText = '';
                hasMoreTools = true;
              }
            }
          }
        }
      }

      finalDisplayText = runController.finalText(
        finalDisplayText,
        allOps.length,
        hasMoreTools && turnCount >= maxAgentTurns
      );

      // Enrich ops with original content and diff info for highlighting
      const enrichedOps = collapseAgentFileOps(allOps).map((op) => {
        if (op.type !== 'write' || !op.content) return op;
        const existing = files.find((f) => f.path === op.path);
        const original = existing?.content || '';
        const oldLines = original.split('\n');
        const newLines = op.content.split('\n');
        const added: number[] = [];
        const removed: { index: number; text: string }[] = [];
        // Simple line-by-line diff: find lines in new that aren't in old, and lines in old not in new
        const oldSet = new Set(oldLines);
        const newSet = new Set(newLines);
        newLines.forEach((line, i) => { if (!oldSet.has(line)) added.push(i); });
        oldLines.forEach((line, i) => { if (!newSet.has(line)) removed.push({ index: i, text: line }); });
        return { ...op, originalContent: original, addedLines: added, removedLines: removed };
      });

      // Update the message with the final result
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                content: finalDisplayText,
                ops: enrichedOps,
                codingPaths: [],
                approvalStatus: enrichedOps.length > 0 ? 'pending' : undefined,
                thinking: accumulatedThinking,
                thinkingLabel: accumulatedThinkingLabel,
                toolCalls: allToolCalls,
                isReadingFiles: false,
              }
            : m
        )
      );

    } catch (err: unknown) {
      if (isAbortError(err)) {
        setMessages((prev) => [...prev, { id: genId(), role: 'assistant', content: '_Stopped._', createdAt: Date.now() }]);
      } else {
        const normalized = normalizeAgentProviderError(err);
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: normalized.message,
            isError: true,
            createdAt: Date.now(),
          },
        ]);
      }
    } finally {
      setIsSending(false);
      setAgentAttachments([]);
      abortControllerRef.current = null;
      // Abort and error both append a new message and leave the in-flight one
      // untouched, so its "working" shimmer would never stop. Only one run is
      // in flight at a time, so clearing the flag everywhere also repairs any
      // message stranded by an earlier failure.
      setMessages((prev) =>
        prev.some((m) => m.isReadingFiles)
          ? prev.map((m) => (m.isReadingFiles ? { ...m, isReadingFiles: false } : m))
          : prev
      );
    }
  };

  const handleAttachImage = (item: AttachmentItem) => {
    setAgentAttachments((prev) => [...prev, item]);
    setShowAttachmentPopover(false);
  };

  const removeAttachment = (index: number) => {
    setAgentAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const caret = e.target.selectionStart ?? val.length;
    const uptoCaret = val.slice(0, caret);

    setShowSlash(/^\/[a-zA-Z]*$/.test(uptoCaret));

    const atMatch = uptoCaret.match(/(?:^|\s)@([\w./-]*)$/);
    setMentionState(atMatch ? { query: atMatch[1].toLowerCase(), start: caret - atMatch[1].length } : null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setMentionState(null);
      setShowSlash(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mentionState && !showSlash) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          parseUploadedFile(file).then((item) => {
            setAgentAttachments((prev) => [...prev, item]);
          }).catch((err) => {
            console.error('Error pasting image:', err);
          });
        }
        break;
      }
    }
  };

  const selectMention = (path: string) => {
    if (!mentionState) return;
    const before = input.slice(0, mentionState.start);
    const after = input.slice(mentionState.start + mentionState.query.length);
    const next = `${before}${path} ${after}`;
    setInput(next);
    setMentionState(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + path.length + 1;
      el.setSelectionRange(pos, pos);
    });
  };

  const selectSlashCommand = (cmd: (typeof SLASH_COMMANDS)[number]) => {
    setShowSlash(false);
    setInput('');
    handleSend(cmd.prompt);
  };

  if (isCollapsed) {
    return (
      <div className="w-9 border-r border-[#e5e3db] dark:border-[#2d2d2c] flex flex-col items-center py-3 bg-[#fbfaf7] dark:bg-[#1e1e1e] shrink-0">
        <button
          onClick={onToggleCollapse}
          title="Show sour.ai Agent"
          className="p-1.5 rounded-lg text-[#8c887d] dark:text-[#a09c94] hover:bg-[#efece5] dark:hover:bg-[#2a2a2a] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const renderMessage = (msg: AgentChatMessage, idx: number) => {
    return (
      <AgentMessage
        key={msg.id}
        message={msg}
        isLatest={idx === messages.length - 1}
        animateTyping={freshMessageIdsRef.current.has(msg.id)}
        openTags={openXmlTags}
        openItems={openToolCalls}
        onToggleTag={toggleXmlTag}
        onToggleItem={toggleToolCalls}
        onApplyOperations={handleApplyAll}
        onRejectOperations={handleRejectAll}
      />
    );
  };

  const handleNewThread = () => {
    setMessages([]);
    setAgentAttachments([]);
    freshMessageIdsRef.current.clear();
  };

  return (
    <div className="w-full lg:w-72 h-full border-r border-[#e5e3db] dark:border-[#2d2d2c] flex flex-col bg-[#fbfaf7] dark:bg-[#1e1e1e] select-none shrink-0 relative">
      <div className="h-8 sm:h-9 border-b border-[#e5e3db] dark:border-[#2d2d2c] flex items-center justify-between px-2 sm:px-3 text-xs text-[#8c887d] dark:text-[#a09c94] shrink-0">
        <span className="flex items-center gap-1 sm:gap-1.5 truncate text-[11px] sm:text-xs">
          <Logo size={12} className="sm:w-4" />
          <span className="hidden sm:inline">New sour.ai Agent Thread</span>
          <span className="sm:hidden">Agent</span>
        </span>
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <button
            onClick={() => setShowSlash((visible) => !visible)}
            title="Open coding tools"
            className="flex items-center gap-1 hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth transition-colors"
          >
            <Settings className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
            <span className="hidden sm:inline text-[10px]">Tools</span>
          </button>
          <button onClick={handleNewThread} title="New thread" className="hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth transition-colors">
            <Plus className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
          </button>
          <button onClick={onToggleCollapse} title="Collapse" className="hidden lg:block hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth transition-colors">
            <ChevronRight className="w-3 sm:w-3.5 h-3 sm:h-3.5 rotate-180" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 sm:px-3 py-2 sm:py-3 space-y-2 sm:space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 sm:gap-3 text-center py-6 sm:py-10">
            <PixelBowlIcon size={28} className="sm:size-10 opacity-80" />
            <span className="font-pixel text-[10px] sm:text-[11px] leading-relaxed text-[#8c887d] dark:text-[#a09c94]">
              Code with me
            </span>
            <span className="text-[9.5px] sm:text-[10.5px] text-[#a39d8f] dark:text-[#767671] max-w-[85%] leading-relaxed">
              @ to include context · / for commands
            </span>
          </div>
        ) : (
          messages.map(renderMessage)
        )}
        {isSending && !messages.some((message) => message.role === 'assistant' && message.isReadingFiles) && (
          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-[#8c887d] dark:text-[#a09c94]">
            <Loader2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 animate-spin" />
            <span className="agent-active-gradient">Starting agent</span>
          </div>
        )}
      </div>

      {/* Attachment Popover for image upload in subagent input */}
      <div ref={attachmentPopoverRef} className="relative">
        {showAttachmentPopover && (
          <AttachmentPopover
            onAttachFile={handleAttachImage}
            onClose={() => setShowAttachmentPopover(false)}
            positionClass="bottom-full mb-3 right-0 sm:right-auto sm:left-0"
          />
        )}
      </div>

      <div className="border-t border-[#e5e3db] dark:border-[#2d2d2c] px-2 sm:px-2.5 pt-2 relative flex flex-col shrink-0">
        {mentionState && mentionMatches.length > 0 && (
          <div className="absolute left-2.5 right-2.5 bottom-full mb-1 bg-white dark:bg-[#1e1e1d] border border-[#d8d5c9] dark:border-[#333230] shadow-lg p-1 max-h-40 overflow-y-auto z-20">
            {mentionMatches.map((f) => (
              <button
                key={f.path}
                onClick={() => selectMention(f.path)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-left hover:bg-[#f5f3ec] dark:hover:bg-[#282826] cursor-pointer ws-button-smooth"
              >
                <AtSign className="w-3 h-3 text-[#8c887d] shrink-0" />
                <span className="truncate">{f.path}</span>
              </button>
            ))}
          </div>
        )}

        {showSlash && (
          <div className="absolute left-2.5 right-2.5 bottom-full mb-1 bg-white dark:bg-[#1e1e1d] border border-[#d8d5c9] dark:border-[#333230] shadow-lg p-1 max-h-48 overflow-y-auto z-20">
            {SLASH_COMMANDS.map((cmd) => (
              <button
                key={cmd.cmd}
                onClick={() => selectSlashCommand(cmd)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-[#f5f3ec] dark:hover:bg-[#282826] cursor-pointer ws-button-smooth"
              >
                <span className="text-[#1c1b1a] dark:text-[#f0efe6]">{cmd.label}</span>
                <span className="text-[#8c887d] dark:text-[#a09c94] font-mono">{cmd.cmd}</span>
              </button>
            ))}
          </div>
        )}

        {agentAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2 border-t border-[#d8d5c9] dark:border-[#333230] bg-[#f5f3ec] dark:bg-[#2d2c2b]">
            {agentAttachments.map((att, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-white dark:bg-[#1e1e1d] border border-[#d8d5c9] dark:border-[#444240] text-[10px] text-[#1c1b1a] dark:text-[#f0efe6]"
              >
                <ImageIcon className="w-3.5 h-3.5 text-[#d96b43]" />
                <span className="truncate flex-1">{att.name}</span>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="hover:text-[#d96b43] transition-colors"
                  title="Remove attachment"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message Agent, @ for context, / for commands"
          className="w-full resize-none bg-transparent text-[11px] sm:text-xs text-[#1c1b1a] dark:text-[#f0efe6] placeholder-[#8c887d] dark:placeholder-[#767671] outline-none leading-tight h-16 sm:h-20 overflow-auto"
        />

        <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-[#8c887d] dark:text-[#a09c94] h-8 sm:h-8 shrink-0 gap-1 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-3 flex-wrap">
            <button
              onClick={() => setShowAttachmentPopover((v) => !v)}
              title="Attach files or images"
              className="flex items-center justify-center p-1.5 sm:p-0 gap-1 sm:gap-1.5 hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth transition-colors min-w-[44px] sm:min-w-auto h-[44px] sm:h-auto"
            >
              <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            </button>
            <button
              onClick={() => setMode((m) => (m === 'write' ? 'plan' : 'write'))}
              title={mode === 'write' ? 'Write: auto-apply changes' : 'Plan: guidance only, no code changes'}
              className="flex items-center justify-center p-1.5 sm:p-0 gap-1 sm:gap-1.5 hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth transition-colors min-w-[44px] sm:min-w-auto h-[44px] sm:h-auto"
            >
              <span className="w-3 h-3 sm:w-3.5 sm:h-3.5 border border-current flex items-center justify-center text-[6px] sm:text-[8px] font-bold">
                {mode === 'write' ? 'W' : 'P'}
              </span>
              <span className="hidden sm:inline">{mode === 'write' ? 'Write' : 'Plan'}</span>
            </button>
            {/* Context Usage Circle */}
            <div className="relative group flex items-center justify-center" title={`${contextUsage}% context used`}>
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 -rotate-90" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" className="text-[#c7c3b6] dark:text-[#444]" />
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3"
                  strokeDasharray={`${contextUsage * 0.6283} 62.83`}
                  className="text-[#1c1b1a] dark:text-[#f0efe6]"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="relative" ref={reasoningPopoverRef}>
              <button
                type="button"
                onClick={() => setShowReasoningPopover((visible) => !visible)}
                title={`Reasoning: ${REASONING_OPTIONS.find((option) => option.id === reasoningEffort)?.label}`}
                className="flex min-w-[44px] items-center justify-center gap-1 p-1.5 text-[9px] transition-colors hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] sm:h-auto sm:min-w-0 sm:p-0 sm:text-[11px]"
              >
                <Brain className="h-3.5 w-3.5" />
              </button>
              {showReasoningPopover && (
                <div className="fixed bottom-11 left-2 z-50 w-56 max-w-[calc(100vw-1rem)] rounded-xl border border-[#d8d5c9] bg-[#f5f3ee] p-3 shadow-xl dark:border-[#3a3937] dark:bg-[#242423]">
                  <div className="mb-3 flex items-center justify-between text-[11px] font-medium text-[#656158] dark:text-[#aaa69e]">
                    <span>
                      Effort{' '}
                      <span
                        className={`font-semibold ${
                          reasoningEffort === 'ultracode'
                            ? 'text-[#d96b43] dark:text-[#e07a52]'
                            : 'text-[#656158] dark:text-[#c1bdb5]'
                        }`}
                      >
                        {REASONING_OPTIONS.find((option) => option.id === reasoningEffort)?.label}
                      </span>
                    </span>
                    <CircleHelp className="h-3.5 w-3.5 text-[#8c887d]" />
                  </div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-[#8c887d] dark:text-[#aaa69e]">
                    <span>Faster</span>
                    <span>Smarter</span>
                  </div>
                  <div
                    className={`agent-effort-control ${
                      reasoningEffort === 'ultracode' ? 'is-ultracode' : ''
                    }`}
                    style={{
                      '--effort-percent': `${
                        (REASONING_OPTIONS.findIndex((option) => option.id === reasoningEffort) /
                          (REASONING_OPTIONS.length - 1)) *
                        100
                      }%`,
                    } as React.CSSProperties}
                  >
                    <div className="agent-effort-track" aria-hidden="true">
                      <span className="agent-effort-stars">
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="agent-effort-thumb" />
                    </div>
                    <input
                      aria-label="Reasoning effort"
                      type="range"
                      min={0}
                      max={REASONING_OPTIONS.length - 1}
                      step={1}
                      value={REASONING_OPTIONS.findIndex((option) => option.id === reasoningEffort)}
                      onChange={(event) => {
                        const option = REASONING_OPTIONS[Number(event.target.value)];
                        if (option) setReasoningEffort(option.id);
                      }}
                      className="agent-effort-input"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="relative" ref={modelPopoverRef}>
              <button onClick={() => setShowModelPopover((v) => !v)} className="flex items-center justify-center p-1.5 sm:p-0 gap-0.5 sm:gap-1 hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth transition-colors text-[9px] sm:text-[11px] min-w-[44px] sm:min-w-auto h-[44px] sm:h-auto">
                <span className="hidden sm:inline">{MODEL_LABELS[selectedModel] || (selectedModel.startsWith('custom_') ? 'API' : selectedModel)}</span>
                <span className="sm:hidden">M</span>
              </button>
              {showModelPopover && (
                <div className="absolute bottom-full mb-2 left-0 w-48 bg-white dark:bg-[#1e1e1d] border border-[#d8d5c9] dark:border-[#333230] shadow-lg p-1 z-20">
                  {/* Built-in Models */}
                  {MODEL_OPTIONS.map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setSelectedModel(m);
                        setShowModelPopover(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-left cursor-pointer ws-button-smooth ${
                        m === selectedModel
                          ? 'bg-[#f4f2eb] dark:bg-[#282826] text-[#1c1b1a] dark:text-[#f0efe6]'
                          : 'text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#f5f3ec] dark:hover:bg-[#282826]'
                      }`}
                    >
                      <span>{MODEL_LABELS[m]}</span>
                      {m === selectedModel && <Check className="w-3 h-3 shrink-0" />}
                    </button>
                  ))}

                  {/* Custom APIs */}
                  {customApiConfigs.length > 0 && (
                    <>
                      <div className="border-t border-[#e5e3db] dark:border-[#333230] my-1" />
                      {customApiConfigs.map((config) => (
                        <button
                          key={config.id}
                          onClick={() => {
                            setSelectedModel(config.id as AIModel);
                            setShowModelPopover(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-left cursor-pointer ws-button-smooth ${
                            config.id === selectedModel
                              ? 'bg-[#f4f2eb] dark:bg-[#282826] text-[#1c1b1a] dark:text-[#f0efe6]'
                              : 'text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#f5f3ec] dark:hover:bg-[#282826]'
                          }`}
                        >
                          <span className="truncate">{config.modelName}</span>
                          {config.id === selectedModel && <Check className="w-3 h-3 shrink-0" />}
                        </button>
                      ))}
                    </>
                  )}

                  {/* Add Custom API Option */}
                  <div className="border-t border-[#e5e3db] dark:border-[#333230] my-1" />
                  <button
                    onClick={() => {
                      setShowModelPopover(false);
                      setShowCustomApiModal(true);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left cursor-pointer text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#f5f3ec] dark:hover:bg-[#282826] ws-button-smooth"
                  >
                    <Settings className="w-3 h-3" />
                    <span>Other model API</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={handleVoiceToggle}
              title={isListening ? 'Stop listening' : 'Start voice input'}
              className={`flex items-center justify-center p-1.5 sm:p-0 gap-1 cursor-pointer ws-button-smooth min-w-[44px] sm:min-w-auto h-[44px] sm:h-auto ${
                isListening
                  ? 'text-[#d96b43] hover:text-[#c55a32]'
                  : 'text-[#8c887d] dark:text-[#a09c94] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
              }`}
            >
              {isListening ? <Mic className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> : <MicOff className="w-4 h-4 sm:w-3.5 sm:h-3.5" />}
            </button>
            {isSending ? (
              <button onClick={() => abortControllerRef.current?.abort()} title="Stop generating" className="flex items-center justify-center p-1.5 sm:p-0 min-w-[44px] sm:min-w-auto h-[44px] sm:h-auto hover:text-red-500 cursor-pointer ws-button-smooth">
                <Square className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                title="Send"
                className="flex items-center justify-center p-1.5 sm:p-0 min-w-[44px] sm:min-w-auto h-[44px] sm:h-auto hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] disabled:opacity-40 cursor-pointer ws-button-smooth"
              >
                <ArrowLeft className="w-4 h-4 sm:w-3.5 sm:h-3.5 rotate-180" />
              </button>
            )}
          </div>
        </div>
      </div>

      <CustomApiModal
        isDarkMode={isDarkMode}
        isOpen={showCustomApiModal}
        onClose={() => setShowCustomApiModal(false)}
        onConfigAdded={(config) => {
          setCustomApiConfigs([...customApiConfigs, config]);
          setSelectedModel(config.id as AIModel);
        }}
      />
    </div>
  );
};
