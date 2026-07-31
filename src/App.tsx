import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LeftSidebar } from './components/LeftSidebar';
import { TopBar } from './components/TopBar';
import { GreetingHeader } from './components/GreetingHeader';
import { MainPromptCard } from './components/MainPromptCard';
import { PromptChips } from './components/PromptChips';
import { UpgradeModal } from './components/UpgradeModal';
import { ChatStreamView } from './components/ChatStreamView';
import { CodeWorkspace } from './components/CodeWorkspace';
import { GlobalContextMenu } from './components/GlobalContextMenu';
import { AIModel, ChatMessage, Conversation, AttachmentItem } from './types';
import { MESSAGE_QUOTA } from './utils/constants';
import { isAbortError, normalizeError, type SourError } from './contracts/errors';
import { getClientPersistence, type ClientPersistence } from './storage/clientPersistence';

export function normalizeChatProviderError(
  value: unknown,
  fallbackMessage = 'The chat provider failed to respond.'
): SourError {
  const candidate =
    value instanceof Error || (typeof value === 'string' && value.trim())
      ? value
      : fallbackMessage;
  return normalizeError(candidate, {
    code: 'chat_provider_failed',
    causeCategory: 'provider',
    message: fallbackMessage,
    retryable: true,
  });
}

/**
 * Sends a chat turn to the provider.
 *
 * This previously returned a local stub that echoed the prompt back
 * ("Local client runtime received: ..."), so the chat never reached a model at
 * all while /api/chat sat there working. The endpoint takes the conversation
 * so far, not just the latest message, or every turn would arrive with no
 * memory of the one before it.
 */
async function runChat(
  messages: readonly { role: string; content: string; attachments?: unknown }[],
  model: AIModel,
  signal: AbortSignal
): Promise<Response> {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model }),
    signal,
  });
}

