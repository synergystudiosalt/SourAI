import React, { useState, useRef, useEffect } from 'react';
import { Plus, Mic, ChevronDown, ArrowUp, X, MicOff, Paperclip, Code2, FileText, FileCode, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AIModel, AttachmentItem } from '../types';
import { ModelSelectorPopover } from './ModelSelectorPopover';
import { AttachmentPopover } from './AttachmentPopover';
import { AttachmentCard } from './AttachmentCard';
import { LimitTimer } from './LimitTimer';
import { parseUploadedFile } from '../utils/fileParser';
import { MESSAGE_QUOTA } from '../utils/constants';
import { VoiceRecognizer } from '../utils/voiceRecognition';

interface MainPromptCardProps {
  promptInput: string;
  setPromptInput: (value: string | ((prev: string) => string)) => void;
  onSubmit: (e?: React.FormEvent) => void;
  selectedModel: AIModel;
  onSelectModel: (model: AIModel) => void;
  attachments: AttachmentItem[];
  onAddAttachment: (item: AttachmentItem) => void;
  onRemoveAttachment: (index: number) => void;
  onOpenUpgrade: () => void;
  messageUnitsUsed: number;
  isGenerating?: boolean;
  onStopGeneration?: () => void;
  limitResetTime?: number | null;
  onResetLimit?: () => void;
}

