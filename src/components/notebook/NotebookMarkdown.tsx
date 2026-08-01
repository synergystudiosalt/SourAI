import React, { Children, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';

import { AgentMarkdownImage } from '../agent/MarkdownContent';

/**
 * Grounded Markdown: renders an answer and turns its `[n]` markers into
 * clickable citation chips.
 *
 * The substitution happens on rendered children rather than on the Markdown
 * source, because rewriting the source would corrupt link syntax (`[text](url)`)
 * and reference definitions. Walking the tree instead means a bracketed number
 * inside a code span is left exactly as written.
 */

export const CITATION_PATTERN = /\[(\d{1,2})\]/g;

interface CitationChipProps {
  index: number;
  label?: string;
  onSelect?: (index: number) => void;
}

const CitationChip: React.FC<CitationChipProps> = ({ index, label, onSelect }) => (
  <button
    type="button"
    onClick={onSelect ? () => onSelect(index) : undefined}
    title={label ? `Source ${index}: ${label}` : `Source ${index}`}
    aria-label={label ? `Source ${index}: ${label}` : `Source ${index}`}
    className={`mx-[1px] inline-flex h-[15px] min-w-[15px] translate-y-[-1px] items-center justify-center border border-[#c9d3e8] bg-[#e8edf8] px-[3px] align-middle font-code text-[9px] leading-none text-[#33518f] dark:border-[#33405c] dark:bg-[#1c2434] dark:text-[#93aee6] ${
      onSelect ? 'cursor-pointer hover:border-[#4776d5] hover:text-[#4776d5]' : 'cursor-default'
    }`}
  >
    {index}
  </button>
);

export interface CitationResolver {
  /** Human label for a marker, used in the chip's tooltip. */
  labelFor?: (index: number) => string | undefined;
  onSelect?: (index: number) => void;
}

function splitCitations(text: string, resolver: CitationResolver, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(CITATION_PATTERN.source, 'g');
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const index = Number(match[1]);
    nodes.push(
      <CitationChip
        key={`${keyPrefix}-${match.index}`}
        index={index}
        label={resolver.labelFor?.(index)}
        onSelect={resolver.onSelect}
      />
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex === 0) return [text];
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Recursively replaces citation markers in rendered children. */
export function withCitations(
  children: React.ReactNode,
  resolver: CitationResolver,
  keyPrefix = 'c'
): React.ReactNode {
  return Children.map(children, (child, position) => {
    if (typeof child === 'string') {
      const parts = splitCitations(child, resolver, `${keyPrefix}-${position}`);
      return parts.length === 1 ? parts[0] : <>{parts}</>;
    }
    if (isValidElement(child)) {
      const element = child as React.ReactElement<{ children?: React.ReactNode }>;
      // Code spans keep their literal text: `[1]` inside code is code.
      if (element.type === 'code' || element.type === 'pre') return child;
      if (element.props?.children === undefined) return child;
      return React.cloneElement(element, {
        children: withCitations(element.props.children, resolver, `${keyPrefix}-${position}`),
      });
    }
    return child;
  });
}

export interface NotebookMarkdownProps {
  text: string;
  resolver?: CitationResolver;
  className?: string;
}

export const NotebookMarkdown: React.FC<NotebookMarkdownProps> = ({
  text,
  resolver,
  className = '',
}) => {
  const cite = (children: React.ReactNode) =>
    resolver ? withCitations(children, resolver) : children;

  return (
    <div
      className={`text-[13px] leading-[1.75] text-[#16181d] dark:text-[#dce0e5] ${className}`}
    >
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 font-heading text-[19px] not-italic first:mt-0">{cite(children)}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 font-heading text-[16px] first:mt-0">{cite(children)}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1.5 font-heading text-[14px] first:mt-0">{cite(children)}</h3>
          ),
          p: ({ children }) => <p className="mb-2.5 last:mb-0">{cite(children)}</p>,
          ul: ({ children }) => <ul className="mb-2.5 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2.5 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{cite(children)}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[#16181d] dark:text-[#f0f2f5]">
              {cite(children)}
            </strong>
          ),
          em: ({ children }) => <em>{cite(children)}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-2.5 border-l-2 border-[#c3cad6] pl-3 text-[#4a5259] dark:border-[#3b414d] dark:text-[#a9afbc]">
              {cite(children)}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-t border-[#dfe3ea] dark:border-[#282c33]" />,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[#4776d5] underline underline-offset-2"
            >
              {children}
            </a>
          ),
          img: AgentMarkdownImage,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto thin-scrollbar">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[#dfe3ea] bg-[#f2f4f7] px-2 py-1 text-left font-semibold dark:border-[#282c33] dark:bg-[#1e2128]">
              {cite(children)}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[#dfe3ea] px-2 py-1 align-top dark:border-[#282c33]">
              {cite(children)}
            </td>
          ),
          code: ({ children, className: codeClass }) =>
            codeClass ? (
              <pre className="my-2.5 overflow-x-auto bg-[#f2f4f7] p-3 font-code text-[11.5px] leading-relaxed dark:bg-[#131418] thin-scrollbar">
                <code>{children}</code>
              </pre>
            ) : (
              <code className="bg-[#f2f4f7] px-1 py-0.5 font-code text-[11.5px] dark:bg-[#131418]">
                {children}
              </code>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};
