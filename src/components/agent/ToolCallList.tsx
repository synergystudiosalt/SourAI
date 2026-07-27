import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Loader2, Search, Terminal } from 'lucide-react';

import type { AgentToolCall } from '../../types';

export interface ToolCallListProps {
  messageId: string;
  toolCalls: AgentToolCall[];
  isReading: boolean;
  openItems: Set<string>;
  onToggle: (id: string) => void;
}

function toolCallLabel(toolCall: AgentToolCall): string {
  switch (toolCall.type) {
    case 'readfile':
      return `Read: ${toolCall.path}`;
    case 'findall':
      return `Search: ${toolCall.query}`;
    case 'replace':
      return `Replace: ${toolCall.path}`;
    case 'search_imports':
      return `Imports: ${toolCall.symbol}`;
    case 'rename':
      return `Rename: ${toolCall.oldPath} → ${toolCall.newPath}`;
    case 'listdir':
      return `Dir: ${toolCall.path}`;
    case 'glob':
      return `Glob: ${toolCall.pattern}`;
  }
}

const ToolCallDetails: React.FC<{ toolCall: AgentToolCall }> = ({ toolCall }) => {
  switch (toolCall.type) {
    case 'readfile':
      return (
        <div className="flex items-center gap-1.5">
          {toolCall.found ? (
            <Check className="w-3 h-3 text-amber-600 shrink-0" />
          ) : (
            <span className="w-3 h-3 text-red-400 shrink-0 font-bold leading-3 text-center">!</span>
          )}
          <span className="font-mono truncate">{toolCall.path}</span>
          {!toolCall.found && <span className="text-red-400 shrink-0">not found</span>}
        </div>
      );
    case 'findall':
      return (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5 font-medium">
            <span>
              "{toolCall.query}" &mdash; {toolCall.matchCount} match
              {toolCall.matchCount !== 1 ? 'es' : ''} in {toolCall.fileCount} file
              {toolCall.fileCount !== 1 ? 's' : ''}
            </span>
          </div>
          {toolCall.matches.slice(0, 5).map((match, index) => (
            <div key={index} className="pl-3 font-mono text-[9.5px] truncate">
              <span className="opacity-60">
                {match.path}:{match.line}
              </span>{' '}
              {match.text}
            </div>
          ))}
          {toolCall.matchCount > 5 && (
            <div className="pl-3 opacity-50 text-[9.5px]">
              …and {toolCall.matchCount - 5} more
            </div>
          )}
        </div>
      );
    case 'replace':
      return (
        <div className="space-y-1">
          <div className="font-mono truncate">{toolCall.path}</div>
          {toolCall.applied ? (
            <div className="text-amber-600">
              Applied ({toolCall.search.length} → {toolCall.replace.length} chars)
            </div>
          ) : toolCall.found ? (
            <div className="text-red-400">Search string not found</div>
          ) : (
            <div className="text-red-400">File not found</div>
          )}
        </div>
      );
    case 'search_imports':
      return (
        <div className="space-y-2.5">
          <div className="font-medium">
            "{toolCall.symbol}" &mdash; {toolCall.matchCount} usage
            {toolCall.matchCount !== 1 ? 's' : ''}
          </div>
          {toolCall.matches.slice(0, 5).map((match, index) => (
            <div key={index} className="pl-3 font-mono text-[9.5px] truncate">
              <span className="opacity-60">
                {match.path}:{match.line}
              </span>{' '}
              {match.text}
            </div>
          ))}
          {toolCall.matchCount > 5 && (
            <div className="pl-3 opacity-50 text-[9.5px]">
              …and {toolCall.matchCount - 5} more
            </div>
          )}
        </div>
      );
    case 'rename':
      return (
        <div className="font-mono text-[9.5px]">
          {toolCall.oldPath} → {toolCall.newPath}
        </div>
      );
    case 'listdir':
      return (
        <div className="space-y-1">
          <div className="font-medium flex items-center gap-1.5">
            <Terminal className="w-3 h-3 shrink-0" />
            <span>
              {toolCall.path} ({toolCall.entries.length} entries)
            </span>
          </div>
          {toolCall.entries.slice(0, 20).map((entry, index) => (
            <div key={index} className="pl-3 font-mono text-[9.5px]">
              {entry.endsWith('/') ? (
                <span className="text-amber-600 dark:text-amber-400">{entry}</span>
              ) : (
                <span>{entry}</span>
              )}
            </div>
          ))}
          {toolCall.entries.length > 20 && (
            <div className="pl-3 opacity-50 text-[9.5px]">
              …and {toolCall.entries.length - 20} more
            </div>
          )}
        </div>
      );
    case 'glob':
      return (
        <div className="space-y-1">
          <div className="font-medium flex items-center gap-1.5">
            <Terminal className="w-3 h-3 shrink-0" />
            <span>
              {toolCall.pattern} — {toolCall.matchCount} file
              {toolCall.matchCount !== 1 ? 's' : ''}
            </span>
          </div>
          {toolCall.matches.slice(0, 15).map((path, index) => (
            <div key={index} className="pl-3 font-mono text-[9.5px] truncate">
              {path}
            </div>
          ))}
          {toolCall.matchCount > 15 && (
            <div className="pl-3 opacity-50 text-[9.5px]">
              …and {toolCall.matchCount - 15} more
            </div>
          )}
        </div>
      );
  }
};

export const ToolCallList: React.FC<ToolCallListProps> = ({
  messageId,
  toolCalls,
  isReading,
  openItems,
  onToggle,
}) => (
  <>
    {toolCalls.map((toolCall, index) => {
      const itemId = `${messageId}-tc-${index}`;
      const isOpen = openItems.has(itemId);
      return (
        <div key={itemId} className="select-none">
          <button
            type="button"
            onClick={() => !isReading && onToggle(itemId)}
            className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#8c887d] dark:text-[#a09c94] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer ws-button-smooth"
          >
            {isReading ? (
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            ) : toolCall.type === 'readfile' ? (
              toolCall.found ? (
                <Check className="w-3 h-3 text-amber-600 shrink-0" />
              ) : (
                <Search className="w-3 h-3 shrink-0" />
              )
            ) : toolCall.type === 'listdir' || toolCall.type === 'glob' ? (
              <Terminal className="w-3 h-3 shrink-0" />
            ) : (
              <Search className="w-3 h-3 shrink-0" />
            )}
            <span>{toolCallLabel(toolCall)}</span>
            {!isReading && (
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              />
            )}
          </button>
          <AnimatePresence>
            {isOpen && !isReading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="mt-1.5 pl-2 border-l border-[#e2dec0] dark:border-[#383836] text-[10.5px] text-[#706c62] dark:text-[#a09d98] space-y-1 leading-relaxed overflow-hidden"
              >
                <ToolCallDetails toolCall={toolCall} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    })}
  </>
);
