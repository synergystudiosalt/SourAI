import React, { useRef, useState } from 'react';
import { Image, Paperclip, Loader2 } from 'lucide-react';
import { AttachmentItem } from '../types';
import { parseUploadedFile } from '../utils/fileParser';

interface AttachmentPopoverProps {
  onAttachFile: (item: AttachmentItem) => void;
  onClose: () => void;
  positionClass?: string;
}

export const AttachmentPopover: React.FC<AttachmentPopoverProps> = ({
  onAttachFile,
  onClose,
  positionClass = 'bottom-full mb-2 left-0',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    try {
      const item = await parseUploadedFile(file);
      onAttachFile(item);
    } catch (err) {
      console.error('Error parsing file:', err);
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  return (
    <div className={`${positionClass} w-60 bg-white/95 dark:bg-[#1e1e1d]/95 backdrop-blur-md border border-[#e5e3db] dark:border-[#2d2d2c] rounded-lg shadow-xl p-1.5 z-[100] select-none absolute`}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept=".txt,.md,.json,.js,.ts,.tsx,.html,.css,.csv,.pdf,.doc,.docx"
      />
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
      />

      {isProcessing && (
        <div className="px-2.5 py-1 flex items-center justify-end">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#d96b43]" />
        </div>
      )}

      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs text-[#1c1b1a] dark:text-[#f0efe6] hover:bg-[#f5f3ec] dark:hover:bg-[#282826] rounded-xl text-left cursor-pointer blurry-hover"
        >
          <Paperclip className="w-4 h-4 text-[#78746a] dark:text-[#aaa]" />
          <span>Upload document or file</span>
        </button>

        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs text-[#1c1b1a] dark:text-[#f0efe6] hover:bg-[#f5f3ec] dark:hover:bg-[#282826] rounded-xl text-left cursor-pointer blurry-hover"
        >
          <Image className="w-4 h-4 text-[#78746a] dark:text-[#aaa]" />
          <span>Add image or screenshot</span>
        </button>


      </div>
    </div>
  );
};
