import React, { useState } from 'react';
import { Copy, Download, Check, AlertCircle, Loader2 } from 'lucide-react';
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
  const [loaded, setLoaded] = useState(false);

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
      className="my-4 rounded-lg border border-[#dfe3ea] dark:border-[#282c33] overflow-hidden bg-white dark:bg-[#17191d]"
    >
      {/* Image Container */}
      <div className="relative aspect-square overflow-hidden flex items-center justify-center">
        {/* Loading skeleton */}
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[var(--z-shimmer-base)]">
            <div className="absolute inset-0 z-shimmer" />
            <Loader2 className="relative w-6 h-6 text-[#90959e] dark:text-[#666] animate-spin" />
          </div>
        )}

        <img
          src={url}
          alt={prompt}
          className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      </div>

      {/* Controls Footer */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#f6f8fa] dark:bg-[#1e2128] border-t border-[#dfe3ea] dark:border-[#282c33]">
        <p className="text-sm text-[#4a5259] dark:text-[#a9afbc] flex-1 truncate">
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
            className="p-2 rounded-md hover:bg-[#e2e3e6] dark:hover:bg-[#1e2128] transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
                <Copy size={16} className="text-[#4a5259] dark:text-[#a9afbc]" />
                <span className="text-xs text-[#4a5259] dark:text-[#a9afbc]">Copy</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="p-2 rounded-md hover:bg-[#e2e3e6] dark:hover:bg-[#1e2128] transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Download image"
            aria-label="Download image"
          >
            <Download size={16} className="text-[#4a5259] dark:text-[#a9afbc]" />
            <span className="text-xs text-[#4a5259] dark:text-[#a9afbc]">
              {downloading ? 'Saving...' : 'Download'}
            </span>
          </button>
        </div>
      </div>
    </motion.div>
  );
};
