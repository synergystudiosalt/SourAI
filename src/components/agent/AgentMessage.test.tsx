import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { describe, expect, it } from 'vitest';

import type { AgentChatMessage } from '../../types';
import { AgentMessage } from './AgentMessage';

function MessageHarness({ message }: { message: AgentChatMessage }) {
  const [openTags, setOpenTags] = useState<Set<string>>(new Set());
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const toggle = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    id: string
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <AgentMessage
      message={message}
      isLatest
      animateTyping={false}
      openTags={openTags}
      openItems={openItems}
      onToggleTag={(id) => toggle(setOpenTags, id)}
      onToggleItem={(id) => toggle(setOpenItems, id)}
      onApplyOperations={() => undefined}
      onRejectOperations={() => undefined}
    />
  );
}

describe('AgentMessage', () => {
  it('keeps provider reasoning in a collapsed Thinking section', () => {
    render(
      <MessageHarness
        message={{
          id: 'assistant-thinking',
          role: 'assistant',
          content: 'The fix is ready.',
          thinking: 'Inspecting the existing implementation.',
          createdAt: 1,
        }}
      />
    );

    expect(screen.getByText('The fix is ready.')).toBeInTheDocument();
    expect(screen.queryByText('Inspecting the existing implementation.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Thinking/i }));
    expect(screen.getByText('Inspecting the existing implementation.')).toBeInTheDocument();
  });

  it('shows a single animated status while a run is active', () => {
    render(
      <MessageHarness
        message={{
          id: 'assistant-active',
          role: 'assistant',
          content: '',
          thinkingLabel: 'Inspecting workspace',
          isReadingFiles: true,
          createdAt: 1,
        }}
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Inspecting workspace');
    expect(status.querySelector('.agent-active-gradient')).toBeInTheDocument();
  });

  it('renders user messages without agent presentation chrome', () => {
    render(
      <MessageHarness
        message={{
          id: 'user-1',
          role: 'user',
          content: 'Please inspect the project.',
          createdAt: 1,
        }}
      />
    );

    expect(screen.getByText('Please inspect the project.')).toBeInTheDocument();
    expect(screen.queryByText('sour.ai Agent')).not.toBeInTheDocument();
  });

  it('presents tool results and file operations as independently expandable items', () => {
    render(
      <MessageHarness
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: 'I found one change.',
          createdAt: 2,
          toolCalls: [
            {
              type: 'findall',
              query: 'needle',
              matchCount: 1,
              fileCount: 1,
              matches: [{ path: 'src/App.tsx', line: 12, text: 'const needle = true;' }],
            },
          ],
          ops: [
            {
              type: 'write',
              path: 'src/App.tsx',
              content: 'const needle = false;',
              addedLines: [0],
              removedLines: [{ index: 0, text: 'const needle = true;' }],
            },
          ],
        }}
      />
    );

    expect(screen.getByText('I found one change.')).toBeInTheDocument();
    expect(screen.queryByText(/1 match in 1 file/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Search: needle' }));
    expect(screen.getByText(/1 match in 1 file/)).toBeInTheDocument();
    expect(screen.getByText('const needle = true;')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /src\/App\.tsx/ }));
    expect(screen.getByText('const needle = false;')).toBeInTheDocument();
  });

  it('shows only the final operation when a model repeats the same path', () => {
    render(
      <MessageHarness
        message={{
          id: 'assistant-duplicates',
          role: 'assistant',
          content: 'Two edits are proposed.',
          createdAt: 3,
          ops: [
            {
              type: 'write',
              path: 'src/shared.ts',
              content: 'const firstPass = true;',
              addedLines: [0],
            },
            {
              type: 'write',
              path: 'src/shared.ts',
              content: 'const secondPass = true;',
              addedLines: [0],
            },
          ],
        }}
      />
    );

    const operationButtons = screen.getAllByRole('button', { name: /src\/shared\.ts/ });
    expect(operationButtons).toHaveLength(1);

    fireEvent.click(operationButtons[0]);
    expect(screen.queryByText('const firstPass = true;')).not.toBeInTheDocument();
    expect(screen.getByText('const secondPass = true;')).toBeInTheDocument();
  });

  it('shows delete details but keeps an in-progress operation collapsed', () => {
    const { container } = render(
      <MessageHarness
        message={{
          id: 'assistant-statuses',
          role: 'assistant',
          content: 'Applying changes.',
          createdAt: 4,
          codingPaths: ['src/loading.ts'],
          ops: [
            { type: 'delete', path: 'src/old.ts' },
            {
              type: 'write',
              path: 'src/loading.ts',
              content: 'const pending = true;',
              addedLines: [0],
            },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /src\/old\.ts/ }));
    expect(screen.getByText('Will delete this file')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /src\/loading\.ts/ }));
    expect(screen.queryByText('const pending = true;')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });
});