export default function App() {
  const [promptInput, setPromptInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<AIModel>('sour-omni-flash');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const persistenceRef = React.useRef<ClientPersistence | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  };

  const [messageUnitsUsed, setMessageUnitsUsed] = useState(0);
  const [limitResetTime, setLimitResetTime] = useState<number | null>(null);

  const [devToast, setDevToast] = useState<string | null>(null);

  const handleResetLimit = () => {
    setMessageUnitsUsed(0);
    setLimitResetTime(null);
    void persistenceRef.current?.settings.set('usage.messageUnits', 'usage', 0);
    void persistenceRef.current?.settings.delete('usage.limitResetTime');
  };

  // Manage 6-hour reset timestamp when limit is reached
  useEffect(() => {
    if (messageUnitsUsed >= MESSAGE_QUOTA) {
      if (!limitResetTime) {
        const target = Date.now() + 6 * 3600 * 1000; // 6 hours timer
        setLimitResetTime(target);
      }
    } else if (limitResetTime) {
      setLimitResetTime(null);
    }
  }, [messageUnitsUsed, limitResetTime]);

  // Developer secret shortcut key listener (e.g. Ctrl+Shift+R, Cmd+Shift+R, Ctrl+Alt+R, Cmd+Alt+R)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (
        isCmdOrCtrl &&
        (e.shiftKey || e.altKey) &&
        (e.key === 'R' || e.key === 'r' || e.key === 'L' || e.key === 'l' || e.key === 'D' || e.key === 'd')
      ) {
        e.preventDefault();
        handleResetLimit();
        setDevToast(`⚡ Developer Shortcut: Message limit refreshed (0/${MESSAGE_QUOTA})!`);
        setTimeout(() => setDevToast(null), 3000);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ---------------------------------------------------------------------
  // Special console command: `sourai.reset()`.
  // Purges sour.ai data only; unrelated origin storage is never touched.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const KEEP_KEYS = new Set(['sour_msg_units']);
    (window as any).sourai = {
      reset: async () => {
        await persistenceRef.current?.resetPreservingUsage();
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (
            key &&
            !KEEP_KEYS.has(key) &&
            (key.startsWith('sour_') || key.startsWith('sourbot_'))
          ) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        const remaining = Math.max(0, MESSAGE_QUOTA - messageUnitsUsed);
        console.log(
          `%c sour.ai %c workspace reset. ${remaining}/${MESSAGE_QUOTA} messages remaining.`,
          'background:#d96b43;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold;',
          'color:inherit;'
        );
        window.location.reload();
      },
    };
    console.log(
      '%c sour.ai %c Type sourai.reset() in this console to wipe local data while keeping your message quota.',
      'background:#16181d;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold;',
      'color:inherit;'
    );
    return () => {
      delete (window as any).sourai;
    };
  }, [messageUnitsUsed]);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('sour_dark_mode') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('sour_dark_mode', isDarkMode.toString());
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const handleToggleTheme = () => {
    setIsDarkMode((prev) => !prev);
  };

  // Conversations state
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: 'demo-1',
      title: 'Quantum Computing Overview',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Can you explain quantum computing in simple terms?',
          timestamp: new Date(Date.now() - 3600000),
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Quantum computing processes information using quantum bits (qubits) that can exist in multiple states simultaneously (superposition), allowing parallel computational power for complex cryptography and molecular simulation.',
          timestamp: new Date(Date.now() - 3500000),
        },
      ],
      createdAt: new Date(Date.now() - 3600000),
    },
  ]);

  useEffect(() => {
    let cancelled = false;
    void getClientPersistence()
      .then(async (persistence) => {
        persistenceRef.current = persistence;
        const [storedConversations, storedUnits, storedReset] = await Promise.all([
          persistence.loadConversations(),
          persistence.settings.getValue<number>('usage.messageUnits'),
          persistence.settings.getValue<number>('usage.limitResetTime'),
        ]);
        if (cancelled) return;
        if (storedConversations.length > 0) setConversations(storedConversations);
        if (typeof storedUnits === 'number') setMessageUnitsUsed(storedUnits);
        if (typeof storedReset === 'number') setLimitResetTime(storedReset);
        setStorageReady(true);
      })
      .catch((error) => console.error('[sour.ai] Could not hydrate local storage', error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    void persistenceRef.current?.settings.set(
      'usage.messageUnits',
      'usage',
      messageUnitsUsed
    );
    if (limitResetTime === null) {
      void persistenceRef.current?.settings.delete('usage.limitResetTime');
    } else {
      void persistenceRef.current?.settings.set(
        'usage.limitResetTime',
        'usage',
        limitResetTime
      );
    }
  }, [limitResetTime, messageUnitsUsed, storageReady]);

  useEffect(() => {
    if (!storageReady || !persistenceRef.current) return;
    const timer = window.setTimeout(() => {
      void Promise.all(
        conversations.map((conversation) =>
          persistenceRef.current!.saveConversation(conversation)
        )
      ).catch((error) => console.error('[sour.ai] Could not persist conversations', error));
    }, 100);
    return () => window.clearTimeout(timer);
  }, [conversations, storageReady]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'chat' | 'code'>('chat');

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  // Helper to increment message units
  const addMessageUnits = () => {
    setMessageUnitsUsed((prev) => Math.min(MESSAGE_QUOTA, prev + 1));
  };

  // Handle adding attachment
  const handleAddAttachment = (item: AttachmentItem) => {
    setAttachments((prev) => [...prev, item]);
  };

  // Handle removing attachment
  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Handle sending new prompt from home screen
  const handleSubmitPrompt = async (textToSend?: string) => {
    if (messageUnitsUsed >= MESSAGE_QUOTA) {
      setIsUpgradeOpen(true);
      return;
    }

    const text = textToSend || promptInput;
    if (!text.trim() && attachments.length === 0) return;

    addMessageUnits();

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      attachments: [...attachments],
      model: selectedModel,
    };

    const newConvId = Date.now().toString();
    const newConvTitle = text.slice(0, 32) || (attachments[0]?.name ?? 'New Conversation');

    const newConv: Conversation = {
      id: newConvId,
      title: newConvTitle,
      messages: [userMsg],
      createdAt: new Date(),
    };

    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConvId);
    setPromptInput('');
    setAttachments([]);
    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await runChat(
        [{ role: userMsg.role, content: userMsg.content, attachments: userMsg.attachments }],
        selectedModel,
        abortControllerRef.current.signal
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw normalizeChatProviderError(errData?.error, 'The chat provider failed to respond.');
      }

      let data: any = {};
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const textResp = await response.text();
        if (response.status === 413) {
          data = { error: 'The attached file or request payload was too large. Please try uploading a smaller image/file.' };
        } else {
          const cleanText = textResp.replace(/<[^>]*>/g, '').trim();
          data = { error: `Server returned HTTP ${response.status}: ${cleanText.slice(0, 120) || 'Unexpected server error'}` };
        }
      }

      const providerError = data.error
        ? normalizeChatProviderError(data.error)
        : null;
      const responseText =
        data.text ||
        (Array.isArray(data.images) && data.images.length > 0
          ? `Generated ${data.images.length} image${data.images.length === 1 ? '' : 's'}.`
          : providerError
            ? `Error: ${providerError.message}`
            : 'sour.ai received an empty response from the Cloudflare Pages Function. Please try again.');
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        model: selectedModel,
        thinking: data.thinking,
        thinkingLabel: data.thinkingLabel,
        images: data.images,
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === newConvId
            ? { ...c, messages: [...c.messages, assistantMsg] }
            : c
        )
      );
    } catch (err: unknown) {
      if (isAbortError(err)) {
        const stoppedMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'This response was stopped.',
          timestamp: new Date(),
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === newConvId
              ? { ...c, messages: [...c.messages, stoppedMsg] }
              : c
          )
        );
        return;
      }
      const normalized = normalizeChatProviderError(err, 'Unable to reach the chat provider.');
      console.error('[sour.ai] Chat request failed', normalized.toData());
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Failed to retrieve response from server (${normalized.message}). Please check your connectivity or API key configuration.`,
        timestamp: new Date(),
      };
      setConversations((prev) =>
        prev.map((c) =>
          c.id === newConvId
            ? { ...c, messages: [...c.messages, errorMsg] }
            : c
        )
      );
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  // Handle follow-up messages inside active conversation stream
  const handleSendFollowUp = async (text: string, newAttachments: AttachmentItem[] = []) => {
    if (messageUnitsUsed >= MESSAGE_QUOTA) {
      setIsUpgradeOpen(true);
      return;
    }

    const targetConvId = activeConversationId;
    if (!targetConvId || (!text.trim() && newAttachments.length === 0)) return;

    addMessageUnits();

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      attachments: newAttachments,
      model: selectedModel,
    };

    const updatedMessages = [...(activeConversation?.messages || []), userMsg];

    setConversations((prev) =>
      prev.map((c) =>
        c.id === targetConvId
          ? { ...c, messages: updatedMessages }
          : c
      )
    );

    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    try {
      // Send the last 40 messages for AI context, keep full history in state
      const contextMessages = updatedMessages.slice(-40);
      const sanitizedMessages = contextMessages.map((m, idx) => {
        const isRecent = idx >= contextMessages.length - 2;
        return {
          role: m.role,
          content: m.content,
          attachments: m.attachments?.map((att) => {
            if (isRecent) return att;
            const { dataUrl, pageImages, type_schema, ...lightweightAtt } = att;
            return lightweightAtt;
          }),
        };
      });

      const response = await runChat(
        sanitizedMessages,
        selectedModel,
        abortControllerRef.current.signal
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw normalizeChatProviderError(errData?.error, 'The chat provider failed to respond.');
      }

      let data: any = {};
      const contentType2 = response.headers.get('content-type') || '';
      if (contentType2.includes('application/json')) {
        data = await response.json();
      } else {
        const textResp = await response.text();
        if (response.status === 413) {
          data = { error: 'The attached file or request payload was too large. Please try uploading a smaller image/file.' };
        } else {
          const cleanText = textResp.replace(/<[^>]*>/g, '').trim();
          data = { error: `Server returned HTTP ${response.status}: ${cleanText.slice(0, 120) || 'Unexpected server error'}` };
        }
      }

      const providerError = data.error
        ? normalizeChatProviderError(data.error)
        : null;
      const responseText =
        data.text ||
        (Array.isArray(data.images) && data.images.length > 0
          ? `Generated ${data.images.length} image${data.images.length === 1 ? '' : 's'}.`
          : providerError
            ? `Error: ${providerError.message}`
            : 'sour.ai received an empty response from the Cloudflare Pages Function. Please try again.');
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        model: selectedModel,
        thinking: data.thinking,
        thinkingLabel: data.thinkingLabel,
        images: data.images,
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetConvId
            ? { ...c, messages: [...c.messages, assistantMsg] }
            : c
        )
      );
    } catch (err: unknown) {
      if (isAbortError(err)) {
        const stoppedMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'This response was stopped.',
          timestamp: new Date(),
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvId
              ? { ...c, messages: [...c.messages, stoppedMsg] }
              : c
          )
        );
        return;
      }
      const normalized = normalizeChatProviderError(err, 'Unable to reach the chat provider.');
      console.error('[sour.ai] Chat follow-up request failed', normalized.toData());
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Failed to retrieve response from server (${normalized.message}). Please check your connectivity or API key configuration.`,
        timestamp: new Date(),
      };
      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetConvId
            ? { ...c, messages: [...c.messages, errorMsg] }
            : c
        )
      );
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  // New Chat handler
  const handleNewChat = () => {
    handleStopGeneration();
    setActiveConversationId(null);
    setPromptInput('');
    setAttachments([]);
  };

  // Delete Conversation handler
  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    void persistenceRef.current
      ?.deleteConversation(id)
      .catch((error) => console.error('[sour.ai] Could not delete conversation', error));
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
  };

  // Reset chat when switching views
  useEffect(() => {
    handleNewChat();
  }, [activeView]);

  return (
    <div className={`zed-shell h-screen w-screen overflow-hidden flex flex-row ${isDarkMode ? 'dark bg-[#121316] text-[#dce0e5]' : 'bg-[#fbfcfd] text-[#16181d]'} antialiased`}>
      {/* Left Icon Sidebar + Drawer */}
      <LeftSidebar
        onNewChat={() => {
          handleNewChat();
          setActiveView('chat');
        }}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setActiveView('chat');
        }}
        onDeleteConversation={handleDeleteConversation}
        onOpenUpgrade={() => setIsUpgradeOpen(true)}
        messageUnitsUsed={messageUnitsUsed}
        isDarkMode={isDarkMode}
        onToggleTheme={handleToggleTheme}
        activeView={activeView}
        onViewChange={(view) => setActiveView(view)}
      />

      {/* Main Container Area */}
      <div className="zed-shell z-grid flex-1 h-screen flex flex-col justify-between overflow-hidden relative bg-[#fbfcfd] dark:bg-[#121316] text-[#16181d] dark:text-[#dce0e5] transition-colors duration-200">
        {/* Top Bar Navigation */}
        {activeView !== 'code' && (
          <TopBar />
        )}

        {/* View Switcher with Smooth Blurry Motion Transitions */}
        <AnimatePresence mode="wait">
          {activeView === 'code' ? (
            <motion.div
              key="code-workspace"
              initial={{ opacity: 0, filter: 'blur(10px)', scale: 0.99 }}
              animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
              exit={{ opacity: 0, filter: 'blur(10px)', scale: 0.99 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <CodeWorkspace isDarkMode={isDarkMode} />
            </motion.div>
          ) : activeConversation ? (
            <motion.div
              key={activeConversation.id}
              initial={{ opacity: 0, filter: 'blur(10px)', scale: 0.99 }}
              animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
              exit={{ opacity: 0, filter: 'blur(10px)', scale: 0.99 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <ChatStreamView
                messages={activeConversation.messages}
                isGenerating={isGenerating}
                onSendFollowUp={handleSendFollowUp}
                onBackToHome={handleNewChat}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                onOpenUpgrade={() => setIsUpgradeOpen(true)}
                onStopGeneration={handleStopGeneration}
              />
            </motion.div>
          ) : (
            <motion.div
              key="home-view"
              initial={{ opacity: 0, filter: 'blur(10px)', scale: 0.99 }}
              animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
              exit={{ opacity: 0, filter: 'blur(0px)', scale: 1 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="flex-1 flex flex-col items-center justify-center px-4 -mt-8 select-none"
            >
              {/* Greeting Header */}
              <GreetingHeader />

              {/* Main Prompt Search Card */}
              <MainPromptCard
                promptInput={promptInput}
                setPromptInput={setPromptInput}
                onSubmit={() => handleSubmitPrompt()}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                attachments={attachments}
                onAddAttachment={handleAddAttachment}
                onRemoveAttachment={handleRemoveAttachment}
                onOpenUpgrade={() => setIsUpgradeOpen(true)}
                messageUnitsUsed={messageUnitsUsed}
                isGenerating={isGenerating}
                onStopGeneration={handleStopGeneration}
                limitResetTime={limitResetTime}
                onResetLimit={handleResetLimit}
              />

              {/* Prompt Action Chips under card */}
              <PromptChips
                onSelectPrompt={(promptText) => {
                  setPromptInput(promptText);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom subtle attribution / disclaimer text */}
        {activeView !== 'code' && !activeConversation && (
          <div className="py-1.5 text-center text-[10px] text-[#78828e] dark:text-[#666] select-none">
            sour.ai can make mistakes. Verify important info.
          </div>
        )}
      </div>

      {/* Upgrade Pro Modal */}
      <UpgradeModal
        isOpen={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        limitResetTime={limitResetTime}
        onResetLimit={handleResetLimit}
      />

      {/* Global custom right-click context menu, available across the whole workspace */}
      <GlobalContextMenu isDarkMode={isDarkMode} onToggleTheme={handleToggleTheme} />

      {/* Developer Shortcut Toast */}
      <AnimatePresence>
        {devToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-[#16181d] text-white dark:bg-[#dce0e5] dark:text-[#16181d] text-xs font-mono font-medium px-4 py-2 rounded-xl shadow-2xl border border-amber-500/40 flex items-center gap-2 select-none"
          >
            <span>{devToast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

