/**
 * Normalises the flashcard and quiz payloads a model returns.
 *
 * These two studio outputs are interactive rather than prose, so the client
 * indexes into them: a quiz whose `answer` points past the end of `options`, or
 * a card with no back, is not a cosmetic problem — it is an unanswerable
 * question. Everything is validated and coerced here, once, before it is
 * stored, so the renderers can treat their input as sound.
 */

export interface Flashcard {
  front: string;
  back: string;
  /** 1-based source number, when the model attributed the card. */
  source?: number;
}

export interface FlashcardDeck {
  cards: Flashcard[];
}

export interface QuizQuestion {
  question: string;
  options: string[];
  /** Index into `options`. Always valid once normalised. */
  answer: number;
  explanation?: string;
  source?: number;
}

export interface Quiz {
  questions: QuizQuestion[];
}

export const MAX_FLASHCARDS = 40;
export const MAX_QUIZ_QUESTIONS = 30;
export const MIN_QUIZ_OPTIONS = 2;
export const MAX_QUIZ_OPTIONS = 6;

const MAX_FIELD_CHARS = 1_000;

function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_CHARS);
}

function sourceNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 99 ? parsed : undefined;
}

function entries(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of keys) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

export function normalizeFlashcards(value: unknown): FlashcardDeck {
  const cards: Flashcard[] = [];
  for (const entry of entries(value, 'cards', 'flashcards', 'deck')) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const front = text(record.front ?? record.question ?? record.term ?? record.prompt);
    const back = text(record.back ?? record.answer ?? record.definition ?? record.response);
    // A card with only one face teaches nothing and cannot be flipped.
    if (!front || !back) continue;
    cards.push({ front, back, source: sourceNumber(record.source ?? record.sourceIndex) });
    if (cards.length >= MAX_FLASHCARDS) break;
  }
  return { cards };
}

export function normalizeQuiz(value: unknown): Quiz {
  const questions: QuizQuestion[] = [];
  for (const entry of entries(value, 'questions', 'quiz', 'items')) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const question = text(record.question ?? record.prompt ?? record.stem);
    const rawOptions = Array.isArray(record.options)
      ? record.options
      : Array.isArray(record.choices)
        ? record.choices
        : [];
    const options = rawOptions
      .map((option) =>
        text(
          option && typeof option === 'object'
            ? ((option as Record<string, unknown>).text ??
              (option as Record<string, unknown>).label)
            : option
        )
      )
      .filter(Boolean)
      .slice(0, MAX_QUIZ_OPTIONS);

    if (!question || options.length < MIN_QUIZ_OPTIONS) continue;

    // The answer may arrive as an index, as the option text, or as a letter.
    const raw = record.answer ?? record.correct ?? record.answerIndex ?? record.correctIndex;
    let answer = -1;
    if (typeof raw === 'number' && Number.isInteger(raw)) {
      // Some models answer 1-based despite being asked for 0-based; a value
      // exactly equal to the option count can only have meant the last one.
      answer = raw === options.length ? raw - 1 : raw;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      const byText = options.findIndex(
        (option) => option.toLowerCase() === trimmed.toLowerCase()
      );
      if (byText >= 0) {
        answer = byText;
      } else if (/^[a-f]$/i.test(trimmed)) {
        answer = trimmed.toLowerCase().charCodeAt(0) - 97;
      } else if (/^\d+$/.test(trimmed)) {
        const parsed = Number(trimmed);
        answer = parsed === options.length ? parsed - 1 : parsed;
      }
    }
    if (answer < 0 || answer >= options.length) continue;

    questions.push({
      question,
      options,
      answer,
      explanation: text(record.explanation ?? record.rationale) || undefined,
      source: sourceNumber(record.source ?? record.sourceIndex),
    });
    if (questions.length >= MAX_QUIZ_QUESTIONS) break;
  }
  return { questions };
}
