import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Plus, Folder, ArrowLeft, Save, AlertCircle, CheckCircle2, X, Loader2,
  Download, WrapText, RefreshCw, Eye, EyeOff, RotateCw, ExternalLink,
} from 'lucide-react';
import JSZip from 'jszip';
import ReactMarkdown from 'react-markdown';
import Logo from './Logo';
import { CodeEditor } from './workspace/CodeEditor';
import { FileExplorer } from './workspace/FileExplorer';
import { AgentPanel } from './workspace/AgentPanel';
import { AgentFileOp, WorkspaceFileNode, WorkspaceTab } from '../types';
import {
  upsertFile, upsertFolder, removeNode, renameNode, updateNode, findNode,
  listFiles, generateUniquePath, joinPath, isDescendantOrSelf, getBaseName,
} from '../utils/workspaceFs';
import {
  isDirectoryPickerSupported, pickDirectory, scanDirectoryTree, readRealFile,
  writeRealFile, writeRealBlob, createRealFolder, deleteRealEntry, isTextLikeFile,
  projectPathReservationKey, reserveUniqueProjectPath,
} from '../utils/realFs';
import { getLanguageName, isLikelyBinary, getFileIconMeta } from '../utils/languageMeta';
import { buildPreviewDocument, getPreviewKind, buildReactPreview, isReactProject } from '../utils/webPreview';
import { buildSandboxedPreviewDocument } from '../security/previewIsolation';
import { useFlag } from '../features/flags';

export { buildSandboxedPreviewDocument } from '../security/previewIsolation';

const ProfessionalAgentWorkspace = React.lazy(() =>
  import('./agent-workspace/AgentWorkspace').then((module) => ({
    default: module.AgentWorkspace,
  }))
);

interface CodeWorkspaceProps {
  isDarkMode: boolean;
}

const VIRTUAL_STORAGE_KEY = 'sourbot_workspace_virtual_v1';

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const createProjectId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

type MarkdownImageProps = React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

