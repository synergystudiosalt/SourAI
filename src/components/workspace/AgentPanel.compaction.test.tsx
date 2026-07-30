import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estimateHistoryTokens, type CompactableMessage } from '../../agent/context/compaction';
import { getClientPersistence } from '../../storage/clientPersistence';
import type { AgentChatMessage } from '../../types';
import { AgentPanel } from './AgentPanel';

function streamedTurn(text: string): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ done: true, text })}\n\n`
        )
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonTurn(text: string, status = 200): Response {
  return new Response(JSON.stringify({ text }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPanel(projectId: string): void {
  render(
    <AgentPanel
      isDarkMode={false}
      isCollapsed={false}
      onToggleCollapse={vi.fn()}
      projectId={projectId}
      projectName="Compaction test"
      files={[]}
      activeFile={null}
      onApplyOps={vi.fn().mockResolvedValue(true)}
      onOpenFile={vi.fn()}
    />
  );
}

function send(text: string): void {
  fireEvent.change(
    screen.getByPlaceholderText('Message Agent, @ for context, / for commands'),
    { target: { value: text } }
  );
  fireEvent.click(screen.getByTitle('Send'));
}

function longMessages(): AgentChatMessage[] {
  return Array.from({ length: 9 }, (_, index) => ({
    id: `old-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `history-marker-${index} ${'x'.repeat(1_700)}`,
    createdAt: index + 1,
  }));
}

async function seedLongThread(projectId: string): Promise<AgentChatMessage[]> {
  const messages = longMessages();
  const persistence = await getClientPersistence();
  await persistence.saveAgentMessages(projectId, 'Compaction test', messages);
  return messages;
}

async function waitForHydration(): Promise<void> {
  await screen.findByText(/history-marker-8/);
}

function callsFor(pathname: string) {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes(pathname));
}

describe('AgentPanel conversation compaction', () => {
  it('skips compaction for a short thread', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(streamedTurn('Short answer.'));
    renderPanel('compaction-short');

    send('hello');

    expect(await screen.findByText('Short answer.')).toBeInTheDocument();
    expect(callsFor('/api/chat')).toHaveLength(0);
    expect(callsFor('/api/agent')).toHaveLength(1);
  });

  it('summarises a long thread exactly once and sends a smaller history', async () => {
    const original = await seedLongThread('compaction-long');
    let agentPayload: { messages: CompactableMessage[] } | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes('/api/chat')) return jsonTurn('The earlier work is summarised.');
      agentPayload = JSON.parse(String(init?.body));
      return streamedTurn('Long-thread answer.');
    });
    renderPanel('compaction-long');
    await waitForHydration();

    send('continue');

    expect(await screen.findByText('Long-thread answer.')).toBeInTheDocument();
    expect(callsFor('/api/chat')).toHaveLength(1);
    expect(callsFor('/api/agent')).toHaveLength(1);
    const summaryPayload = JSON.parse(String(callsFor('/api/chat')[0][1]?.body));
    expect(summaryPayload.model).toBe('sour-omni-flash');
    expect(agentPayload).toBeDefined();

    const uncompacted: CompactableMessage[] = [
      ...original.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: 'continue' },
    ];
    expect(agentPayload!.messages.length).toBeLessThan(uncompacted.length);
    expect(estimateHistoryTokens(agentPayload!.messages)).toBeLessThan(
      estimateHistoryTokens(uncompacted)
    );
  });

  it('reuses the cached prefix summary on the next turn', async () => {
    await seedLongThread('compaction-cache');
    let agentTurn = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes('/api/chat')) return jsonTurn('Cached earlier work.');
      agentTurn += 1;
      return streamedTurn(`Agent answer ${agentTurn}.`);
    });
    renderPanel('compaction-cache');
    await waitForHydration();

    send('first continuation');
    expect(await screen.findByText('Agent answer 1.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle('Send')).toBeInTheDocument());

    send('second continuation');
    expect(await screen.findByText('Agent answer 2.')).toBeInTheDocument();

    expect(callsFor('/api/chat')).toHaveLength(1);
    expect(callsFor('/api/agent')).toHaveLength(2);
    const secondAgentPayload = JSON.parse(String(callsFor('/api/agent')[1][1]?.body));
    expect(secondAgentPayload.messages[0].content).toContain('[Earlier in this conversation]');
    expect(secondAgentPayload.messages[0].content).toContain('Cached earlier work.');
  });

  it('still sends the user turn when summarising fails', async () => {
    await seedLongThread('compaction-failure');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes('/api/chat')) return jsonTurn('', 503);
      return streamedTurn('Answer after summary failure.');
    });
    renderPanel('compaction-failure');
    await waitForHydration();

    send('continue despite failure');

    expect(await screen.findByText('Answer after summary failure.')).toBeInTheDocument();
    expect(callsFor('/api/chat')).toHaveLength(1);
    expect(callsFor('/api/agent')).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith(
      '[sour.ai] Conversation compaction skipped',
      expect.any(Error)
    );
  });
});
