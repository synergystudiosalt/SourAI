import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { FileText, MessageSquare, Wand2 } from 'lucide-react';

import {
  askNotebook,
  generateOverview,
  generateStudioDocument,
  summariseSource,
  NotebookApiError,
} from '../../features/notebook/api';
import {
  createNotebookId,
  selectedSources as pickSelected,
  studioArtifactTitle,
  UNTITLED_NOTEBOOK,
  type Notebook,
  type NotebookMessage,
  type NotebookSource,
  type StudioArtifact,
  type StudioArtifactKind,
} from '../../features/notebook/types';
import type { AIModel } from '../../types';
import { MESSAGE_QUOTA } from '../../utils/constants';
import { composePdfText } from '../../features/notebook/pdfText';
import { formatRemaining, transcribePdfPages } from '../../features/notebook/pdfOcr';
import { studioOptionSpec, type StudioOptions } from '../../../functions/shared/studioOptions';
import { AddSourceDialog, type PendingTranscription } from './AddSourceDialog';
import { StudioOptionsDialog } from './StudioOptionsDialog';
import { ArtifactViewer } from './ArtifactViewer';
import { NotebookChatPanel } from './NotebookChatPanel';
import { SourceViewer } from './SourceViewer';
import { SourcesPanel } from './SourcesPanel';
import { StudioPanel } from './StudioPanel';

/**
 * The Notebook workspace: sources on the left, a grounded conversation in the
 * middle, generated study material on the right.
 *
 * All notebook state is owned by `App` through `useNotebooks` and mutated here
 * via `onChange`, so switching notebooks in the sidebar never loses work in
 * flight and everything is written to IndexedDB by the same debounced writer.
 */

export interface NotebookWorkspaceProps {
  notebook: Notebook;
  onChange: (update: (notebook: Notebook) => Notebook) => void;
  selectedModel: AIModel;
  onSelectModel: (model: AIModel) => void;
  messageUnitsUsed: number;
  onConsumeMessageUnit: () => void;
  onOpenUpgrade: () => void;
}

type CenterView =
  | { kind: 'chat' }
  | { kind: 'source'; id: string }
  | { kind: 'artifact'; id: string };

type MobileTab = 'sources' | 'chat' | 'studio';

const newId = createNotebookId;

