/**
 * The record of one finished deck or quiz.
 *
 * It travels from the widget to the review endpoint, so it is normalised the
 * same way source payloads are: it is user-supplied JSON arriving over HTTP,
 * and it is about to be rendered into a prompt.
 */

export interface StudyAttemptItem {
  /** The question asked, or the front of the card. */
  prompt: string;
  correct: boolean;
  /** What the right answer was. */
  answer?: string;
  /** What the learner picked, when the format records one. */
  chosen?: string;
  /** 1-based source number the item came from. */
  source?: number;
}

export interface StudyAttempt {
  kind: 'quiz' | 'flashcards';
  total: number;
  score: number;
  items: StudyAttemptItem[];
}

export const MAX_ATTEMPT_ITEMS = 60;
const MAX_ITEM_CHARS = 400;

function text(value: unknown, limit = MAX_ITEM_CHARS): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function normalizeStudyAttempt(kind: unknown, value: unknown): StudyAttempt | null {
  const attemptKind = kind === 'flashcards' ? 'flashcards' : kind === 'quiz' ? 'quiz' : null;
  if (!attemptKind || !value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? record.items : [];

  const items: StudyAttemptItem[] = [];
  for (const entry of rawItems.slice(0, MAX_ATTEMPT_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const prompt = text(item.prompt);
    if (!prompt) continue;
    const source = Number(item.source);
    items.push({
      prompt,
      correct: item.correct === true,
      answer: text(item.answer) || undefined,
      chosen: text(item.chosen) || undefined,
      source: Number.isInteger(source) && source >= 1 && source <= 99 ? source : undefined,
    });
  }
  if (items.length === 0) return null;

  const score = items.filter((item) => item.correct).length;
  return { kind: attemptKind, total: items.length, score, items };
}

/**
 * Renders the attempt for the model.
 *
 * Correct answers are listed by prompt only — the model needs to know what was
 * already solid, but spending prompt budget on their full text would crowd out
 * the misses, which are the actual subject.
 */
export function renderStudyAttempt(attempt: StudyAttempt): string {
  const missed = attempt.items.filter((item) => !item.correct);
  const correct = attempt.items.filter((item) => item.correct);
  const lines = [
    `<attempt kind="${attempt.kind}" score="${attempt.score}" total="${attempt.total}">`,
  ];

  if (missed.length > 0) {
    lines.push('MISSED:');
    for (const item of missed) {
      const parts = [`- ${item.prompt}`];
      if (item.chosen) parts.push(`  they answered: ${item.chosen}`);
      if (item.answer) parts.push(`  correct answer: ${item.answer}`);
      if (item.source) parts.push(`  source: ${item.source}`);
      lines.push(parts.join('\n'));
    }
  } else {
    lines.push('MISSED: none.');
  }

  if (correct.length > 0) {
    lines.push('ANSWERED CORRECTLY:');
    for (const item of correct) lines.push(`- ${item.prompt}`);
  }

  lines.push('</attempt>');
  return lines.join('\n');
}
