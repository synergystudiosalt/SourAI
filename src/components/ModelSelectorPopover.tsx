import React from 'react';
import { AIModel, ModelOption } from '../types';
import { Check } from 'lucide-react';

interface ModelSelectorPopoverProps {
  selectedModel: AIModel;
  onSelectModel: (model: AIModel) => void;
  onClose: () => void;
  onOpenUpgrade?: () => void;
  positionClass?: string;
}

const MODELS: ModelOption[] = [
  {
    id: 'sour-omni-flash',
    name: 'Sour Omni-Flash 1.0',
    badge: 'Fast',
    description: 'Ultra-fast multimodal reasoning for everyday tasks.',
  },
  {
    id: 'sour-intelligence',
    name: 'Sour Intelligence 1.5',
    badge: 'Smart',
    description: 'Deep analytical reasoning and structured problem solving.',
  },
  {
    id: 'sour-ultra',
    name: 'Sour Ultra 1.2',
    badge: 'Pro',
    description: 'Advanced capabilities for heavy architecture & coding.',
  },
  {
    id: 'sour-overclock',
    name: 'Sour Overclock 2.0',
    badge: 'Turbo',
    description: 'Maximum speed and peak performance generation.',
  },
];

export const ModelSelectorPopover: React.FC<ModelSelectorPopoverProps> = ({
  selectedModel,
  onSelectModel,
  onClose,
  positionClass = 'top-full mt-2 left-1/2 -translate-x-1/2',
}) => {
  return (
    <div className={`absolute ${positionClass} w-60 bg-white/95 dark:bg-[#1e1e1d]/95 backdrop-blur-md border border-[#e5e3db] dark:border-[#2d2d2c] rounded-2xl shadow-xl p-1.5 z-[100] animate-in fade-in zoom-in-95 duration-150`}>
      <div className="space-y-0.5">
        {MODELS.map((model) => {
          const isSelected = selectedModel === model.id;
          return (
            <button
              key={model.id}
              type="button"
              onClick={() => {
                onSelectModel(model.id);
                onClose();
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left cursor-pointer blurry-hover ${
                isSelected
                  ? 'bg-[#f4f2eb] dark:bg-[#282826] text-[#1c1b1a] dark:text-[#f0efe6]'
                  : 'text-[#42403a] dark:text-[#c4c1b9] hover:bg-[#f8f7f2] dark:hover:bg-[#232322]'
              }`}
            >
              <div className="flex-1 pr-2 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-xs text-[#1c1b1a] dark:text-[#f0efe6] truncate">
                    {model.name}
                  </span>
                  {model.badge && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded-md font-medium bg-[#e8e6df] dark:bg-[#2d2d2c] text-[#636056] dark:text-[#a09c94] shrink-0">
                      {model.badge}
                    </span>
                  )}
                </div>
              </div>

              {isSelected && (
                <Check className="w-3.5 h-3.5 text-[#3b82f6] dark:text-[#60a5fa] shrink-0 ml-1" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