export const NotebookWorkspace: React.FC<NotebookWorkspaceProps> = ({
  notebook,
  onChange,
  selectedModel,
  onSelectModel,
  messageUnitsUsed,
  onConsumeMessageUnit,
  onOpenUpgrade,
}) => {
  const [view, setView] = useState<CenterView>({ kind: 'chat' });
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOverviewLoading, setIsOverviewLoading] = useState(false);
  const [pendingKind, setPendingKind] = useState<StudioArtifactKind | null>(null);
  /** The kind waiting on its settings dialog, if any. */
  const [configuringKind, setConfiguringKind] = useState<Exclude<StudioArtifactKind, 'note'> | null>(
    null
  );
  const [titleDraft, setTitleDraft] = useState(notebook.title);
  const askControllerRef = useRef<AbortController | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** Running page-transcription jobs, keyed by source id. */
  const transcriptionRef = useRef(new Map<string, AbortController>());

  const selected = useMemo(() => pickSelected(notebook), [notebook]);
  const selectedKey = selected.map((source) => source.id).join('|');

  useEffect(() => {
    setView({ kind: 'chat' });
  }, [notebook.id]);

  // The title is also written by the first source and by the generated guide,
  // so the field follows the notebook — except while it is being typed in,
  // where taking the value back would eat the user's edit.
  useEffect(() => {
    if (titleInputRef.current === document.activeElement) return;
    setTitleDraft(notebook.title);
  }, [notebook.title]);

  // A request in flight belongs to the notebook that started it; leaving the
  // notebook must not append its answer to a different transcript.
  useEffect(() => {
    const jobs = transcriptionRef.current;
    return () => {
      askControllerRef.current?.abort();
      askControllerRef.current = null;
      // A transcription belongs to the notebook that started it, and its pdf.js
      // handle must not outlive the view.
      for (const controller of jobs.values()) controller.abort();
      jobs.clear();
    };
  }, [notebook.id]);

  const patchSource = useCallback(
    (id: string, patch: Partial<NotebookSource>) => {
      onChange((current) => ({
        ...current,
        sources: current.sources.map((source) =>
          source.id === id ? { ...source, ...patch } : source
        ),
      }));
    },
    [onChange]
  );

  // ── Sources ───────────────────────────────────────────────────────────────

  /**
   * Reads the pages of a scanned PDF that carry no text.
   *
   * The source is already in the notebook and usable; each transcribed page is
   * merged in as it arrives, so a long document becomes progressively more
   * answerable instead of appearing all at once at the end.
   */
  const runTranscription = useCallback(
    async (job: PendingTranscription) => {
      const controller = new AbortController();
      transcriptionRef.current.set(job.sourceId, controller);
      const pages = job.pages.map((page) => ({ ...page }));

      try {
        const summary = await transcribePdfPages({
          handle: job.handle,
          pages: job.pendingPages,
          signal: controller.signal,
          onPage: ({ page, text }) => {
            const slot = pages.find((entry) => entry.page === page);
            if (slot) slot.text = text;
            patchSource(job.sourceId, { content: composePdfText(pages, job.truncated) });
          },
          onProgress: ({ completed, total, estimatedRemainingMs }) => {
            patchSource(job.sourceId, {
              transcription: {
                state: 'running',
                total,
                completed,
                remainingMs: estimatedRemainingMs,
              },
            });
          },
        });

        patchSource(job.sourceId, {
          transcription: {
            state: summary.cancelled
              ? 'cancelled'
              : summary.transcribed === 0
                ? 'failed'
                : 'done',
            total: job.pendingPages.length,
            completed: summary.transcribed + summary.blank + summary.failed,
          },
        });
      } catch (error) {
        console.error('[sour.ai] Page transcription failed', error);
        patchSource(job.sourceId, {
          transcription: { state: 'failed', total: job.pendingPages.length, completed: 0 },
        });
      } finally {
        transcriptionRef.current.delete(job.sourceId);
        await job.handle.close();
      }
    },
    [patchSource]
  );

  const addSources = useCallback(
    (added: NotebookSource[], pending?: PendingTranscription[]) => {
      onChange((current) => ({
        ...current,
        title:
          current.title === UNTITLED_NOTEBOOK && added[0]
            ? added[0].title.slice(0, 60)
            : current.title,
        sources: [...current.sources, ...added],
      }));
      for (const job of pending ?? []) void runTranscription(job);
    },
    [onChange, runTranscription]
  );

  const cancelTranscription = useCallback((id: string) => {
    transcriptionRef.current.get(id)?.abort();
  }, []);

  const removeSource = useCallback(
    (id: string) => {
      transcriptionRef.current.get(id)?.abort();
      onChange((current) => ({
        ...current,
        sources: current.sources.filter((source) => source.id !== id),
      }));
      setView((current) => (current.kind === 'source' && current.id === id ? { kind: 'chat' } : current));
    },
    [onChange]
  );

  const runSourceSummary = useCallback(
    async (id: string) => {
      const source = notebook.sources.find((entry) => entry.id === id);
      if (!source) return;
      patchSource(id, { summaryState: 'loading' });
      try {
        const reply = await summariseSource({ source, model: selectedModel });
        patchSource(id, {
          summary: reply.summary,
          topics: reply.topics,
          summaryState: 'ready',
        });
      } catch (error) {
        console.error('[sour.ai] Source summary failed', error);
        patchSource(id, { summaryState: 'error' });
      }
    },
    [notebook.sources, patchSource, selectedModel]
  );

  // ── Notebook guide ────────────────────────────────────────────────────────

  const runOverview = useCallback(async () => {
    const sources = pickSelected(notebook);
    if (sources.length === 0 || isOverviewLoading) return;
    setIsOverviewLoading(true);
    const sourceIds = sources.map((source) => source.id);
    try {
      const reply = await generateOverview({ sources, model: selectedModel });
      onChange((current) => ({
        ...current,
        title:
          current.title === UNTITLED_NOTEBOOK && reply.title ? reply.title : current.title,
        overview: {
          summary: reply.summary,
          topics: reply.topics,
          questions: reply.questions,
        },
        overviewSourceIds: sourceIds,
      }));
    } catch (error) {
      console.error('[sour.ai] Notebook guide failed', error);
      // Remember the attempt so a failing provider is not retried on every
      // render; the user can still refresh the guide by hand.
      onChange((current) => ({ ...current, overviewSourceIds: sourceIds }));
    } finally {
      setIsOverviewLoading(false);
    }
  }, [isOverviewLoading, notebook, onChange, selectedModel]);

  // The guide describes the selected sources, so it is regenerated when that
  // set changes rather than on every edit to the notebook.
  useEffect(() => {
    if (selected.length === 0) return;
    const previous = (notebook.overviewSourceIds ?? []).join('|');
    if (previous === selectedKey) return;
    void runOverview();
    // `runOverview` reads the current notebook; re-running on its identity
    // would loop, so the source selection is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, notebook.id]);

  // ── Chat ──────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    askControllerRef.current?.abort();
    askControllerRef.current = null;
    setIsGenerating(false);
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const sources = pickSelected(notebook);
      if (!question.trim() || sources.length === 0 || isGenerating) return;
      if (messageUnitsUsed >= MESSAGE_QUOTA) {
        onOpenUpgrade();
        return;
      }
      onConsumeMessageUnit();

      const userMessage: NotebookMessage = {
        id: newId(),
        role: 'user',
        content: question.trim(),
        createdAt: Date.now(),
      };
      const history = [...notebook.messages, userMessage];
      onChange((current) => ({ ...current, messages: [...current.messages, userMessage] }));
      setView({ kind: 'chat' });
      setMobileTab('chat');
      setIsGenerating(true);

      const controller = new AbortController();
      askControllerRef.current = controller;
      try {
        const reply = await askNotebook({
          sources,
          messages: history,
          model: selectedModel,
          signal: controller.signal,
        });
        const answer: NotebookMessage = {
          id: newId(),
          role: 'assistant',
          content: reply.text,
          createdAt: Date.now(),
          citedSourceIds: reply.sourceIds,
        };
        onChange((current) => ({ ...current, messages: [...current.messages, answer] }));
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        const failure: NotebookMessage = {
          id: newId(),
          role: 'assistant',
          content:
            error instanceof NotebookApiError
              ? error.message
              : 'sour.ai could not answer from these sources. Please try again.',
          createdAt: Date.now(),
          isError: true,
        };
        onChange((current) => ({ ...current, messages: [...current.messages, failure] }));
      } finally {
        if (askControllerRef.current === controller) askControllerRef.current = null;
        setIsGenerating(false);
      }
    },
    [
      isGenerating,
      messageUnitsUsed,
      notebook,
      onChange,
      onConsumeMessageUnit,
      onOpenUpgrade,
      selectedModel,
    ]
  );

  // ── Studio ────────────────────────────────────────────────────────────────

  const addArtifact = useCallback(
    (artifact: StudioArtifact) => {
      onChange((current) => ({ ...current, artifacts: [artifact, ...current.artifacts] }));
    },
    [onChange]
  );

  const generate = useCallback(
    async (kind: Exclude<StudioArtifactKind, 'note'>, options: StudioOptions = {}) => {
      const sources = pickSelected(notebook);
      if (sources.length === 0 || pendingKind) return;
      setPendingKind(kind);
      try {
        const reply = await generateStudioDocument({
          kind,
          sources,
          model: selectedModel,
          options,
        });
        const artifact: StudioArtifact = {
          id: newId(),
          kind,
          title: studioArtifactTitle(kind),
          content: reply.text,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          citedSourceIds: reply.sourceIds,
        };
        addArtifact(artifact);
        setView({ kind: 'artifact', id: artifact.id });
        setMobileTab('chat');
      } catch (error) {
        console.error('[sour.ai] Studio generation failed', error);
        const failure: NotebookMessage = {
          id: newId(),
          role: 'assistant',
          content:
            error instanceof NotebookApiError
              ? error.message
              : `The ${studioArtifactTitle(kind).toLowerCase()} could not be generated.`,
          createdAt: Date.now(),
          isError: true,
        };
        onChange((current) => ({ ...current, messages: [...current.messages, failure] }));
      } finally {
        setPendingKind(null);
      }
    },
    [addArtifact, notebook, onChange, pendingKind, selectedModel]
  );

  const addNote = useCallback(() => {
    const note: StudioArtifact = {
      id: newId(),
      kind: 'note',
      title: 'New note',
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addArtifact(note);
    setView({ kind: 'artifact', id: note.id });
    setMobileTab('chat');
  }, [addArtifact]);

  const saveMessageAsNote = useCallback(
    (message: NotebookMessage) => {
      const note: StudioArtifact = {
        id: newId(),
        kind: 'note',
        title: message.content.replace(/[#*`>]/g, '').trim().split('\n')[0].slice(0, 60) || 'Saved answer',
        content: message.content,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        citedSourceIds: message.citedSourceIds,
      };
      addArtifact(note);
    },
    [addArtifact]
  );

  const updateArtifact = useCallback(
    (id: string, patch: Partial<Pick<StudioArtifact, 'title' | 'content'>>) => {
      onChange((current) => ({
        ...current,
        artifacts: current.artifacts.map((artifact) =>
          artifact.id === id ? { ...artifact, ...patch, updatedAt: Date.now() } : artifact
        ),
      }));
    },
    [onChange]
  );

  const removeArtifact = useCallback(
    (id: string) => {
      onChange((current) => ({
        ...current,
        artifacts: current.artifacts.filter((artifact) => artifact.id !== id),
      }));
      setView((current) =>
        current.kind === 'artifact' && current.id === id ? { kind: 'chat' } : current
      );
    },
    [onChange]
  );

  const convertArtifactToSource = useCallback(
    (artifact: StudioArtifact) => {
      addSources([
        {
          id: newId(),
          title: artifact.title,
          kind: 'note',
          content: artifact.content,
          addedAt: Date.now(),
          selected: true,
          summaryState: 'idle',
        },
      ]);
      setMobileTab('sources');
    },
    [addSources]
  );

  const openSource = useCallback((id: string) => {
    setView({ kind: 'source', id });
    setMobileTab('chat');
  }, []);

  const activeSource =
    view.kind === 'source' ? notebook.sources.find((source) => source.id === view.id) : undefined;
  const activeArtifact =
    view.kind === 'artifact'
      ? notebook.artifacts.find((artifact) => artifact.id === view.id)
      : undefined;

  const centre = (
    <AnimatePresence mode="wait">
      {activeSource ? (
        <SourceViewer
          key={`source-${activeSource.id}`}
          source={activeSource}
          onBack={() => setView({ kind: 'chat' })}
          onSummarise={(id) => void runSourceSummary(id)}
        />
      ) : activeArtifact ? (
        <ArtifactViewer
          key={`artifact-${activeArtifact.id}`}
          artifact={activeArtifact}
          notebook={notebook}
          onBack={() => setView({ kind: 'chat' })}
          onUpdate={updateArtifact}
          onConvertToSource={convertArtifactToSource}
          onOpenSource={openSource}
        />
      ) : (
        <NotebookChatPanel
          key="chat"
          notebook={notebook}
          selectedSources={selected}
          isGenerating={isGenerating}
          overview={notebook.overview}
          isOverviewLoading={isOverviewLoading}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          onSubmit={(question) => void ask(question)}
          onStop={stop}
          onRefreshOverview={() => void runOverview()}
          onSaveToNote={saveMessageAsNote}
          onOpenSource={openSource}
          onAddSource={() => setIsAddOpen(true)}
        />
      )}
    </AnimatePresence>
  );

  const sourcesPanel = (
    <SourcesPanel
      sources={notebook.sources}
      activeSourceId={view.kind === 'source' ? view.id : null}
      onAddSource={() => setIsAddOpen(true)}
      onToggleSource={(id) => {
        const source = notebook.sources.find((entry) => entry.id === id);
        if (source) patchSource(id, { selected: !source.selected });
      }}
      onToggleAll={(value) =>
        onChange((current) => ({
          ...current,
          sources: current.sources.map((source) => ({ ...source, selected: value })),
        }))
      }
      onOpenSource={openSource}
      onRemoveSource={removeSource}
      onCancelTranscription={cancelTranscription}
      formatRemaining={formatRemaining}
    />
  );

  const studioPanel = (
    <StudioPanel
      artifacts={notebook.artifacts}
      activeArtifactId={view.kind === 'artifact' ? view.id : null}
      pendingKind={pendingKind}
      canGenerate={selected.length > 0}
      onGenerate={(kind) => {
        // Kinds with a settings spec ask first; the rest go straight to the
        // model, because a dialog with nothing in it is pure friction.
        if (studioOptionSpec(kind)) setConfiguringKind(kind);
        else void generate(kind);
      }}
      onAddNote={addNote}
      onOpenArtifact={(id) => {
        setView({ kind: 'artifact', id });
        setMobileTab('chat');
      }}
      onRemoveArtifact={removeArtifact}
    />
  );

  const tabs: { id: MobileTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'sources', label: 'Sources', icon: FileText },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'studio', label: 'Studio', icon: Wand2 },
  ];

  return (
    // `zed-workspace` is deliberately not used here: it zooms to 1.04 for the
    // IDE's fixed-pixel chrome, which leaves this panel an inch short of the
    // viewport. The notebook is laid out in flex units and needs no scaling.
    <div className="flex h-full min-h-0 w-full flex-col bg-[#fbfcfd] text-[#16181d] dark:bg-[#121316] dark:text-[#dce0e5]">
      <header className="zed-titlebar flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[#dfe3ea] bg-[#f6f8fa] px-3 dark:border-[#282c33] dark:bg-[#17191d]">
        <input
          ref={titleInputRef}
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() =>
            onChange((current) => ({ ...current, title: titleDraft.trim() || current.title }))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          aria-label="Notebook title"
          className="min-w-0 flex-1 truncate bg-transparent font-heading text-[15px] not-italic text-[#16181d] outline-none focus:border-b focus:border-[#4776d5] dark:text-[#dce0e5]"
        />
        <span className="hidden shrink-0 font-code text-[10px] uppercase tracking-wider text-[#78828e] sm:block">
          {notebook.sources.length} source{notebook.sources.length === 1 ? '' : 's'} ·{' '}
          {notebook.artifacts.length} saved
        </span>
      </header>

      {/* Mobile: one column at a time. */}
      <nav
        aria-label="Notebook panes"
        className="flex shrink-0 border-b border-[#dfe3ea] dark:border-[#282c33] lg:hidden"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMobileTab(tab.id)}
              aria-current={mobileTab === tab.id ? 'page' : undefined}
              className={`ws-tab flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-[11.5px] ${
                mobileTab === tab.id
                  ? 'border-[#4776d5] text-[#16181d] dark:text-[#dce0e5]'
                  : 'border-transparent text-[#78828e]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1">
        <div
          className={`${mobileTab === 'sources' ? 'flex' : 'hidden'} min-h-0 w-full lg:flex lg:w-[258px] lg:shrink-0`}
        >
          {sourcesPanel}
        </div>
        <div
          className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col lg:flex`}
        >
          {centre}
        </div>
        <div
          className={`${mobileTab === 'studio' ? 'flex' : 'hidden'} min-h-0 w-full lg:flex lg:w-[268px] lg:shrink-0`}
        >
          {studioPanel}
        </div>
      </div>

      <StudioOptionsDialog
        kind={configuringKind}
        onCancel={() => setConfiguringKind(null)}
        onConfirm={(options) => {
          const kind = configuringKind;
          setConfiguringKind(null);
          if (kind) void generate(kind, options);
        }}
      />

      <AddSourceDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onAddSources={addSources}
        sourceCount={notebook.sources.length}
      />
    </div>
  );
};

export default NotebookWorkspace;
