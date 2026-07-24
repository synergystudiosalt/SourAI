import React, { useState } from 'react';
import { Copy, Download, Check, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

interface ImagePreviewCardProps {
  prompt: string;
  url: string;
  index?: number;
}

export const ImagePreviewCard: React.FC<ImagePreviewCardProps> = ({ prompt, url, index = 0 }) => {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchImageBlob = async (): Promise<Blob | null> => {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.blob();
    } catch (err) {
      console.error('Failed to fetch image:', err);
      return null;
    }
  };

  const handleCopy = async () => {
    setError(null);
    const blob = await fetchImageBlob();
    if (!blob) {
      setError('Failed to copy — CORS blocked');
      setTimeout(() => setError(null), 3000);
      return;
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || 'image/png']: blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy image:', err);
      setError('Copy not supported in this browser');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    const blob = await fetchImageBlob();
    setDownloading(false);
    if (!blob) {
      setError('Failed to download — CORS blocked');
      setTimeout(() => setError(null), 3000);
      return;
    }
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `sour-ai-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="my-4 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-900"
    >
      {/* Image Container */}
      <div className="relative bg-white dark:bg-gray-800 aspect-square overflow-auto flex items-center justify-center">
        <img
          src={url}
          alt={prompt}
          className="max-w-full max-h-full object-contain"
          loading="lazy"
        />
      </div>

      {/* Controls Footer */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-600 dark:text-gray-400 flex-1 truncate">
          {prompt}
        </p>

        <div className="flex items-center gap-2">
          {error && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle size={12} />
              {error}
            </span>
          )}

          <button
            onClick={handleCopy}
            disabled={copied}
            className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Copy image to clipboard"
            aria-label="Copy image"
          >
            {copied ? (
              <>
                <Check size={16} className="text-green-600" />
                <span className="text-xs text-green-600">Copied</span>
              </>
            ) : (
              <>
                <Copy size={16} className="text-gray-600 dark:text-gray-400" />
                <span className="text-xs text-gray-600 dark:text-gray-400">Copy</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Download image"
            aria-label="Download image"
          >
            <Download size={16} className="text-gray-600 dark:text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {downloading ? 'Saving...' : 'Download'}
            </span>
          </button>
        </div>
      </div>
    </motion.div>
  );
};
