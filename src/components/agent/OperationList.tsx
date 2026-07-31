import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, FilePlus, Loader2, Trash2 } from 'lucide-react';

import type { AgentFileOp } from '../../types';

export interface OperationListProps {
  messageId: string;
  operations: AgentFileOp[];
  codingPaths?: string[];
  openItems: Set<string>;
  onToggle: (id: string) => void;
}

export const OperationList: React.FC<OperationListProps> = ({
  messageId,
  operations,
  codingPaths,
  openItems,
  onToggle,
}) => (
  <>
    {operations.map((operation, operationIndex) => {
      const isCoding = codingPaths?.includes(operation.path);
      // A model may propose multiple edits to the same path in one message.
      // Include the immutable occurrence index so React keys and disclosure
      // state remain independent for every proposed operation.
      const operationId = `${messageId}-op-${operationIndex}-${operation.path}`;
      const isOpen = openItems.has(operationId);
      const lines = operation.content ? operation.content.split('\n') : [];
      const addedLines = new Set(operation.addedLines || []);
      const removedLines = operation.removedLines || [];
      const pathParts = operation.path.split('/');
      const fileName = pathParts.pop() || operation.path;
      const directoryPath = pathParts.join('/');

      return (
        <div
          key={operationId}
          className="select-none border border-[#dfe3ea] dark:border-[#282c33] rounded-md overflow-hidden mb-2"
        >
          <button
            type="button"
            onClick={() => !isCoding && onToggle(operationId)}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-[#f5f3eb] dark:bg-[#1e2128] border-b border-[#dfe3ea] dark:border-[#282c33] text-[10.5px] text-[#4a5259] dark:text-[#a9afbc] hover:bg-[#efece3] dark:hover:bg-[#2a2a29] cursor-pointer ws-button-smooth"
          >
            {isCoding ? (
              <Loader2 className="w-3 h-3 animate-spin shrink-0 text-[#78828e]" />
            ) : operation.type === 'delete' ? (
              <Trash2 className="w-3 h-3 shrink-0 text-[#78828e]" />
            ) : (
              <FilePlus className="w-3 h-3 shrink-0 text-[#78828e]" />
            )}
            <span className="truncate flex-1 text-left">
              {directoryPath && <span className="opacity-50">{directoryPath}/</span>}
              <span className="font-medium text-[#16181d] dark:text-[#dce0e5]">{fileName}</span>
            </span>
            {!isCoding && (
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-200 shrink-0 text-[#78828e] ${isOpen ? 'rotate-180' : ''}`}
              />
            )}
          </button>
          <AnimatePresence>
            {isOpen && !isCoding && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                {operation.type === 'delete' ? (
                  <div className="px-2.5 py-1.5 text-[10.5px] text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/10">
                    Will delete this file
                  </div>
                ) : lines.length > 0 || removedLines.length > 0 ? (
                  <div className="h-48 overflow-y-auto thin-scrollbar">
                    {lines.map((line, index) => (
                      <div key={`add-${index}`} className="flex items-stretch">
                        <div
                          className={`w-0.5 shrink-0 ${
                            addedLines.has(index)
                              ? 'bg-emerald-500/50 dark:bg-emerald-400/40'
                              : 'bg-transparent'
                          }`}
                        />
                        <pre
                          className={`flex-1 px-2.5 py-[1px] font-mono text-[10px] leading-[1.7] whitespace-pre ${
                            addedLines.has(index)
                              ? 'bg-emerald-100/60 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-200'
                              : 'text-[#16181d] dark:text-[#e0dcd4]'
                          }`}
                        >
                          {line || ' '}
                        </pre>
                      </div>
                    ))}
                    {removedLines.map((removedLine, index) => (
                      <div key={`del-${index}`} className="flex items-stretch">
                        <div className="w-0.5 shrink-0 bg-red-400/50 dark:bg-red-500/40" />
                        <pre className="flex-1 px-2.5 py-[1px] font-mono text-[10px] leading-[1.7] whitespace-pre bg-red-100/50 dark:bg-red-900/15 text-red-700 dark:text-red-300 line-through opacity-70">
                          {removedLine.text || ' '}
                        </pre>
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
  </>
);
