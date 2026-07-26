import React from 'react';

interface TopBarProps {}

export const TopBar: React.FC<TopBarProps> = () => {
  return (
    <div className="w-full h-10 md:h-12 px-3 md:px-5 flex items-center justify-between z-10 shrink-0 select-none bg-[#faf9f6] dark:bg-[#181817] border-b border-[#e8e7e1] dark:border-[#2d2d2c]">
      {/* Spacer */}
      <div className="flex-1"></div>
    </div>
  );
};

