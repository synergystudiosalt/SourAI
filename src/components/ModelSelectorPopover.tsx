import React from 'react';
import { AIModel, ModelOption } from '../types';
import { Check } from 'lucide-react';
import { MODEL_IDS, MODEL_ROUTES } from '../../functions/shared/ai';

interface ModelSelectorPopoverProps {
  selectedModel: AIModel;
  onSelectModel: (model: AIModel) => void;
  onClose: () => void;
  onOpenUpgrade?: () => void;
  positionClass?: string;
}

const MODELS: ModelOption[] = MODEL_IDS.map((id) => {
  const route = MODEL_ROUTES[id];
  return {
    id,
    name: route.label,
    description: `Powered by ${route.model}.`,
  };
});

export const ModelSelectorPopover: React.FC<ModelSelectorPopoverProps> = ({
  selectedModel,
  onSelectModel,
  onClose,
  positionClass = 'top-full mt-2 left-1/2 -translate-x-1/2',
}) => {
  return (
    <div className={`absolute ${positionClass} w-60 bg-white/95 dark:bg-[#1e2128]/95 backdrop-blur-md border border-[#dfe3ea] dark:border-[#282c33] rounded-2xl shadow-xl p-1.5 z-[100] animate-in fade-in zoom-in-95 duration-150`}>
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
                  ? 'bg-[#f6f8fa] dark:bg-[#1e2128] text-[#16181d] dark:text-[#dce0e5]'
                  : 'text-[#3b3d41] dark:text-[#babdc3] hover:bg-[#f2f4f8] dark:hover:bg-[#222223]'
              }`}
            >
              <div className="flex-1 pr-2 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-xs text-[#16181d] dark:text-[#dce0e5] truncate">
                    {model.name}
                  </span>
                  {model.badge && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded-md font-medium bg-[#dfe2e8] dark:bg-[#282c33] text-[#585b61] dark:text-[#a9afbc] shrink-0">
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
