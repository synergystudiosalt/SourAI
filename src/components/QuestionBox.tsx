import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Pencil, CornerDownLeft, ChevronRight } from 'lucide-react';

export interface PendingQuestion {
  question: string;
  options: string[];
}

interface QuestionBoxProps {
  questions: PendingQuestion[];
  onAnswer: (index: number, option: string) => void;
  onComplete: (answers: string[]) => void;
  onSkip?: () => void;
  onClose?: () => void;
}

export const QuestionBox: React.FC<QuestionBoxProps> = ({ questions, onAnswer, onComplete, onSkip, onClose }) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customText, setCustomText] = useState('');
  const customInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const question = questions[currentIdx];
  const total = questions.length;
  const isLast = currentIdx === total - 1;
  const displayOptions = question.options.slice(0, 4);
  while (displayOptions.length < 4) displayOptions.push('');

  const commitAnswer = useCallback((option: string) => {
    if (selected) return;
    setSelected(option);
    const newAnswers = [...answers, option];
    setAnswers(newAnswers);
    onAnswer(currentIdx, option);

    setTimeout(() => {
      if (isLast) {
        onComplete(newAnswers);
      } else {
        setCurrentIdx(prev => prev + 1);
        setSelected(null);
        setHighlightedIndex(0);
        setShowCustomInput(false);
        setCustomText('');
      }
    }, 280);
  }, [selected, answers, currentIdx, isLast, onAnswer, onComplete]);

  const handleSelect = useCallback((option: string) => {
    commitAnswer(option);
  }, [commitAnswer]);

  const handleCustomSubmit = useCallback(() => {
    if (!customText.trim()) return;
    commitAnswer(customText.trim());
  }, [customText, commitAnswer]);

  const handleSkipNext = useCallback(() => {
    if (selected) return;
    setSelected('__skip__');
    setTimeout(() => {
      if (isLast) {
        onComplete([...answers, '__skipped__']);
      } else {
        setCurrentIdx(prev => prev + 1);
        setSelected(null);
        setHighlightedIndex(0);
        setShowCustomInput(false);
        setCustomText('');
      }
    }, 200);
  }, [selected, isLast, answers, onComplete]);

  const handleSkip = useCallback(() => {
    if (selected) return;
    setSelected('__skip__');
    setTimeout(() => onSkip?.(), 200);
  }, [selected, onSkip]);

  const handleClose = useCallback(() => {
    if (selected) return;
    setSelected('__skip__');
    setTimeout(() => onClose?.(), 200);
  }, [selected, onClose]);

  useEffect(() => {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [showCustomInput]);

  useEffect(() => {
    if (!containerRef.current || selected) return;
    containerRef.current.focus();
  }, [selected, currentIdx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (selected) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(3, prev + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(0, prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showCustomInput) {
        handleCustomSubmit();
      } else if (highlightedIndex < 4 && displayOptions[highlightedIndex]) {
        handleSelect(displayOptions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setShowCustomInput(true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      handleSkipNext();
    } else if (['1', '2', '3', '4'].includes(e.key)) {
      const idx = parseInt(e.key) - 1;
      if (displayOptions[idx]) {
        setHighlightedIndex(idx);
        handleSelect(displayOptions[idx]);
      }
    }
  }, [selected, highlightedIndex, showCustomInput, displayOptions, handleSelect, handleCustomSubmit, handleClose, handleSkipNext]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentIdx}
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative w-full max-w-[560px] mx-auto bg-white dark:bg-[#17191d] rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_16px_rgba(0,0,0,0.25)] border border-[#e2e3e6] dark:border-[#282c33] p-3 sm:p-4 outline-none select-none"
      >
        {/* Top row: pagination + close */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            {total > 1 && (
              <span className="text-[11px] font-medium text-[#90959e] dark:text-[#666] tabular-nums">
                ({currentIdx + 1}/{total})
              </span>
            )}
            {total > 1 && (
              <button
                type="button"
                onClick={handleSkipNext}
                disabled={!!selected}
                className="p-0.5 rounded text-[#90959e] dark:text-[#666] hover:text-[#16181d] dark:hover:text-[#dce0e5] hover:bg-[#e8ebf0] dark:hover:bg-[#1e2128] transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40"
                title="Next question"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={!!selected}
            className="p-1 rounded-lg text-[#a6a9af] dark:text-[#666] hover:text-[#16181d] dark:hover:text-[#dce0e5] hover:bg-[#e8ebf0] dark:hover:bg-[#1e2128] transition-colors cursor-pointer shrink-0 disabled:cursor-default disabled:opacity-40"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Question text */}
        <p className="text-[13px] font-medium text-[#16181d] dark:text-[#dce0e5] leading-snug mb-3">
          {question.question}
        </p>

        {/* Option rows */}
        <div className="space-y-0">
          {displayOptions.map((option, idx) => {
            if (!option) return null;
            const isHighlighted = highlightedIndex === idx;
            const isSelectedRow = selected === option;
            const isDisabled = selected !== null && !isSelectedRow;

            return (
              <React.Fragment key={idx}>
                <motion.button
                  type="button"
                  onClick={() => handleSelect(option)}
                  onMouseEnter={() => !selected && setHighlightedIndex(idx)}
                  disabled={isDisabled}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`w-full flex items-center gap-2.5 h-[36px] sm:h-[38px] px-2.5 rounded-lg transition-all duration-150
                    ${isSelectedRow
                      ? 'bg-[#f2f2f2] dark:bg-[#1e2128]'
                      : isHighlighted && !selected
                        ? 'bg-[#f6f8fa] dark:bg-[#212122]'
                        : 'bg-transparent hover:bg-[#f6f8fa] dark:hover:bg-[#212122]'
                    }
                    ${isDisabled && !isSelectedRow ? 'opacity-40 cursor-default' : 'cursor-pointer'}
                  `}
                >
                  <span className={`w-6 h-6 flex items-center justify-center rounded-md text-[11px] font-semibold shrink-0 transition-all duration-150
                    ${isSelectedRow
                      ? 'bg-[#dadbde] dark:bg-[#38393a] text-[#16181d] dark:text-[#dce0e5]'
                      : isHighlighted && !selected
                        ? 'bg-[#e2e5ea] dark:bg-[#333] text-[#3b414d] dark:text-[#dfe3ea]'
                        : 'bg-[#e8ebf0] dark:bg-[#1e2128] text-[#90959e] dark:text-[#777]'
                    }
                  `}>
                    {idx + 1}
                  </span>

                  <span className={`text-[13px] font-medium flex-1 text-left transition-colors duration-150 truncate
                    ${isSelectedRow
                      ? 'text-[#16181d] dark:text-[#dce0e5]'
                      : isHighlighted && !selected
                        ? 'text-[#16181d] dark:text-[#dfe3ea]'
                        : 'text-[#3b414d] dark:text-[#90959e]'
                    }
                  `}>
                    {option}
                  </span>

                  {isHighlighted && !selected && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center justify-center"
                    >
                      <CornerDownLeft className="w-3.5 h-3.5 text-[#90959e] dark:text-[#666]" />
                    </motion.span>
                  )}
                </motion.button>

                {idx < 3 && displayOptions[idx + 1] && (
                  <div className="h-px bg-[#e4e7ec] dark:bg-[#282c33] mx-2.5" />
                )}
              </React.Fragment>
            );
          })}

          {/* Something Else */}
          <div className="h-px bg-[#e4e7ec] dark:bg-[#282c33] mx-2.5 my-1" />
          <div className="flex items-center gap-2.5 h-[36px] sm:h-[38px] px-2.5 rounded-lg">
            <Pencil className="w-[14px] h-[14px] text-[#a6a9af] dark:text-[#666] shrink-0" />
            {showCustomInput ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleCustomSubmit(); }}
                className="contents"
              >
                <input
                  ref={customInputRef}
                  type="text"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleCustomSubmit(); }
                    else if (e.key === 'Escape') { e.preventDefault(); setShowCustomInput(false); containerRef.current?.focus(); }
                  }}
                  onBlur={() => { if (!customText.trim()) setShowCustomInput(false); }}
                  placeholder="Type your answer..."
                  className="flex-1 text-[13px] font-medium text-[#16181d] dark:text-[#dce0e5] placeholder-[#a6a9af] dark:placeholder-[#666] outline-none bg-transparent"
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                disabled={!!selected}
                className="flex-1 text-left text-[13px] text-[#a6a9af] dark:text-[#666] cursor-text disabled:cursor-default disabled:opacity-40"
              >
                Something else
              </button>
            )}
          </div>

          {/* Skip */}
          <div className="flex items-center justify-end mt-1 px-2.5">
            <button
              type="button"
              onClick={handleSkip}
              disabled={!!selected}
              className="px-3 py-1 text-[11px] font-medium rounded-md border border-[#cdcfd3] dark:border-[#38393a] text-[#3b414d] dark:text-[#dfe3ea] bg-white dark:bg-[#17191d] hover:bg-[#f6f8fa] dark:hover:bg-[#212122] transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40"
            >
              Skip
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export function extractQuestionBlocks(text: string): {
  cleanText: string;
  questions: PendingQuestion[];
} {
  const regex = /\[QUESTION:\s*([^\]]+)\]/g;
  const questions: PendingQuestion[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const parts = match[1].split('|').map(s => s.trim());
    const question = parts[0];
    const options = parts.slice(1).filter(Boolean);
    if (question && options.length >= 2) {
      questions.push({ question, options });
    }
  }

  const cleanText = text.replace(regex, '').trim();
  return { cleanText, questions };
}
