import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle, Check, X } from 'lucide-react';

import {
  readFlashcards,
  shuffle,
  type Flashcard,
} from '../../features/notebook/studyContent';

/**
 * A flashcard deck you work through one card at a time.
 *
 * The card flips in 3D rather than swapping its text, because the flip is what
 * makes the pause before the answer feel deliberate — the moment the user is
 * supposed to be recalling in.
 */

export interface FlashcardsProps {
  content: string;
  onOpenSource?: (index: number) => void;
  sourceLabel?: (index: number) => string | undefined;
}

type Verdict = 'known' | 'unsure';

export const Flashcards: React.FC<FlashcardsProps> = ({
  content,
  onOpenSource,
  sourceLabel,
}) => {
  const deck = useMemo(() => readFlashcards(content), [content]);
  const [order, setOrder] = useState<Flashcard[]>(() => deck.cards);
  const [position, setPosition] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  // Direction drives the slide, so going back does not animate forwards.
  const [direction, setDirection] = useState(1);

  const total = order.length;
  const card = order[position];
  const known = Object.values(verdicts).filter((verdict) => verdict === 'known').length;
  const reviewed = Object.keys(verdicts).length;

  if (total === 0) {
    return (
      <p className="px-1 py-4 text-[12px] text-[#78828e] dark:text-[#a9afbc]">
        This deck could not be read.
      </p>
    );
  }

  const go = (delta: number) => {
    const next = position + delta;
    if (next < 0 || next >= total) return;
    setDirection(delta);
    setIsFlipped(false);
    setPosition(next);
  };

  const mark = (verdict: Verdict) => {
    setVerdicts((previous) => ({ ...previous, [position]: verdict }));
    if (position < total - 1) go(1);
  };

  const restart = (reshuffle: boolean) => {
    setOrder(reshuffle ? shuffle(deck.cards) : deck.cards);
    setVerdicts({});
    setPosition(0);
    setDirection(1);
    setIsFlipped(false);
  };

  const label = card.source ? sourceLabel?.(card.source) : undefined;

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-[#dfe3ea] pb-2 dark:border-[#282c33]">
        <span className="font-code text-[10px] uppercase tracking-wider text-[#78828e]">
          Card {position + 1} of {total}
          {reviewed > 0 && ` · ${known}/${reviewed} known`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => restart(true)}
            title="Shuffle and start over"
            className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-1 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
          >
            <Shuffle className="h-3 w-3" />
            Shuffle
          </button>
          <button
            type="button"
            onClick={() => restart(false)}
            title="Start over in the original order"
            className="flex items-center gap-1 border border-[#dfe3ea] px-2 py-1 text-[10.5px] text-[#4a5259] hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
          >
            <RotateCcw className="h-3 w-3" />
            Restart
          </button>
        </div>
      </div>

      {/* Progress. A width transition reads as advancing; a redraw does not. */}
      <div className="mb-4 h-[3px] w-full bg-[#e8ecf3] dark:bg-[#22262e]">
        <motion.div
          className="h-full bg-[#4776d5]"
          initial={false}
          animate={{ width: `${((position + 1) / total) * 100}%` }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        />
      </div>

      <div className="[perspective:1400px]">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.button
            key={position}
            type="button"
            custom={direction}
            onClick={() => setIsFlipped((flipped) => !flipped)}
            aria-label={isFlipped ? 'Show the question' : 'Reveal the answer'}
            initial={{ opacity: 0, x: direction * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -28 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className="relative block w-full cursor-pointer text-left"
          >
            <motion.div
              className="relative w-full [transform-style:preserve-3d]"
              initial={false}
              animate={{ rotateY: isFlipped ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 26 }}
            >
              <div className="flex min-h-[190px] w-full flex-col justify-center border border-[#dfe3ea] bg-[#f6f8fa] px-5 py-6 [backface-visibility:hidden] dark:border-[#282c33] dark:bg-[#1e2128]">
                <span className="mb-2 font-code text-[9.5px] uppercase tracking-wider text-[#78828e]">
                  Question
                </span>
                <span className="font-heading text-[17px] not-italic leading-snug text-[#16181d] dark:text-[#dce0e5]">
                  {card.front}
                </span>
                <span className="mt-4 text-[10.5px] text-[#78828e]">Tap to reveal</span>
              </div>

              <div className="absolute inset-0 flex flex-col justify-center border border-[#4776d5] bg-[#e8edf8] px-5 py-6 [backface-visibility:hidden] [transform:rotateY(180deg)] dark:bg-[#1c2434]">
                <span className="mb-2 font-code text-[9.5px] uppercase tracking-wider text-[#4776d5]">
                  Answer
                </span>
                <span className="text-[13.5px] leading-[1.7] text-[#16181d] dark:text-[#dce0e5]">
                  {card.back}
                </span>
                {card.source !== undefined && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSource?.(card.source!);
                    }}
                    title={label ? `Source ${card.source}: ${label}` : `Source ${card.source}`}
                    className="mt-4 self-start border border-[#c9d3e8] bg-[#fbfcfd] px-1.5 font-code text-[9.5px] text-[#33518f] dark:border-[#33405c] dark:bg-[#17191d] dark:text-[#93aee6]"
                  >
                    Source {card.source}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.button>
        </AnimatePresence>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={position === 0}
          className="flex items-center gap-1 border border-[#dfe3ea] px-2.5 py-1.5 text-[11.5px] text-[#4a5259] disabled:opacity-40 hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => mark('unsure')}
            className={`flex items-center gap-1 border px-2.5 py-1.5 text-[11.5px] ws-toolbar-btn ${
              verdicts[position] === 'unsure'
                ? 'border-[#c98a2f] bg-[#fbf3e6] text-[#8a5a12] dark:bg-[#2a2318] dark:text-[#e0b978]'
                : 'border-[#dfe3ea] text-[#4a5259] hover:border-[#c98a2f] hover:text-[#8a5a12] dark:border-[#282c33] dark:text-[#a9afbc]'
            }`}
          >
            <X className="h-3.5 w-3.5" />
            Review
          </button>
          <button
            type="button"
            onClick={() => mark('known')}
            className={`flex items-center gap-1 border px-2.5 py-1.5 text-[11.5px] ws-toolbar-btn ${
              verdicts[position] === 'known'
                ? 'border-[#2f8a55] bg-[#e9f5ee] text-[#1f6b3f] dark:bg-[#16261d] dark:text-[#82c79f]'
                : 'border-[#dfe3ea] text-[#4a5259] hover:border-[#2f8a55] hover:text-[#1f6b3f] dark:border-[#282c33] dark:text-[#a9afbc]'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            Known
          </button>
        </div>

        <button
          type="button"
          onClick={() => go(1)}
          disabled={position === total - 1}
          className="flex items-center gap-1 border border-[#dfe3ea] px-2.5 py-1.5 text-[11.5px] text-[#4a5259] disabled:opacity-40 hover:border-[#4776d5] hover:text-[#4776d5] dark:border-[#282c33] dark:text-[#a9afbc] ws-toolbar-btn"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <AnimatePresence>
        {reviewed === total && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 border border-[#dfe3ea] bg-[#f6f8fa] px-3 py-2 text-[12px] text-[#16181d] dark:border-[#282c33] dark:bg-[#1e2128] dark:text-[#dce0e5]"
          >
            Deck complete — {known} of {total} marked known.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
};
