export type AIModel = 'sour-omni-flash' | 'sour-intelligence' | 'sour-ultra' | 'sour-overclock';

export interface AttachmentItem {
  id: string;
  name: string;
  type: string; // 'image', 'pdf', 'docx', 'file', 'code', or mimeType
  dataUrl?: string; // base64 for images
  content?: string; // text content for documents/code
  size?: number;
  pageImages?: string[]; // rendered PDF page images
  type_schema?: {
    type: 'image_url';
    image_url: {
      url: string;
    };
  };
}

export interface ModelOption {
  id: AIModel;
  name: string;
  badge?: string;
  description: string;
  isPro?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  attachments?: AttachmentItem[];
  model?: AIModel;
  thinking?: string;
  thinkingLabel?: string;
  images?: Array<{ prompt: string; url: string }>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
}

export interface PromptCategory {
  id: string;
  icon: string;
  label: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Agent tool calls
// ---------------------------------------------------------------------------

export type AgentToolCall =
  | { type: 'readfile'; path: string; found: boolean }
  | { type: 'findall'; query: string; matchCount: number; fileCount: number; matches: { path: string; line: number; text: string }[] };

// ---------------------------------------------------------------------------
// Workspace / IDE types
// ---------------------------------------------------------------------------

export type WorkspaceNodeType = 'file' | 'folder';

export interface WorkspaceFileNode {
  /** Stable identifier, equal to `path`. */
  id: string;
  name: string;
  /** Forward-slash relative path from the project root, e.g. `src/App.tsx`. */
  path: string;
  type: WorkspaceNodeType;
  /** File contents. `undefined` means "not loaded yet" for real on-disk projects. */
  content?: string;
  /** Whether `content` reflects the real file (always true for virtual projects). */
  isLoaded?: boolean;
  /** Present (possibly empty) for folders. */
  children?: WorkspaceFileNode[];
}

export interface WorkspaceTab {
  path: string;
  isDirty: boolean;
}

/** A single file mutation proposed/applied by the sour.ai Agent. */
export interface AgentFileOp {
  type: 'write' | 'delete';
  path: string;
  content?: string;
  language?: string;
}

export type AgentMode = 'write' | 'plan';

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ops?: AgentFileOp[];
  appliedPaths?: string[];
  /** Paths from `ops` that are still being "typed out"/applied (drives the per-file spinner). */
  codingPaths?: string[];
  isError?: boolean;
  createdAt: number;
  /** Raw <think>...</think> reasoning extracted from the model's response, if any. */
  thinking?: string;
  /** Short, human-friendly label describing what the reasoning above was doing. */
  thinkingLabel?: string;
  /** Sub-agent tasks this message spawned (populated when the agent delegates work). */
  subAgents?: SubAgentTask[];
  /** Tool calls (readfile / findall) the agent made before its final answer. */
  toolCalls?: AgentToolCall[];
  /** True while the client is resolving tool calls and waiting for the second LLM turn. */
  isReadingFiles?: boolean;
}

export type SubAgentStatus = 'queued' | 'running' | 'done' | 'error';

/** A single autonomous sub-agent task spawned by the main sour.ai Agent. */
export interface SubAgentTask {
  id: string;
  /** Short description of what the sub-agent was asked to do. */
  label: string;
  status: SubAgentStatus;
  /** Number of files the sub-agent ended up changing, once done. */
  fileCount?: number;
  error?: string;
}

// Minimal ambient augmentation for the File System Access API so the
// workspace can open, read and write real local folders. Chrome/Edge only;
// callers must feature-detect via `isDirectoryPickerSupported()`.
declare global {
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
    keys(): AsyncIterableIterator<string>;
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  }
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}
