/**
 * Reading side of the interactive studio outputs.
 *
 * Flashcards and quizzes are stored as JSON rather than Markdown, so they are
 * parsed back through the same normalisers the server used to write them. A
 * record persisted by an older build — or hand-edited — is coerced rather than
 * trusted, because the renderers index into it.
 */

import {
  normalizeFlashcards,
  normalizeQuiz,
  type Flashcard,
  type FlashcardDeck,
  type Quiz,
  type QuizQuestion,
} from '../../../functions/shared/studyContent';

export type { Flashcard, FlashcardDeck, Quiz, QuizQuestion };

function parse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function readFlashcards(content: string): FlashcardDeck {
  return normalizeFlashcards(parse(content));
}

export function readQuiz(content: string): Quiz {
  return normalizeQuiz(parse(content));
}

const LETTERS = 'ABCDEF';

export function optionLetter(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

/**
 * Renders a deck or quiz as prose.
 *
 * Copying JSON to the clipboard, or feeding it back in as a source, would be
 * useless to both a person and a model.
 */
export function flashcardsToPlainText(deck: FlashcardDeck): string {
  return deck.cards
    .map((card, index) => {
      const cite = card.source ? ` [${card.source}]` : '';
      return `${index + 1}. ${card.front}\n   ${card.back}${cite}`;
    })
    .join('\n\n');
}

export function quizToPlainText(quiz: Quiz): string {
  return quiz.questions
    .map((question, index) => {
      const options = question.options
        .map((option, position) => `   ${optionLetter(position)}. ${option}`)
        .join('\n');
      const cite = question.source ? ` [${question.source}]` : '';
      const explanation = question.explanation ? `\n   ${question.explanation}${cite}` : cite;
      return `${index + 1}. ${question.question}\n${options}\n   Answer: ${optionLetter(
        question.answer
      )}.${explanation}`;
    })
    .join('\n\n');
}

/** Fisher-Yates, so shuffling a deck does not bias toward the original order. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
