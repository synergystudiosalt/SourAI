import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Loader2, RefreshCw, Sparkle, Target } from 'lucide-react';

import type { StudyAttempt } from '../../../functions/shared/studyAttempt';

/**
 * The panel that closes out a deck or a quiz: the score, then what to do about
 * it.
 *
 * The review is requested by the parent rather than fetched here, so the
 * widgets stay presentational and a finished attempt can be reviewed without
 * the component owning a network call.
 */

export interface StudyReview {
  state: 'idle' | 'loading' | 'ready' | 'error';
  summary?: string;
  topics?: string[];
  focus?: string;
  error?: string;
}

export interface StudyResultsProps {
  attempt: StudyAttempt;
  /** What "right" is called for this format. */
  scoreNoun: string;
  review?: StudyReview;
  onRetry: () => void;
  onRequestReview: () => void;
  onPractise?: (focus: string) => void;
  practiseLabel: string;
  isPractising?: boolean;
}

function grade(percentage: number): { label: string; tone: string } {
  if (percentage >= 90) return { label: 'Excellent', tone: 'text-[#1f6b3f] dark:text-[#82c79f]' };
  if (percentage >= 70) return { label: 'Solid', tone: 'text-[#1f6b3f] dark:text-[#82c79f]' };
  if (percentage >= 50) return { label: 'Getting there', tone: 'text-[#8a5a12] dark:text-[#e0b978]' };
  return { label: 'Needs work', tone: 'text-[#8c2f2f] dark:text-[#e79b9b]' };
}

export const StudyResults: React.FC<StudyResultsProps> = ({
  attempt,
  scoreNoun,
  review,
  onRetry,
  onRequestReview,
  onPractise,
  practiseLabel,
  isPractising = false,
}) => {
  const percentage = attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0;
  const { label, tone } = grade(percentage);
  const missed = attempt.items.filter((item) => !item.correct);

  return (
    <motion.section
      aria-label="Results"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
      className="mt-5 border border-[#dfe3ea] bg-[#f6f8fa] dark:border-[#282c33] dark:bg-[#1e2128]"
    >
      <div className="flex items-center gap-4 border-b border-[#dfe3ea] px-4 py-3.5 dark:border-[#282c33]">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22, delay: 0.05 }}
          className="flex h-14 w-14 shrink-0 flex-col items-center justify-center border border-[#4776d5] bg-[#e8edf8] dark:bg-[#1c2434]"
        >
          <span className="font-heading text-[19px] not-italic leading-none text-[#16181d] dark:text-[#dce0e5]">
            {percentage}%
          </span>
        </motion.div>
        <div className="min-w-0">
          <p className={`font-heading text-[16px] not-italic ${tone}`}>{label}</p>
          <p className="mt-0.5 font-code text-[10.5px] uppercase tracking-wider text-[#78828e]">
            {attempt.score} of {attempt.total} {scoreNoun}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="ml-auto flex shrink-0 items-center gap-1 border border-[#dfe3ea] px-2 py-1 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
        >
          <RefreshCw className="h-3 w-3" />
          Try again
        </button>
      </div>

      <div className="px-4 py-3.5">
        <span className="mb-2 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-[#78828e]">
          <Target className="h-3 w-3 text-[#4776d5]" />
          What to focus on
        </span>

        {review?.state === 'loading' && (
          <div className="space-y-2">
            <div className="z-shimmer h-3 w-full" />
            <div className="z-shimmer h-3 w-10/12" />
            <div className="z-shimmer h-3 w-6/12" />
          </div>
        )}

        {review?.state === 'error' && (
          <div
            role="alert"
            className="flex items-start gap-2 text-[12px] text-[#8c2f2f] dark:text-[#e79b9b]"
          >
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{review.error ?? 'That review could not be generated.'}</span>
            <button
              type="button"
              onClick={onRequestReview}
              className="ml-auto shrink-0 underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}

        {(review?.state === 'idle' || review === undefined) && (
          <button
            type="button"
            onClick={onRequestReview}
            className="flex items-center gap-1.5 border border-[#dfe3ea] px-2.5 py-1.5 text-[11.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
          >
            <Sparkle className="h-3.5 w-3.5 text-[#4776d5]" />
            Review my answers
          </button>
        )}

        {review?.state === 'ready' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          >
            <p className="text-[12.5px] leading-[1.75] text-[#16181d] dark:text-[#dce0e5]">
              {review.summary}
            </p>

            {review.topics && review.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {review.topics.map((topic, index) => (
                  <motion.span
                    key={topic}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.04 * index, type: 'spring', stiffness: 400, damping: 26 }}
                    className="border border-[#c9d3e8] bg-[#e8edf8] px-2 py-0.5 text-[10.5px] text-[#33518f] dark:border-[#33405c] dark:bg-[#1c2434] dark:text-[#93aee6]"
                  >
                    {topic}
                  </motion.span>
                ))}
              </div>
            )}

            {onPractise && (review.focus || review.topics?.length) && (
              <button
                type="button"
                onClick={() => onPractise(review.focus || (review.topics ?? []).join(', '))}
                disabled={isPractising}
                className="mt-4 flex items-center gap-2 bg-[#4776d5] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-60 interactable-btn"
              >
                {isPractising && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {practiseLabel}
              </button>
            )}
          </motion.div>
        )}

        {missed.length > 0 && (
          <details className="mt-4 border-t border-[#dfe3ea] pt-3 dark:border-[#282c33]">
            <summary className="cursor-pointer text-[11px] text-[#4a5259] dark:text-[#a9afbc]">
              Show the {missed.length} you missed
            </summary>
            <ul className="mt-2 space-y-1.5">
              {missed.map((item, index) => (
                <li key={index} className="text-[11.5px] leading-snug">
                  <span className="text-[#16181d] dark:text-[#dce0e5]">{item.prompt}</span>
                  {item.answer && (
                    <span className="block text-[#4a5259] dark:text-[#a9afbc]">→ {item.answer}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </motion.section>
  );
};
