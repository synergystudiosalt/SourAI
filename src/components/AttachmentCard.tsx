import React from 'react';
import { X, FileText, Code2, Paperclip } from 'lucide-react';
import { AttachmentItem } from '../types';

interface AttachmentCardProps {
  item: AttachmentItem;
  onRemove?: () => void;
  className?: string;
}

export const getFileExtension = (fileName: string, type?: string): string => {
  if (fileName && fileName.includes('.')) {
    const ext = fileName.split('.').pop()?.toUpperCase();
    if (ext && ext.length <= 5) return ext;
  }
  if (type === 'image') return 'IMG';
  if (type === 'pdf') return 'PDF';
  if (type === 'docx') return 'DOCX';
  if (type === 'code') return 'CODE';
  return 'FILE';
};

export const AttachmentCard: React.FC<AttachmentCardProps> = ({ item, onRemove, className = '' }) => {
  const ext = getFileExtension(item.name, item.type);
  const hasImagePreview = Boolean(item.dataUrl && (item.type === 'image' || item.type === 'pdf'));

  return (
    <div
      className={`relative w-36 sm:w-40 bg-white dark:bg-[#1f1f1e] border border-[#e3e0d5] dark:border-[#333] rounded-xl p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col justify-between transition-all select-none ${className}`}
    >
      {/* Remove Button if provided */}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#d96b43] hover:bg-[#c55a33] text-white rounded-full flex items-center justify-center hover:scale-110 transition-transform shadow-sm z-10 cursor-pointer"
          title="Remove attachment"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {/* Card Content Body */}
      {hasImagePreview ? (
        <div className="flex flex-col h-full justify-between gap-2">
          <div className="w-full h-20 rounded-lg overflow-hidden border border-[#eae8e0] dark:border-[#2d2d2c] bg-[#f8f7f2] dark:bg-[#252524] flex items-center justify-center">
            <img src={item.dataUrl} alt={item.name} className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[#1c1b1a] dark:text-[#f0efe6] truncate leading-tight">
              {item.name}
            </span>
            <span className="self-start text-[9px] font-semibold text-[#524f47] dark:text-[#a09c94] bg-[#f5f3ec] dark:bg-[#282827] border border-[#e0ddd2] dark:border-[#3a3a38] px-1.5 py-0.5 rounded-md uppercase tracking-wider">
              {ext}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col justify-between h-full min-h-[80px] gap-3">
          <span className="text-xs font-medium text-[#1c1b1a] dark:text-[#f0efe6] line-clamp-3 leading-snug break-words">
            {item.name}
          </span>
          <span className="self-start text-[10px] font-semibold text-[#524f47] dark:text-[#a09c94] bg-[#f5f3ec] dark:bg-[#282827] border border-[#e0ddd2] dark:border-[#3a3a38] px-2 py-0.5 rounded-md uppercase tracking-wider">
            {ext}
          </span>
        </div>
      )}
    </div>
  );
};
