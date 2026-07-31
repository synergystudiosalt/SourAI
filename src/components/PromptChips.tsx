import React from 'react';
import { Pencil, GraduationCap, Code, Coffee, Lightbulb } from 'lucide-react';
import { motion } from 'motion/react';

interface PromptChipsProps {
  onSelectPrompt: (promptText: string) => void;
}

interface ChipItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  prompt: string;
}

const CHIPS: ChipItem[] = [
  {
    id: 'write',
    label: 'Write',
    icon: <Pencil className="w-3 h-3 text-[#4a5259] dark:text-[#a9afbc]" />,
    prompt: 'Help me draft a concise, engaging blog post about modern AI interface design trends.',
  },
  {
    id: 'learn',
    label: 'Learn',
    icon: <GraduationCap className="w-3 h-3 text-[#4a5259] dark:text-[#a9afbc]" />,
    prompt: 'Explain how vector embeddings and semantic search work in machine learning.',
  },
  {
    id: 'code',
    label: 'Code',
    icon: <Code className="w-3 h-3 text-[#4a5259] dark:text-[#a9afbc]" />,
    prompt: 'Write a clean TypeScript function that parses and validates JSON with Zod.',
  },
  {
    id: 'lifestuff',
    label: 'Life stuff',
    icon: <Coffee className="w-3 h-3 text-[#4a5259] dark:text-[#a9afbc]" />,
    prompt: 'Give me 3 realistic, high-impact strategies to organize a busy daily schedule.',
  },
  {
    id: 'sourschoice',
    label: "Sour's choice",
    icon: <Lightbulb className="w-3 h-3 text-[#4776d5]" />,
    prompt: 'Surprise me with a fascinating visual thought experiment or puzzle!',
  },
];

export const PromptChips: React.FC<PromptChipsProps> = ({ onSelectPrompt }) => {
  return (
    <motion.div
      initial={{ opacity: 0, filter: 'blur(8px)', y: 6 }}
      animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
      transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
      className="flex flex-wrap items-center justify-center gap-1.5 mt-3.5 max-w-[580px] px-2 select-none"
    >
      {CHIPS.map((chip) => (
        <button
          key={chip.id}
          onClick={() => onSelectPrompt(chip.prompt)}
          className="bg-white dark:bg-[#17191d] hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] border border-[#dfe3ea] dark:border-[#282c33] text-[#3b414d] dark:text-[#dfe3ea] text-[11px] font-medium px-3 py-1 rounded-full shadow-2xs hover:shadow-xs cursor-pointer flex items-center gap-1.5 hover:border-[#bdc0c5] dark:hover:border-[#444] blurry-hover"
        >
          {chip.icon}
          <span>{chip.label}</span>
        </button>
      ))}
    </motion.div>
  );
};

