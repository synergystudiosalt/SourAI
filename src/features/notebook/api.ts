/**
 * Client for `/api/notebook`.
 *
 * Every call carries the selected sources: the Pages Function holds no session
 * state, which keeps the notebook's data in the browser and makes the endpoint
 * safe to retry.
 */

import type { StudioOptions } from '../../../functions/shared/studioOptions';
import type { StudyAttempt } from '../../../functions/shared/studyAttempt';
import type { AIModel } from '../../types';
import type { NotebookMessage, NotebookSource } from './types';

export interface NotebookSourcePayload {
  id: string;
  title: string;
  content: string;
  kind: string;
  url?: string;
}

export function toSourcePayload(source: NotebookSource): NotebookSourcePayload {
  return {
    id: source.id,
    title: source.title,
    content: source.content,
    kind: source.kind,
    url: source.url,
  };
}

export class NotebookApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'NotebookApiError';
  }
}

async function post<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/notebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new NotebookApiError('sour.ai could not reach the notebook service.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new NotebookApiError(
      `The notebook service returned HTTP ${response.status}.`,
      response.status
    );
  }
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok || data?.error) {
    throw new NotebookApiError(
      data?.error || `The notebook service returned HTTP ${response.status}.`,
      response.status
    );
  }
  return data;
}

export interface GroundedReply {
  text: string;
  sourceIds: string[];
}

export function askNotebook(options: {
  sources: readonly NotebookSource[];
  messages: readonly NotebookMessage[];
  model: AIModel;
  signal?: AbortSignal;
}): Promise<GroundedReply> {
  return post<GroundedReply>(
    {
      action: 'chat',
      model: options.model,
      sources: options.sources.map(toSourcePayload),
      messages: options.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    },
    options.signal
  );
}

export function generateStudioDocument(options: {
  kind: string;
  sources: readonly NotebookSource[];
  model: AIModel;
  /** Per-generation settings: how many, how hard, what to focus on. */
  options?: StudioOptions;
  signal?: AbortSignal;
}): Promise<GroundedReply> {
  return post<GroundedReply>(
    {
      action: 'studio',
      kind: options.kind,
      model: options.model,
      options: options.options,
      sources: options.sources.map(toSourcePayload),
    },
    options.signal
  );
}

export interface StudyReviewReply {
  summary: string;
  topics: string[];
  /** One line, ready to drop into the focus box of a follow-up generation. */
  focus: string;
  score: number;
  total: number;
}

/** Asks what to study next, from the sources and from what was just missed. */
export function reviewStudyAttempt(options: {
  attempt: StudyAttempt;
  sources: readonly NotebookSource[];
  model: AIModel;
  signal?: AbortSignal;
}): Promise<StudyReviewReply> {
  return post<StudyReviewReply>(
    {
      action: 'study_review',
      kind: options.attempt.kind,
      model: options.model,
      attempt: options.attempt,
      sources: options.sources.map(toSourcePayload),
    },
    options.signal
  );
}

export interface NotebookOverviewReply {
  title: string;
  summary: string;
  topics: string[];
  questions: string[];
}

export function generateOverview(options: {
  sources: readonly NotebookSource[];
  model: AIModel;
  signal?: AbortSignal;
}): Promise<NotebookOverviewReply> {
  return post<NotebookOverviewReply>(
    {
      action: 'overview',
      model: options.model,
      sources: options.sources.map(toSourcePayload),
    },
    options.signal
  );
}

export interface SourceSummaryReply {
  summary: string;
  topics: string[];
}

export function summariseSource(options: {
  source: NotebookSource;
  model: AIModel;
  signal?: AbortSignal;
}): Promise<SourceSummaryReply> {
  return post<SourceSummaryReply>(
    {
      action: 'source_summary',
      model: options.model,
      sources: [toSourcePayload(options.source)],
    },
    options.signal
  );
}

export interface FetchedPage {
  url: string;
  title: string;
  content: string;
}

export function fetchWebsiteSource(url: string, signal?: AbortSignal): Promise<FetchedPage> {
  return post<FetchedPage>({ action: 'fetch_url', url }, signal);
}

export interface TranscribedPage {
  text: string;
  empty: boolean;
}

/** Reads one rendered page of a scanned PDF back as text. */
export function transcribePdfPage(options: {
  image: string;
  page: number;
  signal?: AbortSignal;
}): Promise<TranscribedPage> {
  return post<TranscribedPage>(
    { action: 'transcribe_page', image: options.image, page: options.page },
    options.signal
  );
}
