import React from 'react';

import type { AgentChatMessage } from '../../types';
import Logo from '../Logo';
import { AgentContent, TypedMarkdown } from './MarkdownContent';
import { OperationList } from './OperationList';
import { ToolCallList } from './ToolCallList';

export interface AgentMessageProps {
  message: AgentChatMessage;
  isLatest: boolean;
  animateTyping: boolean;
  openTags: Set<string>;
  openItems: Set<string>;
  onToggleTag: (id: string) => void;
  onToggleItem: (id: string) => void;
}

export const AgentMessage: React.FC<AgentMessageProps> = ({
  message,
  isLatest,
  animateTyping,
  openTags,
  openItems,
  onToggleTag,
  onToggleItem,
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

  return (
    <div className="space-y-1.5 mb-5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#a39d8f] dark:text-[#767671]">
        <Logo size={12} /> sour.ai Agent
      </div>

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

      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallList
          messageId={message.id}
          toolCalls={message.toolCalls}
          isReading={Boolean(message.isReadingFiles)}
          openItems={openItems}
          onToggle={onToggleItem}
        />
      )}

      {message.ops && message.ops.length > 0 && (
        <OperationList
          messageId={message.id}
          operations={message.ops}
          codingPaths={message.codingPaths}
          openItems={openItems}
          onToggle={onToggleItem}
        />
      )}
    </div>
  );
};
