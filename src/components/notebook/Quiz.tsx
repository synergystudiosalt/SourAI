import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, X, RotateCcw, ChevronRight } from 'lucide-react';

import type { StudyAttempt } from '../../../functions/shared/studyAttempt';
import { optionLetter, readQuiz } from '../../features/notebook/studyContent';
import { StudyResults, type StudyReview } from './StudyResults';

/**
 * A multiple-choice quiz answered one question at a time.
 *
 * Feedback lands the instant an option is chosen — the answer is already known
 * locally, so making the user press "check" would only add a step. The
 * explanation expands underneath rather than replacing the question, so the
 * choice that was just made stays visible next to the reason it was wrong.
 */

export interface QuizViewProps {
  content: string;
  onOpenSource?: (index: number) => void;
  sourceLabel?: (index: number) => string | undefined;
  /** Fired once per attempt, when the last question has been answered. */
  onComplete?: (attempt: StudyAttempt) => void;
  review?: StudyReview;
  onRequestReview?: () => void;
  onPractise?: (focus: string) => void;
  isPractising?: boolean;
}

export const QuizView: React.FC<QuizViewProps> = ({
  content,
  onOpenSource,
  sourceLabel,
  onComplete,
  review,
  onRequestReview,
  onPractise,
  isPractising,
}) => {
  const quiz = useMemo(() => readQuiz(content), [content]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [position, setPosition] = useState(0);
  const reportedRef = useRef(false);

  const total = quiz.questions.length;
  const question = quiz.questions[position];
  const answered = answers[position];
  const hasAnswered = answered !== undefined;
  const score = quiz.questions.reduce(
    (correct, entry, index) => (answers[index] === entry.answer ? correct + 1 : correct),
    0
  );
  const isComplete = total > 0 && Object.keys(answers).length === total;

  const attempt: StudyAttempt = useMemo(
    () => ({
      kind: 'quiz',
      total,
      score,
      items: quiz.questions.map((entry, index) => ({
        prompt: entry.question,
        answer: entry.options[entry.answer],
        chosen: answers[index] !== undefined ? entry.options[answers[index]] : undefined,
        correct: answers[index] === entry.answer,
        source: entry.source,
      })),
    }),
    [quiz.questions, answers, total, score]
  );

  // Reported once per attempt; a re-render of a finished quiz must not ask for
  // another review.
  useEffect(() => {
    if (!isComplete || reportedRef.current) return;
    reportedRef.current = true;
    onComplete?.(attempt);
  }, [isComplete, attempt, onComplete]);

  if (total === 0) {
    return (
      <p className="px-1 py-4 text-[12px] text-[#78828e] dark:text-[#a9afbc]">
        This quiz could not be read.
      </p>
    );
  }

  const choose = (index: number) => {
    if (hasAnswered) return;
    setAnswers((previous) => ({ ...previous, [position]: index }));
  };

  const label = question.source ? sourceLabel?.(question.source) : undefined;

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-[#dfe3ea] pb-2 dark:border-[#282c33]">
        <span className="font-code text-[10px] uppercase tracking-wider text-[#78828e]">
          Question {position + 1} of {total}
          {Object.keys(answers).length > 0 && ` · ${score} correct`}
        </span>
        <button
          type="button"
          onClick={() => {
            reportedRef.current = false;
            setAnswers({});
            setPosition(0);
          }}
          className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-1 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
        >
          <RotateCcw className="h-3 w-3" />
          Retake
        </button>
      </div>

      <div className="mb-4 h-[3px] w-full bg-[#e8ecf3] dark:bg-[#22262e]">
        <motion.div
          className="h-full bg-[#4776d5]"
          initial={false}
          animate={{ width: `${(Object.keys(answers).length / total) * 100}%` }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={position}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
        >
          <p className="mb-3 font-heading text-[16px] not-italic leading-snug text-[#16181d] dark:text-[#dce0e5]">
            {question.question}
          </p>

          <div className="space-y-1.5">
            {question.options.map((option, index) => {
              const isCorrect = index === question.answer;
              const isChosen = answered === index;
              const reveal = hasAnswered && (isCorrect || isChosen);
              return (
                <motion.button
                  key={index}
                  type="button"
                  onClick={() => choose(index)}
                  disabled={hasAnswered}
                  whileTap={hasAnswered ? undefined : { scale: 0.99 }}
                  // A wrong pick shakes once. It is a faster "no" than reading
                  // a colour, and it settles rather than persisting.
                  animate={
                    isChosen && !isCorrect
                      ? { x: [0, -5, 5, -3, 3, 0] }
                      : { x: 0 }
                  }
                  transition={{ duration: 0.32 }}
                  className={`flex w-full items-start gap-2.5 border px-3 py-2 text-left text-[12.5px] leading-snug ws-toolbar-btn ${
                    reveal && isCorrect
                      ? 'border-[#2f8a55] bg-[#e9f5ee] text-[#1f6b3f] dark:bg-[#16261d] dark:text-[#82c79f]'
                      : reveal && isChosen
                        ? 'border-[#b5484a] bg-[#fbeeee] text-[#8c2f2f] dark:bg-[#2a1a1a] dark:text-[#e79b9b]'
                        : hasAnswered
                          ? 'border-[#dfe3ea] text-[#78828e] dark:border-[#282c33]'
                          : 'border-[#dfe3ea] text-[#16181d] hover:border-[#4776d5] dark:border-[#282c33] dark:text-[#dce0e5]'
                  }`}
                >
                  <span className="mt-px font-code text-[10.5px] opacity-70">
                    {optionLetter(index)}
                  </span>
                  <span className="flex-1">{option}</span>
                  {reveal && (
                    <motion.span
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      className="mt-px shrink-0"
                    >
                      {isCorrect ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    </motion.span>
                  )}
                </motion.button>
              );
            })}
          </div>

          <AnimatePresence>
            {hasAnswered && (question.explanation || question.source !== undefined) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="mt-3 border-l-2 border-[#4776d5] bg-[#f6f8fa] px-3 py-2 text-[12px] leading-[1.7] text-[#4a5259] dark:bg-[#1e2128] dark:text-[#a9afbc]">
                  {question.explanation}
                  {question.source !== undefined && (
                    <button
                      type="button"
                      onClick={() => onOpenSource?.(question.source!)}
                      title={
                        label ? `Source ${question.source}: ${label}` : `Source ${question.source}`
                      }
                      className="ml-1.5 border border-[#c9d3e8] bg-[#fbfcfd] px-1.5 align-middle font-code text-[9.5px] text-[#33518f] dark:border-[#33405c] dark:bg-[#17191d] dark:text-[#93aee6]"
                    >
                      {question.source}
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPosition((current) => Math.max(0, current - 1))}
          disabled={position === 0}
          className="border border-[#dfe3ea] px-2.5 py-1.5 text-[11.5px] text-[#4a5259] disabled:opacity-40 hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setPosition((current) => Math.min(total - 1, current + 1))}
          disabled={position === total - 1}
          className="flex items-center gap-1 border border-[#dfe3ea] px-2.5 py-1.5 text-[11.5px] text-[#4a5259] disabled:opacity-40 hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {isComplete && (
        <StudyResults
          attempt={attempt}
          scoreNoun="correct"
          review={review}
          onRetry={() => {
            reportedRef.current = false;
            setAnswers({});
            setPosition(0);
          }}
          onRequestReview={() => onRequestReview?.()}
          onPractise={onPractise}
          practiseLabel="Make a quiz on these topics"
          isPractising={isPractising}
        />
      )}
    </div>
  );
};
