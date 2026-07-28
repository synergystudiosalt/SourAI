import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ToolCallList } from './ToolCallList';

describe('ToolCallList trust labels', () => {
  it('counts repeated reads of the same path only once', () => {
    render(
      <ToolCallList
        messageId="m0"
        toolCalls={[
          { type: 'readfile', path: 'index.html', found: true },
          { type: 'readfile', path: 'index.html', found: true },
          { type: 'readfile', path: 'style.css', found: true },
          { type: 'readfile', path: 'style.css', found: true },
        ]}
        isReading={false}
        openItems={new Set()}
        onToggle={() => undefined}
      />
    );

    expect(screen.getByText('Read: index.html')).toBeInTheDocument();
    expect(screen.getByText('Read: style.css')).toBeInTheDocument();
    expect(screen.getAllByText(/^Read:/)).toHaveLength(2);
  });

  it('does not claim a missing file was read', () => {
    render(
      <ToolCallList
        messageId="message-1"
        toolCalls={[{ type: 'readfile', path: 'index.html', found: false }]}
        isReading
        openItems={new Set()}
        onToggle={() => undefined}
      />
    );

    expect(screen.getByText('Missing: index.html')).toBeInTheDocument();
    expect(screen.queryByText('Read: index.html')).not.toBeInTheDocument();
  });

  it('labels a successful workspace read accurately', () => {
    render(
      <ToolCallList
        messageId="message-2"
        toolCalls={[{ type: 'readfile', path: 'src/App.tsx', found: true }]}
        isReading={false}
        openItems={new Set()}
        onToggle={() => undefined}
      />
    );

    expect(screen.getByText('Read: src/App.tsx')).toBeInTheDocument();
  });
});
