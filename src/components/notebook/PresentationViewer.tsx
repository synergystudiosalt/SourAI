import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';

import { parsePresentation, type PresentationSlide } from '../../features/notebook/presentation';

export interface PresentationViewerProps {
  markdown: string;
  fallbackTitle?: string;
  notebookTitle?: string;
  sourceLabel?: (index: number) => string | undefined;
  onOpenSource?: (index: number) => void;
}

function BulletText({
  text,
  sourceLabel,
  onOpenSource,
}: {
  text: string;
  sourceLabel?: PresentationViewerProps['sourceLabel'];
  onOpenSource?: PresentationViewerProps['onOpenSource'];
}) {
  return (
    <>
      {text.split(/(\[\d+\])/g).map((part, index) => {
        const citation = /^\[(\d+)\]$/.exec(part);
        if (!citation) return <React.Fragment key={index}>{part}</React.Fragment>;
        const sourceIndex = Number(citation[1]);
        return (
          <button
            key={index}
            type="button"
            onClick={() => onOpenSource?.(sourceIndex)}
            title={sourceLabel?.(sourceIndex) ?? `Source ${sourceIndex}`}
            className="ml-1 align-super font-code text-[0.55em] font-medium text-[#4776d5] hover:underline"
          >
            [{sourceIndex}]
          </button>
        );
      })}
    </>
  );
}

/** A 16:9 in-notebook slide show matching the exported PowerPoint. */
export const PresentationViewer: React.FC<PresentationViewerProps> = ({
  markdown,
  fallbackTitle,
  notebookTitle,
  sourceLabel,
  onOpenSource,
}) => {
  const outline = useMemo(() => parsePresentation(markdown, fallbackTitle), [markdown, fallbackTitle]);
  const slides = useMemo<(PresentationSlide & { cover?: boolean })[]>(
    () => [{ title: outline.title, bullets: [], cover: true }, ...outline.slides],
    [outline]
  );
  const [active, setActive] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const slide = slides[Math.min(active, slides.length - 1)];

  const go = (index: number) => setActive(Math.max(0, Math.min(slides.length - 1, index)));

  return (
    <section aria-label="Presentation viewer" className="w-full">
      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') go(active - 1);
          if (event.key === 'ArrowRight') go(active + 1);
        }}
        className="group relative aspect-video w-full overflow-hidden border border-[#cbd3df] bg-[#172033] shadow-[0_16px_38px_rgba(23,32,51,0.16)] outline-none focus:border-[#4776d5] dark:border-[#3b414d]"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`absolute inset-0 ${slide.cover ? 'bg-[#172033] text-white' : 'bg-[#f7f9fc] text-[#16181d]'}`}
          >
            {slide.cover ? (
              <div className="flex h-full items-center border-l-[7px] border-[#4776d5] px-[7%]">
                <div className="max-w-[88%]">
                  <h2 className="font-heading text-[clamp(22px,4.1vw,48px)] font-semibold not-italic leading-[1.08] tracking-[-0.02em]">
                    {slide.title}
                  </h2>
                  <p className="mt-[8%] text-[clamp(9px,1.25vw,15px)] text-[#a9b7d0]">
                    {notebookTitle ? `${notebookTitle} · ` : ''}Generated with sour.ai
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col border-t-[5px] border-[#4776d5] px-[6%] pb-[4%] pt-[4.5%]">
                <h2 className="shrink-0 font-heading text-[clamp(17px,2.55vw,31px)] font-semibold not-italic leading-tight tracking-[-0.01em]">
                  {slide.title}
                </h2>
                <div className="my-[3%] h-px shrink-0 bg-[#d8dfea]" />
                <ul className="flex min-h-0 flex-1 flex-col justify-center gap-[clamp(7px,1.8vw,21px)] pl-[3%]">
                  {(slide.bullets.length ? slide.bullets : ['Add supporting detail here.']).map((bullet, index) => (
                    <li
                      key={index}
                      className="relative pl-[3%] text-[clamp(11px,1.65vw,20px)] leading-[1.3] text-[#252b36] before:absolute before:left-0 before:top-[0.55em] before:h-[0.34em] before:w-[0.34em] before:bg-[#4776d5]"
                    >
                      <BulletText text={bullet} sourceLabel={sourceLabel} onOpenSource={onOpenSource} />
                    </li>
                  ))}
                </ul>
                <div className="flex shrink-0 items-center justify-between font-code text-[clamp(7px,0.85vw,10px)] text-[#667085]">
                  <span>sour.ai</span>
                  <span>{active}</span>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <button
          type="button"
          onClick={() => go(active - 1)}
          disabled={active === 0}
          aria-label="Previous slide"
          className="absolute left-2 top-1/2 z-10 -translate-y-1/2 bg-black/45 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => go(active + 1)}
          disabled={active === slides.length - 1}
          aria-label="Next slide"
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 bg-black/45 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:hidden"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void stageRef.current?.requestFullscreen?.()}
          aria-label="Present fullscreen"
          className="absolute right-2 top-2 z-10 bg-black/45 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="font-code text-[10.5px] text-[#667085] dark:text-[#a9afbc]">
          Slide {active + 1} of {slides.length}
        </span>
        <span className="text-[10.5px] text-[#78828e]">Use arrow keys to present</span>
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-2 thin-scrollbar">
        {slides.map((item, index) => (
          <button
            key={`${item.title}-${index}`}
            type="button"
            onClick={() => go(index)}
            aria-label={`Go to slide ${index + 1}`}
            aria-current={active === index ? 'page' : undefined}
            className={`aspect-video w-[112px] shrink-0 overflow-hidden border text-left transition-colors ${
              active === index
                ? 'border-[#4776d5] ring-1 ring-[#4776d5]'
                : 'border-[#cbd3df] hover:border-[#8da7dc] dark:border-[#3b414d]'
            } ${item.cover ? 'bg-[#172033] text-white' : 'bg-[#f7f9fc] text-[#16181d]'}`}
          >
            <span className="flex h-full flex-col justify-center px-2">
              <span className="line-clamp-2 text-[8px] font-semibold leading-tight">{item.title}</span>
              {!item.cover && (
                <span className="mt-1 line-clamp-2 text-[6px] leading-tight text-[#667085]">
                  {item.bullets[0]}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};
