import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileUp, Link2, ClipboardType, X, Loader2, AlertCircle } from 'lucide-react';

import { fetchWebsiteSource, NotebookApiError } from '../../features/notebook/api';
import type { NotebookSource, NotebookSourceKind } from '../../features/notebook/types';
import { createNotebookId } from '../../features/notebook/types';
import type { PdfDocumentHandle, PdfPageText } from '../../features/notebook/pdfText';

/**
 * A scanned PDF that still needs its pages read by the model.
 *
 * The document handle is passed on still open, because every pending page has
 * to be rendered from it; the workspace closes it when the job ends.
 */
export interface PendingTranscription {
  sourceId: string;
  handle: PdfDocumentHandle;
  pages: PdfPageText[];
  pendingPages: number[];
  truncated: boolean;
}

/**
 * The three ways a source gets into a notebook: a file, a link, or pasted text.
 *
 * DOCX and plain files reuse the app's existing extractor (`utils/fileParser`).
 * PDFs do not: that parser stops after five pages and rasterises each one for a
 * vision model, so a notebook source built from it silently contained a
 * fraction of the document. `features/notebook/pdfText` reads the whole file as
 * text instead, which is all a grounded, citable answer needs.
 */

const ACCEPTED_FILES =
  '.txt,.md,.markdown,.json,.csv,.tsv,.log,.pdf,.doc,.docx,.js,.ts,.tsx,.jsx,.py,.html,.css,.yml,.yaml,.xml,.sql,.sh,.rs,.go,.java,.rb,.php,.c,.cpp,.cs';

const MAX_SOURCES = 50;

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function kindForFile(name: string, parsedType: string): NotebookSourceKind {
  const lower = name.toLowerCase();
  if (parsedType === 'pdf') return 'pdf';
  if (parsedType === 'docx') return 'docx';
  if (/\.(md|markdown)$/.test(lower)) return 'markdown';
  if (/\.(csv|tsv)$/.test(lower)) return 'csv';
  if (parsedType === 'code') return 'code';
  return 'text';
}

export interface AddSourceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSources: (sources: NotebookSource[], pending?: PendingTranscription[]) => void;
  sourceCount: number;
}

type Tab = 'upload' | 'link' | 'paste';

