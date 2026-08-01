import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

import {
  studioOptionSpec,
  STUDIO_DIFFICULTIES,
  type StudioDifficulty,
  type StudioOptions,
} from '../../../functions/shared/studioOptions';
import { studioArtifactTitle, type StudioArtifactKind } from '../../features/notebook/types';

/**
 * Asks how an output should be aimed before spending a generation on it.
 *
 * Only kinds with a spec open this; the rest generate straight away, because
 * interrupting someone to ask nothing is worse than not asking.
 */

const DIFFICULTY_LABELS: Record<StudioDifficulty, string> = {
  introductory: 'Introductory',
  balanced: 'Balanced',
  advanced: 'Advanced',
};

export interface StudioOptionsDialogProps {
  kind: StudioArtifactKind | null;
  onCancel: () => void;
  onConfirm: (options: StudioOptions) => void;
}

export const StudioOptionsDialog: React.FC<StudioOptionsDialogProps> = ({
  kind,
  onCancel,
  onConfirm,
}) => {
  const spec = kind ? studioOptionSpec(kind as never) : undefined;
  const [count, setCount] = useState(spec?.count?.fallback ?? 10);
  const [difficulty, setDifficulty] = useState<StudioDifficulty>('balanced');
  const [focus, setFocus] = useState('');

  useEffect(() => {
    if (!kind) return;
    setCount(studioOptionSpec(kind as never)?.count?.fallback ?? 10);
    setDifficulty('balanced');
    setFocus('');
  }, [kind]);

  const isOpen = Boolean(kind && spec);

  return (
    <AnimatePresence>
      {isOpen && kind && spec && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
            onClick={onCancel}
          />
          <motion.div
            role="dialog"
            aria-label={`${studioArtifactTitle(kind)} settings`}
            initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative z-10 flex w-full max-w-[460px] flex-col border border-[#dfe3ea] bg-[#fbfcfd] shadow-2xl dark:border-[#282c33] dark:bg-[#17191d]"
          >
            <div className="flex items-start justify-between border-b border-[#dfe3ea] px-4 py-3 dark:border-[#282c33]">
              <div>
                <h2 className="font-heading text-[17px] not-italic text-[#16181d] dark:text-[#dce0e5]">
                  {studioArtifactTitle(kind)}
                </h2>
                <p className="mt-0.5 text-[11px] text-[#78828e] dark:text-[#a9afbc]">
                  Aim this at what you are actually studying.
                </p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close"
                className="p-2 text-[#4a5259] hover:text-[#16181d] sm:p-1 dark:text-[#a9afbc] dark:hover:text-[#dce0e5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {spec.count && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label
                      htmlFor="studio-count"
                      className="text-[11px] font-medium uppercase tracking-wider text-[#78828e]"
                    >
                      How many {spec.count.noun}
                    </label>
                    <motion.span
                      key={count}
                      initial={{ scale: 0.85, opacity: 0.6 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                      className="font-code text-[12px] text-[#16181d] dark:text-[#dce0e5]"
                    >
                      {count}
                    </motion.span>
                  </div>
                  <input
                    id="studio-count"
                    type="range"
                    min={spec.count.min}
                    max={spec.count.max}
                    value={count}
                    onChange={(event) => setCount(Number(event.target.value))}
                    className="w-full accent-[#4776d5]"
                  />
                  <div className="mt-0.5 flex justify-between font-code text-[9.5px] text-[#78828e]">
                    <span>{spec.count.min}</span>
                    <span>{spec.count.max}</span>
                  </div>
                </div>
              )}

              {spec.difficulty && (
                <div>
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[#78828e]">
                    Difficulty
                  </span>
                  <div
                    role="radiogroup"
                    aria-label="Difficulty"
                    className="flex border border-[#dfe3ea] dark:border-[#282c33]"
                  >
                    {STUDIO_DIFFICULTIES.map((level) => {
                      const isSelected = difficulty === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => setDifficulty(level)}
                          className={`relative flex-1 px-2 py-1.5 text-[11.5px] ws-tab ${
                            isSelected
                              ? 'text-white'
                              : 'text-[#4a5259] hover:text-[#16181d] dark:text-[#a9afbc] dark:hover:text-[#dce0e5]'
                          }`}
                        >
                          {/* The selection slides between options rather than
                              blinking from one to the next. */}
                          {isSelected && (
                            <motion.span
                              layoutId="studio-difficulty"
                              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                              className="absolute inset-0 bg-[#4776d5]"
                            />
                          )}
                          <span className="relative">{DIFFICULTY_LABELS[level]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {spec.focus && (
                <div>
                  <label
                    htmlFor="studio-focus"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[#78828e]"
                  >
                    Focus <span className="normal-case text-[#a3aab5]">(optional)</span>
                  </label>
                  <textarea
                    id="studio-focus"
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                    rows={2}
                    maxLength={400}
                    placeholder="e.g. chapter 3, the experimental method, anything about pricing"
                    className="w-full resize-none border border-[#dfe3ea] bg-white px-2.5 py-2 text-[12.5px] text-[#16181d] outline-none placeholder:text-[#a3aab5] focus:border-[#4776d5] dark:border-[#282c33] dark:bg-[#1e2128] dark:text-[#dce0e5]"
                  />
                  <p className="mt-1 text-[10.5px] text-[#78828e]">
                    Leave empty to cover the sources as a whole.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#dfe3ea] px-4 py-3 dark:border-[#282c33]">
              <button
                type="button"
                onClick={onCancel}
                className="border border-[#dfe3ea] px-3 py-1.5 text-[12px] text-[#4a5259] dark:border-[#282c33] dark:text-[#a9afbc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  onConfirm({
                    ...(spec.count ? { count } : {}),
                    ...(spec.difficulty ? { difficulty } : {}),
                    ...(spec.focus && focus.trim() ? { focus: focus.trim() } : {}),
                  })
                }
                className="bg-[#4776d5] px-3 py-1.5 text-[12px] font-medium text-white interactable-btn"
              >
                Generate
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
