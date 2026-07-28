import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AgentContent,
  MiniMarkdown,
  isRemoteImageSource,
  parseAgentContent,
} from './MarkdownContent';

describe('agent Markdown presentation', () => {
  it('requires consent before rendering a third-party image', () => {
    render(<MiniMarkdown text="![preview](https://tracker.example/result.png)" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /Load remote image from tracker\.example/i })
    );

    const image = screen.getByRole('img', { name: 'preview' });
    expect(image).toHaveAttribute('src', 'https://tracker.example/result.png');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('renders same-origin images immediately and classifies remote URLs explicitly', () => {
    expect(isRemoteImageSource('/assets/local.png')).toBe(false);
    expect(isRemoteImageSource('https://tracker.example/result.png')).toBe(true);

    render(<MiniMarkdown text="![local](/assets/local.png)" />);
    expect(screen.getByRole('img', { name: 'local' })).toHaveAttribute(
      'src',
      '/assets/local.png'
    );
  });
});

describe('agent structured content', () => {
  it('splits XML-style sections from surrounding Markdown', () => {
    expect(
      parseAgentContent('Before\n<thinking>Inspect the file.</thinking>\nAfter')
    ).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'thinking', content: 'Inspect the file.' },
      { type: 'text', content: 'After' },
    ]);
  });

  it('collapses consecutive reasoning sections into one activity disclosure', () => {
    expect(
      parseAgentContent(
        '<think>Inspect files.</think><planning>Prepare edits.</planning><step>Verify.</step>'
      )
    ).toEqual([
      {
        type: 'think',
        content: 'Inspect files.\nPrepare edits.\nVerify.',
      },
    ]);
  });

  it('repairs a mismatched closing tag instead of exposing raw model markup', () => {
    expect(
      parseAgentContent('<thinking>Improving UI polish.</index>')
    ).toEqual([{ type: 'thinking', content: 'Improving UI polish.' }]);
  });

  it('presents structured sections behind an explicit disclosure', () => {
    const openTags = new Set<string>();
    const { rerender } = render(
      <AgentContent
        text="<thinking>Inspect the file.</thinking>"
        messageId="message-1"
        openTags={openTags}
        onToggleTag={(id) => openTags.add(id)}
      />
    );

    expect(screen.queryByText('Inspect the file.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Thinking/i }));
    rerender(
      <AgentContent
        text="<thinking>Inspect the file.</thinking>"
        messageId="message-1"
        openTags={openTags}
        onToggleTag={(id) => openTags.add(id)}
      />
    );
    expect(screen.getByText('Inspect the file.')).toBeInTheDocument();
  });

  it('shows an icon only for read sections', () => {
    const { container } = render(
      <AgentContent
        text="<read>game.js</read><thinking>Inspecting.</thinking><function_request>Run tests.</function_request>"
        messageId="message-icons"
        openTags={new Set()}
        onToggleTag={() => undefined}
      />
    );

    expect(screen.getAllByTestId('read-tag-icon')).toHaveLength(1);
    // The remaining SVGs are disclosure chevrons; non-read labels have no leading icon.
    expect(container.querySelectorAll('[data-testid="read-tag-icon"]')).toHaveLength(1);
  });

  it('animates and truncates every structured section label', () => {
    const { container } = render(
      <AgentContent
        text="<thinking>Inspecting.</thinking><read>game.js</read><check_for_errors>Verify the complete workspace without overflowing the agent panel.</check_for_errors>"
        messageId="message-gradients"
        openTags={new Set()}
        onToggleTag={() => undefined}
      />
    );

    const labels = container.querySelectorAll('.agent-active-gradient');
    expect(labels).toHaveLength(3);
    labels.forEach((label) => expect(label).toHaveClass('truncate'));
  });
});