export const AddSourceDialog: React.FC<AddSourceDialogProps> = ({
  isOpen,
  onClose,
  onAddSources,
  sourceCount,
}) => {
  const [tab, setTab] = useState<Tab>('upload');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [linkValue, setLinkValue] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteValue, setPasteValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const remaining = MAX_SOURCES - sourceCount;

  const reset = () => {
    setError(null);
    setProgress(null);
    setLinkValue('');
    setPasteTitle('');
    setPasteValue('');
    setIsBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, Math.max(0, remaining));
    if (list.length === 0) {
      setError(`A notebook holds up to ${MAX_SOURCES} sources.`);
      return;
    }
    setIsBusy(true);
    setError(null);
    setProgress(null);
    try {
      const [{ parseUploadedFile }, { extractPdf }] = await Promise.all([
        import('../../utils/fileParser'),
        import('../../features/notebook/pdfText'),
      ]);
      const added: NotebookSource[] = [];
      const pending: PendingTranscription[] = [];
      const failed: string[] = [];
      for (const file of list) {
        const position = list.length > 1 ? ` (${added.length + failed.length + 1}/${list.length})` : '';
        setProgress(`Reading ${file.name}${position}…`);
        try {
          // PDFs go through the notebook's own reader. The shared attachment
          // parser stops after five pages and rasterises each one for a vision
          // model, which quietly threw away most of any real document.
          if (isPdf(file)) {
            const extracted = await extractPdf(file, file.name);
            const sourceId = createNotebookId();
            const needsTranscription = extracted.pendingPages.length > 0;
            added.push({
              id: sourceId,
              title: file.name,
              kind: 'pdf',
              content: extracted.text,
              addedAt: Date.now(),
              selected: true,
              summaryState: 'idle',
              transcription: needsTranscription
                ? { state: 'running', total: extracted.pendingPages.length, completed: 0 }
                : undefined,
            });
            // Pages with no text layer are read by the model afterwards; the
            // source is usable in the meantime with whatever text it does have.
            if (needsTranscription) {
              pending.push({
                sourceId,
                handle: extracted.handle,
                pages: extracted.pages,
                pendingPages: extracted.pendingPages,
                truncated: extracted.truncated,
              });
            } else {
              await extracted.handle.close();
            }
            continue;
          }

          const parsed = await parseUploadedFile(file);
          const content = (parsed.content || '').trim();
          if (!content) {
            failed.push(`${file.name} (no readable text)`);
            continue;
          }
          added.push({
            id: createNotebookId(),
            title: parsed.name,
            kind: kindForFile(parsed.name, parsed.type),
            content,
            addedAt: Date.now(),
            selected: true,
            summaryState: 'idle',
          });
        } catch (fileError) {
          failed.push(`${file.name} — ${(fileError as Error)?.message ?? 'could not be read'}`);
        }
      }
      setProgress(null);
      if (added.length > 0) onAddSources(added, pending);
      if (failed.length > 0) {
        setError(`Could not add: ${failed.join(', ')}`);
        setIsBusy(false);
        return;
      }
      close();
    } catch (uploadError) {
      setProgress(null);
      setError((uploadError as Error)?.message ?? 'Those files could not be read.');
      setIsBusy(false);
    }
  };

  const handleLink = async () => {
    const url = linkValue.trim();
    if (!url) return;
    setIsBusy(true);
    setError(null);
    try {
      const page = await fetchWebsiteSource(/^https?:\/\//i.test(url) ? url : `https://${url}`);
      onAddSources([
        {
          id: createNotebookId(),
          title: page.title || page.url,
          kind: 'website',
          content: page.content,
          url: page.url,
          addedAt: Date.now(),
          selected: true,
          summaryState: 'idle',
        },
      ]);
      close();
    } catch (linkError) {
      setError(
        linkError instanceof NotebookApiError
          ? linkError.message
          : 'That page could not be added as a source.'
      );
      setIsBusy(false);
    }
  };

  const handlePaste = () => {
    const content = pasteValue.trim();
    if (!content) return;
    onAddSources([
      {
        id: createNotebookId(),
        title: pasteTitle.trim() || content.split('\n')[0].slice(0, 60) || 'Pasted text',
        kind: 'note',
        content,
        addedAt: Date.now(),
        selected: true,
        summaryState: 'idle',
      },
    ]);
    close();
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'upload', label: 'Upload', icon: <FileUp className="h-3.5 w-3.5" /> },
    { id: 'link', label: 'Link', icon: <Link2 className="h-3.5 w-3.5" /> },
    { id: 'paste', label: 'Paste text', icon: <ClipboardType className="h-3.5 w-3.5" /> },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
            onClick={close}
          />
          <motion.div
            role="dialog"
            aria-label="Add sources"
            initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative z-10 flex w-full max-w-[600px] flex-col border border-[#dfe3ea] bg-[#fbfcfd] shadow-2xl dark:border-[#282c33] dark:bg-[#17191d]"
          >
            <div className="flex items-center justify-between border-b border-[#dfe3ea] px-4 py-3 dark:border-[#282c33]">
              <div>
                <h2 className="font-heading text-[17px] not-italic text-[#16181d] dark:text-[#dce0e5]">
                  Add sources
                </h2>
                <p className="mt-0.5 text-[11px] text-[#78828e] dark:text-[#a9afbc]">
                  Sources let sour.ai answer from what matters most to you.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="p-1 text-[#4a5259] hover:text-[#16181d] dark:text-[#a9afbc] dark:hover:text-[#dce0e5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex border-b border-[#dfe3ea] px-2 dark:border-[#282c33]">
              {tabs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setTab(entry.id);
                    setError(null);
                  }}
                  className={`ws-tab -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11.5px] ${
                    tab === entry.id
                      ? 'border-[#4776d5] text-[#16181d] dark:text-[#dce0e5]'
                      : 'border-transparent text-[#78828e] hover:text-[#16181d] dark:hover:text-[#dce0e5]'
                  }`}
                >
                  {entry.icon}
                  {entry.label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {tab === 'upload' && (
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files);
                  }}
                  className={`flex flex-col items-center justify-center border border-dashed px-4 py-10 text-center transition-colors ${
                    isDragging
                      ? 'border-[#4776d5] bg-[#e8edf8] dark:bg-[#1c2434]'
                      : 'border-[#c3cad6] bg-[#f6f8fa] dark:border-[#3b414d] dark:bg-[#1e2128]'
                  }`}
                >
                  <FileUp className="mb-3 h-6 w-6 text-[#4776d5]" />
                  <p className="text-[13px] text-[#16181d] dark:text-[#dce0e5]">
                    Drop files here, or
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="ml-1 text-[#4776d5] underline underline-offset-2"
                    >
                      choose from your device
                    </button>
                  </p>
                  <p className="mt-2 text-[11px] text-[#78828e] dark:text-[#a9afbc]">
                    PDF, Word, Markdown, plain text, CSV and code files
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_FILES}
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files?.length) void handleFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </div>
              )}

              {tab === 'link' && (
                <div className="space-y-3">
                  <label
                    htmlFor="notebook-source-url"
                    className="block text-[11px] font-medium uppercase tracking-wider text-[#78828e]"
                  >
                    Website URL
                  </label>
                  <input
                    id="notebook-source-url"
                    type="url"
                    value={linkValue}
                    placeholder="https://example.com/article"
                    onChange={(event) => setLinkValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleLink();
                    }}
                    className="w-full border border-[#dfe3ea] bg-white px-3 py-2 text-[13px] text-[#16181d] outline-none focus:border-[#4776d5] dark:border-[#282c33] dark:bg-[#1e2128] dark:text-[#dce0e5]"
                  />
                  <p className="text-[11px] text-[#78828e] dark:text-[#a9afbc]">
                    sour.ai reads the page text. Paywalled pages and files behind a login cannot be
                    imported.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleLink()}
                    disabled={isBusy || !linkValue.trim()}
                    className="flex items-center gap-2 bg-[#4776d5] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50 interactable-btn"
                  >
                    {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Add website
                  </button>
                </div>
              )}

              {tab === 'paste' && (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={pasteTitle}
                    placeholder="Title (optional)"
                    onChange={(event) => setPasteTitle(event.target.value)}
                    className="w-full border border-[#dfe3ea] bg-white px-3 py-2 text-[13px] text-[#16181d] outline-none focus:border-[#4776d5] dark:border-[#282c33] dark:bg-[#1e2128] dark:text-[#dce0e5]"
                  />
                  <textarea
                    value={pasteValue}
                    placeholder="Paste your text here"
                    onChange={(event) => setPasteValue(event.target.value)}
                    rows={9}
                    className="w-full resize-none border border-[#dfe3ea] bg-white px-3 py-2 font-code text-[12px] text-[#16181d] outline-none focus:border-[#4776d5] dark:border-[#282c33] dark:bg-[#1e2128] dark:text-[#dce0e5] thin-scrollbar"
                  />
                  <button
                    type="button"
                    onClick={handlePaste}
                    disabled={!pasteValue.trim()}
                    className="bg-[#4776d5] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50 interactable-btn"
                  >
                    Add text
                  </button>
                </div>
              )}

              {isBusy && tab === 'upload' && (
                <div className="mt-3 flex items-center gap-2 text-[11.5px] text-[#4a5259] dark:text-[#a9afbc]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4776d5]" />
                  <span className="truncate">{progress ?? 'Reading files…'}</span>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mt-3 flex items-start gap-2 border border-[#e5b4b4] bg-[#fbeeee] px-3 py-2 text-[11.5px] text-[#8c2f2f] dark:border-[#5c3030] dark:bg-[#2a1a1a] dark:text-[#e79b9b]"
                >
                  <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[#dfe3ea] px-4 py-2.5 text-[11px] text-[#78828e] dark:border-[#282c33] dark:text-[#a9afbc]">
              <span>Source limit</span>
              <span className="font-code">
                {sourceCount} / {MAX_SOURCES}
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
