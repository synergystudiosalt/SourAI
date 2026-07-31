import React, { useEffect, useRef, useState } from 'react';
import {
  Folder, FolderOpen, FolderPlus, Plus, Upload, RefreshCw,
  ChevronRight, ChevronDown, ChevronLeft, Pencil, Trash2, Download,
} from 'lucide-react';
import { WorkspaceFileNode } from '../../types';
import { getFileIconMeta } from '../../utils/languageMeta';
import { getBaseName, getParentPath, isDescendantOrSelf } from '../../utils/workspaceFs';

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
  onMoveNode: (sourcePath: string, targetFolderPath: string) => void;
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
interface PointerDragCandidate {
  path: string;
  pointerId: number;
  startX: number;
  startY: number;
  captureElement: HTMLElement;
}

const DRAG_START_DISTANCE = 5;
const TREE_INDENT = 14;
const TREE_BASE_PADDING = 8;

/**
 * Dragging left of a nested row means "outdent" even though the pointer still
 * hits that row's full-width box. The returned path is the shallower ancestor
 * folder, or the empty string for the project root.
 */
function getHorizontalOutdentTarget(
  sourcePath: string,
  clientX: number,
  explorerLeft: number
): string | null {
  const parentParts = getParentPath(sourcePath).split('/').filter(Boolean);
  if (parentParts.length === 0) return null;

  const relativeX = Math.max(0, clientX - explorerLeft - TREE_BASE_PADDING);
  const requestedParentDepth = Math.floor(relativeX / TREE_INDENT);
  if (requestedParentDepth >= parentParts.length) return null;
  return parentParts.slice(0, requestedParentDepth).join('/');
}

