import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, CircleX, Loader2, Search, Terminal } from 'lucide-react';

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
      return `${toolCall.found ? 'Read' : 'Missing'}: ${toolCall.path}`;
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
  toolCalls: rawToolCalls,
  isReading,
  openItems,
  onToggle,
}) => {
  const seenReadPaths = new Set<string>();
  const toolCalls = rawToolCalls.filter((call) => {
    if (call.type !== 'readfile') return true;
    if (seenReadPaths.has(call.path)) return false;
    seenReadPaths.add(call.path);
    return true;
  });

  if (toolCalls.length > 3) {
    const groupId = `${messageId}-tool-activity`;
    const isOpen = openItems.has(groupId);
    const reads = toolCalls.filter((call) => call.type === 'readfile').length;
    const missing = toolCalls.filter(
      (call) => call.type === 'readfile' && !call.found
    ).length;
    const successfulReads = reads - missing;
    const searches = toolCalls.filter(
      (call) => call.type === 'findall' || call.type === 'search_imports' || call.type === 'glob'
    ).length;
    const mutations = toolCalls.filter(
      (call) => call.type === 'replace' || call.type === 'rename'
    ).length;
    const summary = [
      successfulReads ? `${successfulReads} file${successfulReads === 1 ? '' : 's'} read` : '',
      missing ? `${missing} missing` : '',
      searches ? `${searches} search${searches === 1 ? '' : 'es'}` : '',
      mutations ? `${mutations} edit${mutations === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ') || `${toolCalls.length} workspace actions`;

    return (
      <div className="select-none">
        <button
          type="button"
          onClick={() => !isReading && onToggle(groupId)}
          className="flex min-w-0 max-w-full items-center gap-1.5 text-[10.5px] font-medium text-[#78828e] hover:text-[#16181d] dark:text-[#a9afbc] dark:hover:text-[#dce0e5]"
        >
          {isReading ? (
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          ) : missing > 0 && successfulReads === 0 ? (
            <CircleX className="h-3 w-3 shrink-0 text-red-400" />
          ) : (
            <Check className="h-3 w-3 shrink-0 text-amber-600" />
          )}
          <span
            className={`min-w-0 truncate ${isReading ? 'agent-active-gradient' : ''}`}
            title={isReading ? `Working · ${summary}` : summary}
          >
            {isReading ? `Working · ${summary}` : summary}
          </span>
          {!isReading && (
            <ChevronDown
              className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          )}
        </button>
        <AnimatePresence>
          {isOpen && !isReading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-1.5 max-h-40 space-y-1 overflow-y-auto border-l border-[#dfe3ea] pl-2 text-[10px] text-[#4a5259] dark:border-[#3b414d] dark:text-[#a9afbc]"
            >
              {toolCalls.map((toolCall, index) => (
                <div key={`${groupId}-${index}`} className="truncate">
                  {toolCallLabel(toolCall)}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <>
    {toolCalls.map((toolCall, index) => {
      const itemId = `${messageId}-tc-${index}`;
      const isOpen = openItems.has(itemId);
      return (
        <div key={itemId} className="select-none">
          <button
            type="button"
            onClick={() => !isReading && onToggle(itemId)}
            className="flex min-w-0 max-w-full items-center gap-1.5 text-[10.5px] font-medium text-[#78828e] dark:text-[#a9afbc] hover:text-[#16181d] dark:hover:text-[#dce0e5] cursor-pointer ws-button-smooth"
          >
            {isReading && !(toolCall.type === 'readfile' && !toolCall.found) ? (
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            ) : toolCall.type === 'readfile' ? (
              toolCall.found ? (
                <Check className="w-3 h-3 text-amber-600 shrink-0" />
              ) : (
                <CircleX className="w-3 h-3 shrink-0 text-red-400" />
              )
            ) : toolCall.type === 'listdir' || toolCall.type === 'glob' ? (
              <Terminal className="w-3 h-3 shrink-0" />
            ) : (
              <Search className="w-3 h-3 shrink-0" />
            )}
            <span
              className={`min-w-0 truncate ${isReading ? 'agent-active-gradient' : ''}`}
              title={toolCallLabel(toolCall)}
            >
              {toolCallLabel(toolCall)}
            </span>
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
                className="mt-1.5 pl-2 border-l border-[#dfe3ea] dark:border-[#3b414d] text-[10.5px] text-[#4a5259] dark:text-[#a9afbc] space-y-1 leading-relaxed overflow-hidden"
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
};
