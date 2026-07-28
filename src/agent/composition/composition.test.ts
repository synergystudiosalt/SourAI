import { describe, expect, it } from 'vitest';

import type { AgentEventV1 } from '../../contracts/events';
import { ContextScope } from '../context/scope';
import { buildWorkspaceSnapshot, type WorkspaceSnapshotV1 } from '../context/snapshot';
import { DeterministicFakeProvider } from '../providers/fakeProvider';
import type { ProviderStreamEvent } from '../providers/types';
import { MemoryEventSink } from '../replay';
import { createAgentComposition } from './index';

const digest = async (bytes: Uint8Array) =>
  bytes.byteLength.toString(16).padStart(64, '0').slice(0, 64);

async function snapshot(): Promise<WorkspaceSnapshotV1> {
  return buildWorkspaceSnapshot(
    'project-1',
    2,
    [
      { path: 'src/app.ts', content: 'export const answer = 42;', isLoaded: true },
      { path: 'src/util.ts', content: 'export const helper = true;', isLoaded: true },
      { path: '.env', content: 'API_KEY=super-secret', isLoaded: true },
    ],
    ContextScope.projectDefault(),
    undefined,
    digest
  );
}

function toolCall(name: string, args: unknown, id = 'call-1'): ProviderStreamEvent {
  return { type: 'tool_call', call: { id, name, arguments: args } };
}

async function runWith(
  scripts: readonly { events: readonly ProviderStreamEvent[] }[],
  overrides: { mode?: 'ask' | 'plan' | 'write'; contextPaths?: readonly string[] } = {}
) {
  const sink = new MemoryEventSink();
  const provider = new DeterministicFakeProvider(scripts);
  const composition = createAgentComposition({
    sink,
    snapshot: await snapshot(),
    scope: ContextScope.projectDefault(),
    providerId: 'fake',
    modelId: 'fake-model',
    contextPaths: overrides.contextPaths ?? ['src/app.ts'],
    provider,
  });
  const runId = await composition.runtime.start({
    projectId: 'project-1',
    threadId: 'thread-1',
    input: { message: 'Explain the workspace', mode: overrides.mode ?? 'ask' },
  });
  await composition.runtime.wait(runId);
  const events = await sink.listRun(runId);
  return { composition, provider, events, runId };
}

const typesOf = (events: readonly AgentEventV1[]) => events.map((event) => event.type);

