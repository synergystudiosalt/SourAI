import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatMarkdownImage } from './ChatStreamView';

describe('Chat Markdown image privacy', () => {
  it('requires consent before rendering a remote image and suppresses the referrer', () => {
    render(<ChatMarkdownImage src="https://images.example/private.png" alt="diagram" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Load remote image from images\.example/i }));

    const image = screen.getByRole('img', { name: 'diagram' });
    expect(image).toHaveAttribute('src', 'https://images.example/private.png');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('renders same-origin images without a consent prompt', () => {
    render(<ChatMarkdownImage src="/assets/diagram.png" alt="local diagram" />);

    expect(screen.queryByRole('button', { name: /Load remote image/i })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'local diagram' })).toHaveAttribute('src', '/assets/diagram.png');
  });
});
