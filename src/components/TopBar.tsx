import React from 'react';

interface TopBarProps {}

export const TopBar: React.FC<TopBarProps> = () => {
  return (
    <div className="w-full h-10 md:h-12 px-3 md:px-5 flex items-center justify-between z-10 shrink-0 select-none bg-[#fbfcfd] dark:bg-[#17191d] border-b border-[#e8e7e1] dark:border-[#282c33]">
      {/* Spacer */}
      <div className="flex-1"></div>
    </div>
  );
};