describe('createAgentComposition', () => {
  it('streams a provider response through to durable events', async () => {
    const { events } = await runWith([
      {
        events: [
          { type: 'text_delta', text: 'Hello ' },
          { type: 'text_delta', text: 'world' },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
          { type: 'completed', finishReason: 'stop' },
        ],
      },
    ]);

    expect(typesOf(events)).toContain('assistant.message_completed');
    const completed = events.find((event) => event.type === 'assistant.message_completed');
    expect(completed?.payload).toMatchObject({ content: 'Hello world' });
    expect(typesOf(events).at(-1)).toBe('run.completed');
  });

  it('sends only the approved context files to the provider', async () => {
    const { provider } = await runWith([
      { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
    ]);

    const prompt = provider.requests[0].messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('export const answer = 42;');
    expect(prompt).not.toContain('src/util.ts');
    expect(prompt).not.toContain('super-secret');
    expect(prompt).not.toContain('<file path=".env"');
  });

  it('executes a valid read tool and returns its result on the next turn', async () => {
    const { events, provider } = await runWith([
      {
        events: [
          toolCall('read_file', { path: 'src/util.ts' }),
          { type: 'completed', finishReason: 'tool_calls' },
        ],
      },
      {
        events: [
          { type: 'text_delta', text: 'The helper is true.' },
          { type: 'completed', finishReason: 'stop' },
        ],
      },
    ]);

    expect(typesOf(events)).toEqual(
      expect.arrayContaining(['tool.proposed', 'tool.started', 'tool.completed'])
    );
    expect(provider.requests).toHaveLength(2);
    const followUp = provider.requests[1].messages.map((message) => message.content).join('\n');
    expect(followUp).toContain('export const helper = true;');
    expect(followUp).toContain('read_file');
  });

  it('refuses a tool read outside the context scope', async () => {
    const { events } = await runWith([
      {
        events: [toolCall('read_file', { path: '.env' }), { type: 'completed', finishReason: 'tool_calls' }],
      },
      { events: [{ type: 'text_delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] },
    ]);

    const failure = events.find((event) => event.type === 'tool.failed');
    expect(failure).toBeDefined();
    expect(JSON.stringify(events)).not.toContain('super-secret');
  });

  it('rejects a malformed tool call before any handler runs', async () => {
    const { events } = await runWith([
      {
        events: [
          toolCall('read_file', { path: '../../etc/passwd' }),
          toolCall('read_file', { path: 'src/app.ts', unexpected: true }, 'call-2'),
          toolCall('no_such_tool', {}, 'call-3'),
          { type: 'completed', finishReason: 'tool_calls' },
        ],
      },
      { events: [{ type: 'text_delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] },
    ]);

    const failures = events.filter((event) => event.type === 'tool.failed');
    expect(failures).toHaveLength(2);
    expect(typesOf(events)).toContain('tool.validation_failed');
  });

  it('never lets Ask or Plan reach a mutating tool', async () => {
    for (const mode of ['ask', 'plan'] as const) {
      const { events } = await runWith(
        [
          {
            events: [
              toolCall('propose_file_changes', { summary: 'x', changes: [] }),
              { type: 'completed', finishReason: 'tool_calls' },
            ],
          },
          { events: [{ type: 'text_delta', text: 'x' }, { type: 'completed', finishReason: 'stop' }] },
        ],
        { mode }
      );
      expect(typesOf(events)).toContain('tool.validation_failed');
      expect(typesOf(events)).not.toContain('tool.started');
    }
  });

  it('exposes no mutation path even in Write mode', async () => {
    const { composition, events } = await runWith(
      [
        {
          events: [
            toolCall('propose_file_changes', { summary: 'x', changes: [] }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'x' }, { type: 'completed', finishReason: 'stop' }] },
      ],
      { mode: 'write' }
    );

    // The tool is not registered at all in this phase.
    expect(composition.capabilities.toolNames).not.toContain('propose_file_changes');
    expect(composition.capabilities.mutation.available).toBe(false);
    expect(typesOf(events)).toContain('tool.failed');
    await expect(
      composition.filesystem.writeFile(
        'src/app.ts' as never,
        new Uint8Array(),
        { type: 'create-only', projectRevision: 2 }
      )
    ).rejects.toThrow(/mutation/i);
  });

  it('reports capabilities that describe this composition, not intentions', async () => {
    const { composition } = await runWith([
      { events: [{ type: 'text_delta', text: 'x' }, { type: 'completed', finishReason: 'stop' }] },
    ]);

    expect(composition.capabilities.filesystem.available).toBe(true);
    expect(composition.capabilities.context.fileCount).toBe(2);
    expect(composition.capabilities.context.excludedCount).toBe(1);
    expect(composition.capabilities.egress.kind).toBe('local');
    expect(composition.capabilities.toolNames).toContain('read_file');
  });

  it('keeps a session credential out of every emitted event', async () => {
    const sink = new MemoryEventSink();
    const provider = new DeterministicFakeProvider([
      { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
    ]);
    const composition = createAgentComposition({
      sink,
      snapshot: await snapshot(),
      scope: ContextScope.projectDefault(),
      providerId: 'fake',
      modelId: 'fake-model',
      contextPaths: ['src/app.ts'],
      credential: () => 'sk-live-canary-value',
      provider,
    });
    const runId = await composition.runtime.start({
      projectId: 'project-1',
      threadId: 'thread-1',
      input: { message: 'hi', mode: 'ask' },
    });
    await composition.runtime.wait(runId);

    expect(JSON.stringify(await sink.listRun(runId))).not.toContain('sk-live-canary-value');
  });
});
