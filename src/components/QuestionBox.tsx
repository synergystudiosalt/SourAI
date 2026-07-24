import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Pencil, CornerDownLeft } from 'lucide-react';

export interface PendingQuestion {
  question: string;
  options: string[];
}

interface QuestionBoxProps {
  question: PendingQuestion;
  onSelect: (option: string) => void;
  onSkip?: () => void;
  onClose?: () => void;
}

export const QuestionBox: React.FC<QuestionBoxProps> = ({ question, onSelect, onSkip, onClose }) => {
  const minOptions = Math.max(question.options.length, 4);
  const displayOptions = question.options.slice(0, 4);
  while (displayOptions.length < 4) displayOptions.push('');

  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customText, setCustomText] = useState('');
  const customInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback((option: string) => {
    if (selected || !option) return;
    setSelected(option);
    setTimeout(() => onSelect(option), 300);
  }, [selected, onSelect]);

  const handleCustomSubmit = useCallback(() => {
    if (selected || !customText.trim()) return;
    setSelected(customText.trim());
    setTimeout(() => onSelect(customText.trim()), 300);
  }, [selected, customText, onSelect]);

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
  }, [selected]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (selected) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => {
        if (prev < 3) return prev + 1;
        return 3;
      });
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
    } else if (['1', '2', '3', '4'].includes(e.key)) {
      const idx = parseInt(e.key) - 1;
      if (displayOptions[idx]) {
        setHighlightedIndex(idx);
        handleSelect(displayOptions[idx]);
      }
    }
  }, [selected, highlightedIndex, showCustomInput, displayOptions, handleSelect, handleCustomSubmit, handleClose]);

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative w-full max-w-[720px] mx-auto bg-white dark:bg-[#1a1a19] rounded-[18px] shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.3)] border border-[#e8e6e0] dark:border-[#2d2d2c] p-6 outline-none select-none"
      >
        {/* Header Row */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <p className="font-serif text-[20px] leading-[1.4] text-[#1c1b1a] dark:text-[#f0efe6] tracking-[-0.01em]">
            {question.question}
          </p>
          <button
            type="button"
            onClick={handleClose}
            disabled={!!selected}
            className="mt-0.5 p-1 rounded-lg text-[#b0ada5] dark:text-[#666] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] hover:bg-[#f0eee8] dark:hover:bg-[#282826] transition-colors cursor-pointer shrink-0 disabled:cursor-default disabled:opacity-40"
            title="Close"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Answer List */}
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
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className={`w-full flex items-center gap-3 h-[52px] px-3 rounded-xl transition-all duration-150 group
                    ${isSelectedRow
                      ? 'bg-[#f2f2f2] dark:bg-[#282826]'
                      : isHighlighted && !selected
                        ? 'bg-[#f7f6f2] dark:bg-[#222221]'
                        : 'bg-transparent hover:bg-[#f7f6f2] dark:hover:bg-[#222221]'
                    }
                    ${isDisabled && !isSelectedRow ? 'opacity-40 cursor-default' : 'cursor-pointer'}
                  `}
                >
                  {/* Number Badge */}
                  <span className={`w-7 h-7 flex items-center justify-center rounded-lg text-[12px] font-semibold shrink-0 transition-all duration-150
                    ${isSelectedRow
                      ? 'bg-[#e0ded8] dark:bg-[#3a3a38] text-[#1c1b1a] dark:text-[#f0efe6]'
                      : isHighlighted && !selected
                        ? 'bg-[#eae8e2] dark:bg-[#333] text-[#3d3a33] dark:text-[#dedcd6]'
                        : 'bg-[#f0eee8] dark:bg-[#282826] text-[#a09a8e] dark:text-[#777]'
                    }
                  `}>
                    {idx + 1}
                  </span>

                  {/* Option Label */}
                  <span className={`text-[15px] font-medium flex-1 text-left transition-colors duration-150
                    ${isSelectedRow
                      ? 'text-[#1c1b1a] dark:text-[#f0efe6]'
                      : isHighlighted && !selected
                        ? 'text-[#1c1b1a] dark:text-[#dedcd6]'
                        : 'text-[#3d3a33] dark:text-[#a09a8e]'
                    }
                  `}>
                    {option}
                  </span>

                  {/* Enter icon when highlighted */}
                  {isHighlighted && !selected && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center justify-center"
                    >
                      <CornerDownLeft className="w-4 h-4 text-[#a09a8e] dark:text-[#666]" />
                    </motion.span>
                  )}
                </motion.button>

                {/* Divider between options */}
                {idx < 3 && displayOptions[idx + 1] && (
                  <div className="h-px bg-[#eceae4] dark:bg-[#2d2d2c] mx-3" />
                )}
              </React.Fragment>
            );
          })}

          {/* Something Else Row */}
          <div className="h-px bg-[#eceae4] dark:bg-[#2d2d2c] mx-3 my-1" />
          <div className="flex items-center gap-3 h-[52px] px-3 rounded-xl">
            <Pencil className="w-[18px] h-[18px] text-[#b0ada5] dark:text-[#666] shrink-0" />
            {showCustomInput ? (
              <input
                ref={customInputRef}
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCustomSubmit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowCustomInput(false);
                    containerRef.current?.focus();
                  }
                }}
                onBlur={() => {
                  if (!customText.trim()) setShowCustomInput(false);
                }}
                placeholder="Type your answer..."
                className="flex-1 text-[15px] font-medium text-[#1c1b1a] dark:text-[#f0efe6] placeholder-[#b0ada5] dark:placeholder-[#666] outline-none bg-transparent"
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                disabled={!!selected}
                className="flex-1 text-left text-[15px] text-[#b0ada5] dark:text-[#666] cursor-text disabled:cursor-default disabled:opacity-40"
              >
                Something else
              </button>
            )}
          </div>

          {/* Skip Button Row */}
          <div className="flex items-center justify-end mt-2 px-3">
            <button
              type="button"
              onClick={handleSkip}
              disabled={!!selected}
              className="px-4 py-[7px] text-[13px] font-medium rounded-lg border border-[#d4d2cc] dark:border-[#3a3a38] text-[#3d3a33] dark:text-[#dedcd6] bg-white dark:bg-[#1a1a19] hover:bg-[#f7f6f2] dark:hover:bg-[#222221] transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40"
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
