import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  ArrowLeft,
  Copy,
  Check,
  ArrowUp,
  Square,
  Plus,
  ChevronDown,
  Mic,
  MicOff,
  X,
  Paperclip,
  Code2,
  Volume2,
  VolumeX,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  Clock,
  Sparkles,
  FileText,
  Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatMessage, AIModel, AttachmentItem } from '../types';
import Logo from './Logo';
import BrandThinkingLogo from './BrandThinkingLogo';
import { ModelSelectorPopover } from './ModelSelectorPopover';
import { AttachmentPopover } from './AttachmentPopover';
import { AttachmentCard } from './AttachmentCard';
import { parseUploadedFile } from '../utils/fileParser';
import { ImagePreviewCard } from './ImagePreviewCard';
import { QuestionBox, extractQuestionBlocks } from './QuestionBox';


interface ChatStreamViewProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  onSendFollowUp: (text: string, attachments?: AttachmentItem[]) => void;
  onBackToHome: () => void;
  selectedModel: AIModel;
  onSelectModel?: (model: AIModel) => void;
  onOpenUpgrade?: () => void;
  onStopGeneration?: () => void;
}

interface TypewriterMessageProps {
  content: string;
  thinking?: string;
  thinkingLabel?: string;
  userQuery?: string;
  isLatest: boolean;
  selectedModel: AIModel;
  onCopy: () => void;
  isCopied: boolean;
  onSpeak: () => void;
  isSpeaking: boolean;
  onRetry: () => void;
  onScrollToBottom?: () => void;
  images?: Array<{ prompt: string; url: string }>;
  onSendFollowUp?: (text: string, attachments?: AttachmentItem[]) => void;
}

