/**
 * Domain types for the Notebook workspace.
 *
 * A notebook is a set of sources plus everything derived from them: the
 * grounded conversation, the saved notes, and the generated study material.
 * Sources carry their extracted text so the notebook keeps working offline and
 * so a re-upload is never needed to ask another question.
 */

export type NotebookSourceKind =
  | 'pdf'
  | 'docx'
  | 'text'
  | 'markdown'
  | 'code'
  | 'csv'
  | 'website'
  | 'note';

export interface NotebookSource {
  id: string;
  title: string;
  kind: NotebookSourceKind;
  /** Extracted plain text — what the model actually reads. */
  content: string;
  addedAt: number;
  /** Origin link for website sources. */
  url?: string;
  /** Only selected sources are sent with a question, exactly as NotebookLM does. */
  selected: boolean;
  summary?: string;
  topics?: string[];
  summaryState?: 'idle' | 'loading' | 'ready' | 'error';
  /** Progress of model transcription for a scanned PDF, when one was needed. */
  transcription?: SourceTranscription;
}

export interface SourceTranscription {
  state: 'running' | 'done' | 'cancelled' | 'failed';
  total: number;
  completed: number;
  /** Set while running, so the panel can say how long is left. */
  remainingMs?: number;
}

export interface NotebookMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /**
   * Source ids in the order they were numbered for this answer, so `[2]`
   * resolves to `citedSourceIds[1]` even after sources are added or removed.
   */
  citedSourceIds?: string[];
  isError?: boolean;
}

export type StudioArtifactKind =
  | 'note'
  | 'study_guide'
  | 'briefing'
  | 'faq'
  | 'timeline'
  | 'mindmap'
  | 'flashcards'
  | 'quiz';

/** Kinds stored as JSON and rendered as an interactive widget, not as prose. */
export const INTERACTIVE_ARTIFACT_KINDS: readonly StudioArtifactKind[] = ['flashcards', 'quiz'];

export function isInteractiveArtifact(kind: StudioArtifactKind): boolean {
  return INTERACTIVE_ARTIFACT_KINDS.includes(kind);
}

export interface StudioArtifact {
  id: string;
  kind: StudioArtifactKind;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  citedSourceIds?: string[];
}

export interface NotebookOverview {
  summary: string;
  topics: string[];
  questions: string[];
}

export interface Notebook {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sources: NotebookSource[];
  messages: NotebookMessage[];
  artifacts: StudioArtifact[];
  overview?: NotebookOverview;
  /** Set of source ids the overview was built from, so it can be refreshed. */
  overviewSourceIds?: string[];
}

export const UNTITLED_NOTEBOOK = 'Untitled notebook';

export function createNotebookId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createNotebook(title: string = UNTITLED_NOTEBOOK): Notebook {
  const now = Date.now();
  return {
    id: createNotebookId(),
    title,
    createdAt: now,
    updatedAt: now,
    sources: [],
    messages: [],
    artifacts: [],
  };
}

export function selectedSources(notebook: Notebook): NotebookSource[] {
  return notebook.sources.filter((source) => source.selected);
}

const KIND_LABELS: Record<NotebookSourceKind, string> = {
  pdf: 'PDF',
  docx: 'Document',
  text: 'Text',
  markdown: 'Markdown',
  code: 'Code',
  csv: 'Spreadsheet',
  website: 'Website',
  note: 'Note',
};

export function sourceKindLabel(kind: NotebookSourceKind): string {
  return KIND_LABELS[kind] ?? 'Source';
}

const STUDIO_TITLES: Record<StudioArtifactKind, string> = {
  note: 'Note',
  study_guide: 'Study guide',
  briefing: 'Briefing doc',
  faq: 'FAQ',
  timeline: 'Timeline',
  mindmap: 'Mind map',
  flashcards: 'Flashcards',
  quiz: 'Quiz',
};

export function studioArtifactTitle(kind: StudioArtifactKind): string {
  return STUDIO_TITLES[kind] ?? 'Note';
}

/** Rough word count used for the "N words" label on a source. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Revives a persisted notebook, dropping anything malformed.
 *
 * Records come back from IndexedDB, where an older build or a partially
 * written value can leave fields missing; a notebook that renders is better
 * than a workspace that throws on mount.
 */
