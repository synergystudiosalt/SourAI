import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, FileText } from 'lucide-react';

type MarkdownImageProps = React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

export function isRemoteImageSource(src: string | undefined): boolean {
  if (!src) return false;
  try {
    const base = typeof window === 'undefined' ? 'https://sour.invalid/' : window.location.href;
    const url = new URL(src, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return typeof window === 'undefined' || url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** Keeps agent-authored Markdown from making an implicit third-party request. */
export const AgentMarkdownImage: React.FC<MarkdownImageProps> = ({
  node: _node,
  src,
  alt,
  ...props
}) => {
  const [allowed, setAllowed] = useState(false);
  if (!src) return null;
  if (!isRemoteImageSource(src) || allowed) {
    return <img {...props} src={src} alt={alt ?? ''} referrerPolicy="no-referrer" />;
  }

  let host = 'remote host';
  try {
    host = new URL(src, window.location.href).host || host;
  } catch {
    // Keep the generic label for malformed URLs.
  }
  return (
    <button
      type="button"
      onClick={() => setAllowed(true)}
      className="my-2 rounded border border-[#c3cad6] px-3 py-2 text-xs text-[#4a5259] dark:border-[#3b414d] dark:text-[#a9afbc]"
    >
      Load remote image from {host}
      {alt ? ` (${alt})` : ''}
    </button>
  );
};

export const MiniMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <ReactMarkdown
    components={{
      p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>,
      ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1 leading-[1.7]">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1 leading-[1.7]">{children}</ol>,
      li: ({ children }) => <li>{children}</li>,
      strong: ({ children }) => (
        <strong className="font-semibold text-[#16181d] dark:text-[#dce0e5]">{children}</strong>
      ),
      a: ({ children, href }) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-[#4776d5] underline">
          {children}
        </a>
      ),
      img: AgentMarkdownImage,
      code: ({ children, className }) => {
        if (className) {
          return (
            <pre className="my-2 p-3 rounded-lg bg-[#e3e7ef] dark:bg-[#131314] overflow-x-auto text-[11px] font-mono leading-relaxed">
              <code>{children}</code>
            </pre>
          );
        }
        return (
          <code className="px-1 py-0.5 rounded bg-[#e3e7ef] dark:bg-[#131314] text-[11px] font-mono">
            {children}
          </code>
        );
      },
    }}
  >
    {text}
  </ReactMarkdown>
);

export interface AgentContentSegment {
  type: string;
  content: string;
}

const XML_TAG_RE = /<([a-zA-Z][\w-]*)>([\s\S]*?)<\/\1>/g;
const THINK_TAGS = ['think', 'thinking', 'reasoning', 'analysis', 'reflection', 'planning', 'step'];
const LOOSE_THINK_TAG_RE = new RegExp(
  `<(${THINK_TAGS.join('|')})>([\\s\\S]*?)(?:<\\/[a-zA-Z][\\w-]*>|$)`,
  'gi'
);

function repairReasoningTags(text: string): string {
  return text.replace(
    LOOSE_THINK_TAG_RE,
    (_match, tag: string, content: string) => `<${tag}>${content}</${tag}>`
  );
}

export function parseAgentContent(text: string): AgentContentSegment[] {
  const repairedText = repairReasoningTags(text);
  const segments: AgentContentSegment[] = [];
  let lastIndex = 0;

  for (const match of repairedText.matchAll(XML_TAG_RE)) {
    if (match.index! > lastIndex) {
      const value = repairedText.slice(lastIndex, match.index).trim();
      if (value) segments.push({ type: 'text', content: value });
    }
    segments.push({ type: match[1], content: match[2].trim() });
    lastIndex = match.index! + match[0].length;
  }

  if (lastIndex < repairedText.length) {
    const value = repairedText.slice(lastIndex).trim();
    if (value) segments.push({ type: 'text', content: value });
  }

  const parsed =
    segments.length > 0 ? segments : [{ type: 'text', content: repairedText }];
  return parsed.reduce<AgentContentSegment[]>((collapsed, segment) => {
    const previous = collapsed[collapsed.length - 1];
    if (
      previous &&
      THINK_TAGS.includes(previous.type) &&
      THINK_TAGS.includes(segment.type)
    ) {
      previous.content = `${previous.content}\n${segment.content}`;
      return collapsed;
    }
    collapsed.push({ ...segment });
    return collapsed;
  }, []);
}

const KNOWN_TAGS: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  ...Object.fromEntries(
    THINK_TAGS.map((tag) => [
      tag,
      {
        label: 'Thinking',
        color: 'text-[#78828e] dark:text-[#78828e]',
        bg: '',
        border: '',
      },
    ])
  ),
  check_for_errors: {
    label: 'Error Check',
    color: 'text-[#78828e] dark:text-[#78828e]',
    bg: 'bg-[#ebeef5] dark:bg-[#1e1e1f]',
    border: 'border-[#78828e] dark:border-[#78828e]',
  },
  function_request: {
    label: 'Function Request',
    color: 'text-[#78828e] dark:text-[#a9afbc]',
    bg: 'bg-[#ebeef5] dark:bg-[#1e1e1f]',
    border: 'border-[#78828e] dark:border-[#a9afbc]',
  },
  function_result: {
    label: 'Function Result',
    color: 'text-[#78828e] dark:text-[#a9afbc]',
    bg: 'bg-[#ebeef5] dark:bg-[#1e1e1f]',
    border: 'border-[#78828e] dark:border-[#a9afbc]',
  },
  using_fallback_model: {
    label: 'Using Fallback Model',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-500 dark:border-blue-400',
  },
  context_compact: {
    label: 'Context Compacted',
    color: 'text-purple-500 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-500 dark:border-purple-400',
  },
};

const TAG_COLOR_CYCLE = [
  {
    color: 'text-[#78828e] dark:text-[#a9afbc]',
    bg: 'bg-[#ebeef5] dark:bg-[#1e1e1f]',
    border: 'border-[#78828e] dark:border-[#a9afbc]',
  },
  {
    color: 'text-[#78828e] dark:text-[#78828e]',
    bg: 'bg-[#ebeef5] dark:bg-[#1e1e1f]',
    border: 'border-[#78828e] dark:border-[#78828e]',
  },
  {
    color: 'text-blue-500 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-500 dark:border-blue-400',
  },
  {
    color: 'text-purple-500 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-500 dark:border-purple-400',
  },
  {
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-500 dark:border-blue-400',
  },
  {
    color: 'text-rose-500 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    border: 'border-rose-500 dark:border-rose-400',
  },
  {
    color: 'text-cyan-600 dark:text-cyan-400',
    bg: 'bg-cyan-50 dark:bg-cyan-950/30',
    border: 'border-cyan-500 dark:border-cyan-400',
  },
  {
    color: 'text-slate-500 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-950/30',
    border: 'border-slate-500 dark:border-slate-400',
  },
];

function getTagMeta(
  tagName: string
): { label: string; color: string; bg: string; border: string } {
  if (KNOWN_TAGS[tagName]) return KNOWN_TAGS[tagName];
  let hash = 0;
  for (let index = 0; index < tagName.length; index++) {
    hash = ((hash << 5) - hash + tagName.charCodeAt(index)) | 0;
  }
  const palette = TAG_COLOR_CYCLE[Math.abs(hash) % TAG_COLOR_CYCLE.length];
  const label = tagName.replace(/[_-]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  return { label, ...palette };
}

interface ExpandableTagProps {
  tagType: string;
  content: string;
  id: string;
  openSet: Set<string>;
  onToggle: (id: string) => void;
  isActive?: boolean;
}

const ExpandableTag: React.FC<ExpandableTagProps> = ({
  tagType,
  content,
  id,
  openSet,
  onToggle,
  isActive = false,
}) => {
  const { label, color, border } = getTagMeta(tagType);
  const isOpen = openSet.has(id);
  const isThinkTag = THINK_TAGS.includes(tagType);
  const showsReadIcon = tagType.toLowerCase() === 'read';
  const activeLabel =
    isActive && isThinkTag
      ? content.split(/\n/).find(Boolean)?.trim().slice(0, 80) || 'Thinking'
      : label;
  const steps = content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 12);

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className={`flex min-w-0 max-w-full items-center gap-1.5 text-[10.5px] font-medium ${color} hover:text-[#16181d] dark:hover:text-[#dce0e5] cursor-pointer ws-button-smooth`}
      >
        {showsReadIcon && (
          <FileText data-testid="read-tag-icon" aria-hidden="true" className="w-3 h-3 shrink-0" />
        )}
        {/* The sweep is an activity indicator, so it must stop when the run
            does. Left unconditional it animates forever on finished messages. */}
        <span
          className={`min-w-0 truncate ${isActive ? 'agent-active-gradient' : ''}`}
          title={activeLabel}
        >
          {activeLabel}
        </span>
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className={
              // Reasoning can run to thousands of words and often contains
              // long unbroken tokens — identifiers, URLs, inline code. Without
              // a height cap it grew until it filled the transcript, and
              // without a wrap rule those tokens pushed out past the panel.
              // Capped and scrollable keeps it readable and the layout intact.
              isThinkTag
                ? 'mt-1.5 pl-2 border-l border-[#dfe3ea] dark:border-[#3b414d] text-[10.5px] text-[#4a5259] dark:text-[#a9afbc] leading-relaxed max-h-64 overflow-y-auto overflow-x-hidden [overflow-wrap:anywhere] thin-scrollbar'
                : `mt-1.5 pl-2 border-l ${border} text-[10.5px] ${color} space-y-1 leading-relaxed max-h-64 overflow-y-auto overflow-x-hidden [overflow-wrap:anywhere] thin-scrollbar`
            }
          >
            {isThinkTag
              ? content
              : steps.map((step, index) => <div key={index}>{step}</div>)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const RAW_MODEL_RESPONSE_MAX_CHARS = 4_000;

export function truncateRawModelResponse(
  text: string,
  limit = RAW_MODEL_RESPONSE_MAX_CHARS
): { text: string; truncated: boolean } {
  return text.length > limit
    ? { text: text.slice(0, limit), truncated: true }
    : { text, truncated: false };
}

interface RawModelResponseProps {
  text: string;
  id: string;
  openSet: Set<string>;
  onToggle: (id: string) => void;
}

/** Renders provider output as escaped text, never as Markdown or agent protocol. */
export const RawModelResponse: React.FC<RawModelResponseProps> = ({
  text,
  id,
  openSet,
  onToggle,
}) => {
  const isOpen = openSet.has(id);
  const clipped = truncateRawModelResponse(text);
  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex min-w-0 max-w-full items-center gap-1.5 text-[10.5px] font-medium text-[#78828e] hover:text-[#16181d] dark:text-[#78828e] dark:hover:text-[#dce0e5] cursor-pointer ws-button-smooth"
      >
        <span className="min-w-0 truncate">Raw model response (for diagnosis)</span>
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-1.5 pl-2 border-l border-[#dfe3ea] dark:border-[#3b414d] text-[10.5px] text-[#4a5259] dark:text-[#a9afbc] leading-relaxed max-h-64 overflow-y-auto overflow-x-hidden [overflow-wrap:anywhere] thin-scrollbar"
          >
            <pre className="m-0 whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">
              {clipped.text || '(empty response)'}
            </pre>
            {clipped.truncated && (
              <div className="mt-2 italic">
                Raw model response truncated after {RAW_MODEL_RESPONSE_MAX_CHARS.toLocaleString()} characters.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export interface AgentContentProps {
  text: string;
  messageId: string;
  openTags: Set<string>;
  onToggleTag: (id: string) => void;
  isActive?: boolean;
}

/** Renders agent content with expandable XML tag sections. */
export const AgentContent: React.FC<AgentContentProps> = ({
  text,
  messageId,
  openTags,
  onToggleTag,
  isActive = false,
}) => {
  const segments = parseAgentContent(text);
  return (
    <div className="space-y-1">
      {segments.map((segment, index) => {
        const segmentId = `${messageId}-xml-${index}`;
        if (segment.type === 'text') {
          return <MiniMarkdown key={index} text={segment.content} />;
        }
        return (
          <ExpandableTag
            key={index}
            tagType={segment.type}
            content={segment.content}
            id={segmentId}
            openSet={openTags}
            onToggle={onToggleTag}
            isActive={isActive}
          />
        );
      })}
    </div>
  );
};

/**
 * Reveals `text` a few characters at a time for newly generated messages.
 * Once complete, later renders keep the full text visible.
 */
export const TypedMarkdown: React.FC<{ text: string; enabled: boolean }> = ({
  text,
  enabled,
}) => {
  const [shown, setShown] = useState(enabled ? '' : text);
  const doneRef = useRef(!enabled);

  useEffect(() => {
    if (doneRef.current || !enabled) {
      setShown(text);
      return;
    }
    let index = 0;
    const timer = setInterval(() => {
      index += 4;
      if (index >= text.length) {
        setShown(text);
        doneRef.current = true;
        clearInterval(timer);
      } else {
        setShown(text.slice(0, index));
      }
    }, 14);
    return () => clearInterval(timer);
    // The animation intentionally starts once for a newly mounted message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return <MiniMarkdown text={shown} />;
};
