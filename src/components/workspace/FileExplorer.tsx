import React, { useEffect, useRef, useState } from 'react';
import {
  Folder, FolderOpen, FolderPlus, Plus, Upload, RefreshCw,
  ChevronRight, ChevronDown, ChevronLeft, Pencil, Trash2, Download,
} from 'lucide-react';
import { WorkspaceFileNode } from '../../types';
import { getFileIconMeta } from '../../utils/languageMeta';
import { getBaseName } from '../../utils/workspaceFs';

interface FileExplorerProps {
  projectName: string;
  tree: WorkspaceFileNode[];
  activePath: string;
  dirtyPaths: Set<string>;
  isRealProject: boolean;
  onOpenFile: (path: string) => void;
  onCreateFile: (parentPath: string, name: string) => void;
  onCreateFolder: (parentPath: string, name: string) => void;
  onRename: (path: string, newName: string) => void;
  onDelete: (path: string) => void;
  onDownload: (path: string) => void;
  onUploadFiles: (parentPath: string, files: File[]) => void;
  onRefresh?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

type MenuTarget = { kind: 'node'; node: WorkspaceFileNode } | { kind: 'background' };
interface MenuState { x: number; y: number; target: MenuTarget; }
interface PendingCreate { parentPath: string; type: 'file' | 'folder'; }

const menuItemClass =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#f5f3ec] dark:hover:bg-[#282826] ws-button-smooth';
const menuDangerClass =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 ws-button-smooth';

export const FileExplorer: React.FC<FileExplorerProps> = ({
  projectName,
  tree,
  activePath,
  dirtyPaths,
  isRealProject,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onDownload,
  onUploadFiles,
  onRefresh,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [createValue, setCreateValue] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef('');

  // Keep the ancestors of the active file expanded so it's always visible.
  useEffect(() => {
    if (!activePath) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      const parts = activePath.split('/');
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        next.add(cur);
      }
      return next;
    });
  }, [activePath]);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openNodeMenu = (e: React.MouseEvent, node: WorkspaceFileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'node', node } });
  };

  const openBackgroundMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'background' } });
  };

  const beginRename = (node: WorkspaceFileNode) => {
    setRenamingPath(node.path);
    setRenameValue(node.name);
    setMenu(null);
  };

  const commitRename = () => {
    if (renamingPath && renameValue.trim() && renameValue.trim() !== getBaseName(renamingPath)) {
      onRename(renamingPath, renameValue.trim());
    }
    setRenamingPath(null);
  };

  const beginCreate = (parentPath: string, type: 'file' | 'folder') => {
    if (parentPath) setExpanded((prev) => new Set(prev).add(parentPath));
    setPendingCreate({ parentPath, type });
    setCreateValue('');
    setMenu(null);
  };

  const commitCreate = () => {
    if (pendingCreate && createValue.trim()) {
      if (pendingCreate.type === 'file') onCreateFile(pendingCreate.parentPath, createValue.trim());
      else onCreateFolder(pendingCreate.parentPath, createValue.trim());
    }
    setPendingCreate(null);
  };

  const triggerUpload = (parentPath: string) => {
    uploadTargetRef.current = parentPath;
    setMenu(null);
    uploadInputRef.current?.click();
  };

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length) onUploadFiles(uploadTargetRef.current, Array.from(files));
    e.target.value = '';
  };

  const handleDeleteNode = (node: WorkspaceFileNode) => {
    setMenu(null);
    const label = node.type === 'folder' ? `the "${node.name}" folder and everything in it` : `"${node.name}"`;
    if (window.confirm(`Are you sure you want to delete ${label}?`)) onDelete(node.path);
  };

  const renderCreateRow = (parentPath: string, depth: number) => {
    if (!pendingCreate || pendingCreate.parentPath !== parentPath) return null;
    return (
      <div style={{ paddingLeft: depth * 14 + 8 }} className="flex items-center gap-1.5 pr-2 py-1">
        {pendingCreate.type === 'folder' ? (
          <Folder className="w-3.5 h-3.5 text-current opacity-70 shrink-0" />
        ) : (
          <span className="w-3.5 h-3.5 shrink-0" />
        )}
        <input
          autoFocus
          value={createValue}
          onChange={(e) => setCreateValue(e.target.value)}
          onBlur={commitCreate}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitCreate();
            if (e.key === 'Escape') setPendingCreate(null);
          }}
          placeholder={pendingCreate.type === 'folder' ? 'folder name' : 'file.ext'}
          className="flex-1 min-w-0 text-xs bg-white dark:bg-[#141413] border border-[#d96b43] px-1.5 py-0.5 outline-none text-[#1c1b1a] dark:text-[#f0efe6]"
        />
      </div>
    );
  };

  const renderNode = (node: WorkspaceFileNode, depth: number): React.ReactNode => {
    const isFolder = node.type === 'folder';
    const isOpen = expanded.has(node.path);
    const isActive = node.path === activePath;
    const isRenaming = renamingPath === node.path;
    const isDirty = dirtyPaths.has(node.path);
    const iconMeta = getFileIconMeta(node.name);
    const Icon = isFolder ? (isOpen ? FolderOpen : Folder) : iconMeta.icon;

    return (
      <div key={node.path}>
        <div
          onClick={() => (isFolder ? toggleExpand(node.path) : onOpenFile(node.path))}
          onContextMenu={(e) => openNodeMenu(e, node)}
          onDoubleClick={() => beginRename(node)}
          style={{ paddingLeft: depth * 14 + 8 }}
          className={`group w-full flex items-center justify-between pr-1.5 py-1 text-xs cursor-pointer ws-file-item ws-clickable ${
            isActive
              ? 'bg-[#eae7de] dark:bg-[#2a2a2a] text-[#1c1b1a] dark:text-[#f0efe6]'
              : 'text-[#615e56] dark:text-[#a09c94] hover:bg-[#f2f0ea] dark:hover:bg-[#2a2a2a] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
          }`}
        >
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {isFolder ? (
              isOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />
              )
            ) : (
              <span className="w-3 h-3 shrink-0" />
            )}
            <Icon className={`w-3.5 h-3.5 shrink-0 ${isFolder ? 'text-current opacity-70' : iconMeta.className}`} />
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingPath(null);
                }}
                className="flex-1 min-w-0 text-xs bg-white dark:bg-[#141413] border border-[#d96b43] px-1.5 py-0.5 outline-none text-[#1c1b1a] dark:text-[#f0efe6]"
              />
            ) : (
              <span className="truncate">{node.name}</span>
            )}
            {isDirty && !isRenaming && <span className="w-1.5 h-1.5 bg-[#d96b43] shrink-0" title="Unsaved changes" />}
          </div>

          {!isRenaming && (
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  beginRename(node);
                }}
                className="p-0.5 text-[#8c887d] hover:text-[#1c1b1a] dark:hover:text-white ws-button-smooth"
                title="Rename"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteNode(node);
                }}
                className="p-0.5 text-[#8c887d] hover:text-red-500 ws-button-smooth"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        {isFolder && isOpen && (
          <div>
            {renderCreateRow(node.path, depth + 1)}
            {(node.children || []).map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const menuX = menu ? Math.min(menu.x, window.innerWidth - 200) : 0;
  const menuY = menu ? Math.min(menu.y, window.innerHeight - 240) : 0;

  if (isCollapsed) {
    return (
      <div className="w-9 border-l border-[#e5e3db] dark:border-[#2d2d2c] flex flex-col items-center py-3 bg-[#fbfaf7] dark:bg-[#1e1e1e] shrink-0">
        <button
          onClick={onToggleCollapse}
          title="Show file explorer"
          className="p-1.5 rounded-lg text-[#8c887d] dark:text-[#a09c94] hover:bg-[#efece5] dark:hover:bg-[#2a2a2a] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-56 border-l border-[#e5e3db] dark:border-[#2d2d2c] flex flex-col bg-[#fbfaf7] dark:bg-[#1e1e1e] select-none shrink-0">
      <div className="px-3 py-2 border-b border-[#e5e3db] dark:border-[#2d2d2c] flex items-center justify-between">
        <span
          className="text-[11px] font-semibold text-[#8c887d] dark:text-[#a09c94] uppercase tracking-wide truncate"
          title={projectName}
        >
          {projectName}
        </span>
        <div className="flex items-center gap-0.5 text-[#8c887d] dark:text-[#a09c94]">
          <button onClick={() => beginCreate('', 'file')} className="p-1 hover:bg-[#efece5] dark:hover:bg-[#2a2a2a] cursor-pointer ws-button-smooth" title="New File">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => beginCreate('', 'folder')} className="p-1 hover:bg-[#efece5] dark:hover:bg-[#2a2a2a] cursor-pointer ws-button-smooth" title="New Folder">
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => triggerUpload('')} className="p-1 hover:bg-[#efece5] dark:hover:bg-[#2a2a2a] cursor-pointer ws-button-smooth" title="Upload files">
            <Upload className="w-3.5 h-3.5" />
          </button>
          {isRealProject && onRefresh && (
            <button onClick={onRefresh} className="p-1 hover:bg-[#efece5] dark:hover:bg-[#2a2a2a] cursor-pointer ws-button-smooth" title="Refresh from disk">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onToggleCollapse} className="p-1 hover:bg-[#efece5] dark:hover:bg-[#2a2a2a] cursor-pointer ws-button-smooth" title="Collapse">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1" onContextMenu={openBackgroundMenu}>
        {tree.length === 0 && !pendingCreate ? (
          <div className="px-3 py-6 text-center text-[11px] text-[#8c887d] dark:text-[#888] italic leading-relaxed">
            No files yet.
            <br />
            Right-click or use the icons above.
          </div>
        ) : (
          <>
            {renderCreateRow('', 0)}
            {tree.map((node) => renderNode(node, 0))}
          </>
        )}
      </div>

      <input ref={uploadInputRef} type="file" multiple className="hidden" onChange={handleUploadChange} />

      {menu && (() => {
        const targetNode = menu.target.kind === 'node' ? menu.target.node : null;
        return (
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menuY, left: menuX }}
            className="z-200 w-48 bg-white dark:bg-[#1e1e1d] border border-[#d8d5c9] dark:border-[#333230] shadow-lg p-1 space-y-0.5 menu-enter backdrop-blur-sm"
          >
            {!targetNode && (
              <>
                <button className={menuItemClass} onClick={() => beginCreate('', 'file')}>
                  <Plus className="w-3.5 h-3.5" /> New File
                </button>
                <button className={menuItemClass} onClick={() => beginCreate('', 'folder')}>
                  <FolderPlus className="w-3.5 h-3.5" /> New Folder
                </button>
                <button className={menuItemClass} onClick={() => triggerUpload('')}>
                  <Upload className="w-3.5 h-3.5" /> Upload Files
                </button>
                {isRealProject && onRefresh && (
                  <button className={menuItemClass} onClick={() => { onRefresh(); setMenu(null); }}>
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh from disk
                  </button>
                )}
              </>
            )}

            {targetNode && targetNode.type === 'folder' && (
              <>
                <button className={menuItemClass} onClick={() => beginCreate(targetNode.path, 'file')}>
                  <Plus className="w-3.5 h-3.5" /> New File
                </button>
                <button className={menuItemClass} onClick={() => beginCreate(targetNode.path, 'folder')}>
                  <FolderPlus className="w-3.5 h-3.5" /> New Folder
                </button>
                <button className={menuItemClass} onClick={() => triggerUpload(targetNode.path)}>
                  <Upload className="w-3.5 h-3.5" /> Upload Files Here
                </button>
                <button className={menuItemClass} onClick={() => beginRename(targetNode)}>
                  <Pencil className="w-3.5 h-3.5" /> Rename
                </button>
                <button className={menuDangerClass} onClick={() => handleDeleteNode(targetNode)}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </>
            )}

            {targetNode && targetNode.type === 'file' && (
              <>
                <button className={menuItemClass} onClick={() => beginRename(targetNode)}>
                  <Pencil className="w-3.5 h-3.5" /> Rename
                </button>
                <button
                  className={menuItemClass}
                  onClick={() => {
                    onDownload(targetNode.path);
                    setMenu(null);
                  }}
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button className={menuDangerClass} onClick={() => handleDeleteNode(targetNode)}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
};
