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
      className="my-2 rounded border border-[#d8d5c9] px-3 py-2 text-xs text-[#706c62] dark:border-[#383836] dark:text-[#a09d98]"
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
        <strong className="font-semibold text-[#1c1b1a] dark:text-[#f0efe6]">{children}</strong>
      ),
      a: ({ children, href }) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-[#d96b43] underline">
          {children}
        </a>
      ),
      img: AgentMarkdownImage,
      code: ({ children, className }) => {
        if (className) {
          return (
            <pre className="my-2 p-3 rounded-lg bg-[#efece3] dark:bg-[#141413] overflow-x-auto text-[11px] font-mono leading-relaxed">
              <code>{children}</code>
            </pre>
          );
        }
        return (
          <code className="px-1 py-0.5 rounded bg-[#efece3] dark:bg-[#141413] text-[11px] font-mono">
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
        color: 'text-[#97948A] dark:text-[#97948A]',
        bg: '',
        border: '',
      },
    ])
  ),
  check_for_errors: {
    label: 'Error Check',
    color: 'text-[#97948A] dark:text-[#97948A]',
    bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]',
    border: 'border-[#97948A] dark:border-[#97948A]',
  },
  function_request: {
    label: 'Function Request',
    color: 'text-[#8c887d] dark:text-[#a09c94]',
    bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]',
    border: 'border-[#8c887d] dark:border-[#a09c94]',
  },
  function_result: {
    label: 'Function Result',
    color: 'text-[#8c887d] dark:text-[#a09c94]',
    bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]',
    border: 'border-[#8c887d] dark:border-[#a09c94]',
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
    color: 'text-[#8c887d] dark:text-[#a09c94]',
    bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]',
    border: 'border-[#8c887d] dark:border-[#a09c94]',
  },
  {
    color: 'text-[#97948A] dark:text-[#97948A]',
    bg: 'bg-[#f5f3eb] dark:bg-[#1f1f1e]',
    border: 'border-[#97948A] dark:border-[#97948A]',
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
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-500 dark:border-amber-400',
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
        className={`flex min-w-0 max-w-full items-center gap-1.5 text-[10.5px] font-medium ${color} hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth`}
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
              isThinkTag
                ? 'mt-1.5 pl-2 border-l border-[#e2dec0] dark:border-[#383836] text-[10.5px] text-[#706c62] dark:text-[#a09d98] leading-relaxed overflow-hidden'
                : `mt-1.5 pl-2 border-l ${border} text-[10.5px] ${color} space-y-1 leading-relaxed overflow-hidden`
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
