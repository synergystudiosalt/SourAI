import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface LimitTimerProps {
  targetTime: number | null;
  onReset?: () => void;
  className?: string;
}

export const LimitTimer: React.FC<LimitTimerProps> = ({ targetTime, onReset, className = '' }) => {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!targetTime) return;

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, targetTime - now);
      setTimeLeft(diff);

      if (diff === 0 && onReset) {
        onReset();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [targetTime, onReset]);

  if (!targetTime) return null;

  const totalSeconds = Math.floor(timeLeft / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const formatted = `${hours.toString().padStart(2, '0')}h ${minutes
    .toString()
    .padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;

  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-medium text-[#78746a] dark:text-[#aaa] shrink-0 select-none ${className}`}>
      <Clock className="w-3.5 h-3.5 text-[#78746a] dark:text-[#aaa]" />
      <span>Resets in {formatted}</span>
    </div>
  );
};
