import React, { useMemo, useState } from 'react';
import { ChevronRight, Minimize2, Maximize2 } from 'lucide-react';

import {
  collectMindMapIds,
  countMindMapNodes,
  parseMindMap,
  type MindMapNode,
} from '../../features/notebook/mindMap';

/**
 * Interactive mind map.
 *
 * Branches expand and collapse from the centre outwards, drawn with square
 * connectors so it sits inside the same boxy geometry as the rest of the app
 * rather than importing a graph library and its rounded house style.
 */

interface BranchProps {
  node: MindMapNode;
  depth: number;
  isLast: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}

const TONE = [
  'border-[#4776d5] text-[#16181d] dark:text-[#dce0e5]',
  'border-[#7d9ae0] text-[#16181d] dark:text-[#dce0e5]',
  'border-[#a9b8d8] text-[#4a5259] dark:text-[#a9afbc]',
  'border-[#c3cad6] text-[#4a5259] dark:text-[#a9afbc]',
];

const Branch: React.FC<BranchProps> = ({ node, depth, isLast, expanded, onToggle }) => {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const tone = TONE[Math.min(depth, TONE.length - 1)];

  return (
    <li className="relative pl-5">
      {/* Vertical rail from the parent, stopping at this row when it is last. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 w-px bg-[#dfe3ea] dark:bg-[#282c33] ${
          isLast ? 'h-[15px]' : 'h-full'
        }`}
      />
      <span
        aria-hidden="true"
        className="absolute left-0 top-[15px] h-px w-4 bg-[#dfe3ea] dark:bg-[#282c33]"
      />
      <div className="flex items-center gap-1 py-1">
        <button
          type="button"
          onClick={hasChildren ? () => onToggle(node.id) : undefined}
          disabled={!hasChildren}
          className={`flex max-w-full items-center gap-1 border-l-2 bg-[#f6f8fa] px-2 py-1 text-left text-[11.5px] leading-tight dark:bg-[#1e2128] ${tone} ${
            hasChildren
              ? 'cursor-pointer hover:bg-[#e8edf8] dark:hover:bg-[#232833]'
              : 'cursor-default'
          }`}
        >
          {hasChildren && (
            <ChevronRight
              className={`h-3 w-3 shrink-0 text-[#78828e] transition-transform duration-[var(--z-motion)] ${
                isOpen ? 'rotate-90' : ''
              }`}
            />
          )}
          <span className="truncate">{node.label}</span>
          {hasChildren && !isOpen && (
            <span className="ml-1 shrink-0 font-code text-[9px] text-[#78828e]">
              {node.children.length}
            </span>
          )}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul className="relative">
          {node.children.map((child, index) => (
            <Branch
              key={child.id}
              node={child}
              depth={depth + 1}
              isLast={index === node.children.length - 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

export interface MindMapProps {
  markdown: string;
  rootLabel?: string;
}

export const MindMap: React.FC<MindMapProps> = ({ markdown, rootLabel = 'Notebook' }) => {
  const tree = useMemo(() => parseMindMap(markdown, rootLabel), [markdown, rootLabel]);
  const allIds = useMemo(() => collectMindMapIds(tree), [tree]);
  // The first ring opens by default: enough to read the shape of the map
  // without unfolding every leaf at once.
  const initial = useMemo(() => new Set<string>([tree.id]), [tree]);
  const [expanded, setExpanded] = useState<Set<string>>(initial);

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (tree.children.length === 0) {
    return (
      <p className="px-1 py-4 text-[12px] text-[#78828e] dark:text-[#a9afbc]">
        The mind map could not be read as an outline.
      </p>
    );
  }

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-[#dfe3ea] pb-2 dark:border-[#282c33]">
        <span className="font-code text-[10px] uppercase tracking-wider text-[#78828e]">
          {countMindMapNodes(tree)} nodes
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(new Set(allIds))}
            title="Expand all"
            className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-1 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
          >
            <Maximize2 className="h-3 w-3" />
            Expand
          </button>
          <button
            type="button"
            onClick={() => setExpanded(new Set([tree.id]))}
            title="Collapse all"
            className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-1 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
          >
            <Minimize2 className="h-3 w-3" />
            Collapse
          </button>
        </div>
      </div>

      <div className="overflow-x-auto thin-scrollbar">
        <div className="min-w-max">
          <div className="mb-1 inline-flex items-center border border-[#4776d5] bg-[#e8edf8] px-2.5 py-1.5 text-[12px] font-semibold text-[#16181d] dark:bg-[#1c2434] dark:text-[#dce0e5]">
            {tree.label}
          </div>
          <ul className="relative">
            {tree.children.map((child, index) => (
              <Branch
                key={child.id}
                node={child}
                depth={0}
                isLast={index === tree.children.length - 1}
                expanded={expanded}
                onToggle={toggle}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
