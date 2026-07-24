import React from 'react';
import { motion } from 'motion/react';
import { File, Search, Bot, CheckCircle2, AlertCircle } from 'lucide-react';

export type FunctionCallType = 'readfile' | 'findall' | 'subagent';

export interface FunctionCallStatus {
  type: FunctionCallType;
  path?: string;
  query?: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  resultCount?: number;
}

interface FunctionCallIndicatorProps {
  call: FunctionCallStatus;
  index?: number;
}

/**
 * Visual indicator for agent function calls appearing inline in chat
 * Shows file reads, searches, and subagent delegations with smooth animations
 */
export const FunctionCallIndicator: React.FC<FunctionCallIndicatorProps> = ({ call, index = 0 }) => {
  const getIcon = () => {
    switch (call.type) {
      case 'readfile':
        return <File className="w-3.5 h-3.5" />;
      case 'findall':
        return <Search className="w-3.5 h-3.5" />;
      case 'subagent':
        return <Bot className="w-3.5 h-3.5" />;
    }
  };

  const getLabel = () => {
    switch (call.type) {
      case 'readfile':
        return call.path ? `Reading ${call.path}` : 'Reading file';
      case 'findall':
        return call.query ? `Searching for "${call.query}"` : 'Searching';
      case 'subagent':
        return 'Delegating to subagent';
    }
  };

  const getColor = () => {
    // Zed-like dark theme colors
    switch (call.type) {
      case 'readfile':
        return 'text-[#6ba3d8] dark:text-[#6ba3d8] bg-[#2d3d4d]/40 dark:bg-[#2d3d4d]/40';
      case 'findall':
        return 'text-[#a89d9e] dark:text-[#a89d9e] bg-[#3d3a35]/40 dark:bg-[#3d3a35]/40';
      case 'subagent':
        return 'text-[#88c993] dark:text-[#88c993] bg-[#2d4d2d]/40 dark:bg-[#2d4d2d]/40';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.95 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-mono font-medium ${getColor()} mb-2 border border-opacity-20 dark:border-opacity-30 border-current`}
    >
      {/* Icon with animation based on status */}
      {call.status === 'running' && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        >
          {getIcon()}
        </motion.div>
      )}
      {call.status === 'pending' && (
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          {getIcon()}
        </motion.div>
      )}
      {call.status === 'complete' && (
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 0.4 }}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
        </motion.div>
      )}
      {call.status === 'error' && (
        <motion.div
          animate={{ x: [0, -2, 2, -2, 0] }}
          transition={{ duration: 0.5 }}
        >
          <AlertCircle className="w-3.5 h-3.5" />
        </motion.div>
      )}

      {/* Status text - Zed style */}
      <span className="tracking-tight">
        {call.type === 'readfile' && call.path ? (
          <>Read file <span className="opacity-70">{call.path}</span></>
        ) : call.type === 'findall' && call.query ? (
          <>Search <span className="opacity-70">"{call.query}"</span></>
        ) : (
          getLabel()
        )}
        {call.status === 'running' && <span className="inline-block ml-1 animate-pulse">…</span>}
        {call.status === 'complete' && call.resultCount !== undefined && (
          <span className="opacity-60 ml-1.5">{call.resultCount}</span>
        )}
      </span>
    </motion.div>
  );
};

interface FunctionCallContainerProps {
  calls: FunctionCallStatus[];
  inline?: boolean;
}

/**
 * Container that displays multiple function calls inline or stacked
 */
export const FunctionCallContainer: React.FC<FunctionCallContainerProps> = ({ calls, inline = true }) => {
  if (calls.length === 0) return null;

  return (
    <div className={inline ? 'flex flex-wrap gap-2 mb-3' : 'flex flex-col gap-2 mb-3'}>
      {calls.map((call, idx) => (
        <FunctionCallIndicator key={`${call.type}-${idx}`} call={call} index={idx} />
      ))}
    </div>
  );
};
