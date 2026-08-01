import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  NotebookPen,
  RefreshCw,
  Square,
  AlertCircle,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { MODEL_ROUTES } from '../../../functions/shared/ai';
import type { AIModel } from '../../types';
import type {
  Notebook,
  NotebookMessage,
  NotebookOverview,
  NotebookSource,
} from '../../features/notebook/types';
import Logo from '../Logo';
import { ModelSelectorPopover } from '../ModelSelectorPopover';
import { NotebookMarkdown } from './NotebookMarkdown';
import { GroqVoiceRecorder, speakText, stopSpeaking } from '../../utils/groqVoice';

export interface NotebookChatPanelProps {
  notebook: Notebook;
  selectedSources: NotebookSource[];
  isGenerating: boolean;
  overview?: NotebookOverview;
  isOverviewLoading: boolean;
  selectedModel: AIModel;
  onSelectModel: (model: AIModel) => void;
  onSubmit: (question: string) => void;
  onStop: () => void;
  onRefreshOverview: () => void;
  onSaveToNote: (message: NotebookMessage) => void;
  onOpenSource: (sourceId: string) => void;
  onAddSource: () => void;
}

/** Resolves `[n]` back to the source that was numbered `n` for that answer. */
function citationResolver(
  message: NotebookMessage,
  notebook: Notebook,
  onOpenSource: (sourceId: string) => void
) {
  const idFor = (index: number): string | undefined => message.citedSourceIds?.[index - 1];
  return {
    labelFor: (index: number) => {
      const id = idFor(index);
      return notebook.sources.find((source) => source.id === id)?.title;
    },
    onSelect: (index: number) => {
      const id = idFor(index);
      if (id && notebook.sources.some((source) => source.id === id)) onOpenSource(id);
    },
  };
}

