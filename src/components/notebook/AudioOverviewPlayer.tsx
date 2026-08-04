import React, { useEffect, useId, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

const WAVE_WIDTH = 480;
const WAVE_MIDLINE = 18;

function wavePath(phase: number): string {
  return Array.from({ length: 49 }, (_, index) => {
    const ratio = index / 48;
    const envelope = Math.sin(Math.PI * ratio);
    const signal = Math.sin(index * 1.41 + phase) * 0.62 + Math.sin(index * 0.57 + phase * 0.7) * 0.38;
    const x = ratio * WAVE_WIDTH;
    const y = WAVE_MIDLINE + signal * envelope * 11;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

const WAVE_PATHS = [wavePath(0), wavePath(0.8), wavePath(1.55), wavePath(0)];

function finiteDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function formatAudioTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export interface AudioOverviewPlayerProps {
  src: string;
}

/** Sour-styled controls with a seekable waveform in place of browser chrome. */
export const AudioOverviewPlayer: React.FC<AudioOverviewPlayerProps> = ({ src }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gradientId = `audio-wave-${useId().replace(/:/g, '')}`;
  const prefersReducedMotion = useReducedMotion();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused && !audio.ended) {
      audio.pause();
      return;
    }
    if (audio.ended) audio.currentTime = 0;
    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    audio.currentTime = Math.min(Math.max(value, 0), duration);
    setCurrentTime(audio.currentTime);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  };

  return (
    <div className="mt-5 flex items-center gap-3 border border-[#dfe3ea] bg-white/80 px-3 py-3 shadow-[0_8px_24px_rgba(29,43,65,0.06)] dark:border-[#343943] dark:bg-[#17191d]">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        aria-label="Audio overview"
        className="sr-only"
        onLoadedMetadata={(event) => setDuration(finiteDuration(event.currentTarget.duration))}
        onDurationChange={(event) => setDuration(finiteDuration(event.currentTarget.duration))}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      <button
        type="button"
        onClick={() => void togglePlayback()}
        aria-label={isPlaying ? 'Pause audio overview' : 'Play audio overview'}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#4776d5] text-white shadow-[0_4px_12px_rgba(71,118,213,0.28)] transition-transform hover:scale-105 active:scale-95"
      >
        {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>

      <div className="min-w-0 flex-1">
        <div
          role="img"
          aria-label={isPlaying ? 'Animated audio waveform' : 'Audio waveform'}
          data-playing={isPlaying ? 'true' : 'false'}
          className="relative h-9 overflow-hidden"
        >
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_MIDLINE * 2}`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible text-[#b8c0cc] dark:text-[#59616e]"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#4776d5" />
                <stop offset={`${progress * 100}%`} stopColor="#4776d5" />
                <stop offset={`${progress * 100}%`} stopColor="currentColor" />
                <stop offset="100%" stopColor="currentColor" />
              </linearGradient>
            </defs>
            <motion.path
              d={WAVE_PATHS[0]}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              animate={isPlaying && !prefersReducedMotion ? { d: WAVE_PATHS } : { d: WAVE_PATHS[0] }}
              transition={isPlaying && !prefersReducedMotion
                ? { duration: 1.4, ease: 'easeInOut', repeat: Infinity }
                : { duration: 0.18 }}
            />
          </svg>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            aria-label="Seek audio overview"
            aria-valuetext={`${formatAudioTime(currentTime)} of ${formatAudioTime(duration)}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <div className="mt-0.5 flex items-center justify-between font-code text-[10px] tabular-nums text-[#78828e]">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(duration)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={toggleMute}
        aria-label={isMuted ? 'Unmute audio overview' : 'Mute audio overview'}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-[#78828e] transition-colors hover:text-[#4776d5]"
      >
        {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  );
};
