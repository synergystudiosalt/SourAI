import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookWorkspace } from './NotebookWorkspace';
import {
  createNotebook,
  type Notebook,
  type NotebookSource,
} from '../../features/notebook/types';

/**
 * The Notebook's contract with the user: an answer is written from the selected
 * sources, it is attributed, and nothing generated is lost when they navigate.
 */

function source(overrides: Partial<NotebookSource> = {}): NotebookSource {
  return {
    id: 'source-1',
    title: 'Deep Work',
    kind: 'text',
    content: 'Focused work produces rare and valuable output.',
    addedAt: Date.now(),
    selected: true,
    summaryState: 'idle',
    ...overrides,
  };
}

function notebookWith(sources: NotebookSource[]): Notebook {
  return { ...createNotebook('Research'), sources };
}

interface StubResponses {
  overview?: unknown;
  chat?: unknown;
  studio?: unknown;
  source_summary?: unknown;
  status?: number;
}

function stubNotebookApi(responses: StubResponses = {}) {
  const calls: { action: string; body: any }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ action: body.action, body });
    const payload =
      body.action === 'overview'
        ? (responses.overview ?? {
            title: 'Research',
            summary: 'These sources describe focused work.',
            topics: ['Focus'],
            questions: ['What is deep work?'],
          })
        : body.action === 'studio'
          ? (responses.studio ?? { text: '## Review questions\n1. What is focus? [1]', sourceIds: ['source-1'] })
          : body.action === 'source_summary'
            ? (responses.source_summary ?? { summary: 'A short book about focus.', topics: ['Focus'] })
            : (responses.chat ?? {
                text: 'Deep work produces rare and valuable output [1].',
                sourceIds: ['source-1'],
              });
    return {
      ok: (responses.status ?? 200) < 400,
      status: responses.status ?? 200,
      headers: { get: () => 'application/json' },
      json: async () => payload,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

/** Hosts the workspace with the same state ownership `App` gives it. */
const Harness: React.FC<{ initial: Notebook; units?: number; onUpgrade?: () => void }> = ({
  initial,
  units = 0,
  onUpgrade = () => {},
}) => {
  const [notebook, setNotebook] = useState(initial);
  return (
    <NotebookWorkspace
      notebook={notebook}
      onChange={(update) => setNotebook((current) => update(current))}
      selectedModel="sour-omni-flash"
      onSelectModel={() => {}}
      messageUnitsUsed={units}
      onConsumeMessageUnit={() => {}}
      onOpenUpgrade={onUpgrade}
    />
  );
};

describe('NotebookWorkspace', () => {
  beforeEach(() => {
    stubNotebookApi();
  });

  it('asks the user for a source before it will answer anything', () => {
    render(<Harness initial={createNotebook('Empty')} />);

    expect(screen.getByText('Add a source to get started')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Ask anything/)).not.toBeInTheDocument();
  });

  it('answers from the selected sources and attributes the claim', async () => {
    const user = userEvent.setup();
    const calls = stubNotebookApi();
    render(<Harness initial={notebookWith([source()])} />);

    await user.type(await screen.findByPlaceholderText(/Ask anything/), 'What is deep work?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByText(/Deep work produces rare and valuable output/)).toBeInTheDocument();
    // The citation is rendered as its own control so it can be followed back
    // to the source it came from.
    expect(await screen.findByRole('button', { name: 'Source 1: Deep Work' })).toBeInTheDocument();

    const chat = calls.find((call) => call.action === 'chat');
    expect(chat?.body.sources).toHaveLength(1);
    expect(chat?.body.sources[0].content).toContain('Focused work');
  });

  it('sends only the sources that are still selected', async () => {
    const user = userEvent.setup();
    const calls = stubNotebookApi();
    render(
      <Harness
        initial={notebookWith([
          source(),
          source({ id: 'source-2', title: 'Distraction', content: 'Notifications fragment attention.' }),
        ])}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Use Distraction' }));
    await user.type(await screen.findByPlaceholderText(/Ask anything/), 'Summarise');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    await waitFor(() => expect(calls.some((call) => call.action === 'chat')).toBe(true));
    const chat = calls.find((call) => call.action === 'chat');
    expect(chat?.body.sources.map((entry: any) => entry.id)).toEqual(['source-1']);
  });

  it('cannot be asked a question with every source deselected', async () => {
    const user = userEvent.setup();
    render(<Harness initial={notebookWith([source()])} />);

    await user.click(screen.getByRole('checkbox', { name: 'Use Deep Work' }));

    expect(
      await screen.findByPlaceholderText('Select at least one source to ask a question')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
  });

  it('surfaces a failure from the service instead of a silent empty answer', async () => {
    const user = userEvent.setup();
    stubNotebookApi({ chat: { error: 'The notebook service is unavailable.' }, status: 503 });
    render(<Harness initial={notebookWith([source()])} />);

    await user.type(await screen.findByPlaceholderText(/Ask anything/), 'Anything?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The notebook service is unavailable.');
  });

  it('generates a study guide into the studio and opens it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={notebookWith([source()])} />);

    await user.click(screen.getByRole('button', { name: /Study guide/ }));

    expect(await screen.findByRole('region', { name: /Studio output: Study guide/ })).toBeInTheDocument();
    expect(screen.getByText('Review questions')).toBeInTheDocument();
  });

  it('renders a generated mind map as an explorable tree, not raw Markdown', async () => {
    const user = userEvent.setup();
    stubNotebookApi({
      studio: {
        text: '- Focus\n  - Deep work\n    - Flow\n  - Shallow work',
        sourceIds: ['source-1'],
      },
    });
    render(<Harness initial={notebookWith([source()])} />);

    await user.click(screen.getByRole('button', { name: /Mind map/ }));

    const viewer = await screen.findByRole('region', { name: /Studio output: Mind map/ });
    expect(within(viewer).getByText('Deep work')).toBeInTheDocument();
    // Third-level nodes stay collapsed until their branch is opened.
    expect(within(viewer).queryByText('Flow')).not.toBeInTheDocument();

    await user.click(within(viewer).getByText('Deep work'));
    expect(await within(viewer).findByText('Flow')).toBeInTheDocument();
  });

  it('opens a source to show exactly the text the model was given', async () => {
    const user = userEvent.setup();
    render(<Harness initial={notebookWith([source()])} />);

    // Anchored so this does not also match the row's "Remove Deep Work" control.
    await user.click(screen.getByRole('button', { name: /^Deep Work/ }));

    const viewer = await screen.findByRole('region', { name: 'Source: Deep Work' });
    expect(within(viewer).getByText(/Focused work produces rare and valuable output/)).toBeInTheDocument();
  });

  it('saves an answer as a note that survives leaving the view', async () => {
    const user = userEvent.setup();
    render(<Harness initial={notebookWith([source()])} />);

    await user.type(await screen.findByPlaceholderText(/Ask anything/), 'What is deep work?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await screen.findByText(/Deep work produces rare and valuable output/);

    await user.click(await screen.findByRole('button', { name: /Save to note/ }));

    const studio = screen.getByRole('region', { name: 'Studio' });
    const saved = await within(studio).findByTitle(/Deep work produces rare/);
    await user.click(saved);

    expect(await screen.findByRole('region', { name: /Studio output/ })).toBeInTheDocument();
  });

  it('builds the notebook guide from the sources on open', async () => {
    const calls = stubNotebookApi();
    render(<Harness initial={notebookWith([source()])} />);

    expect(await screen.findByText('These sources describe focused work.')).toBeInTheDocument();
    expect(calls.filter((call) => call.action === 'overview')).toHaveLength(1);
  });

  it('offers the upgrade path instead of asking once the quota is spent', async () => {
    const user = userEvent.setup();
    const onUpgrade = vi.fn();
    const calls = stubNotebookApi();
    render(<Harness initial={notebookWith([source()])} units={9999} onUpgrade={onUpgrade} />);

    await user.type(await screen.findByPlaceholderText(/Ask anything/), 'Anything?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(onUpgrade).toHaveBeenCalled();
    expect(calls.some((call) => call.action === 'chat')).toBe(false);
  });
});
