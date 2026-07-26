import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, ChevronRight, ChevronDown, AtSign, Check, Square, Loader2,
  FilePlus, Trash2, ArrowLeft, Bot, Search, Settings, Mic, MicOff, X, Image as ImageIcon,
  Lightbulb, CheckCircle, ClipboardList, BarChart3, Package, Tag, Zap,
} from 'lucide-react';
import { AttachmentPopover } from '../AttachmentPopover';
import { AttachmentItem } from '../../types';
import { parseUploadedFile } from '../../utils/fileParser';
import { AgentChatMessage, AgentFileOp, AgentMode, AgentToolCall, AIModel, SubAgentTask, WorkspaceFileNode } from '../../types';
import { parseAgentResponse, summarizeForHistory, extractMentionedPaths, extractPathsFromCheckContent } from '../../utils/agentProtocol';
import { shouldUseSubagents, planSubagent, formatSubagentPrompt } from '../../utils/subagentDetection';
import { MAX_CONCURRENT_SUBAGENTS } from '../../utils/constants';
import { customApiManager, type CustomApiConfig } from '../../utils/customApiManager';
import { VoiceRecognizer } from '../../utils/voiceRecognition';
import { apiUrl } from '../../lib/api';
import Logo from '../Logo';
import PixelBowlIcon from '../PixelBowlIcon';
import { CustomApiModal } from '../CustomApiModal';


/** Persistent context memory store keyed by project name. */
class ContextStore {
  private key(projectName: string) { return `sourbot_context::${projectName}`; }

