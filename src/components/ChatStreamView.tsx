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

  Volume2,
  VolumeX,
  ThumbsUp,
  ThumbsDown,
  RotateCw,

  Sparkles,

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
import { MODEL_ROUTES } from '../../functions/shared/ai';
import { ImagePreviewCard } from './ImagePreviewCard';
import { QuestionBox, extractQuestionBlocks } from './QuestionBox';

type MarkdownImageProps = React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

function isRemoteImageSource(src: string | undefined): boolean {
  if (!src) return false;
  try {
    const base = typeof window === 'undefined' ? 'https://sour.invalid/' : window.location.href;
    const url = new URL(src, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return typeof window === 'undefined' || url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** Prevents model-authored Markdown from silently contacting a third party. */
export const ChatMarkdownImage: React.FC<MarkdownImageProps> = ({
  node: _node,
  src,
  alt,
  ...props
}) => {
  const [allowed, setAllowed] = useState(false);
  if (!src) return null;
  if (!isRemoteImageSource(src) || allowed) {
    return <img {...props} src={src} alt={alt ?? ''} referrerPolicy="no-referrer" />;
  }

  let host = 'remote host';
  try {
    host = new URL(src, window.location.href).host || host;
  } catch {
    // Keep the generic label for malformed URLs.
  }
  return (
    <button
      type="button"
      onClick={() => setAllowed(true)}
      className="my-2 rounded border border-[#c3cad6] px-3 py-2 text-xs text-[#4a5259] dark:border-[#3b414d] dark:text-[#a9afbc]"
    >
      Load remote image from {host}
      {alt ? ` (${alt})` : ''}
    </button>
  );
};

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
}) => {
  const [displayedContent, setDisplayedContent] = useState(isLatest ? '' : content);
  const [isThinking, setIsThinking] = useState(isLatest);
  const [isLiked, setIsLiked] = useState<boolean | null>(null);
  const hasFinishedTypewritingRef = useRef(!isLatest);

  const { cleanText } = extractQuestionBlocks(displayedContent);

  // Speed and thinking duration based on model tier
  const fastModels = ['sour-omni-flash', 'sour-velocity', 'sour-overdrive'] as const;
  const modelSpeed = (fastModels as readonly string[]).includes(selectedModel) ? 14 : 26;
  const thinkingDuration = (fastModels as readonly string[]).includes(selectedModel) ? 900 : 1800;

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

  return (
    <div className="w-full text-left py-2">
      {/* Dynamic Thinking */}
      {thinking && !isErrorMsg && (
        <div className="mb-3 select-none">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#78828e] dark:text-[#78828e] py-0.5">
            <span>{isThinking ? 'Thinking...' : (thinkingLabel || thinking)}</span>
          </div>
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
          className="text-sm sm:text-base text-[#16181d] dark:text-[#dce0e5] leading-relaxed space-y-3 font-sans"
        >
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              p: ({ children }) => <div className="mb-3 leading-relaxed">{children}</div>,
              h1: ({ children }) => (
                <h1 className="font-serif text-lg sm:text-xl font-medium mt-4 mb-2 text-[#16181d] dark:text-[#dce0e5]">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="font-serif text-base sm:text-lg font-medium mt-3 mb-2 text-[#16181d] dark:text-[#dce0e5]">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="font-sans text-sm font-semibold mt-3 mb-1 text-[#16181d] dark:text-[#dce0e5]">
                  {children}
                </h3>
              ),
              ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm">{children}</ol>,
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[#4776d5] pl-3 italic text-[#666] dark:text-[#aaa] my-3">
                  {children}
                </blockquote>
              ),
              img: ChatMarkdownImage,
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
                    <code className="bg-[#eaedf2] dark:bg-[#1e2128] text-[#3162c3] dark:text-[#608add] px-1.5 py-0.5 rounded text-[11px] font-mono">
                      {children}
                    </code>
                  );
                }
                return (
                  <div className="my-3 overflow-hidden rounded-lg bg-[#f6f8fa] dark:bg-[#17191d] border border-[#dfe3ea] dark:border-[#333] text-[#16181d] dark:text-[#dce0e5] text-xs font-mono shadow-2xs">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#dce1ea] dark:bg-[#1e2128] border-b border-[#dfe3ea] dark:border-[#333] text-[11px] text-[#4a5259] dark:text-[#a9afbc]">
                      <span>code snippet</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleDownloadCode}
                          className="p-1 hover:text-[#16181d] dark:hover:text-[#dce0e5] transition-colors cursor-pointer rounded hover:bg-[#ccd2de] dark:hover:bg-[#2e2f30]"
                          title="Download code"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          className="p-1 hover:text-[#16181d] dark:hover:text-[#dce0e5] transition-colors cursor-pointer rounded hover:bg-[#ccd2de] dark:hover:bg-[#2e2f30]"
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

      {/* Action Row Under Response */}
      {!isThinking && (
        <motion.div
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          className="mt-4 flex flex-col items-start gap-3"
        >
          <div className="flex items-center gap-1 text-[#78828e] dark:text-[#a9afbc]">
            {/* Copy Button */}
            <button
              type="button"
              onClick={onCopy}
              className="p-1.5 rounded-lg hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5] cursor-pointer interactable-btn"
              title="Copy response"
            >
              {isCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>

            {/* Read Aloud Speech Button */}
            <button
              type="button"
              onClick={onSpeak}
              className={`p-1.5 rounded-lg hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] cursor-pointer interactable-btn ${
                isSpeaking
                  ? 'text-[#4776d5] bg-[#f6f8fa] dark:bg-[#1e2128]'
                  : 'hover:text-[#16181d] dark:hover:text-[#dce0e5]'
              }`}
              title="Read aloud"
            >
              {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Thumbs Up Button */}
            <button
              type="button"
              onClick={() => setIsLiked(isLiked === true ? null : true)}
              className={`p-1.5 rounded-lg hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] cursor-pointer interactable-btn ${
                isLiked === true ? 'text-emerald-600 font-bold' : 'hover:text-[#16181d] dark:hover:text-[#dce0e5]'
              }`}
              title="Good response"
            >
              <ThumbsUp className="w-4 h-4" />
            </button>

            {/* Thumbs Down Button */}
            <button
              type="button"
              onClick={() => setIsLiked(isLiked === false ? null : false)}
              className={`p-1.5 rounded-lg hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] cursor-pointer interactable-btn ${
                isLiked === false ? 'text-red-500 font-bold' : 'hover:text-[#16181d] dark:hover:text-[#dce0e5]'
              }`}
              title="Bad response"
            >
              <ThumbsDown className="w-4 h-4" />
            </button>

            {/* Retry / Regenerate Button */}
            <button
              type="button"
              onClick={onRetry}
              className="p-1.5 rounded-lg hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5] cursor-pointer interactable-btn"
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
  const [questionDismissed, setQuestionDismissed] = useState(false);
  const lastQuestionContentRef = useRef<string | null>(null);

  // Extract pending questions from last assistant message
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
  const { questions: pendingQuestions } = extractQuestionBlocks(lastAssistantMsg?.content || '');
  const showQuestions = pendingQuestions.length > 0 && !isGenerating && !questionDismissed;

  // Reset dismissed when new assistant content arrives
  useEffect(() => {
    const currentContent = lastAssistantMsg?.content || '';
    if (lastQuestionContentRef.current !== currentContent) {
      lastQuestionContentRef.current = currentContent;
      if (questionDismissed) setQuestionDismissed(false);
    }
  });
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
        console.error('Speech recognition failed to start:', err);
        setIsRecording(false);
      }
    } else {
      console.warn('Speech recognition is not supported in this browser');
    }
  };

  const handleSend = () => {
    if ((inputText.trim() || attachments.length > 0) && !isGenerating) {
      if (showQuestions) setQuestionDismissed(true);
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

  const modelDisplayName = MODEL_ROUTES[selectedModel].label;

  return (
    <motion.div
      initial={{ opacity: 0, filter: 'blur(10px)', y: 6 }}
      animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
      exit={{ opacity: 0, filter: 'blur(10px)', y: -6 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex-1 w-full max-w-2xl flex flex-col h-full overflow-hidden mx-auto px-2 sm:px-3 md:px-4"
    >
      {/* Active Header Bar */}
      <div className="sticky top-0 bg-[#fbfcfd]/95 dark:bg-[#121316]/95 backdrop-blur-md py-2 sm:py-2.5 border-b border-[#e3e4e6] dark:border-[#282c33] flex items-center justify-between shrink-0 z-50 select-none">
        <button
          type="button"
          onClick={onBackToHome}
          className="flex items-center gap-1 text-xs text-[#4a5259] dark:text-[#a9afbc] hover:text-[#16181d] dark:hover:text-[#dce0e5] p-1 rounded-lg hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128] cursor-pointer interactable-btn transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Home</span>
        </button>

        <div className="relative flex items-center gap-1">
          <Logo size={16} className="sm:w-5" />
          <span className="font-instrument text-sm sm:text-base font-normal text-[#16181d] dark:text-[#dce0e5]">sour.ai</span>

          {/* Header Model Selector Dropdown Badge */}
          <div ref={modelPopoverRef} className="relative flex items-center justify-center">
            <button
              type="button"
              onClick={() => setShowHeaderModelPopover(!showHeaderModelPopover)}
              className="flex items-center gap-1 text-[10px] bg-[#dfe2e8] dark:bg-[#282c33] hover:bg-[#cfd4dd] dark:hover:bg-[#3b414d] text-[#484b51] dark:text-[#acadaf] font-medium px-2 py-0.5 rounded-full cursor-pointer interactable-btn"
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
          className="p-1 text-[#4a5259] dark:text-[#a9afbc] hover:text-[#16181d] dark:hover:text-[#dce0e5] hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128] rounded-lg cursor-pointer interactable-btn"
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
                    <div className="max-w-[95%] sm:max-w-[88%] bg-[#f6f8fa] dark:bg-[#1e2128] border border-[#d5d9e2] dark:border-[#333] text-[#16181d] dark:text-[#dce0e5] px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl rounded-tr-xs text-xs sm:text-sm md:text-base leading-relaxed text-left shadow-2xs">
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

      {/* Question Box - above prompt field */}
      {showQuestions && (
        <div className="shrink-0 px-2 sm:px-3 md:px-4 pb-2 max-h-[60vh] overflow-y-auto">
          <QuestionBox
            questions={pendingQuestions}
            onAnswer={() => {}}
            onComplete={(answers) => {
              setQuestionDismissed(true);
              const validAnswers = answers.filter(a => a !== '__skipped__');
              if (validAnswers.length > 0) {
                onSendFollowUp(validAnswers.join('\n'));
              }
            }}
            onSkip={() => setQuestionDismissed(true)}
            onClose={() => setQuestionDismissed(true)}
          />
        </div>
      )}

      {/* Clean Prompt Box at bottom */}
      <div className="pb-2 sm:pb-3 pt-1 shrink-0 relative">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative bg-white dark:bg-[#17191d] border ${
            isDragging
              ? 'border-[#4776d5] ring-2 ring-[#4776d5]/20'
              : 'border-[#dcdfe6] dark:border-[#282c33]'
          } rounded-xl sm:rounded-2xl p-2 sm:p-3 shadow-xs focus-within:border-[#b9bcc2] dark:focus-within:border-[#444] transition-all`}
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
            className="w-full text-xs sm:text-sm text-[#16181d] dark:text-[#dce0e5] placeholder-[#81848b] dark:placeholder-[#777] outline-none resize-none px-1 bg-transparent leading-relaxed"
          />

          {/* Bottom Toolbar Row: + on left, mic & send on right (NO model selector in prompt box, NO waveform icon) */}
          <div className="pt-2 flex items-center justify-between select-none">
            {/* Attachment Plus Icon */}
            <div ref={attachPopoverRef} className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={() => setShowAttachPopover(!showAttachPopover)}
                className="p-1.5 rounded-lg text-[#4a5259] dark:text-[#a9afbc] hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5] cursor-pointer interactable-btn"
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
                    : 'text-[#4a5259] dark:text-[#a9afbc] hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5]'
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
                    ? 'bg-[#4776d5] text-white hover:bg-[#3765c1]'
                    : 'bg-[#4776d5]/30 text-white/50 cursor-not-allowed'
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

        <p className="text-[10px] text-center text-[#78828e] dark:text-[#777] mt-1.5">
          sour.ai is AI and can make mistakes. Please double-check responses.
        </p>
      </div>
    </motion.div>
  );
};