function isRemoteImageSource(src: string | undefined): boolean {
  if (!src) return false;
  try {
    const base = typeof window === 'undefined' ? 'https://sour.invalid/' : window.location.href;
    const url = new URL(src, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return typeof window === 'undefined' || url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** Remote Markdown images stay inert until the user explicitly loads them. */
export const WorkspaceMarkdownImage: React.FC<MarkdownImageProps> = ({
  node: _node,
  src,
  alt,
  ...props
}) => {
  const [allowed, setAllowed] = useState(false);
  if (!src) return null;
  if (!isRemoteImageSource(src) || allowed) {
    return <img {...props} src={src} alt={alt ?? ''} referrerPolicy="no-referrer" />;
  }

  let host = 'remote host';
  try {
    host = new URL(src, window.location.href).host || host;
  } catch {
    // Keep the generic label for malformed URLs.
  }
  return (
    <button
      type="button"
      onClick={() => setAllowed(true)}
      className="my-2 rounded border border-[#d8d5c9] px-3 py-2 text-xs text-[#706c62] dark:border-[#383836] dark:text-[#a09d98]"
    >
      Load remote image from {host}
      {alt ? ` (${alt})` : ''}
    </button>
  );
};

/**
 * Active project content is never inserted into the app DOM. An empty sandbox
 * creates an opaque origin and disables scripts, forms, popups, and navigation.
 * The document-level CSP also blocks passive requests such as CSS backgrounds,
 * SVG images, fonts, and media, which a sandbox alone does not prevent.
 */
export const SandboxedPreviewFrame: React.FC<{
  source: string;
  title: string;
  className?: string;
}> = ({ source, title, className }) => (
  <iframe
    srcDoc={buildSandboxedPreviewDocument(source)}
    sandbox=""
    referrerPolicy="no-referrer"
    className={className}
    title={title}
  />
);

/**
 * Opens the exact same CSP-restricted preview document in a separate tab.
 * The delayed revoke gives the new tab time to consume the temporary URL.
 */
export function openSafePreviewInNewTab(source: string): void {
  const blob = new Blob([buildSandboxedPreviewDocument(source)], {
    type: 'text/html;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Open safe preview in new tab');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function getRenameBlockReason(
  tree: WorkspaceFileNode[],
  path: string,
  newName: string
): string | null {
  const node = findNode(tree, path);
  const trimmed = newName.trim();
  if (!node) return 'The item no longer exists.';
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\/\\\0]/.test(trimmed)) {
    return 'Names cannot be empty, dot segments, or contain path separators.';
  }

  const slash = path.lastIndexOf('/');
  const parentPath = slash >= 0 ? path.slice(0, slash) : '';
  const newPath = joinPath(parentPath, trimmed);
  if (newPath.toLocaleLowerCase() === path.toLocaleLowerCase()) return 'Choose a different name.';
  if (node.type === 'folder' && isDescendantOrSelf(newPath, path)) {
    return 'A folder cannot be moved inside itself.';
  }
  const siblings = parentPath
    ? findNode(tree, parentPath)?.children ?? []
    : tree;
  if (siblings.some((sibling) => sibling.path.toLocaleLowerCase() === newPath.toLocaleLowerCase())) {
    return `An item already exists at "${newPath}".`;
  }
  return null;
}

const SaveStatusIndicator: React.FC<{ status: SaveStatus }> = ({ status }) => {
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-[#8c887d] dark:text-[#a09c94]">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-red-500">
        <AlertCircle className="w-3 h-3" /> Save failed
      </span>
    );
  }
  if (status === 'unsaved') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-[#8c887d] dark:text-[#a09c94]">
        <Save className="w-3 h-3" /> Unsaved
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-500">
      <CheckCircle2 className="w-3 h-3" /> Saved
    </span>
  );
};

export const CodeWorkspace: React.FC<CodeWorkspaceProps> = ({ isDarkMode }) => {
  const clientAgentEnabled =
    useFlag('clientAgentRuntime') && typeof globalThis.Worker === 'function';
  const [activeProject, setActiveProject] = useState<{ id: string; name: string; isReal: boolean } | null>(null);
  const [tree, setTree] = useState<WorkspaceFileNode[]>([]);
  const [openTabs, setOpenTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState('');
  const [wordWrap, setWordWrap] = useState(false);
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1, selectionLength: 0 });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [isAgentCollapsed, setIsAgentCollapsed] = useState(false);
  const [agentView, setAgentView] = useState<'chat' | 'advanced'>('chat');
  const [isFileExplorerCollapsed, setIsFileExplorerCollapsed] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [truncatedNotice, setTruncatedNotice] = useState(false);
  // Preview is scoped per open file tab (not a single global toggle) so
  // multiple different files can each have their own preview "stacked"
  // independently without one global preview stomping on another.
  const [previewOpenPaths, setPreviewOpenPaths] = useState<Set<string>>(new Set());
  const [previewNonce, setPreviewNonce] = useState(0);

  const rootDirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  // Keyed by file path so autosaving one file never cancels another's pending save (e.g. after switching tabs).
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastManualSaveRef = useRef(0);

  const [hasSavedVirtualProject] = useState(() => {
    try {
      return Boolean(localStorage.getItem(VIRTUAL_STORAGE_KEY));
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!activeProject || activeProject.isReal) return;
    try {
      localStorage.setItem(
        VIRTUAL_STORAGE_KEY,
        JSON.stringify({ id: activeProject.id, name: activeProject.name, tree, openTabs, activeTabPath })
      );
    } catch {
      /* storage full/unavailable - not critical */
    }
  }, [activeProject, tree, openTabs, activeTabPath]);

  const allFiles = useMemo(() => listFiles(tree), [tree]);
  const activeNode = useMemo(() => findNode(tree, activeTabPath), [tree, activeTabPath]);
  const dirtyPaths = useMemo(() => new Set(openTabs.filter((t) => t.isDirty).map((t) => t.path)), [openTabs]);
  // Preview is strictly per active tab: only show the preview button when the
  // currently open file is itself a previewable type (HTML, Markdown, SVG).
  // For HTML files in React projects, use the React bundler instead of plain inlining.
  const previewKind = useMemo(() => {
    if (!activeNode || activeNode.type !== 'file') return null;
    return getPreviewKind(activeNode.name);
  }, [activeNode]);
  const htmlEntry = previewKind ? activeNode ?? null : null;
  const isReactPreview = previewKind === 'html' && isReactProject(allFiles);
  // Whether *this specific file tab* currently has its preview toggled on.
  const showPreview = Boolean(activeTabPath && previewOpenPaths.has(activeTabPath));
  const togglePreviewForActiveTab = () => {
    if (!activeTabPath) return;
    setPreviewOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(activeTabPath)) next.delete(activeTabPath);
      else next.add(activeTabPath);
      return next;
    });
  };
  const previewDoc = useMemo(() => {
    if (!showPreview || !htmlEntry) return '';
    try {
      if (isReactPreview) {
        return buildReactPreview(tree, htmlEntry);
      }
      if (previewKind === 'html') {
        return buildPreviewDocument(tree, htmlEntry);
      }
      return '';
    } catch (err) {
      console.error('Failed to build preview document', err);
      return '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, htmlEntry, isReactPreview, previewKind, tree, previewNonce]);

  // ---------------------------------------------------------------------
  // Project lifecycle
  // ---------------------------------------------------------------------

  const handleNewEmptyWorkspace = () => {
    rootDirHandleRef.current = null;
    setActiveProject({ id: createProjectId(), name: 'Untitled Project', isReal: false });
    setTree(upsertFile([], 'untitled.txt', ''));
    setOpenTabs([{ path: 'untitled.txt', isDirty: false }]);
    setActiveTabPath('untitled.txt');
  };

  const handleOpenLocalDirectory = async () => {
    const dirHandle = await pickDirectory();
    if (!dirHandle) return;
    setIsScanning(true);
    try {
      const { nodes, truncated } = await scanDirectoryTree(dirHandle);
      if (nodes.length === 0) {
        alert('That folder appears to be empty.');
        return;
      }
      rootDirHandleRef.current = dirHandle;
      setActiveProject({ id: createProjectId(), name: dirHandle.name, isReal: true });
      setTree(nodes);
      setOpenTabs([]);
      setActiveTabPath('');
      setTruncatedNotice(truncated);
    } catch (err) {
      console.error('Failed to read directory', err);
      alert('Could not read that folder. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleRefreshProject = async () => {
    if (!activeProject?.isReal || !rootDirHandleRef.current) return;
    setIsScanning(true);
    try {
      const { nodes, truncated } = await scanDirectoryTree(rootDirHandleRef.current);
      setTree(nodes);
      setTruncatedNotice(truncated);
      setOpenTabs((prev) => prev.filter((t) => findNode(nodes, t.path)));
      if (activeTabPath && !findNode(nodes, activeTabPath)) setActiveTabPath('');
    } catch (err) {
      console.error('Failed to refresh directory', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRestoreVirtualProject = () => {
    try {
      const raw = localStorage.getItem(VIRTUAL_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      rootDirHandleRef.current = null;
      setActiveProject({
        id: typeof saved.id === 'string' && saved.id ? saved.id : createProjectId(),
        name: saved.name || 'Untitled Project',
        isReal: false,
      });
      setTree(saved.tree || []);
      setOpenTabs(saved.openTabs || []);
      setActiveTabPath(saved.activeTabPath || '');
    } catch (err) {
      console.error('Failed to restore previous session', err);
    }
  };

  // ---------------------------------------------------------------------
  // File I/O
  // ---------------------------------------------------------------------

  const openFile = async (path: string) => {
    const node = findNode(tree, path);
    if (!node || node.type !== 'file') return;
    setOpenTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, isDirty: false }]));
    setActiveTabPath(path);

    if (!node.isLoaded && rootDirHandleRef.current && !isLikelyBinary(path)) {
      try {
        const content = await readRealFile(rootDirHandleRef.current, path);
        setTree((prev) => updateNode(prev, path, { content, isLoaded: true }));
      } catch (err) {
        console.error('Failed to read file', path, err);
        setTree((prev) => updateNode(prev, path, { content: '', isLoaded: true }));
      }
    }
  };

  const persistFile = async (path: string, content: string) => {
    try {
      if (activeProject?.isReal && rootDirHandleRef.current) {
        await writeRealFile(rootDirHandleRef.current, path, content);
      }
      setOpenTabs((prev) => prev.map((t) => (t.path === path ? { ...t, isDirty: false } : t)));
      setSaveStatus('saved');
    } catch (err) {
      console.error('Failed to save file', path, err);
      setSaveStatus('error');
    }
  };

  const handleEditorChange = (value: string) => {
    const path = activeTabPath;
    if (!path) return;
    setTree((prev) => updateNode(prev, path, { content: value }));
    setOpenTabs((prev) => prev.map((t) => (t.path === path ? { ...t, isDirty: true } : t)));
    setSaveStatus('saving');
    if (saveTimersRef.current[path]) clearTimeout(saveTimersRef.current[path]);
    saveTimersRef.current[path] = setTimeout(() => {
      delete saveTimersRef.current[path];
      persistFile(path, value);
    }, 700);
  };

  const handleManualSave = () => {
    const now = Date.now();
    if (now - lastManualSaveRef.current < 150) return;
    lastManualSaveRef.current = now;
    if (!activeTabPath) return;
    if (saveTimersRef.current[activeTabPath]) {
      clearTimeout(saveTimersRef.current[activeTabPath]);
      delete saveTimersRef.current[activeTabPath];
    }
    const node = findNode(tree, activeTabPath);
    if (node) persistFile(activeTabPath, node.content ?? '');
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && activeProject) {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabPath, tree, activeProject]);

  // ---------------------------------------------------------------------
  // Explorer actions
  // ---------------------------------------------------------------------

  const handleCreateFile = async (parentPath: string, name: string) => {
    const path = generateUniquePath(tree, joinPath(parentPath, name));
    setTree((prev) => upsertFile(prev, path, ''));
    setOpenTabs((prev) => [...prev, { path, isDirty: false }]);
    setActiveTabPath(path);
    if (activeProject?.isReal && rootDirHandleRef.current) {
      try {
        await writeRealFile(rootDirHandleRef.current, path, '');
      } catch (err) {
        console.error('Failed to create file on disk', err);
      }
    }
  };

  const handleCreateFolder = async (parentPath: string, name: string) => {
    const path = generateUniquePath(tree, joinPath(parentPath, name));
    setTree((prev) => upsertFolder(prev, path));
    if (activeProject?.isReal && rootDirHandleRef.current) {
      try {
        await createRealFolder(rootDirHandleRef.current, path);
      } catch (err) {
        console.error('Failed to create folder on disk', err);
      }
    }
  };

  const handleRename = async (path: string, newName: string) => {
    const node = findNode(tree, path);
    if (!node) return;
    const blocked = getRenameBlockReason(tree, path, newName);
    if (blocked) {
      alert(blocked);
      return;
    }
    if (activeProject?.isReal && rootDirHandleRef.current) {
      alert(
        'Renaming items in a real folder is temporarily disabled until safe, conflict-checked filesystem transactions are available.'
      );
      return;
    }

    const { tree: nextTree, newPath } = renameNode(tree, path, newName.trim());
    setTree(nextTree);
    setOpenTabs((prev) =>
      prev.map((t) => (isDescendantOrSelf(t.path, path) ? { ...t, path: newPath + t.path.slice(path.length) } : t))
    );
    setActiveTabPath((prev) => (isDescendantOrSelf(prev, path) ? newPath + prev.slice(path.length) : prev));
  };

  const handleDelete = async (path: string) => {
    const node = findNode(tree, path);
    if (!node) return;

    if (activeProject?.isReal && rootDirHandleRef.current) {
      try {
        await deleteRealEntry(rootDirHandleRef.current, path, node.type === 'folder');
      } catch (err) {
        console.error('Failed to delete on disk', err);
      }
    }

    setTree((prev) => removeNode(prev, path));

    const remainingTabs = openTabs.filter((t) => !isDescendantOrSelf(t.path, path));
    setOpenTabs(remainingTabs);
    if (isDescendantOrSelf(activeTabPath, path)) {
      setActiveTabPath(remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].path : '');
    }
  };

  const handleCloseTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = openTabs.find((t) => t.path === path);
    if (tab?.isDirty && !window.confirm(`"${getBaseName(path)}" has unsaved changes. Close anyway?`)) return;

    const remaining = openTabs.filter((t) => t.path !== path);
    setOpenTabs(remaining);
    if (activeTabPath === path) {
      setActiveTabPath(remaining.length > 0 ? remaining[remaining.length - 1].path : '');
    }
    setPreviewOpenPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  };

  const handleDownloadFile = (path: string) => {
    const node = findNode(tree, path);
    if (!node || node.type !== 'file') return;
    const blob = new Blob([node.content ?? ''], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = node.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadProject = async () => {
    const zip = new JSZip();
    for (const f of allFiles) {
      let content = f.content;
      if (content === undefined) {
        if (isLikelyBinary(f.path)) continue;
        if (activeProject?.isReal && rootDirHandleRef.current) {
          try {
            content = await readRealFile(rootDirHandleRef.current, f.path);
          } catch {
            content = '';
          }
        } else {
          content = '';
        }
      }
      zip.file(f.path, content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeProject?.name || 'project'}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadFiles = async (parentPath: string, files: File[]) => {
    const reservedUploadKeys = new Set<string>();
    const reserveExistingNodes = (nodes: WorkspaceFileNode[]) => {
      for (const node of nodes) {
        reservedUploadKeys.add(projectPathReservationKey(node.path));
        if (node.children) reserveExistingNodes(node.children);
      }
    };
    reserveExistingNodes(tree);
    for (const file of files) {
      const path = reserveUniqueProjectPath(
        joinPath(parentPath, file.name),
        reservedUploadKeys
      );
      if (activeProject?.isReal && rootDirHandleRef.current) {
        try {
          await writeRealBlob(rootDirHandleRef.current, path, file);
          if (isTextLikeFile(file)) {
            const content = await file.text();
            setTree((prev) => upsertFile(prev, path, content));
          } else {
            setTree((prev) =>
              upsertFile(prev, path, '', { content: undefined, isLoaded: false })
            );
          }
        } catch (err) {
          console.error('Failed to upload file to disk', err);
        }
        continue;
      }

      if (!isTextLikeFile(file)) {
        alert(
          `"${file.name}" is binary. Browser-native binary project storage arrives with the OPFS migration; the file was not imported.`
        );
        continue;
      }
      const content = await file.text();
      setTree((prev) => upsertFile(prev, path, content));
    }
  };

  // ---------------------------------------------------------------------
  // Agent integration
  // ---------------------------------------------------------------------

  /**
   * Adopts the result of an approved, already-applied agent transaction.
   *
   * The reviewer has committed the change to its authoritative workspace copy
   * and hands back the complete file set, so this rebuilds the tree from that
   * rather than replaying operations that could drift from what was applied.
   */
  const handleAgentApplied = async (
    appliedFiles: readonly { readonly path: string; readonly content: string }[],
    changedPaths: readonly string[]
  ): Promise<void> => {
    const byPath = new Map(appliedFiles.map((file) => [file.path, file]));
    let next = tree;
    for (const path of changedPaths) {
      const file = byPath.get(path);
      if (file) {
        const existing = findNode(next, path);
        next =
          existing && existing.type === 'file'
            ? updateNode(next, path, { content: file.content, isLoaded: true })
            : upsertFile(next, path, file.content);
      } else if (findNode(next, path)) {
        next = removeNode(next, path);
      } else {
        next = upsertFolder(next, path);
      }
    }

    if (activeProject && !activeProject.isReal) {
      localStorage.setItem(
        VIRTUAL_STORAGE_KEY,
        JSON.stringify({ id: activeProject.id, name: activeProject.name, tree: next, openTabs, activeTabPath })
      );
    }
    setTree(next);

    const written = changedPaths.filter((path) => appliedFiles.some((file) => file.path === path));
    if (written.length > 0) {
      setOpenTabs((previous) => {
        const have = new Set(previous.map((tab) => tab.path));
        return [
          ...previous,
          ...written.filter((path) => !have.has(path)).map((path) => ({ path, isDirty: false })),
        ];
      });
      setActiveTabPath(written[written.length - 1]);
    }
    const removed = new Set(changedPaths.filter((path) => !appliedFiles.some((f) => f.path === path)));
    if (removed.size > 0) {
      setOpenTabs((previous) => previous.filter((tab) => !removed.has(tab.path)));
      setActiveTabPath((current) => (removed.has(current) ? '' : current));
    }

  };

  const handleOpenAgentFile = (path: string) => {
    if (!findNode(tree, path)) return;
    setOpenTabs((previous) =>
      previous.some((tab) => tab.path === path) ? previous : [...previous, { path, isDirty: false }]
    );
    setActiveTabPath(path);
  };

  const handleLegacyAgentOps = async (ops: AgentFileOp[]): Promise<boolean> => {
    if (activeProject?.isReal) {
      return false;
    }
    for (const op of ops) {
      const current = findNode(tree, op.path);
      if (
        op.originalContent !== undefined &&
        (current
          ? current.type !== 'file' || (current.content ?? '') !== op.originalContent
          : op.originalContent !== '')
      ) {
        return false;
      }
    }

    let next = tree;
    for (const op of ops) {
      next =
        op.type === 'delete'
          ? removeNode(next, op.path)
          : upsertFile(next, op.path, op.content ?? '');
    }
    setTree(next);

    const writes = ops.filter((op) => op.type === 'write');
    const deleted = new Set(ops.filter((op) => op.type === 'delete').map((op) => op.path));
    setOpenTabs((current) => {
      const remaining = current.filter((tab) => !deleted.has(tab.path));
      const have = new Set(remaining.map((tab) => tab.path));
      return [
        ...remaining,
        ...writes
          .filter((op) => !have.has(op.path))
          .map((op) => ({ path: op.path, isDirty: false })),
      ];
    });
    if (writes.length > 0) setActiveTabPath(writes[writes.length - 1].path);
    else if (deleted.has(activeTabPath)) setActiveTabPath('');
    return true;
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  if (!activeProject) {
    return (
      <div className={`flex-1 h-full flex flex-col overflow-hidden relative ${isDarkMode ? 'bg-[#181817] text-[#f0efe6]' : 'bg-[#faf9f6] text-[#1c1b1a]'}`}>
        <div className="flex-1 flex flex-col items-center justify-center p-6 select-none relative">
          <div className="flex flex-col items-center text-center max-w-lg w-full">
            <div className="flex items-center justify-center gap-3.5 mb-8">
              <Logo size={42} />
              <div className="text-left">
                <h1 className="text-xl font-medium tracking-tight font-instrument text-[#1c1b1a] dark:text-[#f0efe6]">
                  Welcome back to sour.ai
                </h1>
                <p className="text-xs text-[#78746a] dark:text-[#a09c94] font-medium tracking-wide font-sans">
                  The workspace for what's next
                </p>
              </div>
            </div>

            <div className="w-full border-t border-[#e5e3db] dark:border-[#2d2d2c] pt-4 text-left">
              <span className="text-[10px] font-bold text-[#8c887d] dark:text-[#888] tracking-wider uppercase block mb-2.5 text-left">
                Get Started
              </span>

              <div className="space-y-1 w-full text-left">
                <button
                  onClick={handleNewEmptyWorkspace}
                  className="w-full flex items-center justify-between text-xs px-3 py-1.5 text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#efede4] dark:hover:bg-[#232322] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] group cursor-pointer text-left blurry-hover"
                >
                  <span className="flex items-center gap-2.5">
                    <Plus className="w-3.5 h-3.5 text-[#8c887d] dark:text-[#888]" />
                    <span>New File</span>
                  </span>
                  <span className="text-[10px] text-[#8c887d] dark:text-[#888] font-mono group-hover:text-[#1c1b1a] dark:group-hover:text-white transition-colors">⌥N</span>
                </button>

                <button
                  onClick={handleOpenLocalDirectory}
                  disabled={!isDirectoryPickerSupported() || isScanning}
                  title={isDirectoryPickerSupported() ? undefined : 'Opening real folders needs a Chromium-based browser (Chrome or Edge).'}
                  className="w-full flex items-center justify-between text-xs px-3 py-1.5 text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#efede4] dark:hover:bg-[#232322] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] group cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent blurry-hover"
                >
                  <span className="flex items-center gap-2.5">
                    <Folder className="w-3.5 h-3.5 text-[#8c887d] dark:text-[#888]" />
                    <span>{isScanning ? 'Opening…' : 'Open Project'}</span>
                  </span>
                  <span className="text-[10px] text-[#8c887d] dark:text-[#888] font-mono group-hover:text-[#1c1b1a] dark:group-hover:text-white transition-colors">⌥O</span>
                </button>

                {hasSavedVirtualProject && (
                  <button
                    onClick={handleRestoreVirtualProject}
                    className="w-full flex items-center justify-between text-xs px-3 py-1.5 text-[#3d3a33] dark:text-[#dedcd6] hover:bg-[#efede4] dark:hover:bg-[#232322] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] group cursor-pointer text-left blurry-hover"
                  >
                    <span className="flex items-center gap-2.5">
                      <RefreshCw className="w-3.5 h-3.5 text-[#8c887d] dark:text-[#888]" />
                      <span>Continue Previous Session</span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 h-full flex flex-col overflow-hidden relative ${isDarkMode ? 'bg-[#181817] text-[#f0efe6]' : 'bg-[#faf9f6] text-[#1c1b1a]'}`}>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="h-9 border-b border-[#e5e3db] dark:border-[#2d2d2c] flex items-center justify-between px-3 select-none bg-[#f4f2eb] dark:bg-[#1a1a19] shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveProject(null)}
              className="flex items-center gap-1.5 text-[11px] text-[#78746a] dark:text-[#a09c94] hover:text-[#1c1b1a] dark:hover:text-white font-medium cursor-pointer blurry-hover"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Exit Workspace</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <SaveStatusIndicator status={saveStatus} />
            <button
              onClick={handleDownloadProject}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border border-[#e5e3db] dark:border-[#2d2d2c] hover:bg-[#ede9df] dark:hover:bg-[#242423] text-[#1c1b1a] dark:text-[#f0efe6] cursor-pointer ws-toolbar-btn"
              title="Download the whole project as a .zip"
            >
              <Download className="w-3 h-3" />
              <span>Download Project</span>
            </button>
            <button
              onClick={() => activeTabPath && handleDownloadFile(activeTabPath)}
              disabled={!activeTabPath}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border border-[#e5e3db] dark:border-[#2d2d2c] hover:bg-[#ede9df] dark:hover:bg-[#242423] text-[#1c1b1a] dark:text-[#f0efe6] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ws-toolbar-btn"
              title="Export active file code"
            >
              <span>Export Code</span>
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <motion.div
            initial={false}
            animate={{ width: isAgentCollapsed ? 36 : agentView === 'advanced' ? 440 : 288 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="overflow-hidden relative"
          >
            {agentView === 'advanced' && clientAgentEnabled ? (
              <>
                <button
                  type="button"
                  onClick={() => setAgentView('chat')}
                  className="absolute right-2 top-2 z-30 rounded border border-[#e5e3db] bg-[#fbfaf7] px-2 py-1 text-[10px] text-[#78746a] hover:text-[#1c1b1a] dark:border-[#333230] dark:bg-[#1e1e1e] dark:text-[#a09c94] dark:hover:text-white"
                >
                  Back to chat
                </button>
              <React.Suspense fallback={<div className="h-full border-r p-3 text-xs">Loading agent runtime…</div>}>
                <ProfessionalAgentWorkspace
                  key={activeProject.id}
                  projectId={activeProject.id}
                  projectName={activeProject.name}
                  files={allFiles}
                  activeFile={activeNode && activeNode.type === 'file' ? { path: activeNode.path, content: activeNode.content ?? '' } : null}
                  isDarkMode={isDarkMode}
                  onApplyChanges={activeProject.isReal ? undefined : handleAgentApplied}
                  onOpenFile={handleOpenAgentFile}
                />
              </React.Suspense>
              </>
            ) : agentView === 'advanced' ? (
              <aside
                aria-label="Client agent unavailable"
                className="h-full border-r border-[#e5e3db] p-3 text-xs dark:border-[#2d2d2c]"
              >
                The client-only agent needs Web Worker support and cannot fall back to a server API.
              </aside>
            ) : (
              <AgentPanel
                key={activeProject.id}
                isDarkMode={isDarkMode}
                isCollapsed={isAgentCollapsed}
                onToggleCollapse={() => setIsAgentCollapsed((value) => !value)}
                projectId={activeProject.id}
                projectName={activeProject.name}
                files={allFiles}
                activeFile={
                  activeNode && activeNode.type === 'file'
                    ? { path: activeNode.path, content: activeNode.content ?? '' }
                    : null
                }
                onApplyOps={handleLegacyAgentOps}
                onOpenFile={openFile}
              />
            )}
          </motion.div>

          <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-[#1e1e1e] min-w-0">
            <div className="h-9 border-b border-[#e5e3db] dark:border-[#2d2d2c] bg-[#f7f6f2] dark:bg-[#1e1e1e] flex items-stretch select-none shrink-0">
              <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
                {openTabs.map((tab) => {
                  const node = findNode(tree, tab.path);
                  if (!node) return null;
                  const { icon: TabIcon, className: tabIconClass } = getFileIconMeta(node.name);
                  const isActive = tab.path === activeTabPath;
                  return (
                    <button
                      key={tab.path}
                      onClick={() => setActiveTabPath(tab.path)}
                      title={tab.path}
                      className={`h-full pl-3 pr-2 text-xs flex items-center gap-1.5 cursor-pointer shrink-0 group border-r border-[#e5e3db] dark:border-[#2d2d2c] ws-tab ${
                        isActive
                          ? 'bg-white dark:bg-[#1e1e1e] text-[#1c1b1a] dark:text-[#f0efe6] font-medium'
                          : 'text-[#8c887d] dark:text-[#a09c94] hover:bg-[#efede4] dark:hover:bg-[#2a2a2a] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
                      }`}
                    >
                      <TabIcon className={`w-3.5 h-3.5 shrink-0 ${tabIconClass}`} />
                      <span className="truncate max-w-35">{node.name}</span>
                      {tab.isDirty ? (
                        <span className="w-1.5 h-1.5 bg-[#d96b43] shrink-0" />
                      ) : (
                        <X
                          onClick={(e) => handleCloseTab(tab.path, e)}
                          className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              {previewKind && (
                <button
                  onClick={togglePreviewForActiveTab}
                  title="Toggle live preview for this file"
                  className={`flex items-center gap-1.5 px-3 text-[11px] font-medium border-l border-[#e5e3db] dark:border-[#2d2d2c] shrink-0 cursor-pointer ws-toolbar-btn ${
                    showPreview
                      ? 'bg-white dark:bg-[#1e1e1e] text-[#d96b43]'
                      : 'text-[#8c887d] dark:text-[#a09c94] hover:bg-[#efede4] dark:hover:bg-[#2a2a2a] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]'
                  }`}
                >
                  {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  Preview
                </button>
              )}
            </div>

            <div className="flex-1 flex overflow-hidden">
              <div className={`flex flex-col overflow-hidden ${showPreview && htmlEntry ? 'w-1/2 border-r border-[#e5e3db] dark:border-[#2d2d2c]' : 'flex-1'}`}>
                {activeNode && activeNode.type === 'file' ? (
                  isLikelyBinary(activeNode.path) ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-[#8c887d] dark:text-[#a09c94] p-6 text-center">
                      <AlertCircle className="w-6 h-6" />
                      <span>Preview isn't available for this file type.</span>
                      <button
                        onClick={() => handleDownloadFile(activeNode.path)}
                        className="text-xs px-3 py-1.5 bg-[#f4f2eb] dark:bg-[#252524] border border-[#e5e3db] dark:border-[#2d2d2c] hover:bg-[#ede9df] dark:hover:bg-[#30302e] cursor-pointer"
                      >
                        Download file
                      </button>
                    </div>
                  ) : !activeNode.isLoaded ? (
                    <div className="flex-1 flex items-center justify-center gap-2 text-sm text-[#8c887d] dark:text-[#a09c94]">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading file…
                    </div>
                  ) : (
                    <div className="flex-1 overflow-hidden">
                      <CodeEditor
                        path={activeNode.path}
                        value={activeNode.content ?? ''}
                        isDarkMode={isDarkMode}
                        wordWrap={wordWrap}
                        onChange={handleEditorChange}
                        onSave={handleManualSave}
                        onCursorChange={setCursorInfo}
                      />
                    </div>
                  )
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-[#8c887d] dark:text-[#a09c94]">
                    Select a file to start editing
                  </div>
                )}
              </div>

              {showPreview && htmlEntry && (
                <div className="w-1/2 flex flex-col overflow-hidden preview-panel-enter">
                  <div className="h-7 border-b border-[#e5e3db] dark:border-[#2d2d2c] bg-[#f7f6f2] dark:bg-[#1e1e1e] flex items-center justify-between px-2.5 text-[10px] text-[#8c887d] dark:text-[#a09c94] shrink-0">
                    <span className="truncate">Preview: {htmlEntry.path}</span>
                    <div className="flex items-center gap-2.5">
                      <button onClick={() => setPreviewNonce((n) => n + 1)} title="Refresh preview" className="cursor-pointer hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] blurry-hover">
                        <RotateCw className="w-3 h-3" />
                      </button>
                      {(previewKind === 'html' || previewKind === 'svg') && (
                        <button
                          onClick={() =>
                            openSafePreviewInNewTab(
                              previewKind === 'svg' ? htmlEntry.content || '' : previewDoc
                            )
                          }
                          title="Open safe preview in new tab"
                          aria-label="Open safe preview in new tab"
                          className="cursor-pointer hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                      {previewKind === 'html' && (
                        <button
                          onClick={() => {
                            const blob = new Blob([previewDoc], { type: 'text/plain;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = `${getBaseName(htmlEntry.path)}.source.txt`;
                            link.rel = 'noopener noreferrer';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);
                          }}
                          title="Download preview source as text"
                          className="cursor-pointer hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {previewKind === 'html' && (
                    <SandboxedPreviewFrame
                      key={previewNonce}
                      source={previewDoc}
                      className="flex-1 w-full bg-white border-0"
                      title="Safe HTML preview (scripts disabled)"
                    />
                  )}
                  {previewKind === 'markdown' && (
                    <div key={previewNonce} className="flex-1 w-full overflow-y-auto bg-white dark:bg-[#141413] px-5 py-4 text-sm leading-relaxed text-[#1c1b1a] dark:text-[#f0efe6] space-y-2">
                      <ReactMarkdown components={{ img: WorkspaceMarkdownImage }}>
                        {htmlEntry.content || ''}
                      </ReactMarkdown>
                    </div>
                  )}
                  {previewKind === 'svg' && (
                    <SandboxedPreviewFrame
                      key={previewNonce}
                      source={htmlEntry.content || ''}
                      className="flex-1 w-full bg-white border-0"
                      title="Safe SVG preview (scripts disabled)"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="h-6 border-t border-[#e5e3db] dark:border-[#2d2d2c] bg-white dark:bg-[#1e1e1e] flex items-center justify-between px-3 text-[10px] text-[#8c887d] dark:text-[#a09c94] shrink-0">
              <div className="flex items-center gap-3">
                {truncatedNotice && <span title="Some files were hidden to keep the explorer fast">Large project — some files hidden</span>}
              </div>
              <div className="flex items-center gap-4">
                {activeNode && activeNode.type === 'file' && !isLikelyBinary(activeNode.path) && (
                  <>
                    <span>
                      Ln {cursorInfo.line}, Col {cursorInfo.col}
                      {cursorInfo.selectionLength > 0 ? ` (${cursorInfo.selectionLength} selected)` : ''}
                    </span>
                    <button
                      onClick={() => setWordWrap((v) => !v)}
                      className={`flex items-center gap-1 cursor-pointer hover:text-[#1c1b1a] dark:hover:text-[#f0efe6] ${wordWrap ? 'text-[#d96b43]' : ''}`}
                      title="Toggle word wrap"
                    >
                      <WrapText className="w-3 h-3" /> Wrap
                    </button>
                    <span>Spaces: 2</span>
                    <span>UTF-8</span>
                    <span>{getLanguageName(activeNode.path)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <motion.div
            initial={false}
            animate={{ width: isFileExplorerCollapsed ? 36 : 224 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="overflow-hidden"
          >
            <FileExplorer
              projectName={activeProject.name}
              tree={tree}
              activePath={activeTabPath}
              dirtyPaths={dirtyPaths}
              isRealProject={activeProject.isReal}
              onOpenFile={openFile}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onRename={handleRename}
              onDelete={handleDelete}
              onDownload={handleDownloadFile}
              onUploadFiles={handleUploadFiles}
              onRefresh={activeProject.isReal ? handleRefreshProject : undefined}
              isCollapsed={isFileExplorerCollapsed}
              onToggleCollapse={() => setIsFileExplorerCollapsed((v) => !v)}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
};