/**
 * A job cannot survive the page that was running it, so a notebook reloaded
 * mid-transcription reports the truth: it stopped.
 */
function reviveTranscription(value: unknown): SourceTranscription | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const total = typeof record.total === 'number' ? record.total : 0;
  const completed = typeof record.completed === 'number' ? record.completed : 0;
  if (total <= 0) return undefined;
  const state =
    record.state === 'done' || record.state === 'failed' || record.state === 'cancelled'
      ? record.state
      : 'cancelled';
  return { state, total, completed };
}

export function reviveNotebook(value: unknown): Notebook | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;

  const sources = Array.isArray(record.sources)
    ? record.sources
        .map((entry): NotebookSource | null => {
          if (!entry || typeof entry !== 'object') return null;
          const source = entry as Record<string, unknown>;
          if (typeof source.id !== 'string' || typeof source.content !== 'string') return null;
          return {
            id: source.id,
            title: typeof source.title === 'string' ? source.title : 'Untitled source',
            kind: (typeof source.kind === 'string' ? source.kind : 'text') as NotebookSourceKind,
            content: source.content,
            addedAt: typeof source.addedAt === 'number' ? source.addedAt : Date.now(),
            url: typeof source.url === 'string' ? source.url : undefined,
            selected: source.selected !== false,
            summary: typeof source.summary === 'string' ? source.summary : undefined,
            topics: Array.isArray(source.topics)
              ? source.topics.filter((topic): topic is string => typeof topic === 'string')
              : undefined,
            summaryState: typeof source.summary === 'string' ? 'ready' : 'idle',
            transcription: reviveTranscription(source.transcription),
          };
        })
        .filter((source): source is NotebookSource => source !== null)
    : [];

  const messages = Array.isArray(record.messages)
    ? record.messages
        .map((entry): NotebookMessage | null => {
          if (!entry || typeof entry !== 'object') return null;
          const message = entry as Record<string, unknown>;
          if (typeof message.id !== 'string' || typeof message.content !== 'string') return null;
          return {
            id: message.id,
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
            createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
            citedSourceIds: Array.isArray(message.citedSourceIds)
              ? message.citedSourceIds.filter((id): id is string => typeof id === 'string')
              : undefined,
            isError: message.isError === true,
          };
        })
        .filter((message): message is NotebookMessage => message !== null)
    : [];

  const artifacts = Array.isArray(record.artifacts)
    ? record.artifacts
        .map((entry): StudioArtifact | null => {
          if (!entry || typeof entry !== 'object') return null;
          const artifact = entry as Record<string, unknown>;
          if (typeof artifact.id !== 'string' || typeof artifact.content !== 'string') return null;
          const createdAt = typeof artifact.createdAt === 'number' ? artifact.createdAt : Date.now();
          return {
            id: artifact.id,
            kind: (typeof artifact.kind === 'string' ? artifact.kind : 'note') as StudioArtifactKind,
            title: typeof artifact.title === 'string' ? artifact.title : 'Note',
            content: artifact.content,
            createdAt,
            updatedAt: typeof artifact.updatedAt === 'number' ? artifact.updatedAt : createdAt,
            citedSourceIds: Array.isArray(artifact.citedSourceIds)
              ? artifact.citedSourceIds.filter((id): id is string => typeof id === 'string')
              : undefined,
          };
        })
        .filter((artifact): artifact is StudioArtifact => artifact !== null)
    : [];

  const overviewRecord = record.overview as Record<string, unknown> | undefined;
  const overview: NotebookOverview | undefined =
    overviewRecord && typeof overviewRecord.summary === 'string'
      ? {
          summary: overviewRecord.summary,
          topics: Array.isArray(overviewRecord.topics)
            ? overviewRecord.topics.filter((topic): topic is string => typeof topic === 'string')
            : [],
          questions: Array.isArray(overviewRecord.questions)
            ? overviewRecord.questions.filter((question): question is string => typeof question === 'string')
            : [],
        }
      : undefined;

  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
  return {
    id: record.id,
    title: typeof record.title === 'string' && record.title ? record.title : UNTITLED_NOTEBOOK,
    createdAt,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : createdAt,
    sources,
    messages,
    artifacts,
    overview,
    overviewSourceIds: Array.isArray(record.overviewSourceIds)
      ? record.overviewSourceIds.filter((id): id is string => typeof id === 'string')
      : undefined,
  };
}
