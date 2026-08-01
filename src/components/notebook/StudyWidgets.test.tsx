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
    expect(await screen.findByText(/Deck complete — 2 of 2 marked known/)).toBeInTheDocument();
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

    expect(await screen.findByText(/Quiz complete — 2 of 2 correct/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Retake/ }));
    // The completion banner animates out, so it lingers for a frame.
    await waitFor(() => expect(screen.queryByText(/Quiz complete/)).not.toBeInTheDocument());
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
