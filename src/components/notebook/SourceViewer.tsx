import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

import {
  countWords,
  sourceKindLabel,
  type NotebookSource,
} from '../../features/notebook/types';

/**
 * The reading view for one source: its generated summary, its key topics, and
 * the exact text the model was given. Showing the extracted text verbatim is
 * the point — a citation is only checkable against what was actually read.
 */

export interface SourceViewerProps {
  source: NotebookSource;
  onBack: () => void;
  onSummarise: (id: string) => void;
}

export const SourceViewer: React.FC<SourceViewerProps> = ({ source, onBack, onSummarise }) => {
  const isLoading = source.summaryState === 'loading';

  return (
    <motion.section
      key={source.id}
      aria-label={`Source: ${source.title}`}
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
        <span className="truncate font-code text-[10px] uppercase tracking-wider text-[#78828e]">
          {sourceKindLabel(source.kind)}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 thin-scrollbar">
        <div className="mx-auto max-w-[760px]">
          <h2 className="font-heading text-[20px] not-italic leading-snug text-[#16181d] dark:text-[#dce0e5]">
            {source.title}
          </h2>
          <p className="mt-1 font-code text-[10.5px] text-[#78828e]">
            {countWords(source.content).toLocaleString()} words ·{' '}
            {new Date(source.addedAt).toLocaleDateString()}
          </p>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-[#4776d5] underline underline-offset-2"
            >
              <ExternalLink className="h-3 w-3" />
              {source.url}
            </a>
          )}

          <div className="mt-5 border border-[#dfe3ea] bg-[#f6f8fa] p-3.5 dark:border-[#282c33] dark:bg-[#1e2128]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10.5px] font-medium uppercase tracking-wider text-[#78828e]">
                Source guide
              </span>
              <button
                type="button"
                onClick={() => onSummarise(source.id)}
                disabled={isLoading}
                className="flex items-center gap-1 text-[10.5px] text-[#4776d5] disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {source.summary ? 'Regenerate' : 'Generate'}
              </button>
            </div>

            {isLoading && !source.summary ? (
              <div className="space-y-2">
                <div className="z-shimmer h-3 w-full" />
                <div className="z-shimmer h-3 w-11/12" />
                <div className="z-shimmer h-3 w-2/3" />
              </div>
            ) : source.summary ? (
              <>
                <p className="text-[12.5px] leading-[1.7] text-[#16181d] dark:text-[#dce0e5]">
                  {source.summary}
                </p>
                {source.topics && source.topics.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {source.topics.map((topic) => (
                      <span
                        key={topic}
                        className="border border-[#dfe3ea] bg-[#fbfcfd] px-2 py-0.5 text-[10.5px] text-[#4a5259] dark:border-[#3b414d] dark:bg-[#17191d] dark:text-[#a9afbc]"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[12px] text-[#78828e] dark:text-[#a9afbc]">
                {source.summaryState === 'error'
                  ? 'The guide for this source could not be generated. Try again.'
                  : 'Generate a short guide with the key topics in this source.'}
              </p>
            )}
          </div>

          <h3 className="mt-6 mb-2 text-[10.5px] font-medium uppercase tracking-wider text-[#78828e]">
            Source text
          </h3>
          <pre className="whitespace-pre-wrap border border-[#dfe3ea] bg-[#fbfcfd] p-3.5 font-code text-[11.5px] leading-[1.75] text-[#16181d] [overflow-wrap:anywhere] dark:border-[#282c33] dark:bg-[#131418] dark:text-[#dce0e5]">
            {source.content}
          </pre>
        </div>
      </div>
    </motion.section>
  );
};
