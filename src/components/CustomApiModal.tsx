import React, { useEffect, useRef, useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import {
  customApiManager,
  CustomApiProvider,
  PROVIDER_LABELS,
  PROVIDER_PLACEHOLDERS,
  type CustomApiConfig,
} from '../utils/customApiManager';

interface CustomApiModalProps {
  isDarkMode: boolean;
  isOpen: boolean;
  onClose: () => void;
  onConfigAdded: (config: CustomApiConfig) => void;
}

const PROVIDERS: CustomApiProvider[] = ['groq', 'gemini', 'claude', 'openai'];

export const CustomApiModal: React.FC<CustomApiModalProps> = ({
  isDarkMode,
  isOpen,
  onClose,
  onConfigAdded,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<CustomApiProvider>('groq');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleSubmit = () => {
    setError('');

    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }

    if (!modelName.trim()) {
      setError('Model name is required');
      return;
    }

    try {
      const config = customApiManager.addConfig(selectedProvider, apiKey.trim(), modelName.trim());
      onConfigAdded(config);
      setApiKey('');
      setModelName('');
      setSelectedProvider('groq');
      onClose();
    } catch (err) {
      setError('Failed to save API configuration');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 ${isDarkMode ? 'bg-black/50' : 'bg-black/30'}`}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`relative w-96 ${isDarkMode ? 'bg-[#1e1e1e]' : 'bg-white'} border ${isDarkMode ? 'border-[#2d2d2c]' : 'border-[#e5e3db]'} shadow-2xl`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-[#2d2d2c]' : 'border-[#e5e3db]'}`}
        >
          <h2 className={`text-sm font-semibold ${isDarkMode ? 'text-[#f0efe6]' : 'text-[#1c1b1a]'}`}>
            Add Custom API
          </h2>
          <button
            onClick={onClose}
            className={`p-1 hover:bg-opacity-10 cursor-pointer ${isDarkMode ? 'hover:bg-white text-[#a09c94]' : 'hover:bg-black text-[#8c887d]'}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label className={`text-xs font-semibold uppercase tracking-wide ${isDarkMode ? 'text-[#a09c94]' : 'text-[#8c887d]'}`}>
              API Provider
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider}
                  onClick={() => setSelectedProvider(provider)}
                  className={`px-3 py-2 text-xs font-medium border transition-colors ${
                    selectedProvider === provider
                      ? isDarkMode
                        ? 'bg-[#252524] border-[#d96b43] text-[#f0efe6]'
                        : 'bg-[#f4f2eb] border-[#d96b43] text-[#1c1b1a]'
                      : isDarkMode
                      ? 'bg-[#252524] border-[#2d2d2c] text-[#a09c94] hover:border-[#666] hover:text-[#f0efe6]'
                      : 'bg-[#efede4] border-[#e5e3db] text-[#8c887d] hover:border-[#999] hover:text-[#1c1b1a]'
                  }`}
                >
                  {PROVIDER_LABELS[provider]}
                </button>
              ))}
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <label className={`text-xs font-semibold uppercase tracking-wide ${isDarkMode ? 'text-[#a09c94]' : 'text-[#8c887d]'}`}>
              API Key
            </label>
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={PROVIDER_PLACEHOLDERS[selectedProvider]}
                className={`flex-1 px-3 py-2 text-xs font-mono border ${
                  isDarkMode
                    ? 'bg-[#141413] border-[#2d2d2c] text-[#f0efe6] placeholder-[#666]'
                    : 'bg-[#faf9f6] border-[#e5e3db] text-[#1c1b1a] placeholder-[#999]'
                } focus:outline-none focus:border-[#d96b43]`}
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className={`absolute right-2 p-1 ${isDarkMode ? 'text-[#a09c94] hover:text-[#f0efe6]' : 'text-[#8c887d] hover:text-[#1c1b1a]'}`}
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model Name Input */}
          <div className="space-y-2">
            <label className={`text-xs font-semibold uppercase tracking-wide ${isDarkMode ? 'text-[#a09c94]' : 'text-[#8c887d]'}`}>
              Model Name
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., llama-3.1-8b-instant"
              className={`w-full px-3 py-2 text-xs border ${
                isDarkMode
                  ? 'bg-[#141413] border-[#2d2d2c] text-[#f0efe6] placeholder-[#666]'
                  : 'bg-[#faf9f6] border-[#e5e3db] text-[#1c1b1a] placeholder-[#999]'
              } focus:outline-none focus:border-[#d96b43]`}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="px-3 py-2 text-xs text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400 border border-red-200 dark:border-red-900/50">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${isDarkMode ? 'border-[#2d2d2c]' : 'border-[#e5e3db]'}`}>
          <button
            onClick={onClose}
            className={`px-3 py-1.5 text-xs font-medium border cursor-pointer ${
              isDarkMode
                ? 'bg-transparent border-[#2d2d2c] text-[#a09c94] hover:bg-[#252524]'
                : 'bg-transparent border-[#e5e3db] text-[#8c887d] hover:bg-[#f9f8f5]'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className={`px-3 py-1.5 text-xs font-medium border cursor-pointer ${
              isDarkMode
                ? 'bg-[#d96b43] border-[#d96b43] text-white hover:bg-[#c55a32]'
                : 'bg-[#d96b43] border-[#d96b43] text-white hover:bg-[#c55a32]'
            }`}
          >
            Add API
          </button>
        </div>
      </div>
    </div>
  );
};