const menuItemClass =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer text-[#3b414d] dark:text-[#dfe3ea] hover:bg-[#f6f8fa] dark:hover:bg-[#1e2128] ws-button-smooth';
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
  onMoveNode,
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
  // Pointer events are used instead of native HTML5 drag-and-drop. Native drag
  // hit-testing is unreliable inside the zoomed workspace, while pointer
  // coordinates and document.elementFromPoint describe the painted UI.
  const pointerCandidateRef = useRef<PointerDragCandidate | null>(null);
  const dragPathRef = useRef<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const dragHoverTimerRef = useRef<number | null>(null);
  const dragHoverPathRef = useRef<string | null>(null);
  const suppressNextClickRef = useRef(false);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => () => {
    if (dragHoverTimerRef.current !== null) window.clearTimeout(dragHoverTimerRef.current);
  }, []);

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

  const clearFolderHover = () => {
    if (dragHoverTimerRef.current !== null) window.clearTimeout(dragHoverTimerRef.current);
    dragHoverTimerRef.current = null;
    dragHoverPathRef.current = null;
  };

  const setPointerDropTarget = (target: string | null) => {
    if (dropTargetRef.current === target) return;
    dropTargetRef.current = target;
    setDropTarget(target);
  };

  const canMoveTo = (sourcePath: string, targetFolderPath: string) =>
    sourcePath !== targetFolderPath &&
    getParentPath(sourcePath) !== targetFolderPath &&
    !isDescendantOrSelf(targetFolderPath, sourcePath);

  const queueFolderExpand = (folderPath: string | null) => {
    if (folderPath === dragHoverPathRef.current) return;
    clearFolderHover();
    if (!folderPath || expanded.has(folderPath)) return;

    dragHoverPathRef.current = folderPath;
    dragHoverTimerRef.current = window.setTimeout(() => {
      setExpanded((prev) => new Set(prev).add(folderPath));
      dragHoverTimerRef.current = null;
    }, 550);
  };

  const updatePointerDropTarget = (
    clientX: number,
    clientY: number,
    fallbackTarget: EventTarget | null
  ) => {
    const sourcePath = dragPathRef.current;
    const explorer = explorerRef.current;
    if (!sourcePath || !explorer) return;

    const pointTarget = document.elementFromPoint?.(clientX, clientY);
    const hit = pointTarget instanceof Element
      ? pointTarget
      : fallbackTarget instanceof Element
        ? fallbackTarget
        : null;

    if (!hit || !explorer.contains(hit)) {
      queueFolderExpand(null);
      setPointerDropTarget(null);
      return;
    }

    const outdentTarget = getHorizontalOutdentTarget(
      sourcePath,
      clientX,
      explorer.getBoundingClientRect().left
    );
    if (outdentTarget !== null && canMoveTo(sourcePath, outdentTarget)) {
      queueFolderExpand(null);
      setPointerDropTarget(outdentTarget);
      return;
    }

    const row = hit.closest<HTMLElement>('[data-explorer-row]');
    const hoveredFolderPath = row?.dataset.nodeType === 'folder'
      ? row.dataset.path || null
      : null;
    const targetFolderPath = row
      ? hoveredFolderPath ?? getParentPath(row.dataset.path || '')
      : '';

    if (!canMoveTo(sourcePath, targetFolderPath)) {
      queueFolderExpand(null);
      setPointerDropTarget(null);
      return;
    }

    queueFolderExpand(hoveredFolderPath);
    setPointerDropTarget(targetFolderPath);
  };

  const finishPointerDrag = () => {
    const candidate = pointerCandidateRef.current;
    if (candidate) {
      try {
        if (candidate.captureElement.hasPointerCapture?.(candidate.pointerId)) {
          candidate.captureElement.releasePointerCapture(candidate.pointerId);
        }
      } catch {
        // The browser may already have released capture during pointercancel.
      }
    }
    clearFolderHover();
    pointerCandidateRef.current = null;
    dragPathRef.current = null;
    dropTargetRef.current = null;
    setDragPath(null);
    setDropTarget(null);
  };

  const handleRowPointerDown = (e: React.PointerEvent<HTMLDivElement>, path: string) => {
    // If the prior drag did not synthesize a click, this is a genuinely new
    // gesture and its eventual click must be allowed through.
    suppressNextClickRef.current = false;
    if (!e.isPrimary || e.button !== 0) return;
    if ((e.target as Element).closest('button, input, textarea, select, a')) return;

    pointerCandidateRef.current = {
      path,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      captureElement: e.currentTarget,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleRowPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const candidate = pointerCandidateRef.current;
    if (!candidate || candidate.pointerId !== e.pointerId) return;

    if (!dragPathRef.current) {
      const distance = Math.hypot(e.clientX - candidate.startX, e.clientY - candidate.startY);
      if (distance < DRAG_START_DISTANCE) return;
      dragPathRef.current = candidate.path;
      setDragPath(candidate.path);
      setMenu(null);
    }

    e.preventDefault();
    updatePointerDropTarget(e.clientX, e.clientY, e.target);
  };

  const handleRowPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const candidate = pointerCandidateRef.current;
    if (!candidate || candidate.pointerId !== e.pointerId) return;

    const sourcePath = dragPathRef.current;
    if (sourcePath) {
      updatePointerDropTarget(e.clientX, e.clientY, e.target);
      const targetFolderPath = dropTargetRef.current;
      if (targetFolderPath !== null && canMoveTo(sourcePath, targetFolderPath)) {
        if (targetFolderPath) {
          setExpanded((prev) => new Set(prev).add(targetFolderPath));
        }
        onMoveNode(sourcePath, targetFolderPath);
      }

      // Some browsers synthesize click well after pointerup. Keep the guard
      // until that click arrives; a genuinely new pointerdown clears it above.
      suppressNextClickRef.current = true;
    }
    finishPointerDrag();
  };

  const renderCreateRow = (parentPath: string, depth: number) => {
    if (!pendingCreate || pendingCreate.parentPath !== parentPath) return null;
    return (
      <div style={{ paddingLeft: depth * TREE_INDENT + TREE_BASE_PADDING }} className="flex items-center gap-1.5 pr-2 py-1">
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
          className="flex-1 min-w-0 text-xs bg-white dark:bg-[#131314] border border-[#4776d5] px-1.5 py-0.5 outline-none text-[#16181d] dark:text-[#dce0e5]"
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
          data-explorer-row
          data-path={node.path}
          data-node-type={node.type}
          data-depth={depth}
          onPointerDown={(e) => handleRowPointerDown(e, node.path)}
          onClick={(e) => {
            if (suppressNextClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
              suppressNextClickRef.current = false;
              return;
            }
            if (isFolder) toggleExpand(node.path);
            else onOpenFile(node.path);
          }}
          onContextMenu={(e) => openNodeMenu(e, node)}
          onDoubleClick={() => beginRename(node)}
          style={{
            paddingLeft: depth * TREE_INDENT + TREE_BASE_PADDING,
            '--file-drop-indent': `${(depth + 1) * TREE_INDENT + TREE_BASE_PADDING}px`,
          } as React.CSSProperties}
          className={`group relative w-full flex items-center justify-between pr-1.5 py-1 text-xs ws-file-item ws-clickable ${dragPath ? 'cursor-grabbing' : 'cursor-pointer'} ${dragPath === node.path ? 'opacity-40' : ''} ${isFolder && dropTarget === node.path ? 'ws-file-drop-target' : ''} ${
            isActive
              ? 'bg-[#dde7f7] dark:bg-[#1b2338] text-[#16181d] dark:text-[#dce0e5]'
              : 'text-[#4a5259] dark:text-[#a9afbc] hover:bg-[#e8effb] dark:hover:bg-[#1b2338] hover:text-[#16181d] dark:hover:text-[#dce0e5]'
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
                className="flex-1 min-w-0 text-xs bg-white dark:bg-[#131314] border border-[#4776d5] px-1.5 py-0.5 outline-none text-[#16181d] dark:text-[#dce0e5]"
              />
            ) : (
              <span className="truncate">{node.name}</span>
            )}
            {isDirty && !isRenaming && <span className="w-1.5 h-1.5 bg-[#4776d5] shrink-0" title="Unsaved changes" />}
          </div>

          {!isRenaming && (
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  beginRename(node);
                }}
                className="p-0.5 text-[#78828e] hover:text-[#16181d] dark:hover:text-white ws-button-smooth"
                title="Rename"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteNode(node);
                }}
                className="p-0.5 text-[#78828e] hover:text-red-500 ws-button-smooth"
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

  // The panel is drawn inside a zoomed subtree, and a position:fixed child of a
  // zoomed element has its coordinates scaled by that zoom — so the menu drifts
  // further off-screen the further right it is opened. Dividing the factor back
  // out keeps it in the viewport. Both edges are clamped, since the old
  // single-sided Math.min could still push it off the top-left.
  const ZOOM = 1.04;
  const clampAxis = (value: number, max: number) =>
    Math.max(8, Math.min(value / ZOOM, max));
  const menuX = menu ? clampAxis(menu.x, window.innerWidth / ZOOM - 208) : 0;
  const menuY = menu ? clampAxis(menu.y, window.innerHeight / ZOOM - 248) : 0;

  if (isCollapsed) {
    return (
      <div className="zed-file-explorer w-9 border-l border-[#dfe3ea] dark:border-[#282c33] flex flex-col items-center py-3 bg-[#fbfcfd] dark:bg-[#1e2128] shrink-0">
        <button
          onClick={onToggleCollapse}
          title="Show file explorer"
          className="p-1.5 rounded-lg text-[#78828e] dark:text-[#a9afbc] hover:bg-[#e8effb] dark:hover:bg-[#1b2338] hover:text-[#16181d] dark:hover:text-[#dce0e5] cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={explorerRef}
      onPointerMove={handleRowPointerMove}
      onPointerUp={handleRowPointerUp}
      onPointerCancel={finishPointerDrag}
      className="zed-file-explorer z-grid z-grid-fine w-56 h-full border-l border-[#dfe3ea] dark:border-[#282c33] flex flex-col bg-[#fbfcfd] dark:bg-[#1e2128] select-none shrink-0">
      <div className="zed-panel-bar px-3 py-2 border-b border-[#dfe3ea] dark:border-[#282c33] flex items-center justify-between">
        <span
          className="text-[11px] font-semibold text-[#78828e] dark:text-[#a9afbc] uppercase tracking-wide truncate"
          title={projectName}
        >
          {projectName}
        </span>
        <div className="flex items-center gap-0.5 text-[#78828e] dark:text-[#a9afbc]">
          <button onClick={() => beginCreate('', 'file')} className="p-1 hover:bg-[#e8effb] dark:hover:bg-[#1b2338] cursor-pointer ws-button-smooth" title="New File">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => beginCreate('', 'folder')} className="p-1 hover:bg-[#e8effb] dark:hover:bg-[#1b2338] cursor-pointer ws-button-smooth" title="New Folder">
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => triggerUpload('')} className="p-1 hover:bg-[#e8effb] dark:hover:bg-[#1b2338] cursor-pointer ws-button-smooth" title="Upload files">
            <Upload className="w-3.5 h-3.5" />
          </button>
          {isRealProject && onRefresh && (
            <button onClick={onRefresh} className="p-1 hover:bg-[#e8effb] dark:hover:bg-[#1b2338] cursor-pointer ws-button-smooth" title="Refresh from disk">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onToggleCollapse} className="p-1 hover:bg-[#e8effb] dark:hover:bg-[#1b2338] cursor-pointer ws-button-smooth" title="Collapse">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        data-explorer-tree
        className={`relative flex-1 overflow-y-auto py-1 ${dropTarget === '' ? 'ws-file-root-drop-target' : ''}`}
        onContextMenu={openBackgroundMenu}
      >
        {tree.length === 0 && !pendingCreate ? (
          <div className="px-3 py-6 text-center text-[11px] text-[#78828e] dark:text-[#888] italic leading-relaxed">
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
            className="z-200 w-48 bg-white dark:bg-[#1e2128] border border-[#c3cad6] dark:border-[#3b414d] shadow-lg p-1 space-y-0.5 menu-enter backdrop-blur-sm"
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
