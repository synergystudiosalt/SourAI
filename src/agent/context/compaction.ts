/**
 * Keeps a long conversation inside the provider's per-minute token budget.
 *
 * Groq's on-demand tier allows 8000 tokens per minute, and that ceiling counts
 * the request as well as the reply. A request measured at 9599 tokens was
 * rejected outright with HTTP 413, which no retry or key rotation can help —
 * every key on the tier refuses a request that size.
 *
 * Only the conversation is compactable. The system prompt and the file context
 * are rebuilt each turn and are already capped by the effort profile, so they
 * are treated here as fixed overhead that the history has to fit around.
 *
 * Deliberately pure: no React, no network. The caller performs the summarising
 * request, which keeps the policy — when to compact, what to keep, what to
 * discard — testable without a provider.
 */

export interface CompactableMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * Four characters per token is the usual approximation for English and code.
 * It is an estimate, so every budget below leaves room for it to be wrong.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateHistoryTokens(messages: readonly CompactableMessage[]): number {
  // Four tokens per message covers the role and separators the provider adds.
  return messages.reduce((total, m) => total + estimateTokens(m.content) + 4, 0);
}

export interface CompactionOptions {
  /** Ceiling for the whole request. Stay well under the tier's TPM limit. */
  readonly budgetTokens?: number;
  /** System prompt plus file context: rebuilt each turn and not compactable. */
  readonly fixedOverheadTokens?: number;
  /** Maximum messages to replay verbatim before rolling older turns into a summary. */
  readonly maxMessages?: number;
  /** Recent turns kept verbatim. Recency carries most of the meaning. */
  readonly keepRecent?: number;
}

/** Input budget only. The reply is charged against the same per-minute pool. */
export const DEFAULT_BUDGET_TOKENS = 5000;
export const DEFAULT_KEEP_RECENT = 4;
/** Below this there is nothing worth summarising, and a request would cost more than it saves. */
export const MIN_MESSAGES_TO_SUMMARISE = 2;

export interface CompactionPlan {
  readonly needed: boolean;
  /** Older turns to fold into one summary. Empty when nothing is compacted. */
  readonly summarise: readonly CompactableMessage[];
  /** Turns passed through untouched. */
  readonly keep: readonly CompactableMessage[];
  readonly estimatedTokens: number;
  readonly availableTokens: number;
}

/**
 * Decides whether the history must shrink, and what may be dropped.
 *
 * Returns `needed: false` unchanged whenever compacting would not help: within
 * budget, or too little history to be worth a summarising request.
 */
export function planCompaction(
  messages: readonly CompactableMessage[],
  options: CompactionOptions = {}
): CompactionPlan {
  const budget = options.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const overhead = Math.max(0, options.fixedOverheadTokens ?? 0);
  const keepRecent = Math.max(1, options.keepRecent ?? DEFAULT_KEEP_RECENT);
  const maxMessages = Math.max(keepRecent + 1, options.maxMessages ?? Number.MAX_SAFE_INTEGER);

  const available = Math.max(0, budget - overhead);
  const estimatedTokens = estimateHistoryTokens(messages);

  const withinBudget = estimatedTokens <= available;
  const withinMessageLimit = messages.length <= maxMessages;
  const older = messages.slice(0, Math.max(0, messages.length - keepRecent));

  if ((withinBudget && withinMessageLimit) || older.length < MIN_MESSAGES_TO_SUMMARISE) {
    return {
      needed: false,
      summarise: [],
      keep: messages,
      estimatedTokens,
      availableTokens: available,
    };
  }

  return {
    needed: true,
    summarise: older,
    keep: messages.slice(older.length),
    estimatedTokens,
    availableTokens: available,
  };
}

const SUMMARY_INSTRUCTION = [
  'Summarise the conversation below so another assistant can continue it without having read it.',
  '',
  'Keep, in this order of priority:',
  '- decisions made and the reasoning behind them',
  '- every file path, function or symbol that was mentioned',
  '- what was tried and failed, and why — so it is not attempted again',
  '- anything the user asked for that is not done yet',
  '',
  'Drop pleasantries, restated code, and tool output that has already been acted on.',
  'Write plain prose under 200 words. Do not add a preamble or a closing line.',
].join('\n');

/** The request sent to the cheap model. Caller supplies the transport. */
export function buildCompactionRequest(
  toSummarise: readonly CompactableMessage[]
): CompactableMessage[] {
  const transcript = toSummarise
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  return [{ role: 'user', content: `${SUMMARY_INSTRUCTION}\n\n---\n\n${transcript}` }];
}

/** Marks the summary so a reader can tell it from something actually said. */
export const SUMMARY_PREFIX = '[Earlier in this conversation]';

/**
 * Rebuilds the history from the summary and the kept turns.
 *
 * An empty summary returns the kept turns alone rather than inserting a marker
 * with nothing after it: if the summarising request failed, losing the older
 * context is recoverable, but claiming a summary exists when it does not is
 * worse than saying nothing.
 */
export function applyCompaction(
  summary: string,
  keep: readonly CompactableMessage[]
): CompactableMessage[] {
  const trimmed = summary.trim();
  if (!trimmed) return [...keep];
  return [{ role: 'user', content: `${SUMMARY_PREFIX}\n${trimmed}` }, ...keep];
}
