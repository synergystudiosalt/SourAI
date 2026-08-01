import React from 'react';
import { X } from 'lucide-react';
import Logo from './Logo';
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
            className="relative w-full max-w-md bg-[#fbfcfd] dark:bg-[#17191d] border border-[#dfe3ea] dark:border-[#282c33] rounded-3xl shadow-2xl overflow-hidden p-6 z-10 text-center flex flex-col items-center"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full text-[#4a5259] dark:text-[#a9afbc] hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="w-12 h-12 rounded-2xl bg-[#e3e9f4] dark:bg-[#292a2c] flex items-center justify-center mx-auto mb-3">
              <Logo size={24} />
            </div>

            <h2 className="font-instrument text-2xl font-normal text-[#16181d] dark:text-[#dce0e5] tracking-tight mb-2">
              Message Limit Reached
            </h2>
            <p className="text-xs text-[#4a5259] dark:text-[#a9afbc] mb-4 leading-relaxed">
              You have used all {MESSAGE_QUOTA} message units for this session. Your limit will automatically refresh once the timer expires.
            </p>

            <LimitTimer targetTime={limitResetTime || null} onReset={onResetLimit} className="mb-6 text-xs" />

            <button
              onClick={onClose}
              className="w-full bg-[#16181d] dark:bg-[#dce0e5] text-white dark:text-[#16181d] hover:bg-[#2f3032] dark:hover:bg-white text-xs font-semibold py-2.5 rounded-xl transition-all cursor-pointer shadow-xs"
            >
              Got it
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

