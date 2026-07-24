import React, { useEffect, useRef, useState } from 'react';
import { Copy, Scissors, Clipboard, TextSelect, RotateCw, Moon, Sun } from 'lucide-react';

interface GlobalContextMenuProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

interface MenuState {
  x: number;
  y: number;
}

const itemClass =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#f5f3ec] dark:hover:bg-[#282826] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';

/**
 * A single custom right-click menu mounted once at the app root. It only
 * takes over the native context menu when nothing more specific already
 * has (file tree rows, the code editor's own gutter menu, etc. call
 * `preventDefault()` themselves, which this component detects and defers
 * to by doing nothing).
 */
export const GlobalContextMenu: React.FC<GlobalContextMenuProps> = ({ isDarkMode, onToggleTheme }) => {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return; // a more specific menu already handled this
      e.preventDefault();
      const x = Math.min(e.clientX, window.innerWidth - 190);
      const y = Math.min(e.clientY, window.innerHeight - 200);
      setMenu({ x, y });
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setMenu(null);
        return;
      }
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', () => setMenu(null), true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  if (!menu) return null;

  const run = (fn: () => void) => {
    fn();
    setMenu(null);
  };

  const selectionText = window.getSelection?.()?.toString() || '';

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', top: menu.y, left: menu.x }}
      className="z-[300] w-44 bg-white/95 dark:bg-[#1e1e1d]/95 backdrop-blur-md border border-[#d8d5c9] dark:border-[#333230] rounded-xl shadow-xl p-1 space-y-0.5 animate-in fade-in zoom-in-95 duration-150"
    >
      <button
        className={itemClass}
        disabled={!selectionText}
        onClick={() => run(() => navigator.clipboard?.writeText(selectionText))}
      >
        <Copy className="w-3.5 h-3.5" /> Copy
      </button>
      <button
        className={itemClass}
        disabled={!selectionText}
        onClick={() => run(() => document.execCommand('cut'))}
      >
        <Scissors className="w-3.5 h-3.5" /> Cut
      </button>
      <button
        className={itemClass}
        onClick={() =>
          run(async () => {
            try {
              const clip = await navigator.clipboard?.readText();
              if (clip) document.execCommand('insertText', false, clip);
            } catch {
              /* clipboard read denied - ignore */
            }
          })
        }
      >
        <Clipboard className="w-3.5 h-3.5" /> Paste
      </button>
      <button className={itemClass} onClick={() => run(() => document.execCommand('selectAll'))}>
        <TextSelect className="w-3.5 h-3.5" /> Select All
      </button>
      <div className="h-px bg-[#e5e3db] dark:bg-[#2d2d2c] my-1" />
      <button className={itemClass} onClick={() => run(onToggleTheme)}>
        {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        {isDarkMode ? 'Light mode' : 'Dark mode'}
      </button>
      <button className={itemClass} onClick={() => run(() => window.location.reload())}>
        <RotateCw className="w-3.5 h-3.5" /> Reload sour.ai
      </button>
    </div>
  );
};

export default GlobalContextMenu;
