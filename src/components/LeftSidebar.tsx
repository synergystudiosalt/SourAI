import React, { useState } from 'react';
import { PanelLeft, Plus, MessageSquare, Code, Search, Sun, Moon, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Conversation } from '../types';
import Logo from './Logo';
import { MESSAGE_QUOTA } from '../utils/constants';

interface LeftSidebarProps {
  onNewChat: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenUpgrade: () => void;
  messageUnitsUsed: number;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  activeView: 'chat' | 'code';
  onViewChange: (view: 'chat' | 'code') => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  onNewChat,
  conversations,
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  onOpenUpgrade,
  messageUnitsUsed,
  isDarkMode,
  onToggleTheme,
  activeView,
  onViewChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredConversations = conversations.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      {/* Narrow Leftmost Icon Bar - Hidden on very small screens, visible on sm and up */}
      <div className="hidden sm:flex w-[46px] h-screen bg-[#fbfcfd] dark:bg-[#17191d] border-r border-[#e8e7e1] dark:border-[#282c33] flex-col items-center justify-between py-3 z-30 shrink-0 select-none">
        {/* Top Icons */}
        <div className="flex flex-col items-center gap-2.5">
          {/* Sidebar Toggle */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title="Toggle Sidebar"
            className={`p-1.5 rounded-lg cursor-pointer interactable-btn transition-colors ${
              isExpanded ? 'bg-[#eeebe3] dark:bg-[#282c33] text-[#16181d] dark:text-[#dce0e5]' : 'text-[#4a5259] dark:text-[#a3a099] hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5]'
            }`}
          >
            <PanelLeft className="w-[17px] h-[17px]" />
          </button>

          {/* New Chat Icon */}
          <button
            onClick={() => {
              onViewChange('chat');
              onNewChat();
            }}
            title="New Chat"
            className="p-1.5 rounded-lg text-[#4a5259] dark:text-[#a3a099] hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5] cursor-pointer interactable-btn transition-colors"
          >
            <Plus className="w-[17px] h-[17px]" />
          </button>

          {/* Search/Recents Chat Icon */}
          <button
            onClick={() => {
              onViewChange('chat');
              setIsExpanded(true);
            }}
            title="Chat Sessions"
            className={`p-1.5 rounded-lg cursor-pointer interactable-btn transition-colors ${
              activeView === 'chat' ? 'bg-[#eeebe3] dark:bg-[#282c33] text-[#16181d] dark:text-[#dce0e5]' : 'text-[#4a5259] dark:text-[#a3a099] hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128]'
            }`}
          >
            <MessageSquare className="w-[17px] h-[17px]" />
          </button>

          {/* AI IDE Icon */}
          <button
            onClick={() => {
              onViewChange('code');
              setIsExpanded(false);
            }}
            title="sour.ai IDE"
            className={`p-1.5 rounded-lg cursor-pointer interactable-btn transition-colors ${
              activeView === 'code' ? 'bg-[#eeebe3] dark:bg-[#282c33] text-[#16181d] dark:text-[#dce0e5]' : 'text-[#4a5259] dark:text-[#a3a099] hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128]'
            }`}
          >
            <Code className="w-[17px] h-[17px]" />
          </button>
        </div>

        {/* Bottom Theme Toggle */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onToggleTheme}
            title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            className="w-6 h-6 rounded-full bg-[#eeebe3] dark:bg-[#282c33] hover:bg-[#e4e0d5] dark:hover:bg-[#3b414d] text-[#16181d] dark:text-[#dce0e5] flex items-center justify-center cursor-pointer interactable-btn transition-colors"
          >
            {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer - Full width on mobile, positioned on desktop */}
      <AnimatePresence>
        {isExpanded && (
          <div className="fixed inset-0 z-40 flex">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/10 transition-opacity"
              onClick={() => setIsExpanded(false)}
            />

            {/* Drawer Content */}
            <motion.div
              initial={{ x: -20, opacity: 0, filter: 'blur(6px)' }}
              animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
              exit={{ x: -20, opacity: 0, filter: 'blur(6px)' }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="relative left-0 sm:left-[46px] w-full sm:w-[260px] h-screen bg-[#fbfcfd] dark:bg-[#17191d] border-r border-[#e8e7e1] dark:border-[#282c33] text-[#16181d] dark:text-[#dce0e5] flex flex-col z-50 shadow-xl"
            >
              {/* Header */}
              <div className="p-3 md:p-4 border-b border-[#e8e7e1] dark:border-[#282c33] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Logo size={20} />
                  <span className="font-instrument text-base md:text-lg font-normal text-[#16181d] dark:text-[#dce0e5]">sour.ai</span>
                  <span className="text-[8px] md:text-[9px] font-medium bg-[#e8e6df] dark:bg-[#282c33] text-[#524f47] dark:text-[#b0adab] px-1.5 py-0.5 rounded">v4.5</span>
                </div>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-1 rounded-md text-[#4a5259] dark:text-[#a9afbc] hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5] cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* New Chat Button */}
              {activeView === 'chat' && (
                <div className="p-2 md:p-2.5">
                  <button
                    onClick={() => {
                      onNewChat();
                      setIsExpanded(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 bg-[#f0ede4] dark:bg-[#1e2128] hover:bg-[#e8e4d8] dark:hover:bg-[#30302e] text-[#16181d] dark:text-[#dce0e5] px-2.5 py-1.5 rounded-lg text-xs md:text-xs font-medium cursor-pointer interactable-btn transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5 text-[#524f47] dark:text-[#b0adab]" />
                      New conversation
                    </span>
                  </button>
                </div>
              )}

              {/* Search Box */}
              {activeView === 'chat' && (
                <div className="px-2 md:px-2.5 pb-2">
                  <div className="relative flex items-center">
                    <Search className="w-3 h-3 text-[#78828e] dark:text-[#888] absolute left-2.5" />
                    <input
                      type="text"
                      placeholder="Search chats..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#f2f0ea] dark:bg-[#222221] border border-[#e4e1d7] dark:border-[#333] rounded-md pl-7 pr-2.5 py-1 text-xs md:text-xs text-[#16181d] dark:text-[#dce0e5] placeholder-[#78828e] dark:placeholder-[#888] outline-none focus:border-[#b8b4a8] transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* Conversations List */}
              {activeView === 'chat' && (
                <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
                  <div className="px-2 py-1 text-[10px] md:text-[10px] font-semibold text-[#78828e] dark:text-[#888] tracking-wider uppercase">
                    Recent Chats
                  </div>
                  {filteredConversations.length === 0 ? (
                    <div className="p-3 text-center text-[11px] md:text-[11px] text-[#78828e] dark:text-[#888] italic">
                      No previous conversations found
                    </div>
                  ) : (
                    filteredConversations.map((chat) => (
                      <div
                        key={chat.id}
                        className={`group flex items-center justify-between px-2 py-1.5 rounded-md text-xs md:text-xs cursor-pointer transition-colors ${
                          chat.id === activeConversationId
                            ? 'bg-[#eae7de] dark:bg-[#282c33] font-medium text-[#16181d] dark:text-[#dce0e5]'
                            : 'text-[#524f47] dark:text-[#b0adab] hover:bg-[#f2f0ea] dark:hover:bg-[#222221] hover:text-[#16181d] dark:hover:text-[#dce0e5]'
                        }`}
                        onClick={() => {
                          onSelectConversation(chat.id);
                          setIsExpanded(false);
                        }}
                      >
                        <span className="truncate pr-1 text-[11px] md:text-[11px]">{chat.title}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConversation(chat.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-[#78828e] dark:text-[#888] hover:text-red-600 transition-opacity cursor-pointer"
                          title="Delete chat"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="p-2 md:p-2.5 border-t border-[#e8e7e1] dark:border-[#282c33] flex flex-col gap-1 bg-[#fbfcfd] dark:bg-[#17191d]">
                <div className="text-[10px] md:text-[10px] text-[#4a5259] dark:text-[#a9afbc] px-1 font-medium flex items-center justify-between">
                  <span>Usage allowance</span>
                  <span className="font-semibold text-[#16181d] dark:text-[#dce0e5]">{Math.max(0, MESSAGE_QUOTA - messageUnitsUsed)}/{MESSAGE_QUOTA} left</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
