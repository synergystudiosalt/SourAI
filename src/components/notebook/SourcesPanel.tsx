import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Plus,
  FileText,
  Globe,
  FileType2,
  Table2,
  Code2,
  StickyNote,
  Trash2,
  Search,
  ScanText,
  X,
} from 'lucide-react';

import {
  countWords,
  sourceKindLabel,
  type NotebookSource,
  type NotebookSourceKind,
} from '../../features/notebook/types';

const ICONS: Record<NotebookSourceKind, React.ComponentType<{ className?: string }>> = {
  pdf: FileType2,
  docx: FileText,
  text: FileText,
  markdown: FileText,
  code: Code2,
  csv: Table2,
  website: Globe,
  note: StickyNote,
};

export interface SourcesPanelProps {
  sources: NotebookSource[];
  activeSourceId: string | null;
  onAddSource: () => void;
  onToggleSource: (id: string) => void;
  onToggleAll: (selected: boolean) => void;
  onOpenSource: (id: string) => void;
  onRemoveSource: (id: string) => void;
  onCancelTranscription?: (id: string) => void;
  formatRemaining?: (ms: number) => string;
}

export const SourcesPanel: React.FC<SourcesPanelProps> = ({
  sources,
  activeSourceId,
  onAddSource,
  onToggleSource,
  onToggleAll,
  onOpenSource,
  onRemoveSource,
  onCancelTranscription,
  formatRemaining,
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sources;
    return sources.filter((source) => source.title.toLowerCase().includes(needle));
  }, [sources, query]);

  const allSelected = sources.length > 0 && sources.every((source) => source.selected);
  const selectedCount = sources.filter((source) => source.selected).length;

  return (
    <section
      aria-label="Sources"
      className="zed-file-explorer z-grid z-grid-fine flex h-full w-full flex-col border-r border-[#dfe3ea] bg-[#fbfcfd] dark:border-[#282c33] dark:bg-[#17191d]"
    >
      <div className="zed-panel-bar flex h-9 shrink-0 items-center justify-between border-b border-[#dfe3ea] px-3 dark:border-[#282c33]">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#78828e]">
          Sources
        </span>
        <button
          type="button"
          onClick={onAddSource}
          title="Add source"
          className="flex items-center gap-1 border border-[#dfe3ea] px-1.5 py-0.5 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>

      {sources.length > 0 && (
        <>
          <div className="shrink-0 px-2.5 pt-2.5">
            <div className="relative flex items-center">
              <Search className="absolute left-2 h-3 w-3 text-[#78828e]" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sources"
                className="w-full border border-[#dfe3ea] bg-[#f2f4f7] py-1 pl-7 pr-2 text-[11.5px] text-[#16181d] outline-none placeholder:text-[#78828e] focus:border-[#4776d5] dark:border-[#282c33] dark:bg-[#1e2128] dark:text-[#dce0e5]"
              />
            </div>
          </div>

          <label className="flex shrink-0 cursor-pointer items-center justify-between px-3 py-2 text-[11.5px] text-[#4a5259] dark:text-[#a9afbc]">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => onToggleAll(event.target.checked)}
                className="h-3 w-3 accent-[#4776d5]"
              />
              Select all sources
            </span>
            <span className="font-code text-[10px] text-[#78828e]">
              {selectedCount}/{sources.length}
            </span>
          </label>
        </>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 thin-scrollbar">
        {sources.length === 0 ? (
          <div className="mt-6 border border-dashed border-[#c3cad6] px-3 py-6 text-center dark:border-[#3b414d]">
            <FileText className="mx-auto mb-2 h-5 w-5 text-[#78828e]" />
            <p className="text-[11.5px] leading-relaxed text-[#4a5259] dark:text-[#a9afbc]">
              Saved sources will appear here.
            </p>
            <button
              type="button"
              onClick={onAddSource}
              className="mt-3 w-full bg-[#4776d5] px-2 py-1.5 text-[11.5px] font-medium text-white interactable-btn"
            >
              Add a source
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11.5px] text-[#78828e]">No matching sources.</p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((source) => {
              const Icon = ICONS[source.kind] ?? FileText;
              const isActive = source.id === activeSourceId;
              const transcription = source.transcription;
              return (
                <li key={source.id}>
                  <div
                    className={`ws-file-item group flex items-center gap-1.5 px-1.5 py-1.5 ${
                      isActive
                        ? 'bg-[#e3e7ee] dark:bg-[#282c33]'
                        : 'hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={source.selected}
                      onChange={() => onToggleSource(source.id)}
                      aria-label={`Use ${source.title}`}
                      className="h-3 w-3 shrink-0 accent-[#4776d5]"
                    />
                    <button
                      type="button"
                      onClick={() => onOpenSource(source.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      title={source.title}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-[#4776d5]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] text-[#16181d] dark:text-[#dce0e5]">
                          {source.title}
                        </span>
                        <span className="block truncate font-code text-[9.5px] text-[#78828e]">
                          {sourceKindLabel(source.kind)} · {countWords(source.content).toLocaleString()} words
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveSource(source.id)}
                      title="Remove source"
                      aria-label={`Remove ${source.title}`}
                      className="shrink-0 p-0.5 text-[#78828e] opacity-0 transition-opacity hover:text-[#c0392b] group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Scanned pages are read by the model afterwards, one at a
                      time. The job runs for minutes, so it reports where it is
                      and can be stopped. */}
                  <AnimatePresence initial={false}>
                    {transcription && transcription.state === 'running' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <div className="mx-1.5 mb-1 border-l-2 border-[#4776d5] bg-[#f2f4f7] px-2 py-1.5 dark:bg-[#1e2128]">
                          <div className="flex items-center justify-between gap-1">
                            <span className="flex min-w-0 items-center gap-1 text-[10px] text-[#4a5259] dark:text-[#a9afbc]">
                              <ScanText className="h-3 w-3 shrink-0 animate-pulse text-[#4776d5]" />
                              <span className="truncate">
                                Reading scanned page {Math.min(transcription.completed + 1, transcription.total)} of{' '}
                                {transcription.total}
                              </span>
                            </span>
                            {onCancelTranscription && (
                              <button
                                type="button"
                                onClick={() => onCancelTranscription(source.id)}
                                aria-label={`Stop reading ${source.title}`}
                                title="Stop"
                                className="shrink-0 p-0.5 text-[#78828e] hover:text-[#c0392b]"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          <div className="mt-1 h-[2px] w-full bg-[#dfe3ea] dark:bg-[#282c33]">
                            <motion.div
                              className="h-full bg-[#4776d5]"
                              initial={false}
                              animate={{
                                width: `${(transcription.completed / Math.max(transcription.total, 1)) * 100}%`,
                              }}
                              transition={{ type: 'spring', stiffness: 200, damping: 30 }}
                            />
                          </div>
                          {formatRemaining && transcription.remainingMs !== undefined && (
                            <span className="mt-1 block font-code text-[9px] text-[#78828e]">
                              {formatRemaining(transcription.remainingMs)}
                            </span>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {transcription && transcription.state === 'cancelled' && (
                    <p className="mx-1.5 mb-1 px-2 text-[9.5px] text-[#78828e]">
                      Page reading stopped — {transcription.completed} of {transcription.total} read.
                    </p>
                  )}
                  {transcription && transcription.state === 'failed' && (
                    <p className="mx-1.5 mb-1 px-2 text-[9.5px] text-[#b5484a]">
                      Those scanned pages could not be read.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};
