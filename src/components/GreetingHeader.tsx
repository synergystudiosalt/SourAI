import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import Logo from './Logo';

interface GreetingHeaderProps {
  customGreeting?: string;
}

export const GreetingHeader: React.FC<GreetingHeaderProps> = ({ customGreeting }) => {
  const [greetingText, setGreetingText] = useState('night owl');

  useEffect(() => {
    if (customGreeting) {
      setGreetingText(customGreeting);
      return;
    }

    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      setGreetingText('early bird');
    } else if (hour >= 12 && hour < 17) {
      setGreetingText('day dreamer');
    } else if (hour >= 17 && hour < 22) {
      setGreetingText('night owl');
    } else {
      setGreetingText('night owl');
    }
  }, [customGreeting]);

  return (
    <motion.div
      initial={{ opacity: 0, filter: 'blur(8px)', scale: 0.96 }}
      animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex items-center justify-center gap-2.5 my-4 select-none"
    >
      <Logo size={32} />

      {/* Main Title Heading in Instrument Serif */}
      <h1 className="font-instrument text-3xl sm:text-4xl font-normal tracking-tight text-[#1c1b1a] dark:text-[#f0efe6] leading-none">
        Hello, {greetingText}
      </h1>
    </motion.div>
  );
};

