import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PresentationViewer } from './PresentationViewer';

const DECK = [
  '# Deep Work',
  '## Slide 1: Why focus matters',
  '- Focus creates valuable output. [1]',
  '## Slide 2: Takeaways',
  '- Protect uninterrupted time. [1]',
].join('\n');

describe('PresentationViewer', () => {
  it('opens as a cover slide and navigates like a slide show', async () => {
    const user = userEvent.setup();
    render(<PresentationViewer markdown={DECK} notebookTitle="Research" />);
    const viewer = screen.getByRole('region', { name: 'Presentation viewer' });

    expect(within(viewer).getByRole('heading', { name: 'Deep Work' })).toBeInTheDocument();
    expect(within(viewer).getByText('Slide 1 of 3')).toBeInTheDocument();

    await user.click(within(viewer).getByRole('button', { name: 'Next slide' }));
    expect(await within(viewer).findByRole('heading', { name: 'Why focus matters' })).toBeInTheDocument();
    expect(within(viewer).getByRole('listitem')).toHaveTextContent('Focus creates valuable output. [1]');
    expect(within(viewer).getByText('Slide 2 of 3')).toBeInTheDocument();
  });

  it('opens citations from slide bullets', async () => {
    const user = userEvent.setup();
    const onOpenSource = vi.fn();
    render(<PresentationViewer markdown={DECK} onOpenSource={onOpenSource} />);

    await user.click(screen.getByRole('button', { name: 'Go to slide 2' }));
    await user.click(await screen.findByRole('button', { name: '[1]' }));
    expect(onOpenSource).toHaveBeenCalledWith(1);
  });
});
