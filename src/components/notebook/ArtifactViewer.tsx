import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  Presentation,
  Headphones,
  Loader2,
  Pencil,
} from 'lucide-react';

import {
  studioArtifactTitle,
  type Notebook,
  type StudioArtifact,
} from '../../features/notebook/types';
import {
  flashcardsToPlainText,
  quizToPlainText,
  readFlashcards,
  readQuiz,
} from '../../features/notebook/studyContent';
import type { StudyAttempt } from '../../../functions/shared/studyAttempt';
import { downloadArtifact, type ExportFormat } from '../../features/notebook/exportArtifact';
import { saveBlob, safeFileName } from '../../features/notebook/exportArtifact';
import { synthesizeAudioOverview } from '../../features/notebook/audioOverview';
import { Flashcards } from './Flashcards';
import { MindMap } from './MindMap';
import { NotebookMarkdown } from './NotebookMarkdown';
import { PresentationViewer } from './PresentationViewer';
import { QuizView } from './Quiz';
import type { StudyReview } from './StudyResults';

/**
 * Flashcards and quizzes are stored as JSON. Copying that to the clipboard, or
 * feeding it back in as a source, would be useless to a person and to a model
 * alike — both take the readable rendition instead.
 */
function artifactAsText(artifact: StudioArtifact): string {
  if (artifact.kind === 'flashcards') return flashcardsToPlainText(readFlashcards(artifact.content));
  if (artifact.kind === 'quiz') return quizToPlainText(readQuiz(artifact.content));
  return artifact.content;
}

/**
 * Reading and editing view for one studio output.
 *
 * Notes are editable in place; generated documents are read-only until
 * converted to a note, so a regenerate never silently discards edits.
 */

export interface ArtifactViewerProps {
  artifact: StudioArtifact;
  notebook: Notebook;
  onBack: () => void;
  onUpdate: (id: string, update: Partial<Pick<StudioArtifact, 'title' | 'content'>>) => void;
  onConvertToSource: (artifact: StudioArtifact) => void;
  onOpenSource: (sourceId: string) => void;
  review?: StudyReview;
  onAttemptComplete?: (attempt: StudyAttempt) => void;
  onRequestReview?: () => void;
  onPractise?: (focus: string) => void;
  isPractising?: boolean;
}

