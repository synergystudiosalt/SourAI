import React, { useState } from 'react';
import { motion } from 'motion/react';

interface QuestionBoxProps {
  question: string;
  options: string[];
  onSelect: (option: string) => void;
}

export const QuestionBox: React.FC<QuestionBoxProps> = ({ question, options, onSelect }) => {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (option: string) => {
    if (selected) return;
    setSelected(option);
    onSelect(option);
  };

  return (
    <div className="my-4 border border-[#e2dec0] dark:border-[#383836] bg-[#faf9f5] dark:bg-[#1a1a19]">
      <div className="px-4 py-3 border-b border-[#e2dec0] dark:border-[#383836] bg-[#f4f2eb] dark:bg-[#222221]">
        <p className="text-[13px] font-medium text-[#1c1b1a] dark:text-[#f0efe6] leading-relaxed">
          {question}
        </p>
      </div>
      <div className="divide-y divide-[#e2dec0] dark:divide-[#383836]">
        {options.map((option, idx) => {
          const isSelected = selected === option;
          return (
            <motion.button
              key={idx}
              onClick={() => handleSelect(option)}
              disabled={selected !== null && !isSelected}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`w-full text-left px-4 py-2.5 text-[12.5px] leading-relaxed transition-colors
                ${isSelected
                  ? 'bg-[#d96b43]/10 text-[#d96b43] font-medium'
                  : selected
                    ? 'text-[#a09a8e] dark:text-[#6b6a66] cursor-default'
                    : 'text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#eeebe3] dark:hover:bg-[#282826] cursor-pointer'
                }`}
            >
              <span className="flex items-center gap-2.5">
                <span className={`w-4 h-4 flex items-center justify-center border text-[10px] font-mono
                  ${isSelected
                    ? 'border-[#d96b43] bg-[#d96b43] text-white'
                    : selected
                      ? 'border-[#d4cfc4] dark:border-[#4a4a48] text-[#a09a8e] dark:text-[#6b6a66]'
                      : 'border-[#d4cfc4] dark:border-[#4a4a48] text-[#8c887d] dark:text-[#a09c94]'
                  }`}
                >
                  {isSelected ? '✓' : String.fromCharCode(65 + idx)}
                </span>
                {option}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export function extractQuestionBlocks(text: string): {
  cleanText: string;
  questions: Array<{ question: string; options: string[] }>;
} {
  const regex = /\[QUESTION:\s*([^\]]+)\]/g;
  const questions: Array<{ question: string; options: string[] }> = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const parts = match[1].split('|').map(s => s.trim());
    const question = parts[0];
    const options = parts.slice(1).filter(Boolean);
    if (question && options.length >= 2) {
      questions.push({ question, options });
    }
  }

  const cleanText = text.replace(regex, '').trim();
  return { cleanText, questions };
}