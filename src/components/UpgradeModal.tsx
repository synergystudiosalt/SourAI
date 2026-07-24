import React from 'react';
import { X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LimitTimer } from './LimitTimer';
import { MESSAGE_QUOTA } from '../utils/constants';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  limitResetTime?: number | null;
  onResetLimit?: () => void;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({ isOpen, onClose, limitResetTime, onResetLimit }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop with blur */}
          <motion.div
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, backdropFilter: 'blur(8px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 bg-black/20"
            onClick={onClose}
          />

          {/* Modal Box */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.94, filter: 'blur(10px)' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="relative w-full max-w-md bg-[#faf9f6] dark:bg-[#1a1a19] border border-[#e5e3db] dark:border-[#2d2d2c] rounded-3xl shadow-2xl overflow-hidden p-6 z-10 text-center flex flex-col items-center"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full text-[#78746a] dark:text-[#a09c94] hover:bg-[#efece5] dark:hover:bg-[#282826] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="w-12 h-12 rounded-2xl bg-[#f4ece3] dark:bg-[#2c2b28] flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-[#d96b43]" />
            </div>

            <h2 className="font-instrument text-2xl font-normal text-[#1c1b1a] dark:text-[#f0efe6] tracking-tight mb-2">
              Message Limit Reached
            </h2>
            <p className="text-xs text-[#615e56] dark:text-[#a09c94] mb-4 leading-relaxed">
              You have used all {MESSAGE_QUOTA} message units for this session. Your limit will automatically refresh once the timer expires.
            </p>

            <LimitTimer targetTime={limitResetTime || null} onReset={onResetLimit} className="mb-6 text-xs" />

            <button
              onClick={onClose}
              className="w-full bg-[#1c1b1a] dark:bg-[#f0efe6] text-white dark:text-[#1c1b1a] hover:bg-[#33312e] dark:hover:bg-white text-xs font-semibold py-2.5 rounded-xl transition-all cursor-pointer shadow-xs"
            >
              Got it
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

