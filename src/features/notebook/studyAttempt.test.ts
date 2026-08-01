import { describe, expect, it } from 'vitest';

import {
  MAX_ATTEMPT_ITEMS,
  normalizeStudyAttempt,
  renderStudyAttempt,
} from '../../../functions/shared/studyAttempt';

const attempt = {
  items: [
    {
      prompt: 'What is deep work?',
      answer: 'Distraction-free concentration',
      chosen: 'Meetings',
      correct: false,
      source: 1,
    },
    { prompt: 'What is shallow work?', answer: 'Logistical tasks', correct: true },
  ],
};

describe('normalizeStudyAttempt', () => {
  it('scores the attempt from the items rather than trusting the caller', () => {
    // The score decides what the review talks about, so it is recomputed here
    // instead of being taken from a field the client could get wrong.
    const normalized = normalizeStudyAttempt('quiz', { ...attempt, score: 99, total: 99 });
    expect(normalized).toMatchObject({ kind: 'quiz', score: 1, total: 2 });
  });

  it('rejects an unknown kind', () => {
    expect(normalizeStudyAttempt('essay', attempt)).toBeNull();
  });

  it('rejects an attempt with no usable items', () => {
    expect(normalizeStudyAttempt('quiz', { items: [] })).toBeNull();
    expect(normalizeStudyAttempt('quiz', { items: [{ correct: true }] })).toBeNull();
    expect(normalizeStudyAttempt('quiz', null)).toBeNull();
  });

  it('caps how much of an attempt can be sent', () => {
    const many = { items: Array.from({ length: 200 }, (_, i) => ({ prompt: `q${i}`, correct: true })) };
    expect(normalizeStudyAttempt('flashcards', many)!.total).toBe(MAX_ATTEMPT_ITEMS);
  });

  it('discards a source number that is not a plausible index', () => {
    const normalized = normalizeStudyAttempt('quiz', {
      items: [{ prompt: 'q', correct: false, source: 0 }],
    });
    expect(normalized!.items[0].source).toBeUndefined();
  });

  it('treats a missing correctness flag as incorrect', () => {
    const normalized = normalizeStudyAttempt('quiz', { items: [{ prompt: 'q' }] });
    expect(normalized!.items[0].correct).toBe(false);
    expect(normalized!.score).toBe(0);
  });
});

describe('renderStudyAttempt', () => {
  const normalized = normalizeStudyAttempt('quiz', attempt)!;

  it('leads with what was missed, including the wrong choice', () => {
    const rendered = renderStudyAttempt(normalized);
    expect(rendered).toContain('MISSED:');
    expect(rendered).toContain('they answered: Meetings');
    expect(rendered).toContain('correct answer: Distraction-free concentration');
  });

  it('lists correct answers by prompt only, to leave room for the misses', () => {
    const rendered = renderStudyAttempt(normalized);
    expect(rendered).toContain('- What is shallow work?');
    expect(rendered).not.toContain('Logistical tasks');
  });

  it('says so plainly when nothing was missed', () => {
    const perfect = normalizeStudyAttempt('flashcards', {
      items: [{ prompt: 'a', correct: true }],
    })!;
    expect(renderStudyAttempt(perfect)).toContain('MISSED: none.');
  });

  it('carries the score for the model to react to', () => {
    expect(renderStudyAttempt(normalized)).toContain('score="1" total="2"');
  });
});