export const MainPromptCard: React.FC<MainPromptCardProps> = ({
  promptInput,
  setPromptInput,
  onSubmit,
  selectedModel,
  onSelectModel,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  onOpenUpgrade,
  messageUnitsUsed,
  isGenerating,
  onStopGeneration,
  limitResetTime,
  onResetLimit,
}) => {
  const [showModelPopover, setShowModelPopover] = useState(false);
  const [showAttachPopover, setShowAttachPopover] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceRecognizerRef = useRef<VoiceRecognizer | null>(null);
  const modelPopoverRef = useRef<HTMLDivElement>(null);
  const attachPopoverRef = useRef<HTMLDivElement>(null);

  // Initialize voice recognizer on mount
  useEffect(() => {
    voiceRecognizerRef.current = new VoiceRecognizer({
      onTranscript: (transcript) => {
        setPromptInput((prev) => (prev ? prev + ' ' : '') + transcript);
      },
      onError: (error) => {
        console.error('Voice recognition error:', error);
        setIsRecording(false);
      },
      onStart: () => setIsRecording(true),
      onEnd: () => setIsRecording(false),
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showModelPopover &&
        modelPopoverRef.current &&
        !modelPopoverRef.current.contains(event.target as Node)
      ) {
        setShowModelPopover(false);
      }
      if (
        showAttachPopover &&
        attachPopoverRef.current &&
        !attachPopoverRef.current.contains(event.target as Node)
      ) {
        setShowAttachPopover(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModelPopover, showAttachPopover]);

  // Cleanup voice recognizer on unmount
  useEffect(() => {
    return () => {
      if (voiceRecognizerRef.current) {
        voiceRecognizerRef.current.stop();
      }
    };
  }, []);

  const isLimitReached = messageUnitsUsed >= MESSAGE_QUOTA;

  // Auto-resize textarea (capped at max height)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [promptInput]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isLimitReached) {
        onOpenUpgrade();
      } else if (promptInput.trim() || attachments.length > 0) {
        onSubmit();
      }
    }
    // Stop voice recording on Escape
    if (e.key === 'Escape' && isRecording) {
      e.preventDefault();
      if (voiceRecognizerRef.current) {
        voiceRecognizerRef.current.stop();
      }
    }
  };

  const modelDisplayName = selectedModel === 'sour-omni-flash'
    ? 'Omni-Flash 1.0'
    : selectedModel === 'sour-intelligence'
    ? 'Intelligence 1.5'
    : selectedModel === 'sour-ultra'
    ? 'Ultra 1.2'
    : 'Overclock 2.0';

  const toggleVoiceRecording = () => {
    if (!voiceRecognizerRef.current) return;

    if (isRecording) {
      voiceRecognizerRef.current.stop();
      setIsRecording(false);
    } else {
      if (!voiceRecognizerRef.current.isSupported()) {
        alert('Speech recognition is not supported in your browser');
        return;
      }
      voiceRecognizerRef.current.start();
    }
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        try {
          const parsed = await parseUploadedFile(e.dataTransfer.files[i]);
          onAddAttachment(parsed);
        } catch (err) {
          console.error('Error parsing dropped file:', err);
        }
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, filter: 'blur(10px)', y: 8 }}
      animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative z-30 w-full max-w-[580px] bg-white dark:bg-[#1a1a19] rounded-2xl border ${
        isDragging
          ? 'border-[#d96b43] ring-2 ring-[#d96b43]/20'
          : 'border-[#e6e4dc] dark:border-[#2d2d2c]'
      } shadow-[0_2px_12px_rgba(0,0,0,0.03)] focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.06)] focus-within:border-[#c8c5ba] dark:focus-within:border-[#444] transition-all duration-200`}
    >
      {/* Input Textarea Area */}
      <div className="p-3.5">
        {/* Attachments Preview Row */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2.5 mb-3">
            {attachments.map((file, idx) => (
              <AttachmentCard
                key={file.id || idx}
                item={file}
                onRemove={() => onRemoveAttachment(idx)}
              />
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={promptInput}
          onChange={(e) => setPromptInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="How can I help you today?"
          rows={2}
          className="w-full text-xs sm:text-sm text-[#1c1b1a] dark:text-[#f0efe6] placeholder-[#8d897f] dark:placeholder-[#777] outline-none resize-none bg-transparent leading-relaxed"
        />
      </div>

      {/* Internal Controls Toolbar Row */}
      <div className="px-2.5 pb-2.5 pt-1 flex items-center justify-between select-none">
        {/* Left Side: Attachment + Button */}
        <div ref={attachPopoverRef} className="relative flex items-center justify-center">
          <button
            type="button"
            onClick={() => {
              setShowAttachPopover(!showAttachPopover);
              setShowModelPopover(false);
            }}
            className="p-1 rounded-lg text-[#6e6a5e] dark:text-[#a09c94] hover:bg-[#f4f2eb] dark:hover:bg-[#282826] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer interactable-btn"
            title="Add attachment or code"
          >
            <Plus className="w-4.5 h-4.5 stroke-[1.75]" />
          </button>

          <AnimatePresence>
            {showAttachPopover && (
              <motion.div
                initial={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
                animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
                exit={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full mb-2 left-0 z-[100]"
              >
                <AttachmentPopover
                  onAttachFile={onAddAttachment}
                  onClose={() => setShowAttachPopover(false)}
                  positionClass="relative"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Side: Model Selector + Mic + Waveform + Send Button */}
        <div className="flex items-center gap-1">
          {/* Model Selector Dropdown */}
          <div ref={modelPopoverRef} className="relative flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                setShowModelPopover(!showModelPopover);
                setShowAttachPopover(false);
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-[#524f47] dark:text-[#b0adab] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] bg-[#f7f6f1] dark:bg-[#252524] hover:bg-[#f0ede4] dark:hover:bg-[#30302e] border border-[#e4e1d7] dark:border-[#333] rounded-lg px-2 py-0.5 cursor-pointer mr-0.5 interactable-btn"
            >
              <span>{modelDisplayName}</span>
              <ChevronDown className="w-3 h-3 text-[#78746a] dark:text-[#999]" />
            </button>

            <AnimatePresence>
              {showModelPopover && (
                <motion.div
                  initial={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
                  animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
                  exit={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-[100]"
                >
                  <ModelSelectorPopover
                    selectedModel={selectedModel}
                    onSelectModel={onSelectModel}
                    onClose={() => setShowModelPopover(false)}
                    onOpenUpgrade={onOpenUpgrade}
                    positionClass="top-0 left-0"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Voice Mic Button */}
          <button
            type="button"
            onClick={toggleVoiceRecording}
            className={`p-1 rounded-lg cursor-pointer interactable-btn ${
              isRecording
                ? 'bg-red-100 text-red-600 animate-pulse'
                : 'text-[#6e6a5e] dark:text-[#a09c94] hover:bg-[#f4f2eb] dark:hover:bg-[#282826] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
            }`}
            title={isRecording ? 'Listening...' : 'Voice Dictation'}
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 stroke-[1.75]" />}
          </button>

          {/* Send / Stop Button */}
          <button
            type="button"
            onClick={() => {
              if (isGenerating) {
                onStopGeneration?.();
              } else if (isLimitReached) {
                onOpenUpgrade();
              } else if (promptInput.trim() || attachments.length > 0) {
                onSubmit();
              }
            }}
            disabled={!isGenerating && (!promptInput.trim() && attachments.length === 0 && !isLimitReached)}
            className={`ml-1 p-2 rounded-lg cursor-pointer shadow-xs interactable-btn ${
              isGenerating || promptInput.trim() || attachments.length > 0 || isLimitReached
                ? 'bg-[#d96b43] text-white hover:bg-[#c55a33]'
                : 'bg-[#d96b43]/30 text-white/50 cursor-not-allowed'
            }`}
            title={isGenerating ? 'Stop generation' : 'Send Prompt'}
          >
            {isGenerating ? (
              <Square className="w-4 h-4 fill-current stroke-[2]" />
            ) : (
              <ArrowUp className="w-4 h-4 stroke-[2.2]" />
            )}
          </button>
        </div>
      </div>

      {/* Message Limit & Upgrade Banner inside card (only shown if limit reached) */}
      {isLimitReached && (
        <div className="border-t border-[#f0eee6] dark:border-[#2d2d2c] px-3.5 py-2 flex items-center justify-between text-xs text-[#6e6a5e] dark:text-[#a09c94] bg-[#fcfbf9] dark:bg-[#222221] rounded-b-2xl">
          <span className="truncate pr-2 font-medium text-[#78746a] dark:text-[#aaa] text-[11px]">
            Message limit reached ({MESSAGE_QUOTA}/{MESSAGE_QUOTA})
          </span>
          <LimitTimer targetTime={limitResetTime || null} onReset={onResetLimit} />
        </div>
      )}
    </motion.div>
  );
};