export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({
  artifact,
  notebook,
  onBack,
  onUpdate,
  onConvertToSource,
  onOpenSource,
  review,
  onAttemptComplete,
  onRequestReview,
  onPractise,
  isPractising,
}) => {
  const [isEditing, setIsEditing] = useState(artifact.kind === 'note' && !artifact.content);
  const [draft, setDraft] = useState(artifact.content);
  const [title, setTitle] = useState(artifact.title);
  const [copied, setCopied] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloading, setDownloading] = useState<ExportFormat | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setDraft(artifact.content);
    setTitle(artifact.title);
    setIsEditing(artifact.kind === 'note' && !artifact.content);
  }, [artifact.id, artifact.kind, artifact.content, artifact.title]);

  useEffect(() => {
    setAudioState('idle');
    setAudioBlob(null);
    setAudioError(null);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudioUrl(null);
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    };
  }, [artifact.id]);

  const resolver = {
    labelFor: (index: number) => {
      const id = artifact.citedSourceIds?.[index - 1];
      return notebook.sources.find((source) => source.id === id)?.title;
    },
    onSelect: (index: number) => {
      const id = artifact.citedSourceIds?.[index - 1];
      if (id && notebook.sources.some((source) => source.id === id)) onOpenSource(id);
    },
  };

  const plainText = artifactAsText(artifact);

  useEffect(() => {
    if (!downloadOpen) return;
    const close = (event: MouseEvent) => {
      if (downloadRef.current && !downloadRef.current.contains(event.target as Node)) {
        setDownloadOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [downloadOpen]);

  const download = async (format: ExportFormat) => {
    setDownloading(format);
    setDownloadError(null);
    try {
      await downloadArtifact(
        {
          title: artifact.title,
          text: plainText,
          kindLabel: studioArtifactTitle(artifact.kind),
          notebookTitle: notebook.title,
        },
        format
      );
      setDownloadOpen(false);
    } catch (error) {
      setDownloadError((error as Error)?.message ?? 'That download could not be prepared.');
    } finally {
      setDownloading(null);
    }
  };

  const commit = () => {
    onUpdate(artifact.id, { title: title.trim() || artifact.title, content: draft });
    setIsEditing(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the text stays selectable on screen.
    }
  };

  const createAudio = useCallback(async (): Promise<Blob | null> => {
    if (audioBlob) return audioBlob;
    setAudioState('loading');
    setAudioError(null);
    try {
      const blob = await synthesizeAudioOverview(artifact.content);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setAudioBlob(blob);
      setAudioUrl(url);
      setAudioState('ready');
      return blob;
    } catch (error) {
      setAudioState('error');
      setAudioError((error as Error)?.message ?? 'The audio overview could not be created.');
      return null;
    }
  }, [artifact.content, audioBlob]);

  useEffect(() => {
    if (artifact.kind === 'audio_overview' && audioState === 'idle') void createAudio();
  }, [artifact.kind, artifact.id, audioState, createAudio]);

  const downloadAudio = async () => {
    const blob = await createAudio();
    if (blob) saveBlob(blob, `${safeFileName(artifact.title)}.wav`);
  };

  return (
    <motion.section
      key={artifact.id}
      aria-label={`Studio output: ${artifact.title}`}
      initial={{ opacity: 0, filter: 'blur(6px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 flex-col bg-[#fbfcfd] dark:bg-[#17191d]"
    >
      <div className="zed-panel-bar flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[#dfe3ea] px-3 dark:border-[#282c33]">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11.5px] text-[#4a5259] hover:text-[#16181d] dark:text-[#a9afbc] dark:hover:text-[#dce0e5]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to chat
        </button>
        <div className="flex items-center gap-1">
          {artifact.kind === 'note' && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-0.5 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
          {/* Word for editing and sharing, PNG for pasting into a chat or a
              slide — the two things people actually do with a study sheet. */}
          <div ref={downloadRef} className="relative">
            <button
              type="button"
              onClick={() => setDownloadOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={downloadOpen}
              className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-0.5 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
            >
              <Download className="h-3 w-3" />
              Download
            </button>
            <AnimatePresence>
              {downloadOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="absolute right-0 top-full z-50 mt-1 w-48 border border-[#dfe3ea] bg-[#fbfcfd] shadow-xl dark:border-[#282c33] dark:bg-[#1e2128]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void download('docx')}
                    disabled={downloading !== null}
                    className="dropdown-item flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11.5px] text-[#16181d] disabled:opacity-50 dark:text-[#dce0e5]"
                  >
                    {downloading === 'docx' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4776d5]" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-[#4776d5]" />
                    )}
                    Word document (.docx)
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void download('png')}
                    disabled={downloading !== null}
                    className="dropdown-item flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11.5px] text-[#16181d] disabled:opacity-50 dark:text-[#dce0e5]"
                  >
                    {downloading === 'png' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4776d5]" />
                    ) : (
                      <FileImage className="h-3.5 w-3.5 text-[#4776d5]" />
                    )}
                    Image (.png)
                  </button>
                  {artifact.kind === 'presentation' && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void download('pptx')}
                      disabled={downloading !== null}
                      className="dropdown-item flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11.5px] text-[#16181d] disabled:opacity-50 dark:text-[#dce0e5]"
                    >
                      {downloading === 'pptx' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4776d5]" />
                      ) : (
                        <Presentation className="h-3.5 w-3.5 text-[#4776d5]" />
                      )}
                      PowerPoint (.pptx)
                    </button>
                  )}
                  {artifact.kind === 'audio_overview' && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void downloadAudio()}
                      disabled={audioState === 'loading'}
                      className="dropdown-item flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11.5px] text-[#16181d] disabled:opacity-50 dark:text-[#dce0e5]"
                    >
                      {audioState === 'loading' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4776d5]" />
                      ) : (
                        <Headphones className="h-3.5 w-3.5 text-[#4776d5]" />
                      )}
                      Audio overview (.wav)
                    </button>
                  )}
                  {downloadError && (
                    <p role="alert" className="px-2.5 py-2 text-[10.5px] text-[#b5484a]">
                      {downloadError}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            onClick={() => void copy()}
            className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-0.5 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => onConvertToSource({ ...artifact, content: plainText })}
            title="Add this document to the notebook as a source"
            className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-0.5 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
          >
            <FilePlus2 className="h-3 w-3" />
            Use as source
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 thin-scrollbar">
        <div className="mx-auto max-w-[760px]">
          <span className="font-code text-[10px] uppercase tracking-wider text-[#78828e]">
            {studioArtifactTitle(artifact.kind)}
          </span>

          {isEditing ? (
            <>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label="Note title"
                className="mt-1 w-full border border-[#dfe3ea] bg-white px-2.5 py-1.5 font-heading text-[18px] text-[#16181d] outline-none focus:border-[#4776d5] dark:border-[#282c33] dark:bg-[#1e2128] dark:text-[#dce0e5]"
              />
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={16}
                aria-label="Note content"
                placeholder="Write your note. Markdown is supported."
                className="mt-2 w-full resize-none border border-[#dfe3ea] bg-white px-3 py-2 font-code text-[12px] leading-relaxed text-[#16181d] outline-none focus:border-[#4776d5] dark:border-[#282c33] dark:bg-[#1e2128] dark:text-[#dce0e5] thin-scrollbar"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={commit}
                  className="bg-[#4776d5] px-3 py-1.5 text-[12px] font-medium text-white interactable-btn"
                >
                  Save note
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(artifact.content);
                    setTitle(artifact.title);
                    setIsEditing(false);
                  }}
                  className="border border-[#dfe3ea] px-3 py-1.5 text-[12px] text-[#4a5259] dark:border-[#282c33] dark:text-[#a9afbc]"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              {artifact.kind !== 'presentation' && (
                <h2 className="mt-1 mb-4 font-heading text-[22px] not-italic leading-snug text-[#16181d] dark:text-[#dce0e5]">
                  {artifact.title}
                </h2>
              )}
              {artifact.kind === 'audio_overview' && (
                <section aria-label="Audio overview player" className="border border-[#dfe3ea] bg-[#f6f8fa] p-5 dark:border-[#282c33] dark:bg-[#1e2128]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#4776d5]/10">
                      {audioState === 'loading'
                        ? <Loader2 className="h-5 w-5 animate-spin text-[#4776d5]" />
                        : <Headphones className="h-5 w-5 text-[#4776d5]" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-[#16181d] dark:text-[#dce0e5]">
                        {audioState === 'loading' ? 'Creating your audio overview' : 'Audio overview'}
                      </p>
                      <p className="text-[10.5px] text-[#78828e]">
                        {audioState === 'loading' ? 'Groq is turning the overview into speech…' : 'Generated with Groq speech'}
                      </p>
                    </div>
                    {audioUrl && (
                      <button
                        type="button"
                        onClick={() => void downloadAudio()}
                        className="flex shrink-0 items-center gap-1.5 bg-[#4776d5] px-3 py-1.5 text-[11.5px] font-medium text-white interactable-btn"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </button>
                    )}
                  </div>
                  {audioUrl && <audio ref={audioRef} aria-label="Audio overview" src={audioUrl} controls className="mt-4 w-full" />}
                  {audioError && (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p role="alert" className="text-[10.5px] text-[#b5484a]">{audioError}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setAudioState('idle');
                          setAudioError(null);
                        }}
                        className="shrink-0 border border-[#dfe3ea] px-2.5 py-1 text-[11px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc]"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </section>
              )}
              {artifact.kind === 'audio_overview' ? null : artifact.kind === 'presentation' ? (
                <PresentationViewer
                  markdown={artifact.content}
                  fallbackTitle={artifact.title}
                  notebookTitle={notebook.title}
                  sourceLabel={resolver.labelFor}
                  onOpenSource={resolver.onSelect}
                />
              ) : artifact.kind === 'mindmap' ? (
                <MindMap markdown={artifact.content} rootLabel={notebook.title} />
              ) : artifact.kind === 'flashcards' ? (
                <Flashcards
                  content={artifact.content}
                  onOpenSource={resolver.onSelect}
                  sourceLabel={resolver.labelFor}
                  onComplete={onAttemptComplete}
                  review={review}
                  onRequestReview={onRequestReview}
                  onPractise={onPractise}
                  isPractising={isPractising}
                />
              ) : artifact.kind === 'quiz' ? (
                <QuizView
                  content={artifact.content}
                  onOpenSource={resolver.onSelect}
                  sourceLabel={resolver.labelFor}
                  onComplete={onAttemptComplete}
                  review={review}
                  onRequestReview={onRequestReview}
                  onPractise={onPractise}
                  isPractising={isPractising}
                />
              ) : (
                <NotebookMarkdown text={artifact.content} resolver={resolver} />
              )}
            </>
          )}
        </div>
      </div>
    </motion.section>
  );
};