export const NotebookChatPanel: React.FC<NotebookChatPanelProps> = ({
  notebook,
  selectedSources,
  isGenerating,
  overview,
  isOverviewLoading,
  selectedModel,
  onSelectModel,
  onSubmit,
  onStop,
  onRefreshOverview,
  onSaveToNote,
  onOpenSource,
  onAddSource,
}) => {
  const [draft, setDraft] = useState('');
  const [showModels, setShowModels] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const voiceRecorderRef = useRef<GroqVoiceRecorder | null>(null);

  const hasSources = notebook.sources.length > 0;
  const canSend = draft.trim().length > 0 && selectedSources.length > 0 && !isGenerating;

  useEffect(() => {
    voiceRecorderRef.current = new GroqVoiceRecorder({
      onTranscript: (transcript) => {
        setDraft((prev) => (prev ? `${prev} ` : '') + transcript);
      },
      onError: (error) => {
        console.error('Voice input error:', error);
        setIsRecording(false);
      },
      onStart: () => setIsRecording(true),
      onEnd: () => setIsRecording(false),
      onTranscribing: setIsTranscribing,
    });
    return () => {
      voiceRecorderRef.current?.stop();
      stopSpeaking();
    };
  }, []);

  const toggleVoiceRecording = () => {
    if (!voiceRecorderRef.current) return;
    if (isRecording) {
      voiceRecorderRef.current.stop();
    } else {
      voiceRecorderRef.current.start();
    }
  };

  const toggleSpeak = (message: NotebookMessage) => {
    if (speakingMessageId === message.id) {
      stopSpeaking();
      setSpeakingMessageId(null);
      return;
    }
    speakText(message.content, {
      onStart: () => setSpeakingMessageId(message.id),
      onEnd: () => setSpeakingMessageId((current) => (current === message.id ? null : current)),
      onError: () => setSpeakingMessageId((current) => (current === message.id ? null : current)),
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [notebook.messages.length, isGenerating]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    if (!showModels) return;
    const close = (event: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(event.target as Node)) setShowModels(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showModels]);

  const send = () => {
    if (!canSend) return;
    onSubmit(draft.trim());
    setDraft('');
  };

  return (
    <section
      aria-label="Notebook chat"
      className="z-grid flex h-full min-h-0 flex-col bg-[#fbfcfd] dark:bg-[#121316]"
    >
      <div className="zed-panel-bar flex h-9 shrink-0 items-center justify-between border-b border-[#dfe3ea] px-3 dark:border-[#282c33]">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#78828e]">Chat</span>
        <span className="font-code text-[10px] text-[#78828e]">
          {selectedSources.length} source{selectedSources.length === 1 ? '' : 's'} in context
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 thin-scrollbar">
        <div className="mx-auto flex max-w-[760px] flex-col gap-5">
          {!hasSources ? (
            <div className="mt-10 flex flex-col items-center text-center">
              <NotebookPen className="mb-4 h-8 w-8 text-[#4776d5]" />
              <h2 className="font-heading text-[24px] text-[#16181d] dark:text-[#dce0e5]">
                Add a source to get started
              </h2>
              <p className="mt-2 max-w-[420px] text-[12.5px] leading-relaxed text-[#4a5259] dark:text-[#a9afbc]">
                Upload documents, paste text or add a link. sour.ai answers only from the sources in
                this notebook and cites every claim.
              </p>
              <button
                type="button"
                onClick={onAddSource}
                className="mt-5 bg-[#4776d5] px-4 py-2 text-[12.5px] font-medium text-white interactable-btn"
              >
                Upload a source
              </button>
            </div>
          ) : (
            <>
              {/* Notebook guide — the grounded overview of everything added. */}
              <div className="border border-[#dfe3ea] bg-[#f6f8fa] p-4 dark:border-[#282c33] dark:bg-[#17191d]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-[#78828e]">
                    <Logo size={12} />
                    Notebook guide
                  </span>
                  <button
                    type="button"
                    onClick={onRefreshOverview}
                    disabled={isOverviewLoading}
                    title="Regenerate the notebook guide"
                    className="flex items-center gap-1 text-[10.5px] text-[#4776d5] disabled:opacity-50"
                  >
                    {isOverviewLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Refresh
                  </button>
                </div>

                {isOverviewLoading && !overview ? (
                  <div className="space-y-2">
                    <div className="z-shimmer h-3 w-full" />
                    <div className="z-shimmer h-3 w-10/12" />
                    <div className="z-shimmer h-3 w-7/12" />
                  </div>
                ) : overview ? (
                  <>
                    <p className="text-[12.5px] leading-[1.75] text-[#16181d] dark:text-[#dce0e5]">
                      {overview.summary}
                    </p>
                    {overview.topics.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {overview.topics.map((topic) => (
                          <span
                            key={topic}
                            className="border border-[#dfe3ea] bg-[#fbfcfd] px-2 py-0.5 text-[10.5px] text-[#4a5259] dark:border-[#3b414d] dark:bg-[#1e2128] dark:text-[#a9afbc]"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[12px] text-[#78828e] dark:text-[#a9afbc]">
                    Generate a guide to see what these sources cover.
                  </p>
                )}
              </div>

              {notebook.messages.map((message) =>
                message.role === 'user' ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] border border-[#dfe3ea] bg-[#e8edf8] px-3 py-2 text-[12.5px] leading-relaxed text-[#16181d] dark:border-[#33405c] dark:bg-[#1c2434] dark:text-[#dce0e5]">
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="group">
                    {message.isError ? (
                      <div
                        role="alert"
                        className="flex items-start gap-2 border border-[#e5b4b4] bg-[#fbeeee] px-3 py-2 text-[12px] text-[#8c2f2f] dark:border-[#5c3030] dark:bg-[#2a1a1a] dark:text-[#e79b9b]"
                      >
                        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span>{message.content}</span>
                      </div>
                    ) : (
                      <>
                        <NotebookMarkdown
                          text={message.content}
                          resolver={citationResolver(message, notebook, onOpenSource)}
                        />
                        <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => onSaveToNote(message)}
                            className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-0.5 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
                          >
                            <NotebookPen className="h-3 w-3" />
                            Save to note
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleSpeak(message)}
                            className={`flex items-center gap-1 border px-2 py-0.5 text-[10.5px] ws-toolbar-btn ${
                              speakingMessageId === message.id
                                ? 'border-[#4776d5] text-[#4776d5]'
                                : 'border-[#dfe3ea] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc]'
                            }`}
                          >
                            {speakingMessageId === message.id ? (
                              <VolumeX className="h-3 w-3" />
                            ) : (
                              <Volume2 className="h-3 w-3" />
                            )}
                            Read aloud
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              )}

              {isGenerating && (
                <div className="flex items-center gap-2 text-[12px] text-[#78828e]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4776d5]" />
                  <span className="agent-active-gradient">Reading your sources…</span>
                </div>
              )}

              {notebook.messages.length === 0 && overview && overview.questions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {overview.questions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => onSubmit(question)}
                      disabled={isGenerating || selectedSources.length === 0}
                      className="border border-[#dfe3ea] bg-[#fbfcfd] px-2.5 py-1.5 text-left text-[11.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] disabled:opacity-50 dark:border-[#282c33] dark:bg-[#17191d] dark:text-[#a9afbc] ws-toolbar-btn"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {hasSources && (
        <div className="shrink-0 border-t border-[#dfe3ea] bg-[#fbfcfd] px-4 py-3 dark:border-[#282c33] dark:bg-[#17191d]">
          <div className="mx-auto max-w-[760px]">
            <div className="flex items-end gap-2 border border-[#dfe3ea] bg-white px-2.5 py-2 focus-within:border-[#4776d5] dark:border-[#282c33] dark:bg-[#1e2128]">
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  selectedSources.length === 0
                    ? 'Select at least one source to ask a question'
                    : 'Ask anything about your sources…'
                }
                className="max-h-40 min-h-[22px] flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-[#16181d] outline-none placeholder:text-[#78828e] dark:text-[#dce0e5] thin-scrollbar"
              />
              <button
                type="button"
                onClick={toggleVoiceRecording}
                disabled={isTranscribing || selectedSources.length === 0}
                title={isTranscribing ? 'Transcribing...' : isRecording ? 'Listening...' : 'Voice dictation'}
                className={`flex h-7 w-7 shrink-0 items-center justify-center disabled:opacity-40 disabled:cursor-wait ws-toolbar-btn ${
                  isRecording
                    ? 'bg-red-100 text-red-600 animate-pulse dark:bg-red-950/60 dark:text-red-400'
                    : 'text-[#78828e] hover:text-[#16181d] dark:hover:text-[#dce0e5]'
                }`}
              >
                {isTranscribing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isRecording ? (
                  <MicOff className="h-3.5 w-3.5" />
                ) : (
                  <Mic className="h-3.5 w-3.5" />
                )}
              </button>
              {isGenerating ? (
                <button
                  type="button"
                  onClick={onStop}
                  title="Stop"
                  aria-label="Stop generating"
                  className="flex h-7 w-7 shrink-0 items-center justify-center bg-[#16181d] text-white dark:bg-[#dce0e5] dark:text-[#16181d] interactable-btn"
                >
                  <Square className="h-3 w-3" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  title="Send"
                  aria-label="Send question"
                  className="flex h-7 w-7 shrink-0 items-center justify-center bg-[#4776d5] text-white disabled:opacity-40 interactable-btn"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-[#78828e]">
              <div ref={modelRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowModels((open) => !open)}
                  className="flex items-center gap-1 whitespace-nowrap hover:text-[#16181d] dark:hover:text-[#dce0e5]"
                >
                  {MODEL_ROUTES[selectedModel].label}
                  <ChevronDown className="h-3 w-3" />
                </button>
                <AnimatePresence>
                  {showModels && (
                    <ModelSelectorPopover
                      selectedModel={selectedModel}
                      onSelectModel={onSelectModel}
                      onClose={() => setShowModels(false)}
                      positionClass="bottom-full mb-2 left-0"
                    />
                  )}
                </AnimatePresence>
              </div>
              {/* Reassurance, not instruction — the first thing to drop when
                  the row would otherwise wrap under the composer. */}
              <span className="hidden truncate sm:inline">
                Answers are grounded in your selected sources.
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
