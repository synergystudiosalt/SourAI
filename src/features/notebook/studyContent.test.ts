import { describe, expect, it } from 'vitest';

import {
  normalizeFlashcards,
  normalizeQuiz,
} from '../../../functions/shared/studyContent';
import {
  flashcardsToPlainText,
  optionLetter,
  quizToPlainText,
  readFlashcards,
  readQuiz,
  shuffle,
} from './studyContent';

describe('normalizeFlashcards', () => {
  it('reads the documented shape', () => {
    const deck = normalizeFlashcards({
      cards: [{ front: 'What is deep work?', back: 'Distraction-free focus.', source: 2 }],
    });
    expect(deck.cards).toEqual([
      { front: 'What is deep work?', back: 'Distraction-free focus.', source: 2 },
    ]);
  });

  it('accepts the near-misses models return instead', () => {
    const deck = normalizeFlashcards([
      { question: 'Term?', answer: 'Definition.' },
      { term: 'Focus', definition: 'Sustained attention.' },
    ]);
    expect(deck.cards.map((card) => card.front)).toEqual(['Term?', 'Focus']);
  });

  it('drops a card with only one face, which cannot be flipped', () => {
    const deck = normalizeFlashcards({
      cards: [{ front: 'Lonely question' }, { front: 'Good', back: 'Card' }],
    });
    expect(deck.cards).toHaveLength(1);
  });

  it('discards a source number that is not a plausible index', () => {
    const deck = normalizeFlashcards({
      cards: [{ front: 'a', back: 'b', source: 0 }, { front: 'c', back: 'd', source: 'two' }],
    });
    expect(deck.cards.every((card) => card.source === undefined)).toBe(true);
  });

  it('returns an empty deck rather than throwing on nonsense', () => {
    expect(normalizeFlashcards(null).cards).toEqual([]);
    expect(normalizeFlashcards('cards!').cards).toEqual([]);
  });
});

describe('normalizeQuiz', () => {
  const question = {
    question: 'Which is true?',
    options: ['One', 'Two', 'Three', 'Four'],
    answer: 2,
    explanation: 'Because three.',
    source: 1,
  };

  it('reads the documented shape', () => {
    expect(normalizeQuiz({ questions: [question] }).questions[0]).toEqual(question);
  });

  it('drops a question whose answer points past its options', () => {
    // This is the failure that matters: an out-of-range index renders a
    // question that can never be answered correctly.
    const quiz = normalizeQuiz({
      questions: [{ ...question, answer: 9 }, question],
    });
    expect(quiz.questions).toHaveLength(1);
  });

  it('resolves an answer given as text or as a letter', () => {
    expect(normalizeQuiz({ questions: [{ ...question, answer: 'Three' }] }).questions[0].answer).toBe(2);
    expect(normalizeQuiz({ questions: [{ ...question, answer: 'C' }] }).questions[0].answer).toBe(2);
  });

  it('corrects a one-based answer that can only have meant the last option', () => {
    expect(normalizeQuiz({ questions: [{ ...question, answer: 4 }] }).questions[0].answer).toBe(3);
  });

  it('drops a question with too few options to choose between', () => {
    expect(normalizeQuiz({ questions: [{ ...question, options: ['Only one'] }] }).questions).toEqual(
      []
    );
  });
});

describe('reading stored artifacts', () => {
  it('parses what the server stored', () => {
    const stored = JSON.stringify({ cards: [{ front: 'a', back: 'b' }] });
    expect(readFlashcards(stored).cards).toHaveLength(1);
  });

  it('degrades to empty rather than throwing on a corrupt record', () => {
    expect(readFlashcards('not json').cards).toEqual([]);
    expect(readQuiz('{"questions":').questions).toEqual([]);
  });
});

describe('plain-text rendition', () => {
  it('renders a deck as numbered prose, not as JSON', () => {
    const text = flashcardsToPlainText({
      cards: [{ front: 'What is focus?', back: 'Sustained attention.', source: 3 }],
    });
    expect(text).toBe('1. What is focus?\n   Sustained attention. [3]');
  });

  it('renders a quiz with lettered options and the answer', () => {
    const text = quizToPlainText({
      questions: [
        {
          question: 'Pick one',
          options: ['Wrong', 'Right'],
          answer: 1,
          explanation: 'Because.',
          source: 2,
        },
      ],
    });
    expect(text).toContain('   A. Wrong');
    expect(text).toContain('   B. Right');
    expect(text).toContain('Answer: B.');
    expect(text).toContain('Because. [2]');
  });
});

describe('shuffle', () => {
  it('keeps every item exactly once', () => {
    const items = [1, 2, 3, 4, 5];
    expect([...shuffle(items)].sort()).toEqual(items);
  });

  it('does not mutate the deck it was given', () => {
    const items = [1, 2, 3];
    shuffle(items, () => 0);
    expect(items).toEqual([1, 2, 3]);
  });
});

describe('optionLetter', () => {
  it('labels options A, B, C…', () => {
    expect([0, 1, 2].map(optionLetter)).toEqual(['A', 'B', 'C']);
  });
});