const TypewriterMessage: React.FC<TypewriterMessageProps> = ({
  content,
  thinking = '',
  thinkingLabel = 'Analyzing request',
  userQuery = '',
  isLatest,
  selectedModel,
  onCopy,
  isCopied,
  onSpeak,
  isSpeaking,
  onRetry,
  onScrollToBottom,
  images = [],
  onSendFollowUp,
}) => {
  const [displayedContent, setDisplayedContent] = useState(isLatest ? '' : content);
  const [isThinking, setIsThinking] = useState(isLatest);
  const [showThoughtDetails, setShowThoughtDetails] = useState(false);
  const [isLiked, setIsLiked] = useState<boolean | null>(null);
  const hasFinishedTypewritingRef = useRef(!isLatest);

  const { cleanText, questions } = extractQuestionBlocks(displayedContent);

  // Speed and thinking duration based on model tier
  const modelSpeed = selectedModel === 'sour-omni-flash' ? 14 : 26;
  const thinkingDuration = selectedModel === 'sour-omni-flash' ? 900 : 1800;

  useEffect(() => {
    // If message was already typed or is not latest, don't restart typing
    if (hasFinishedTypewritingRef.current || !isLatest) {
      setDisplayedContent(content);
      setIsThinking(false);
      return;
    }

    setIsThinking(true);
    const thinkingTimer = setTimeout(() => {
      setIsThinking(false);

      const words = content.split(' ');
      let currentWordIndex = 0;

      const streamInterval = setInterval(() => {
        if (currentWordIndex < words.length) {
          const nextText = words.slice(0, currentWordIndex + 1).join(' ');
          setDisplayedContent(nextText);
          currentWordIndex++;
        } else {
          clearInterval(streamInterval);
          setDisplayedContent(content);
          hasFinishedTypewritingRef.current = true;
        }
      }, modelSpeed);

      return () => clearInterval(streamInterval);
    }, thinkingDuration);

    return () => clearTimeout(thinkingTimer);
  }, [content, isLatest]);

  useEffect(() => {
    if (isLatest && !hasFinishedTypewritingRef.current) {
      onScrollToBottom?.();
    }
  }, [displayedContent, isThinking, isLatest, onScrollToBottom]);

  const isErrorMsg = content.startsWith('Error:') || content.startsWith('Failed to retrieve');

  // Split thinking into 2-5 short meaningful steps (1 sentence max each) and strip markdown
  const rawThinkingSteps = thinking
    ? thinking
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim().replace(/^[-*•0-9.]+\s*/, '').replace(/[*_#`~]/g, '').trim())
        .filter((s) => s.length > 0)
    : [];

  // Group or constrain to 2-12 steps max
  const thinkingSteps = rawThinkingSteps.slice(0, 12);

  return (
    <div className="w-full text-left py-2">
      {/* Dynamic Thinking Dropdown */}
      {thinking && !isErrorMsg && (
        <div className="mb-3 select-none">
          <button
            type="button"
            onClick={() => setShowThoughtDetails(!showThoughtDetails)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-[#8c887d] dark:text-[#a09c94] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] transition-colors cursor-pointer"
          >
            {isThinking ? (
              <span>Thinking...</span>
            ) : (
              <>
                <span>{thinkingLabel || "Thought process"}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-[#8c887d] transition-transform duration-200 ${
                    showThoughtDetails ? 'rotate-180' : ''
                  }`}
                />
              </>
            )}
          </button>

          <AnimatePresence>
            {showThoughtDetails && !isThinking && (
              <motion.div
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="mt-2.5 pl-3 relative text-[12px] text-[#706c62] dark:text-[#a09d98]"
              >
                {/* Thin vertical timeline line on the far left */}
                <div className="absolute left-0 top-1 bottom-1 w-[1px] bg-[#e2dec0] dark:bg-[#383836]" />

                <div className="space-y-2.5 leading-[1.8]">
                  {thinkingSteps.map((step, idx) => (
                    <div key={idx} className="pl-1">
                      {step}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Response Content or Thinking Pulse */}
      {isThinking ? (
        <motion.div
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          className="flex items-center py-2 select-none"
        >
          <BrandThinkingLogo />
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.3 }}
          className="text-sm sm:text-base text-[#1c1b1a] dark:text-[#f0efe6] leading-relaxed space-y-3 font-sans"
        >
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              p: ({ children }) => <div className="mb-3 leading-relaxed">{children}</div>,
              h1: ({ children }) => (
                <h1 className="font-serif text-lg sm:text-xl font-medium mt-4 mb-2 text-[#1c1b1a] dark:text-[#f0efe6]">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="font-serif text-base sm:text-lg font-medium mt-3 mb-2 text-[#1c1b1a] dark:text-[#f0efe6]">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="font-sans text-sm font-semibold mt-3 mb-1 text-[#1c1b1a] dark:text-[#f0efe6]">
                  {children}
                </h3>
              ),
              ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm">{children}</ol>,
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[#d96b43] pl-3 italic text-[#666] dark:text-[#aaa] my-3">
                  {children}
                </blockquote>
              ),
              code: ({ node, inline, className, children, ...props }: any) => {
                const [copied, setCopied] = useState(false);
                const codeString = String(children).replace(/\n$/, '');

                const handleCopyCode = () => {
                  navigator.clipboard.writeText(codeString);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                };

                const handleDownloadCode = () => {
                  const blob = new Blob([codeString], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'code_snippet.txt';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                };

                if (inline) {
                  return (
                    <code className="bg-[#f2f0ea] dark:bg-[#282826] text-[#c7552d] dark:text-[#e07e5d] px-1.5 py-0.5 rounded text-[11px] font-mono">
                      {children}
                    </code>
                  );
                }
                return (
                  <div className="my-3 overflow-hidden rounded-lg bg-[#f5f3ec] dark:bg-[#1a1a19] border border-[#e2dec0] dark:border-[#333] text-[#1c1b1a] dark:text-[#f0efe6] text-xs font-mono shadow-2xs">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#eae6dc] dark:bg-[#242423] border-b border-[#e2dec0] dark:border-[#333] text-[11px] text-[#6e6a5e] dark:text-[#a09c94]">
                      <span>code snippet</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleDownloadCode}
                          className="p-1 hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] transition-colors cursor-pointer rounded hover:bg-[#ded9cc] dark:hover:bg-[#30302e]"
                          title="Download code"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          className="p-1 hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] transition-colors cursor-pointer rounded hover:bg-[#ded9cc] dark:hover:bg-[#30302e]"
                          title={copied ? "Copied" : "Copy code"}
                        >
                          {copied ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="p-3 overflow-x-auto">
                      <code>{children}</code>
                    </div>
                  </div>
                );
              },
            }}
          >
            {cleanText}
          </ReactMarkdown>
        </motion.div>
      )}

      {/* Generated Images */}
      {images && images.length > 0 && (
        <div className="space-y-2 mt-4">
          {images.map((img, idx) => (
            <ImagePreviewCard
              key={`${img.url}-${idx}`}
              prompt={img.prompt}
              url={img.url}
              index={idx}
            />
          ))}
        </div>
      )}

      {/* Question Box */}
      {questions.length > 0 && onSendFollowUp && (
        <div className="mt-4 space-y-3">
          {questions.map((q, idx) => (
            <QuestionBox
              key={idx}
              question={q.question}
              options={q.options}
              onSelect={(option) => onSendFollowUp(option)}
            />
          ))}
        </div>
      )}

      {/* Action Row Under Response */}
      {!isThinking && (
        <motion.div
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          className="mt-4 flex flex-col items-start gap-3"
        >
          <div className="flex items-center gap-1 text-[#8c887d] dark:text-[#a09c94]">
            {/* Copy Button */}
            <button
              type="button"
              onClick={onCopy}
              className="p-1.5 rounded-lg hover:bg-[#f4f2eb] dark:hover:bg-[#282826] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer interactable-btn"
              title="Copy response"
            >
              {isCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>

            {/* Read Aloud Speech Button */}
            <button
              type="button"
              onClick={onSpeak}
              className={`p-1.5 rounded-lg hover:bg-[#f4f2eb] dark:hover:bg-[#282826] cursor-pointer interactable-btn ${
                isSpeaking
                  ? 'text-[#d96b43] bg-[#f4f2eb] dark:bg-[#282826]'
                  : 'hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
              }`}
              title="Read aloud"
            >
              {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Thumbs Up Button */}
            <button
              type="button"
              onClick={() => setIsLiked(isLiked === true ? null : true)}
              className={`p-1.5 rounded-lg hover:bg-[#f4f2eb] dark:hover:bg-[#282826] cursor-pointer interactable-btn ${
                isLiked === true ? 'text-emerald-600 font-bold' : 'hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
              }`}
              title="Good response"
            >
              <ThumbsUp className="w-4 h-4" />
            </button>

            {/* Thumbs Down Button */}
            <button
              type="button"
              onClick={() => setIsLiked(isLiked === false ? null : false)}
              className={`p-1.5 rounded-lg hover:bg-[#f4f2eb] dark:hover:bg-[#282826] cursor-pointer interactable-btn ${
                isLiked === false ? 'text-red-500 font-bold' : 'hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
              }`}
              title="Bad response"
            >
              <ThumbsDown className="w-4 h-4" />
            </button>

            {/* Retry / Regenerate Button */}
            <button
              type="button"
              onClick={onRetry}
              className="p-1.5 rounded-lg hover:bg-[#f4f2eb] dark:hover:bg-[#282826] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer interactable-btn"
              title="Regenerate response"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>

          {/* Orange Star Logo Ornament matching reference screenshot */}
          <div className="pt-2 opacity-90">
            <Logo size={28} />
          </div>
        </motion.div>
      )}
    </div>
  );
};

export const ChatStreamView: React.FC<ChatStreamViewProps> = ({
  messages,
  isGenerating,
  onSendFollowUp,
  onBackToHome,
  selectedModel,
  onSelectModel,
  onOpenUpgrade,
  onStopGeneration,
}) => {
  const [inputText, setInputText] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [showHeaderModelPopover, setShowHeaderModelPopover] = useState(false);
  const [showAttachPopover, setShowAttachPopover] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isRecording, setIsRecording] = useState(false);
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
          handleAddAttachment(parsed);
        } catch (err) {
          console.error('Error parsing dropped file in chat stream:', err);
        }
      }
    }
  };

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const modelPopoverRef = useRef<HTMLDivElement>(null);
  const attachPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showHeaderModelPopover &&
        modelPopoverRef.current &&
        !modelPopoverRef.current.contains(event.target as Node)
      ) {
        setShowHeaderModelPopover(false);
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
  }, [showHeaderModelPopover, showAttachPopover]);

  const scrollToBottom = (smooth = true) => {
    if (!scrollEndRef.current) return;
    const container = messagesContainerRef.current;
    if (container) {
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 180;
      const lastMsg = messages[messages.length - 1];
      const isUserLast = lastMsg?.role === 'user';

      if (isUserLast || isNearBottom) {
        scrollEndRef.current.scrollIntoView({
          behavior: smooth ? 'smooth' : 'auto',
        });
      }
    } else {
      scrollEndRef.current.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  };

  useEffect(() => {
    scrollToBottom(true);
  }, [messages, isGenerating]);



  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [inputText]);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSpeak = (text: string, index: number) => {
    if ('speechSynthesis' in window) {
      if (speakingIndex === index) {
        window.speechSynthesis.cancel();
        setSpeakingIndex(null);
      } else {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => setSpeakingIndex(null);
        utterance.onerror = () => setSpeakingIndex(null);
        window.speechSynthesis.speak(utterance);
        setSpeakingIndex(index);
      }
    }
  };

  const handleAddAttachment = (item: AttachmentItem) => {
    setAttachments((prev) => [...prev, item]);
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleVoiceRecording = () => {
    if (isRecording) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          if (transcript) {
            setInputText(transcript);
          }
        };

        recognition.onerror = () => setIsRecording(false);
        recognition.onend = () => setIsRecording(false);

        recognition.start();
        recognitionRef.current = recognition;
        setIsRecording(true);
      } catch (err) {
        setIsRecording(true);
        setTimeout(() => {
          setInputText((prev) => (prev ? prev + ' ' : '') + 'Can you explain quantum physics in simple terms?');
          setIsRecording(false);
        }, 2000);
      }
    } else {
      setIsRecording(true);
      setTimeout(() => {
        setInputText((prev) => (prev ? prev + ' ' : '') + 'Can you explain quantum physics in simple terms?');
        setIsRecording(false);
      }, 2000);
    }
  };

  const handleSend = () => {
    if ((inputText.trim() || attachments.length > 0) && !isGenerating) {
      onSendFollowUp(inputText, attachments);
      setInputText('');
      setAttachments([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const modelDisplayName = selectedModel === 'sour-omni-flash'
    ? 'Omni-Flash'
    : selectedModel === 'sour-intelligence'
    ? 'Intelligence 1.5'
    : selectedModel === 'sour-ultra'
    ? 'Ultra 1.2'
    : 'Overclock 2.0';

  return (
    <motion.div
      initial={{ opacity: 0, filter: 'blur(10px)', y: 6 }}
      animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
      exit={{ opacity: 0, filter: 'blur(10px)', y: -6 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex-1 w-full max-w-2xl flex flex-col h-full overflow-hidden mx-auto px-2 sm:px-3 md:px-4"
    >
      {/* Active Header Bar */}
      <div className="sticky top-0 bg-[#faf9f6]/95 dark:bg-[#121212]/95 backdrop-blur-md py-2 sm:py-2.5 border-b border-[#e8e7e1] dark:border-[#2d2d2c] flex items-center justify-between shrink-0 z-50 select-none">
        <button
          type="button"
          onClick={onBackToHome}
          className="flex items-center gap-1 text-xs text-[#6e6a5e] dark:text-[#a09c94] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] p-1 rounded-lg hover:bg-[#efece5] dark:hover:bg-[#252524] cursor-pointer interactable-btn transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Home</span>
        </button>

        <div className="relative flex items-center gap-1">
          <Logo size={16} className="sm:w-5" />
          <span className="font-instrument text-sm sm:text-base font-normal text-[#1c1b1a] dark:text-[#f0efe6]">sour.ai</span>

          {/* Header Model Selector Dropdown Badge */}
          <div ref={modelPopoverRef} className="relative flex items-center justify-center">
            <button
              type="button"
              onClick={() => setShowHeaderModelPopover(!showHeaderModelPopover)}
              className="flex items-center gap-1 text-[10px] bg-[#e8e6df] dark:bg-[#2d2d2c] hover:bg-[#ddd9cf] dark:hover:bg-[#383836] text-[#524f47] dark:text-[#b0adab] font-medium px-2 py-0.5 rounded-full cursor-pointer interactable-btn"
              title="Change Model"
            >
              <span>{modelDisplayName}</span>
              <ChevronDown className="w-2.5 h-2.5" />
            </button>

            <AnimatePresence>
              {showHeaderModelPopover && onSelectModel && (
                <motion.div
                  initial={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
                  animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
                  exit={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-[100]"
                >
                  <ModelSelectorPopover
                    selectedModel={selectedModel}
                    onSelectModel={(m) => {
                      onSelectModel(m);
                      setShowHeaderModelPopover(false);
                    }}
                    onClose={() => setShowHeaderModelPopover(false)}
                    onOpenUpgrade={onOpenUpgrade}
                    positionClass="top-0 left-0"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <button
          type="button"
          onClick={onBackToHome}
          className="p-1 text-[#6e6a5e] dark:text-[#a09c94] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] hover:bg-[#efece5] dark:hover:bg-[#252524] rounded-lg cursor-pointer interactable-btn"
          title="New conversation"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto no-scrollbar py-3 sm:py-6 space-y-3 sm:space-y-6 pr-1"
      >
        <AnimatePresence>
          {messages.map((msg, idx) => (
            <motion.div
              key={msg.id || idx}
              initial={{ opacity: 0, filter: 'blur(8px)', y: 8 }}
              animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="w-full"
            >
              {msg.role === 'user' ? (
                /* User Query Message - Clean Right-Aligned Content */
                <div className="w-full flex flex-col items-end my-2 sm:my-3">
                  {/* Render Attachment Cards above the text message bubble */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2.5 mb-2 max-w-[95%] sm:max-w-[88%]">
                      {msg.attachments.map((att, aIdx) => (
                        <AttachmentCard key={att.id || aIdx} item={att} />
                      ))}
                    </div>
                  )}

                  {msg.content && (
                    <div className="max-w-[95%] sm:max-w-[88%] bg-[#f4f2eb] dark:bg-[#242423] border border-[#e2dfd5] dark:border-[#333] text-[#1c1b1a] dark:text-[#f0efe6] px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl rounded-tr-xs text-xs sm:text-sm md:text-base leading-relaxed text-left shadow-2xs">
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    </div>
                  )}
                </div>
              ) : (
                /* AI Response Message - Unboxed, Thought Process, Typewriter Effect & Actions */
                <TypewriterMessage
                  content={msg.content}
                  thinking={msg.thinking}
                  thinkingLabel={msg.thinkingLabel}
                  userQuery={messages[idx - 1]?.content || ''}
                  isLatest={idx === messages.length - 1}
                  selectedModel={selectedModel}
                  onCopy={() => handleCopy(msg.content, idx)}
                  isCopied={copiedIndex === idx}
                  onSpeak={() => handleSpeak(msg.content, idx)}
                  isSpeaking={speakingIndex === idx}
                  onRetry={() => onSendFollowUp(messages[idx - 1]?.content || 'Please elaborate further')}
                  onScrollToBottom={() => scrollToBottom(true)}
                  images={msg.images}
                  onSendFollowUp={onSendFollowUp}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Thinking Indicator */}
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
            animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
            exit={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
            className="flex items-center py-2 select-none"
          >
            <BrandThinkingLogo />
          </motion.div>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Clean Prompt Box at bottom */}
      <div className="pb-2 sm:pb-3 pt-1 shrink-0 relative">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative bg-white dark:bg-[#1a1a19] border ${
            isDragging
              ? 'border-[#d96b43] ring-2 ring-[#d96b43]/20'
              : 'border-[#e6e4dc] dark:border-[#2d2d2c]'
          } rounded-xl sm:rounded-2xl p-2 sm:p-3 shadow-xs focus-within:border-[#c5c2b6] dark:focus-within:border-[#444] transition-all`}
        >
          {/* Attachments preview row */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2.5 mb-2.5 px-1">
              {attachments.map((file, idx) => (
                <AttachmentCard
                  key={file.id || idx}
                  item={file}
                  onRemove={() => handleRemoveAttachment(idx)}
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a message..."
            rows={1}
            className="w-full text-xs sm:text-sm text-[#1c1b1a] dark:text-[#f0efe6] placeholder-[#8d897f] dark:placeholder-[#777] outline-none resize-none px-1 bg-transparent leading-relaxed"
          />

          {/* Bottom Toolbar Row: + on left, mic & send on right (NO model selector in prompt box, NO waveform icon) */}
          <div className="pt-2 flex items-center justify-between select-none">
            {/* Attachment Plus Icon */}
            <div ref={attachPopoverRef} className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={() => setShowAttachPopover(!showAttachPopover)}
                className="p-1.5 rounded-lg text-[#6e6a5e] dark:text-[#a09c94] hover:bg-[#f4f2eb] dark:hover:bg-[#282826] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer interactable-btn"
                title="Add attachment"
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
                      onAttachFile={handleAddAttachment}
                      onClose={() => setShowAttachPopover(false)}
                      positionClass="relative"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Mic Icon & Orange Boxed Send Button on Right */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleVoiceRecording}
                className={`p-1.5 rounded-lg cursor-pointer interactable-btn ${
                  isRecording
                    ? 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 animate-pulse'
                    : 'text-[#6e6a5e] dark:text-[#a09c94] hover:bg-[#f4f2eb] dark:hover:bg-[#282826] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
                }`}
                title={isRecording ? 'Listening...' : 'Voice Dictation'}
              >
                {isRecording ? <MicOff className="w-4.5 h-4.5" /> : <Mic className="w-4.5 h-4.5 stroke-[1.75]" />}
              </button>

              {/* Send / Stop Button */}
              <button
                type="button"
                onClick={() => {
                  if (isGenerating) {
                    onStopGeneration?.();
                  } else {
                    handleSend();
                  }
                }}
                disabled={!isGenerating && (!inputText.trim() && attachments.length === 0)}
                className={`p-2 rounded-lg cursor-pointer shadow-xs interactable-btn ${
                  isGenerating || inputText.trim() || attachments.length > 0
                    ? 'bg-[#d96b43] text-white hover:bg-[#c55a33]'
                    : 'bg-[#d96b43]/30 text-white/50 cursor-not-allowed'
                }`}
                title={isGenerating ? 'Stop generation' : 'Send message'}
              >
                {isGenerating ? (
                  <Square className="w-4 h-4 fill-current stroke-[2]" />
                ) : (
                  <ArrowUp className="w-4 h-4 stroke-[2.2]" />
                )}
              </button>
            </div>
          </div>
        </div>

        <p className="text-[10px] text-center text-[#8c887d] dark:text-[#777] mt-1.5">
          sour.ai is AI and can make mistakes. Please double-check responses.
        </p>
      </div>
    </motion.div>
  );
};
