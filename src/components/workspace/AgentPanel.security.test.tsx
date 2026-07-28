import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SECRET_CANARIES, expectNoSecrets } from '../../test/assertions';
import { AgentPanel, MiniMarkdown, parseAgentStreamEvent } from './AgentPanel';

describe('AgentPanel Markdown image privacy', () => {
  it('does not materialize a model-provided remote image before consent', () => {
    render(<MiniMarkdown text="![build result](https://tracker.example/build.png)" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Load remote image from tracker\.example/i }));

    const image = screen.getByRole('img', { name: 'build result' });
    expect(image).toHaveAttribute('src', 'https://tracker.example/build.png');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});

describe('AgentPanel provider error privacy', () => {
  it('normalizes an SSE error payload before throwing it', () => {
    let thrown: unknown;
    try {
      parseAgentStreamEvent(
        JSON.stringify({ error: `provider rejected ${SECRET_CANARIES.anthropic}` })
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expectNoSecrets(thrown instanceof Error ? thrown.message : thrown, 'parsed SSE provider error');
  });

  it('renders a streamed provider error without exposing its credential', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ error: `stream failed with ${SECRET_CANARIES.groq}` })}\n\n`
          )
        );
        controller.close();
      },
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );

    render(
      <AgentPanel
        isDarkMode={false}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
        projectId="error-test"
        projectName="Error test"
        files={[]}
        activeFile={null}
        onApplyOps={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );
    fireEvent.change(
      screen.getByPlaceholderText('Message Agent, @ for context, / for commands'),
      { target: { value: 'hello' } }
    );
    fireEvent.click(screen.getByTitle('Send'));

    expect(await screen.findByText(/stream failed with/i)).toBeInTheDocument();
    expectNoSecrets(document.body.textContent, 'rendered SSE provider error');
  });

  it('redacts a JSON server error before rendering it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: `agent request failed with ${SECRET_CANARIES.openai}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      )
    );

    render(
      <AgentPanel
        isDarkMode={false}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
        projectId="server-error-test"
        projectName="Server error test"
        files={[]}
        activeFile={null}
        onApplyOps={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );
    fireEvent.change(
      screen.getByPlaceholderText('Message Agent, @ for context, / for commands'),
      { target: { value: 'hello' } }
    );
    fireEvent.click(screen.getByTitle('Send'));

    expect(await screen.findByText(/agent request failed with/i)).toBeInTheDocument();
    expectNoSecrets(document.body.textContent, 'rendered agent server error');
  });
});

describe('AgentPanel progress gate', () => {
  it('stops when the model repeats an already completed tool request', async () => {
    const firstTurn = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              done: true,
              text: '@@readfile: src/a.ts',
              thinkingLabel: 'Inspecting files',
            })}\n\n`
          )
        );
        controller.close();
      },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(firstTurn, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: '@@readfile: src/a.ts' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    render(
      <AgentPanel
        isDarkMode={false}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
        projectId="loop-test"
        projectName="Loop test"
        files={[
          {
            id: 'src/a.ts',
            name: 'a.ts',
            path: 'src/a.ts',
            type: 'file',
            content: 'export const value = 1;',
          },
        ]}
        activeFile={null}
        onApplyOps={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );
    fireEvent.change(
      screen.getByPlaceholderText('Message Agent, @ for context, / for commands'),
      { target: { value: 'inspect the project' } }
    );
    fireEvent.click(screen.getByTitle('Send'));

    expect(
      await screen.findByText(/stopped the tool loop because the same workspace checks/i)
    ).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
