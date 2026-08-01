import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Copy, FilePlus2, Pencil } from 'lucide-react';

import {
  studioArtifactTitle,
  type Notebook,
  type StudioArtifact,
} from '../../features/notebook/types';
import { MindMap } from './MindMap';
import { NotebookMarkdown } from './NotebookMarkdown';

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
}

export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({
  artifact,
  notebook,
  onBack,
  onUpdate,
  onConvertToSource,
  onOpenSource,
}) => {
  const [isEditing, setIsEditing] = useState(artifact.kind === 'note' && !artifact.content);
  const [draft, setDraft] = useState(artifact.content);
  const [title, setTitle] = useState(artifact.title);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDraft(artifact.content);
    setTitle(artifact.title);
    setIsEditing(artifact.kind === 'note' && !artifact.content);
  }, [artifact.id, artifact.kind, artifact.content, artifact.title]);

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

  const commit = () => {
    onUpdate(artifact.id, { title: title.trim() || artifact.title, content: draft });
    setIsEditing(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the text stays selectable on screen.
    }
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
            onClick={() => onConvertToSource(artifact)}
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
              <h2 className="mt-1 mb-4 font-heading text-[22px] not-italic leading-snug text-[#16181d] dark:text-[#dce0e5]">
                {artifact.title}
              </h2>
              {artifact.kind === 'mindmap' ? (
                <MindMap markdown={artifact.content} rootLabel={notebook.title} />
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
