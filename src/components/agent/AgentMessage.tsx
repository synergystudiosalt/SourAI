import React from 'react';
import { Check, Loader2, X } from 'lucide-react';

import type { AgentChatMessage, AgentFileOp } from '../../types';
import Logo from '../Logo';
import { AgentContent, RawModelResponse, TypedMarkdown } from './MarkdownContent';
import { OperationList } from './OperationList';
import { ToolCallList } from './ToolCallList';
import { collapseAgentFileOps } from '../../utils/agentProtocol';

export interface AgentMessageProps {
  message: AgentChatMessage;
  isLatest: boolean;
  animateTyping: boolean;
  openTags: Set<string>;
  openItems: Set<string>;
  onToggleTag: (id: string) => void;
  onToggleItem: (id: string) => void;
  onApplyOperations: (messageId: string, operations: AgentFileOp[]) => void;
  onRejectOperations: (messageId: string) => void;
}

export const AgentMessage: React.FC<AgentMessageProps> = ({
  message,
  isLatest,
  animateTyping,
  openTags,
  openItems,
  onToggleTag,
  onToggleItem,
  onApplyOperations,
  onRejectOperations,
}) => {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[88%] bg-[#f0ede4] dark:bg-[#252524] text-[#1c1b1a] dark:text-[#f0efe6] px-2.5 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap wrap-break-word rounded-lg">
          {message.content}
        </div>
      </div>
    );
  }

  const isTyping = animateTyping && isLatest;
  const operations = collapseAgentFileOps(message.ops || []);

  return (
    <div className="space-y-1.5 mb-5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#a39d8f] dark:text-[#767671]">
        <Logo size={12} /> sour.ai Agent
      </div>

      {(message.thinking || message.isReadingFiles) && (
        <div role={message.isReadingFiles ? 'status' : undefined} aria-live={message.isReadingFiles ? 'polite' : undefined}>
          <AgentContent
          text={`<thinking>${message.thinking || message.thinkingLabel || 'Thinking'}</thinking>`}
          messageId={`${message.id}-provider-thinking`}
          openTags={openTags}
          onToggleTag={onToggleTag}
          isActive={Boolean(message.isReadingFiles)}
          />
        </div>
      )}

      {message.content && (
        <div
          className={`text-[12px] leading-[1.7] wrap-break-word ${
            message.isError
              ? 'text-red-600 dark:text-red-400'
              : 'text-[#3d3a33] dark:text-[#dedcd6]'
          }`}
        >
          {!message.content.startsWith('**Sub-agent') ? (
            <AgentContent
              text={message.content}
              messageId={message.id}
              openTags={openTags}
              onToggleTag={onToggleTag}
            />
          ) : (
            <TypedMarkdown text={message.content} enabled={isTyping} />
          )}
        </div>
      )}

      {message.rawModelResponse !== undefined && (
        <RawModelResponse
          text={message.rawModelResponse}
          id={`${message.id}-raw-model-response`}
          openSet={openTags}
          onToggle={onToggleTag}
        />
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallList
          messageId={message.id}
          toolCalls={message.toolCalls}
          isReading={Boolean(message.isReadingFiles)}
          openItems={openItems}
          onToggle={onToggleItem}
        />
      )}

      {operations.length > 0 && (
        <div className="overflow-hidden rounded-md border border-[#d8d5c9] bg-white dark:border-[#3a3937] dark:bg-[#20201f]">
          <div className="px-2 pt-2">
            <OperationList
              messageId={message.id}
              operations={operations}
              codingPaths={message.codingPaths}
              openItems={openItems}
              onToggle={onToggleItem}
            />
          </div>
          {message.approvalStatus === 'applied' ? (
            <div className="flex items-center gap-1.5 border-t border-[#e5e3db] px-2.5 py-2 text-[10.5px] text-emerald-700 dark:border-[#333230] dark:text-emerald-400">
              <Check className="h-3 w-3" /> Changes applied
            </div>
          ) : message.approvalStatus === 'rejected' ? (
            <div className="flex items-center gap-1.5 border-t border-[#e5e3db] px-2.5 py-2 text-[10.5px] text-[#8c887d] dark:border-[#333230] dark:text-[#a09c94]">
              <X className="h-3 w-3" /> Changes rejected
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 border-t border-[#e5e3db] px-2 py-2 dark:border-[#333230]">
              <span
                className={`text-[9.5px] ${
                  message.approvalStatus === 'failed'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-[#8c887d] dark:text-[#a09c94]'
                }`}
              >
                {message.approvalStatus === 'failed'
                  ? 'Could not apply safely. Review and retry.'
                  : 'Review before applying'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={message.approvalStatus === 'applying'}
                  onClick={() => onRejectOperations(message.id)}
                  className="rounded border border-[#d8d5c9] px-2 py-1 text-[10px] text-[#706c62] hover:bg-[#f5f3ec] disabled:opacity-50 dark:border-[#444240] dark:text-[#b8b4ac] dark:hover:bg-[#2a2928]"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={message.approvalStatus === 'applying'}
                  onClick={() => onApplyOperations(message.id, operations)}
                  className="flex items-center gap-1 rounded bg-[#d96b43] px-2 py-1 text-[10px] text-white hover:bg-[#c85f3a] disabled:opacity-60"
                >
                  {message.approvalStatus === 'applying' && <Loader2 className="h-3 w-3 animate-spin" />}
                  Apply changes
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
