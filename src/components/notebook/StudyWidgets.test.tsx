import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Flashcards } from './Flashcards';
import { QuizView } from './Quiz';

const DECK = JSON.stringify({
  cards: [
    { front: 'What is deep work?', back: 'Distraction-free concentration.', source: 1 },
    { front: 'What is attention residue?', back: 'Focus left on a previous task.' },
  ],
});

const QUIZ = JSON.stringify({
  questions: [
    {
      question: 'What is deep work?',
      options: ['Meetings', 'Distraction-free concentration', 'Email triage'],
      answer: 1,
      explanation: 'It is focused, cognitively demanding work.',
      source: 1,
    },
    {
      question: 'What is shallow work?',
      options: ['Logistical tasks', 'Research'],
      answer: 0,
    },
  ],
});

describe('Flashcards', () => {
  it('hides the answer until the card is turned over', async () => {
    const user = userEvent.setup();
    render(<Flashcards content={DECK} />);

    expect(screen.getByText('What is deep work?')).toBeInTheDocument();
    const card = screen.getByRole('button', { name: 'Reveal the answer' });
    await user.click(card);
    expect(screen.getByRole('button', { name: 'Show the question' })).toBeInTheDocument();
  });

  it('walks the deck and tracks what was marked known', async () => {
    const user = userEvent.setup();
    render(<Flashcards content={DECK} />);

    expect(screen.getByText(/Card 1 of 2/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Known/ }));

    // Marking advances, so the count reflects the second card.
    expect(await screen.findByText(/Card 2 of 2/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Known/ }));

    const results = await screen.findByRole('region', { name: 'Results' });
    expect(within(results).getByText('100%')).toBeInTheDocument();
    expect(within(results).getByText('2 of 2 marked known')).toBeInTheDocument();
  });

  it('cannot step past either end of the deck', async () => {
    const user = userEvent.setup();
    render(<Flashcards content={DECK} />);

    expect(screen.getByRole('button', { name: /Back/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText(/Card 2 of 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('follows a card citation back to its source', async () => {
    const user = userEvent.setup();
    const onOpenSource = vi.fn();
    render(<Flashcards content={DECK} onOpenSource={onOpenSource} />);

    await user.click(screen.getByRole('button', { name: 'Reveal the answer' }));
    await user.click(screen.getByRole('button', { name: 'Source 1' }));
    expect(onOpenSource).toHaveBeenCalledWith(1);
  });

  it('says so plainly when the deck cannot be read', () => {
    render(<Flashcards content="not json" />);
    expect(screen.getByText('This deck could not be read.')).toBeInTheDocument();
  });
});

describe('QuizView', () => {
  it('marks an answer the moment it is chosen', async () => {
    const user = userEvent.setup();
    render(<QuizView content={QUIZ} />);

    await user.click(screen.getByRole('button', { name: /Distraction-free concentration/ }));

    expect(screen.getByText(/It is focused, cognitively demanding work/)).toBeInTheDocument();
    expect(screen.getByText(/1 correct/)).toBeInTheDocument();
  });

  it('reveals the right answer when the wrong one is picked', async () => {
    const user = userEvent.setup();
    render(<QuizView content={QUIZ} />);

    await user.click(screen.getByRole('button', { name: /Meetings/ }));

    expect(screen.getByText(/0 correct/)).toBeInTheDocument();
    // The explanation still appears, so a wrong answer teaches something.
    expect(screen.getByText(/It is focused, cognitively demanding work/)).toBeInTheDocument();
  });

  it('does not let an answer be changed once given', async () => {
    const user = userEvent.setup();
    render(<QuizView content={QUIZ} />);

    await user.click(screen.getByRole('button', { name: /Meetings/ }));
    expect(screen.getByRole('button', { name: /Email triage/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Distraction-free concentration/ }));
    expect(screen.getByText(/0 correct/)).toBeInTheDocument();
  });

  it('scores the whole quiz and can be retaken', async () => {
    const user = userEvent.setup();
    render(<QuizView content={QUIZ} />);

    await user.click(screen.getByRole('button', { name: /Distraction-free concentration/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Logistical tasks/ }));

    const results = await screen.findByRole('region', { name: 'Results' });
    expect(within(results).getByText('100%')).toBeInTheDocument();
    expect(within(results).getByText('2 of 2 correct')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Retake/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Results' })).not.toBeInTheDocument());
    expect(screen.getByText(/Question 1 of 2/)).toBeInTheDocument();
  });

  it('drops a question whose answer index is out of range', () => {
    // Normalisation happens on read as well as on write, so a record stored by
    // an older build cannot render an unanswerable question.
    render(
      <QuizView
        content={JSON.stringify({
          questions: [
            { question: 'Broken', options: ['a', 'b'], answer: 7 },
            { question: 'Fine', options: ['a', 'b'], answer: 0 },
          ],
        })}
      />
    );
    const header = screen.getByText(/Question 1 of 1/);
    expect(header).toBeInTheDocument();
    expect(within(document.body).queryByText('Broken')).not.toBeInTheDocument();
  });
});

describe('finishing an attempt', () => {
  it('reports the quiz attempt once, with what was missed', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<QuizView content={QUIZ} onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: /Meetings/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Logistical tasks/ }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const attempt = onComplete.mock.calls[0][0];
    expect(attempt).toMatchObject({ kind: 'quiz', score: 1, total: 2 });
    // The missed item carries both what was picked and what was right, so the
    // review can talk about the specific mistake.
    expect(attempt.items[0]).toMatchObject({
      correct: false,
      chosen: 'Meetings',
      answer: 'Distraction-free concentration',
    });
  });

  it('reports a flashcard pass with the cards marked for review', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Flashcards content={DECK} onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: /Known/ }));
    await user.click(await screen.findByRole('button', { name: /Review/ }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ kind: 'flashcards', score: 1, total: 2 });
  });

  it('reports again after a retake, so a second pass gets its own review', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<QuizView content={QUIZ} onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: /Distraction-free concentration/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Logistical tasks/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Retake/ }));
    await user.click(await screen.findByRole('button', { name: /Meetings/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Logistical tasks/ }));

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete.mock.calls[1][0].score).toBe(1);
  });

  it('shows the review and offers to practise the weak topics', async () => {
    const user = userEvent.setup();
    const onPractise = vi.fn();
    render(
      <QuizView
        content={QUIZ}
        review={{
          state: 'ready',
          summary: 'You mixed up deep and shallow work.',
          topics: ['Deep work', 'Attention residue'],
          focus: 'deep work, attention residue',
        }}
        onPractise={onPractise}
      />
    );

    await user.click(screen.getByRole('button', { name: /Meetings/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Logistical tasks/ }));

    const results = await screen.findByRole('region', { name: 'Results' });
    expect(within(results).getByText('You mixed up deep and shallow work.')).toBeInTheDocument();
    expect(within(results).getByText('Deep work')).toBeInTheDocument();

    await user.click(within(results).getByRole('button', { name: /Make a quiz on these topics/ }));
    expect(onPractise).toHaveBeenCalledWith('deep work, attention residue');
  });

  it('asks for the review only when the learner wants it', async () => {
    const user = userEvent.setup();
    const onRequestReview = vi.fn();
    render(<QuizView content={QUIZ} review={{ state: 'idle' }} onRequestReview={onRequestReview} />);

    await user.click(screen.getByRole('button', { name: /Meetings/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Logistical tasks/ }));

    await user.click(await screen.findByRole('button', { name: /Review my answers/ }));
    expect(onRequestReview).toHaveBeenCalledTimes(1);
  });
});