  getAll(projectName: string): Record<string, string> {
    try {
      const raw = localStorage.getItem(this.key(projectName));
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  set(projectName: string, k: string, v: string) {
    const all = this.getAll(projectName);
    all[k] = v;
    localStorage.setItem(this.key(projectName), JSON.stringify(all));
  }

  get(projectName: string, k: string): string | undefined {
    return this.getAll(projectName)[k];
  }

  remove(projectName: string, k: string) {
    const all = this.getAll(projectName);
    delete all[k];
    localStorage.setItem(this.key(projectName), JSON.stringify(all));
  }

  clear(projectName: string) {
    localStorage.removeItem(this.key(projectName));
  }
}

const contextStore = new ContextStore();

interface AgentPanelProps {
  isDarkMode: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  projectId: string;
  projectName: string;
  files: WorkspaceFileNode[];
  activeFile: { path: string; content: string } | null;
  onApplyOps: (ops: AgentFileOp[]) => void;
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

// ─── XML Tag Parsing & Expandable Rendering ────────────────────────────────────

interface ContentSegment {
  type: string;
  content: string;
}

const XML_TAG_RE = /<([a-zA-Z][\w-]*)>([\s\S]*?)<\/\1>/g;

function parseAgentContent(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(XML_TAG_RE)) {
    if (match.index! > lastIndex) {
      const t = text.slice(lastIndex, match.index).trim();
      if (t) segments.push({ type: 'text', content: t });
    }
    segments.push({ type: match[1], content: match[2].trim() });
    lastIndex = match.index! + match[0].length;
  }

  if (lastIndex < text.length) {
    const t = text.slice(lastIndex).trim();
    if (t) segments.push({ type: 'text', content: t });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

type TagIcon = React.FC<{ className?: string }>;

const THINK_TAGS = ['think', 'thinking', 'reasoning', 'analysis', 'reflection', 'planning', 'step'];

const KNOWN_TAGS: Record<string, { label: string; Icon: TagIcon; color: string; bg: string; border: string }> = {
  ...Object.fromEntries(
    THINK_TAGS.map(t => [t, { label: 'Thinking', Icon: Lightbulb, color: 'text-[#97948A] dark:text-[#97948A]', bg: '', border: '' }])
  ),
  check_for_errors:  { label: 'Error Check',     Icon: CheckCircle,   color: 'text-[#97948A] dark:text-[#97948A]', bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]', border: 'border-[#97948A] dark:border-[#97948A]' },
  subagent_request:  { label: 'Subagent Request', Icon: Bot,          color: 'text-[#97948A] dark:text-[#97948A]', bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]', border: 'border-[#97948A] dark:border-[#97948A]' },
  subagent_response: { label: 'Subagent Response', Icon: ClipboardList, color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-500 dark:border-blue-400' },
  function_request:  { label: 'Function Request', Icon: Settings,     color: 'text-[#8c887d] dark:text-[#a09c94]', bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]', border: 'border-[#8c887d] dark:border-[#a09c94]' },
  function_result:   { label: 'Function Result',  Icon: BarChart3,    color: 'text-[#8c887d] dark:text-[#a09c94]', bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]', border: 'border-[#8c887d] dark:border-[#a09c94]' },
  context_compact:   { label: 'Context Compacted', Icon: Package,      color: 'text-purple-500 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-500 dark:border-purple-400' },
};

const TAG_COLOR_CYCLE = [
  { color: 'text-[#8c887d] dark:text-[#a09c94]', bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]', border: 'border-[#8c887d] dark:border-[#a09c94]' },
  { color: 'text-[#97948A] dark:text-[#97948A]', bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]', border: 'border-[#97948A] dark:border-[#97948A]' },
  { color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-500 dark:border-blue-400' },
  { color: 'text-purple-500 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-500 dark:border-purple-400' },
  { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-500 dark:border-amber-400' },
  { color: 'text-rose-500 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/30', border: 'border-rose-500 dark:border-rose-400' },
  { color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-950/30', border: 'border-cyan-500 dark:border-cyan-400' },
  { color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-950/30', border: 'border-slate-500 dark:border-slate-400' },
];

function getTagMeta(tagName: string): { label: string; Icon: TagIcon; color: string; bg: string; border: string } {
  if (KNOWN_TAGS[tagName]) return KNOWN_TAGS[tagName];
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) hash = ((hash << 5) - hash + tagName.charCodeAt(i)) | 0;
  const palette = TAG_COLOR_CYCLE[Math.abs(hash) % TAG_COLOR_CYCLE.length];
  const label = tagName.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { label, Icon: Tag, ...palette };
}

const MiniMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <ReactMarkdown
    components={{
      p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>,
      ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1 leading-[1.7]">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1 leading-[1.7]">{children}</ol>,
      li: ({ children }) => <li>{children}</li>,
      strong: ({ children }) => <strong className="font-semibold text-[#1c1b1a] dark:text-[#f0efe6]">{children}</strong>,
      a: ({ children, href }) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-[#d96b43] underline">
          {children}
        </a>
      ),
      code: ({ children, className }) => {
        if (className) {
          return (
            <pre className="my-2 p-3 rounded-lg bg-[#efece3] dark:bg-[#141413] overflow-x-auto text-[11px] font-mono leading-relaxed">
              <code>{children}</code>
            </pre>
          );
        }
        return <code className="px-1 py-0.5 rounded bg-[#efece3] dark:bg-[#141413] text-[11px] font-mono">{children}</code>;
      },
    }}
  >
    {text}
  </ReactMarkdown>
);

/** Expandable section with collapsible content and colored border-l. */
const ExpandableTag: React.FC<{
  tagType: string;
  content: string;
  id: string;
  openSet: Set<string>;
  onToggle: (id: string) => void;
}> = ({ tagType, content, id, openSet, onToggle }) => {
  const { label, Icon, color, bg, border } = getTagMeta(tagType);
  const isOpen = openSet.has(id);
  const isThinkTag = THINK_TAGS.includes(tagType);
  const steps = content.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean).slice(0, 12);

  if (isThinkTag) {
    return (
      <div className="select-none">
        <button
          type="button"
          onClick={() => onToggle(id)}
          className={`flex items-center gap-1.5 text-[10.5px] font-medium ${color} hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth`}
        >
          <Icon className="w-3 h-3 shrink-0" />
          <span>{label}</span>
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="mt-1.5 pl-2 border-l border-[#e2dec0] dark:border-[#383836] text-[10.5px] text-[#706c62] dark:text-[#a09d98] leading-relaxed overflow-hidden"
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className={`flex items-center gap-1.5 text-[10.5px] font-medium ${color} hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth`}
      >
        <Icon className="w-3 h-3 shrink-0" />
        <span>{label}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className={`mt-1.5 pl-2 border-l ${border} text-[10.5px] ${color} space-y-1 leading-relaxed overflow-hidden`}
          >
            {steps.map((step, i) => (
              <div key={i}>{step}</div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/** Renders agent content with expandable XML tag sections. */
const AgentContent: React.FC<{ text: string; isTyping: boolean; msgId: string; openTags: Set<string>; onToggleTag: (id: string) => void }> = ({
  text, isTyping, msgId, openTags, onToggleTag,
}) => {
  const segments = parseAgentContent(text);
  return (
    <div className="space-y-1">
      {segments.map((seg, i) => {
        const segId = `${msgId}-xml-${i}`;
        if (seg.type === 'text') {
          return <MiniMarkdown key={i} text={seg.content} />;
        }
        return (
          <ExpandableTag
            key={i}
            tagType={seg.type}
            content={seg.content}
            id={segId}
            openSet={openTags}
            onToggle={onToggleTag}
          />
        );
      })}
    </div>
  );
};

/**
 * Reveals `text` a few characters at a time (a staggered, simulated typing
 * effect) instead of dumping the whole response in at once. Only animates
 * when `enabled` is true (freshly-generated messages); once it finishes a
 * single pass it locks in the full text so later re-renders never replay it.
 */
const TypedMarkdown: React.FC<{ text: string; enabled: boolean }> = ({ text, enabled }) => {
  const [shown, setShown] = useState(enabled ? '' : text);
  const doneRef = useRef(!enabled);

  useEffect(() => {
    if (doneRef.current || !enabled) {
      setShown(text);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 4;
      if (i >= text.length) {
        setShown(text);
        doneRef.current = true;
        clearInterval(id);
      } else {
        setShown(text.slice(0, i));
      }
    }, 14);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return <MiniMarkdown text={shown} />;
};

const SUBAGENT_STATUS_LABEL: Record<SubAgentTask['status'], string> = {
  queued: 'Queued',
  running: 'Working…',
  done: 'Done',
  error: 'Failed',
};

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
  const [mode, setMode] = useState<AgentMode>(() => (localStorage.getItem('sourbot_agent_mode') as AgentMode) || 'write');
  const [selectedModel, setSelectedModel] = useState<AIModel>(
    () => (localStorage.getItem('sourbot_agent_model') as AIModel) || 'sour-omni-flash'
  );
  const [showModelPopover, setShowModelPopover] = useState(false);
  const [showCustomApiModal, setShowCustomApiModal] = useState(false);
  const [customApiConfigs, setCustomApiConfigs] = useState<CustomApiConfig[]>(customApiManager.getConfigs());
  const [isListening, setIsListening] = useState(false);
  const [mentionState, setMentionState] = useState<{ query: string; start: number } | null>(null);
  const [showSlash, setShowSlash] = useState(false);
  const [openXmlTags, setOpenXmlTags] = useState<Set<string>>(new Set());
  const [openToolCalls, setOpenToolCalls] = useState<Set<string>>(new Set());
  const [subAgents, setSubAgents] = useState<SubAgentTask[]>([]);
  const subAgentsRef = useRef<SubAgentTask[]>([]);

  // Keep ref in sync so spawnSubAgents Promise can read latest state
  useEffect(() => { subAgentsRef.current = subAgents; }, [subAgents]);
  const [showAttachmentPopover, setShowAttachmentPopover] = useState(false);
  const [agentAttachments, setAgentAttachments] = useState<AttachmentItem[]>([]);
  const attachmentPopoverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPopoverRef = useRef<HTMLDivElement>(null);
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

  /** Smart function auto-detection: when user mentions action words,
   *  automatically inject the corresponding @@ function call. */
  const autoDetectAndCallFunctions = (userText: string): { promptToSend: string; autoCalledFunctions: string[] } => {
    const autoCalledFunctions: string[] = [];
    let modifiedText = userText;

    // Pattern 1: Read/view operations
    if (/\b(read|view|show|open|check|display|cat|view.*file)\b/i.test(userText) && !/@@readfile/i.test(userText)) {
      // Check if path-like tokens suggest a file request
      const pathMatch = userText.match(/['\"]([\w.\/-]+[\.\w]+)['\"]|(?:the\s+)?file\s+([\w.\/-]+)|(src|app|lib|components)\/[\w.\/-]+/i);
      if (pathMatch) {
        modifiedText = `${userText}\n\n@@readfile: ${pathMatch[1] || pathMatch[2] || pathMatch[0]}`;
        autoCalledFunctions.push('@@readfile');
      }
    }

    // Pattern 2: Search/find operations
    if (/\b(search|find|locate|grep|look for|where|detect)\b/i.test(userText) && !/@@findall/i.test(userText)) {
      const searchTerm = userText.match(/(?:for|"([^"]+)"|\s+([\w\s]+?)(?:\s+in|\?|$))/i);
      if (searchTerm && searchTerm[1]?.length < 50) {
        modifiedText = `${userText}\n\n@@findall: ${searchTerm[1] || searchTerm[2]}`;
        autoCalledFunctions.push('@@findall');
      }
    }

    return { promptToSend: modifiedText, autoCalledFunctions };
  };

  /** Check if a request warrants subagent delegation with parent approval. */
  const shouldSuggestSubagents = (userText: string): boolean => {
    const plan = planSubagent(userText);
    return plan !== null && plan.risk !== 'low';
  };

  // Hard cap enforcement for autonomous sub-agents: at most
  // MAX_CONCURRENT_SUBAGENTS run at once, extras wait in this queue.
  const subAgentQueueRef = useRef<{ task: SubAgentTask; prompt: string }[]>([]);
  const runningSubAgentsRef = useRef(0);
  /** Maps task ID → resolve callback so spawnSubAgents can await completion. */
  const subAgentResolversRef = useRef<Map<string, () => void>>(new Map());

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`sourbot_agent_thread::${projectId}`);
      setMessages(raw ? JSON.parse(raw) : []);
    } catch {
      setMessages([]);
    }
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`sourbot_agent_thread::${projectId}`, JSON.stringify(messages));
    } catch {
      /* storage full/unavailable - not critical */
    }
  }, [messages, projectId]);

  useEffect(() => {
    localStorage.setItem('sourbot_agent_mode', mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem('sourbot_agent_model', selectedModel);
  }, [selectedModel]);

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
            }
          : m
      )
    );
  };

  const handleApplySingle = (messageId: string, op: AgentFileOp) => {
    onApplyOps([op]);
    markApplied(messageId, [op.path]);
  };

  const handleApplyAll = (messageId: string, ops: AgentFileOp[]) => {
    onApplyOps(ops);
    markApplied(messageId, ops.map((o) => o.path));
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
    for (const p of paths) {
      const node = files.find((f) => f.path === p);
      if (node && node.content !== undefined) {
        toolCalls.push({ type: 'readfile', path: p, found: true });
        parts.push(`[File read: ${p}]\n\`\`\`\n${node.content.slice(0, 6000)}\n\`\`\``);
      } else {
        toolCalls.push({ type: 'readfile', path: p, found: false });
        parts.push(`[File not found: ${p}]`);
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
    const parts: string[] = [];
    for (const p of paths) {
      const prefix = p ? p.replace(/\/$/, '') + '/' : '';
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
      if (unique.length === 0) {
        parts.push(`[Directory: ${p || '/'}]\n(empty or not found)`);
      } else {
        parts.push(`[Directory: ${p || '/'}]\n${unique.join('\n')}`);
      }
    }
    return { toolCalls: [], resultText: parts.join('\n\n') };
  };

  /** Resolves @@glob: requests — finds files matching a glob pattern. */
  const resolveGlobRequests = (
    patterns: string[]
  ): { toolCalls: AgentToolCall[]; resultText: string } => {
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
      if (matches.length === 0) {
        parts.push(`[Glob: ${pattern}]\nNo files matched.`);
      } else {
        parts.push(`[Glob: ${pattern}] (${matches.length} files)\n${matches.join('\n')}`);
      }
    }
    return { toolCalls: [], resultText: parts.join('\n\n') };
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
  const resolveContextStore = (entries: { key: string; value: string }[]): string => {
    for (const { key, value } of entries) {
      contextStore.set(projectName, key, value);
    }
    return entries.map(({ key }) => `[Context stored: "${key}"]`).join('\n');
  };

  /** Resolves @@context_get: key — retrieves stored context. */
  const resolveContextGet = (keys: string[]): string => {
    const parts: string[] = [];
    for (const k of keys) {
      const val = contextStore.get(projectName, k);
      parts.push(val !== undefined
        ? `[Context: "${k}"]\n${val}`
        : `[Context: "${k}"]\nNot found.`);
    }
    return parts.join('\n\n');
  };

  /** Resolves @@context_list — shows all stored context keys. */
  const resolveContextList = (): string => {
    const all = contextStore.getAll(projectName);
    const keys = Object.keys(all);
    if (keys.length === 0) return '[Context store is empty]';
    return `[Stored context keys (${keys.length})]:\n${keys.map(k => `- ${k}`).join('\n')}`;
  };

  /** Resolves @@context_clear: key — removes a context entry. */
  const resolveContextClear = (keys: string[]): string => {
    for (const k of keys) {
      contextStore.remove(projectName, k);
    }
    return keys.map(k => `[Context cleared: "${k}"]`).join('\n');
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

  /** Sequentially "codes" each file with a short delay so the UI can show a
   *  spinner per-file (rather than instantly marking every file as done). */
  const applyOpsStaggered = async (messageId: string, ops: AgentFileOp[]) => {
    for (const op of ops) {
      await new Promise((resolve) => setTimeout(resolve, 350 + Math.random() * 400));
      onApplyOps([op]);
      markApplied(messageId, [op.path]);
    }
  };

  const runSubAgentTask = async (task: SubAgentTask, prompt: string, parentMsgId: string) => {
    setSubAgents((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'running' } : t)));

    const knownPaths = files.map((f) => f.path);
    try {
      const res = await fetch(apiUrl('/api/agent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          mode,
          messages: [{ role: 'user', content: `Sub-agent task (delegated by the main agent): ${prompt}` }],
          activeFile: activeFile ? { path: activeFile.path, content: activeFile.content.slice(0, 8000) } : null,
          projectFiles: knownPaths.slice(0, 300),
          mentionedFiles: [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Sub-agent failed to respond.');

      const parsed = parseAgentResponse(data.text || '');
      let finalParsed = parsed;
      let finalData = data;

      // Tool-call loop for sub-agents
      if (parsed.fileRequests.length > 0 || parsed.findRequests.length > 0) {
        const { toolCalls: readCalls, resultText: readText } = resolveFileRequests(parsed.fileRequests);
        const { toolCalls: findCalls, resultText: findText } = resolveFindRequests(parsed.findRequests);
        const toolCalls = [...readCalls, ...findCalls];
        const resultText = [readText, findText].filter(Boolean).join('\n\n');
        const subMsgId = genId();
        const interimSubMsg: AgentChatMessage = {
          id: subMsgId,
          role: 'assistant',
          content: '',
          ops: [],
          appliedPaths: [],
          codingPaths: [],
          thinking: data.thinking,
          thinkingLabel: data.thinkingLabel,
          toolCalls,
          isReadingFiles: true,
          createdAt: Date.now(),
        };
        freshMessageIdsRef.current.add(subMsgId);
        setMessages((prev) => [...prev, interimSubMsg]);

        const res2 = await fetch(apiUrl('/api/agent'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            mode,
            messages: [
              { role: 'user', content: `Sub-agent task (delegated by the main agent): ${prompt}` },
              { role: 'assistant', content: data.text || '' },
              { role: 'user', content: resultText },
            ],
            activeFile: activeFile ? { path: activeFile.path, content: activeFile.content.slice(0, 8000) } : null,
            projectFiles: knownPaths.slice(0, 300),
            mentionedFiles: [],
          }),
        });
        const data2 = await res2.json().catch(() => ({}));
        if (!res2.ok) throw new Error(data2?.error || 'Sub-agent failed after reading files.');
        finalParsed = parseAgentResponse(data2.text || '');
        finalData = data2;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === subMsgId ? { ...m, isReadingFiles: false } : m
          )
        );
      }

      const { displayText, ops } = finalParsed;
      const willAutoApply = true;

      const subMsg: AgentChatMessage = {
        id: genId(),
        role: 'assistant',
        content: `**Sub-agent — ${task.label}**\n\n${displayText || '_No changes were necessary._'}`,
        ops,
        appliedPaths: [],
        codingPaths: willAutoApply ? ops.map((o) => o.path) : [],
        thinking: finalData.thinking,
        thinkingLabel: finalData.thinkingLabel,
        createdAt: Date.now(),
      };
      freshMessageIdsRef.current.add(subMsg.id);
      setMessages((prev) => [...prev, subMsg]);
      if (willAutoApply) applyOpsStaggered(subMsg.id, ops);

      setSubAgents((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'done', fileCount: ops.length, result: { displayText: displayText || '', filesChanged: ops.map(o => o.path) } } : t)));
    } catch (err: any) {
      setSubAgents((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'error', error: err?.message } : t)));
    } finally {
      const resolver = subAgentResolversRef.current.get(task.id);
      if (resolver) {
        subAgentResolversRef.current.delete(task.id);
        resolver();
      }
    }
  };

  const kickSubAgentQueue = () => {
    while (runningSubAgentsRef.current < MAX_CONCURRENT_SUBAGENTS && subAgentQueueRef.current.length > 0) {
      const next = subAgentQueueRef.current.shift()!;
      runningSubAgentsRef.current += 1;
      runSubAgentTask(next.task, next.prompt, next.task.id).finally(() => {
        runningSubAgentsRef.current -= 1;
        kickSubAgentQueue();
      });
    }
  };

  /** Spawns sub-agents and returns a Promise that resolves when ALL of them
   *  finish (done or error). The resolved array contains the final task states
   *  including their result summaries. */
  const spawnSubAgents = (taskDescriptions: string[]): Promise<SubAgentTask[]> => {
    const newTasks: SubAgentTask[] = taskDescriptions.map((label) => ({ id: genId(), label, status: 'queued' }));
    setSubAgents((prev) => [...prev, ...newTasks]);
    newTasks.forEach((task, idx) => subAgentQueueRef.current.push({ task, prompt: taskDescriptions[idx] }));
    kickSubAgentQueue();

    return new Promise<SubAgentTask[]>((resolve) => {
      const taskIds = new Set(newTasks.map((t) => t.id));
      const checkDone = () => {
        const snap = subAgentsRef.current;
        const allDone = newTasks.every((t) => {
          const live = snap.find((s) => s.id === t.id);
          return live && (live.status === 'done' || live.status === 'error');
        });
        if (allDone) {
          const results = newTasks.map((t) => snap.find((s) => s.id === t.id) || t);
          resolve(results);
        }
      };
      // Register resolvers for each task so runSubAgentTask can trigger re-check
      for (const t of newTasks) {
        subAgentResolversRef.current.set(t.id, checkDone);
      }
      // Also poll in case they finish instantly before resolvers are called
      checkDone();
    });
  };

  const MAX_AGENT_TURNS = 50;

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isSending) return;
    setInput('');
    setShowSlash(false);
    setMentionState(null);
    setShowAttachmentPopover(false);

    // Auto-detect functions and check for complex tasks
    const { promptToSend, autoCalledFunctions } = autoDetectAndCallFunctions(text);

    // Add note about auto-called functions if any
    let displayContent = text;
    if (autoCalledFunctions.length > 0) {
      displayContent = `${text}\n\n_[Auto-called: ${autoCalledFunctions.join(', ')}]_`;
    }

    const userMsg: AgentChatMessage = { id: genId(), role: 'user', content: displayContent, createdAt: Date.now() };
    const historyBase = [...messages, userMsg];
    setMessages(historyBase);
    setIsSending(true);

    const knownPaths = files.map((f) => f.path);
    const mentionPaths = extractMentionedPaths(text, knownPaths);
    const mentionedFiles = mentionPaths
      .map((p) => files.find((f) => f.path === p))
      .filter((f): f is WorkspaceFileNode => Boolean(f))
      .map((f) => ({ path: f.path, content: (f.content || '').slice(0, 6000) }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const basePayload = {
        model: selectedModel,
        mode,
        activeFile: activeFile ? { path: activeFile.path, content: activeFile.content.slice(0, 8000) } : null,
        projectFiles: knownPaths.slice(0, 300),
        mentionedFiles,
      };

      // ── Agent loop: send prompt, resolve tools, repeat until no more tool calls ──
      // Expanded context: keep up to40 messages so AI remembers code + chat
      let conversationHistory: { role: 'user' | 'assistant'; content: string }[] =
        historyBase.slice(-40).map((m) => ({
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

      while (hasMoreTools && turnCount < MAX_AGENT_TURNS) {
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
            throw new Error(errData?.error || 'The agent failed to respond.');
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
                try {
                  const event = JSON.parse(trimmed.slice(6));
                  if (event.error) throw new Error(event.error);
                  if (event.token) {
                    streamText += event.token;
                    // Update message with live text (truncate think tags for display)
                    const { displayText: displayPart } = parseAgentResponse(streamText);
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === msgId
                          ? { ...m, content: displayPart || streamText }
                          : m
                      )
                    );
                  }
                  if (event.done) {
                    accumulatedThinking = event.thinking || accumulatedThinking;
                    accumulatedThinkingLabel = event.thinkingLabel || accumulatedThinkingLabel;
                    const finalParsed = parseAgentResponse(event.text || streamText);
                    finalDisplayText = finalParsed.displayText || (finalParsed.ops.length ? '' : "I didn't find anything useful to say - try rephrasing that.");
                    allOps = [...allOps, ...finalParsed.ops];

                    if (finalParsed.subAgentTasks.length > 0) {
                      // Update UI to show subagent work is starting
                      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isReadingFiles: true } : m));
                      const completedTasks = await spawnSubAgents(finalParsed.subAgentTasks.slice(0, 8));
                      // Build a summary of subagent results for the main agent to review
                      const subagentSummary = completedTasks.map((t) => {
                        const status = t.status === 'done' ? 'completed' : `failed: ${t.error || 'unknown error'}`;
                        const files = t.result?.filesChanged?.length
                          ? `Files changed: ${t.result.filesChanged.join(', ')}` : 'No files changed.';
                        const preview = t.result?.displayText
                          ? t.result.displayText.slice(0, 500) : '';
                        return `[Sub-agent "${t.label}" — ${status}]\n${files}\n${preview}`;
                      }).join('\n\n');
                      conversationHistory = [
                        ...conversationHistory,
                        { role: 'assistant', content: event.text || streamText },
                        { role: 'user', content: `[All sub-agents have finished. Review their work and continue with the remaining task.]\n\n${subagentSummary}` },
                      ];
                      hasMoreTools = true;
                      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isReadingFiles: false } : m));
                    }

                    const hasToolCalls = finalParsed.fileRequests.length > 0 || finalParsed.findRequests.length > 0
                      || finalParsed.listDirRequests.length > 0 || finalParsed.globRequests.length > 0 || finalParsed.fileInfoRequests.length > 0
                      || finalParsed.replaceRequests.length > 0 || finalParsed.searchImportsRequests.length > 0 || finalParsed.renameRequests.length > 0;
                    const hasCheckErrors = finalParsed.checkErrorsContent.length > 0;
                    const hasContextOps = finalParsed.contextStore.length > 0 || finalParsed.contextGet.length > 0 || finalParsed.contextList || finalParsed.contextClear.length > 0;

                    if (hasToolCalls || hasCheckErrors || hasContextOps) {
                      // Resolve all tool types
                      const { toolCalls: readCalls, resultText: readText } = resolveFileRequests(finalParsed.fileRequests);
                      const { toolCalls: findCalls, resultText: findText } = resolveFindRequests(finalParsed.findRequests);
                      const { resultText: listDirText } = resolveListDirRequests(finalParsed.listDirRequests);
                      const { resultText: globText } = resolveGlobRequests(finalParsed.globRequests);
                      const { resultText: fileInfoText } = resolveFileInfoRequests(finalParsed.fileInfoRequests);
                      const turnToolCalls = [...readCalls, ...findCalls];

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
                      if (finalParsed.contextStore.length > 0) contextResultParts.push(resolveContextStore(finalParsed.contextStore));
                      if (finalParsed.contextGet.length > 0) contextResultParts.push(resolveContextGet(finalParsed.contextGet));
                      if (finalParsed.contextList) contextResultParts.push(resolveContextList());
                      if (finalParsed.contextClear.length > 0) contextResultParts.push(resolveContextClear(finalParsed.contextClear));

                      // Resolve replace / search_imports / rename
                      const replaceResult: { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } = finalParsed.replaceRequests.length > 0
                        ? resolveReplaceRequests(finalParsed.replaceRequests) : { toolCalls: [], ops: [], resultText: '' };
                      const importsResult: { toolCalls: AgentToolCall[]; resultText: string } = finalParsed.searchImportsRequests.length > 0
                        ? resolveSearchImportsRequests(finalParsed.searchImportsRequests) : { toolCalls: [], resultText: '' };
                      const renameResult: { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } = finalParsed.renameRequests.length > 0
                        ? resolveRenameRequests(finalParsed.renameRequests) : { toolCalls: [], ops: [], resultText: '' };
                      turnToolCalls.push(...replaceResult.toolCalls, ...importsResult.toolCalls, ...renameResult.toolCalls);
                      allOps = [...allOps, ...replaceResult.ops, ...renameResult.ops];

                      const resultText = [readText, findText, listDirText, globText, fileInfoText, replaceResult.resultText, importsResult.resultText, renameResult.resultText, ...checkResultParts, ...contextResultParts].filter(Boolean).join('\n\n');

                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === msgId
                            ? { ...m, toolCalls: allToolCalls, thinking: accumulatedThinking, thinkingLabel: accumulatedThinkingLabel }
                            : m
                        )
                      );

                      conversationHistory = [
                        ...conversationHistory,
                        { role: 'assistant', content: event.text || streamText },
                        { role: 'user', content: resultText },
                      ];
                      hasMoreTools = true;
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
          if (!res.ok) throw new Error(data?.error || 'The agent failed to respond.');

          const parsed = parseAgentResponse(data.text || '');

          if (data.thinking) accumulatedThinking = data.thinking;
          if (data.thinkingLabel) accumulatedThinkingLabel = data.thinkingLabel;

          if (parsed.subAgentTasks.length > 0) {
            // Update UI to show subagent work is starting
            setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isReadingFiles: true } : m));
            const completedTasks = await spawnSubAgents(parsed.subAgentTasks.slice(0, 8));
            const subagentSummary = completedTasks.map((t) => {
              const status = t.status === 'done' ? 'completed' : `failed: ${t.error || 'unknown error'}`;
              const files = t.result?.filesChanged?.length
                ? `Files changed: ${t.result.filesChanged.join(', ')}` : 'No files changed.';
              const preview = t.result?.displayText
                ? t.result.displayText.slice(0, 500) : '';
              return `[Sub-agent "${t.label}" — ${status}]\n${files}\n${preview}`;
            }).join('\n\n');
            conversationHistory = [
              ...conversationHistory,
              { role: 'assistant', content: data.text || '' },
              { role: 'user', content: `[All sub-agents have finished. Review their work and continue with the remaining task.]\n\n${subagentSummary}` },
            ];
            hasMoreTools = true;
            setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isReadingFiles: false } : m));
          }

          const hasToolCalls = parsed.fileRequests.length > 0 || parsed.findRequests.length > 0
            || parsed.listDirRequests.length > 0 || parsed.globRequests.length > 0 || parsed.fileInfoRequests.length > 0
            || parsed.replaceRequests.length > 0 || parsed.searchImportsRequests.length > 0 || parsed.renameRequests.length > 0;
          const hasCheckErrors = parsed.checkErrorsContent.length > 0;
          const hasContextOps = parsed.contextStore.length > 0 || parsed.contextGet.length > 0 || parsed.contextList || parsed.contextClear.length > 0;

          if (hasToolCalls || hasCheckErrors || hasContextOps) {
            const { toolCalls: readCalls, resultText: readText } = resolveFileRequests(parsed.fileRequests);
            const { toolCalls: findCalls, resultText: findText } = resolveFindRequests(parsed.findRequests);
            const { resultText: listDirText } = resolveListDirRequests(parsed.listDirRequests);
            const { resultText: globText } = resolveGlobRequests(parsed.globRequests);
            const { resultText: fileInfoText } = resolveFileInfoRequests(parsed.fileInfoRequests);
            const turnToolCalls = [...readCalls, ...findCalls];

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
            if (parsed.contextStore.length > 0) contextResultParts.push(resolveContextStore(parsed.contextStore));
            if (parsed.contextGet.length > 0) contextResultParts.push(resolveContextGet(parsed.contextGet));
            if (parsed.contextList) contextResultParts.push(resolveContextList());
            if (parsed.contextClear.length > 0) contextResultParts.push(resolveContextClear(parsed.contextClear));

            // Resolve replace / search_imports / rename
            const replaceResult: { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } = parsed.replaceRequests.length > 0
              ? resolveReplaceRequests(parsed.replaceRequests) : { toolCalls: [], ops: [], resultText: '' };
            const importsResult: { toolCalls: AgentToolCall[]; resultText: string } = parsed.searchImportsRequests.length > 0
              ? resolveSearchImportsRequests(parsed.searchImportsRequests) : { toolCalls: [], resultText: '' };
            const renameResult: { toolCalls: AgentToolCall[]; ops: AgentFileOp[]; resultText: string } = parsed.renameRequests.length > 0
              ? resolveRenameRequests(parsed.renameRequests) : { toolCalls: [], ops: [], resultText: '' };
            turnToolCalls.push(...replaceResult.toolCalls, ...importsResult.toolCalls, ...renameResult.toolCalls);
            allOps = [...allOps, ...replaceResult.ops, ...renameResult.ops];

            const resultText = [readText, findText, listDirText, globText, fileInfoText, replaceResult.resultText, importsResult.resultText, renameResult.resultText, ...checkResultParts, ...contextResultParts].filter(Boolean).join('\n\n');

            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, toolCalls: allToolCalls, thinking: accumulatedThinking, thinkingLabel: accumulatedThinkingLabel }
                  : m
              )
            );

            conversationHistory = [
              ...conversationHistory,
              { role: 'assistant', content: data.text || '' },
              { role: 'user', content: resultText },
            ];
            hasMoreTools = true;
          } else {
            finalDisplayText = parsed.displayText || (allOps.length ? '' : "I didn't find anything useful to say - try rephrasing that.");
            allOps = [...allOps, ...parsed.ops];
          }
        }
      }

      const willAutoApply = true;

      // Enrich ops with original content and diff info for highlighting
      const enrichedOps = allOps.map((op) => {
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
                codingPaths: willAutoApply ? enrichedOps.map((o) => o.path) : [],
                thinking: accumulatedThinking,
                thinkingLabel: accumulatedThinkingLabel,
                toolCalls: allToolCalls,
                isReadingFiles: false,
              }
            : m
        )
      );

      if (willAutoApply) applyOpsStaggered(msgId, allOps);

    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setMessages((prev) => [...prev, { id: genId(), role: 'assistant', content: '_Stopped._', createdAt: Date.now() }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: err?.message || 'Something went wrong reaching the sour.ai Agent.',
            isError: true,
            createdAt: Date.now(),
          },
        ]);
      }
    } finally {
      setIsSending(false);
      setAgentAttachments([]);
      abortControllerRef.current = null;
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
    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="flex justify-end mb-4">
          <div className="max-w-[88%] bg-[#f0ede4] dark:bg-[#252524] text-[#1c1b1a] dark:text-[#f0efe6] px-2.5 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap wrap-break-word rounded-lg">
            {msg.content}
          </div>
        </div>
      );
    }

    const isLatest = idx === messages.length - 1;
    const isTyping = freshMessageIdsRef.current.has(msg.id) && isLatest;

    return (
      <div key={msg.id} className="space-y-1.5 mb-5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#a39d8f] dark:text-[#767671]">
          <Logo size={12} /> sour.ai Agent
        </div>

        {msg.content && (
          <div className={`text-[12px] leading-[1.7] wrap-break-word ${msg.isError ? 'text-red-600 dark:text-red-400' : 'text-[#3d3a33] dark:text-[#dedcd6]'}`}>
            {msg.role === 'assistant' && !msg.content.startsWith('**Sub-agent') ? (
              <AgentContent text={msg.content} isTyping={isTyping} msgId={msg.id} openTags={openXmlTags} onToggleTag={toggleXmlTag} />
            ) : (
              <TypedMarkdown text={msg.content} enabled={isTyping} />
            )}
          </div>
        )}

        {msg.toolCalls && msg.toolCalls.length > 0 && msg.toolCalls.map((tc, ti) => {
          const tcId = `${msg.id}-tc-${ti}`;
          const isReading = msg.isReadingFiles;
          return (
            <div key={tcId} className="select-none">
              <button
                type="button"
                onClick={() => !isReading && toggleToolCalls(tcId)}
                className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#8c887d] dark:text-[#a09c94] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth"
              >
                {isReading ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                ) : tc.type === 'readfile' ? (
                  tc.found ? <Check className="w-3 h-3 text-amber-600 shrink-0" /> : <Search className="w-3 h-3 shrink-0" />
                ) : (
                  <Search className="w-3 h-3 shrink-0" />
                )}
                <span>{
                  tc.type === 'readfile' ? `Read: ${tc.path}`
                  : tc.type === 'findall' ? `Search: ${tc.query}`
                  : tc.type === 'replace' ? `Replace: ${tc.path}`
                  : tc.type === 'search_imports' ? `Imports: ${tc.symbol}`
                  : tc.type === 'rename' ? `Rename: ${tc.oldPath} → ${tc.newPath}`
                  : 'Tool call'
                }</span>
                {!isReading && <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${openToolCalls.has(tcId) ? 'rotate-180' : ''}`} />}
              </button>
              <AnimatePresence>
                {openToolCalls.has(tcId) && !isReading && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="mt-1.5 pl-2 border-l border-[#e2dec0] dark:border-[#383836] text-[10.5px] text-[#706c62] dark:text-[#a09d98] space-y-1 leading-relaxed overflow-hidden"
                  >
                    {tc.type === 'readfile' ? (
                      <div className="flex items-center gap-1.5">
                        {tc.found ? <Check className="w-3 h-3 text-amber-600 shrink-0" /> : <span className="w-3 h-3 text-red-400 shrink-0 font-bold leading-3 text-center">!</span>}
                        <span className="font-mono truncate">{tc.path}</span>
                        {!tc.found && <span className="text-red-400 shrink-0">not found</span>}
                      </div>
                    ) : tc.type === 'findall' ? (
    <div className="space-y-2.5">
                        <div className="flex items-center gap-1.5 font-medium">
                          <span>"{tc.query}" &mdash; {tc.matchCount} match{tc.matchCount !== 1 ? 'es' : ''} in {tc.fileCount} file{tc.fileCount !== 1 ? 's' : ''}</span>
                        </div>
                        {tc.matches.slice(0, 5).map((m, j) => (
                          <div key={j} className="pl-3 font-mono text-[9.5px] truncate">
                            <span className="opacity-60">{m.path}:{m.line}</span>{' '}{m.text}
                          </div>
                        ))}
                        {tc.matchCount > 5 && (
                          <div className="pl-3 opacity-50 text-[9.5px]">…and {tc.matchCount - 5} more</div>
                        )}
                      </div>
                    ) : tc.type === 'replace' ? (
                      <div className="space-y-1">
                        <div className="font-mono truncate">{tc.path}</div>
                        {tc.applied ? (
                          <div className="text-amber-600">Applied ({tc.search.length} → {tc.replace.length} chars)</div>
                        ) : tc.found ? (
                          <div className="text-red-400">Search string not found</div>
                        ) : (
                          <div className="text-red-400">File not found</div>
                        )}
                      </div>
                    ) : tc.type === 'search_imports' ? (
                      <div className="space-y-2.5">
                        <div className="font-medium">
                          "{tc.symbol}" &mdash; {tc.matchCount} usage{tc.matchCount !== 1 ? 's' : ''}
                        </div>
                        {tc.matches.slice(0, 5).map((m, j) => (
                          <div key={j} className="pl-3 font-mono text-[9.5px] truncate">
                            <span className="opacity-60">{m.path}:{m.line}</span>{' '}{m.text}
                          </div>
                        ))}
                        {tc.matchCount > 5 && (
                          <div className="pl-3 opacity-50 text-[9.5px]">…and {tc.matchCount - 5} more</div>
                        )}
                      </div>
                    ) : tc.type === 'rename' ? (
                      <div className="font-mono text-[9.5px]">
                        {tc.oldPath} → {tc.newPath}
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {msg.ops && msg.ops.length > 0 && msg.ops.map((op) => {
          const applied = msg.appliedPaths?.includes(op.path);
          const isCoding = msg.codingPaths?.includes(op.path);
          const opId = `${msg.id}-op-${op.path}`;
          const isOpen = openToolCalls.has(opId);
          const lines = op.content ? op.content.split('\n') : [];
          const addedSet = new Set(op.addedLines || []);
          const removedLines = op.removedLines || [];
          const pathParts = op.path.split('/');
          const fileName = pathParts.pop() || op.path;
          const dirPath = pathParts.join('/');
          return (
            <div key={opId} className="select-none border border-[#e5e3db] dark:border-[#2d2d2c] rounded-md overflow-hidden mb-2">
              {/* Breadcrumb bar */}
              <button
                type="button"
                onClick={() => !isCoding && toggleToolCalls(opId)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-[#f5f3eb] dark:bg-[#252524] border-b border-[#e5e3db] dark:border-[#2d2d2c] text-[10.5px] text-[#706c62] dark:text-[#a09c94] hover:bg-[#efece3] dark:hover:bg-[#2a2a29] cursor-pointer ws-button-smooth"
              >
                {isCoding ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0 text-[#97948A]" />
                ) : op.type === 'delete' ? (
                  <Trash2 className="w-3 h-3 shrink-0 text-[#97948A]" />
                ) : (
                  <FilePlus className="w-3 h-3 shrink-0 text-[#97948A]" />
                )}
                <span className="truncate flex-1 text-left">
                  {dirPath && <span className="opacity-50">{dirPath}/</span>}
                  <span className="font-medium text-[#1c1b1a] dark:text-[#f0efe6]">{fileName}</span>
                </span>
                {!isCoding && <ChevronDown className={`w-3 h-3 transition-transform duration-200 shrink-0 text-[#97948A] ${isOpen ? 'rotate-180' : ''}`} />}
              </button>
              {/* Expanded content */}
              <AnimatePresence>
                {isOpen && !isCoding && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    {op.type === 'delete' ? (
                      <div className="px-2.5 py-1.5 text-[10.5px] text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/10">
                        Will delete this file
                      </div>
                    ) : lines.length > 0 || removedLines.length > 0 ? (
                      <div className="h-48 overflow-y-auto thin-scrollbar">
                        {lines.map((line, li) => (
                          <div key={`add-${li}`} className="flex items-stretch">
                            <div className={`w-0.5 shrink-0 ${addedSet.has(li) ? 'bg-emerald-500/50 dark:bg-emerald-400/40' : 'bg-transparent'}`} />
                            <pre className={`flex-1 px-2.5 py-[1px] font-mono text-[10px] leading-[1.7] whitespace-pre ${addedSet.has(li) ? 'bg-emerald-100/60 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-200' : 'text-[#1c1b1a] dark:text-[#e0dcd4]'}`}>{line || ' '}</pre>
                          </div>
                        ))}
                        {removedLines.map((rm, ri) => (
                          <div key={`del-${ri}`} className="flex items-stretch">
                            <div className="w-0.5 shrink-0 bg-red-400/50 dark:bg-red-500/40" />
                            <pre className="flex-1 px-2.5 py-[1px] font-mono text-[10px] leading-[1.7] whitespace-pre bg-red-100/50 dark:bg-red-900/15 text-red-700 dark:text-red-300 line-through opacity-70">{rm.text || ' '}</pre>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    );
  };

  const handleNewThread = () => {
    setMessages([]);
    setSubAgents([]);
    setAgentAttachments([]);
    freshMessageIdsRef.current.clear();
    subAgentQueueRef.current = [];
    runningSubAgentsRef.current = 0;
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
        {isSending && (
          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-[#8c887d] dark:text-[#a09c94]">
            <Loader2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 animate-spin" /> Thinking…
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

      {/* Sub-agent orchestration indicator: shows currently queued/running/done
          sub-agents (hard-capped at MAX_CONCURRENT_SUBAGENTS concurrent). */}
      <AnimatePresence>
        {subAgents.some((t) => t.status === 'queued' || t.status === 'running') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-[#e5e3db] dark:border-[#2d2d2c] px-2 sm:px-3 py-2 space-y-1 sm:space-y-1.5 shrink-0 overflow-hidden"
          >
            <div className="flex items-center gap-1 sm:gap-1.5 text-[8px] sm:text-[9.5px] uppercase tracking-wide text-[#a39d8f] dark:text-[#767671]">
              <Bot className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> Sub-agents ({subAgents.filter((t) => t.status === 'running').length}/{MAX_CONCURRENT_SUBAGENTS})
            </div>
            {subAgents
              .filter((t) => t.status === 'queued' || t.status === 'running')
              .map((t) => (
                <div key={t.id} className="flex items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[10.5px] text-[#3d3a33] dark:text-[#dedcd6]">
                  {t.status === 'running' ? (
                    <Loader2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#d96b43] shrink-0 animate-spin" />
                  ) : (
                    <span className="inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-[#c7c3b6]" />
                  )}
                  <span className="truncate flex-1">{t.label}</span>
                  <span className="text-[#8c887d] dark:text-[#767671] shrink-0 text-[8px] sm:text-[9px]">{SUBAGENT_STATUS_LABEL[t.status]}</span>
                </div>
              ))}
          </motion.div>
        )}
      </AnimatePresence>

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
