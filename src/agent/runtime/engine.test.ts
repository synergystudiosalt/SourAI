import { describe, expect, it, vi } from 'vitest';
import { createAgentEventV1, type AgentEventV1 } from '../../contracts/events';
import { MemoryEventSink, replayRun } from '../replay';
import { AgentRuntime } from './engine';
import type {
  RuntimeProvider,
  RuntimeProviderChunk,
  RuntimeToolExecutor,
} from './types';

function ids(): () => string {
  let value = 0;
  return () => `id-${value++}`;
}

const noTools: RuntimeToolExecutor = {
  isMutating: () => false,
  execute: async () => ({}),
};

function provider(
  stream: RuntimeProvider['stream'],
): RuntimeProvider {
  return { id: 'fake', modelId: 'fake-1', stream };
}

describe('AgentRuntime', () => {
  it('persists a deterministic streaming run and replays it', async () => {
    const sink = new MemoryEventSink();
    const runtime = new AgentRuntime(
      sink,
      provider(async function* () {
        yield { type: 'text.delta', delta: 'Hello ' };
        yield { type: 'text.delta', delta: 'world' };
        yield {
          type: 'usage',
          usage: { inputTokens: 4, outputTokens: 3, estimatedCostUsd: 0.01 },
        };
      }),
      noTools,
      { createId: ids(), now: () => 10 },
    );
    const runId = await runtime.start({
      projectId: 'project',
      threadId: 'thread',
      input: { message: 'Hi', mode: 'ask' },
    });
    await runtime.wait(runId);
    const replayed = replayRun(await sink.listRun(runId));
    expect(replayed.status).toBe('completed');
    expect(replayed.completedMessages).toEqual(['Hello world']);
    expect(replayed.outputTokens).toBe(3);
  });

  it('resumes an interrupted stream from persisted events', async () => {
    const sink = new MemoryEventSink();
    const base = {
      version: 1 as const,
      projectId: 'project',
      threadId: 'thread',
      runId: 'run',
      createdAt: 1,
      correlationId: 'run',
    };
    await sink.append(createAgentEventV1({
      ...base,
      id: 'created',
      sequence: 0,
      type: 'run.created',
      payload: { input: { message: 'continue', mode: 'ask' } },
    }));
    await sink.append(createAgentEventV1({
      ...base,
      id: 'started',
      sequence: 1,
      type: 'provider.request_started',
      payload: { requestId: 'old-request', providerId: 'fake', modelId: 'fake-1' },
    }));
    await sink.append(createAgentEventV1({
      ...base,
      id: 'delta',
      sequence: 2,
      type: 'provider.output_delta',
      payload: { requestId: 'old-request', delta: 'partial ' },
    }));
    const seenPartial: string[] = [];
    const runtime = new AgentRuntime(
      sink,
      provider(async function* (request) {
        seenPartial.push(request.partialAssistantMessage ?? '');
        yield { type: 'text.delta', delta: 'done' };
      }),
      noTools,
      { createId: ids(), now: () => 2 },
    );
    await runtime.resume('run');
    await runtime.wait('run');
    expect(seenPartial).toEqual(['partial ']);
    expect(replayRun(await sink.listRun('run')).completedMessages).toEqual([
      'partial done',
    ]);
  });

  it('aborts provider streaming and never schedules a later tool', async () => {
    const sink = new MemoryEventSink();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn(async () => ({}));
    const runtime = new AgentRuntime(
      sink,
      provider(async function* ({ signal }) {
        yield { type: 'text.delta', delta: 'first' };
        await blocked;
        if (signal.aborted) return;
        yield {
          type: 'tool.call',
          call: { id: 'tool', name: 'read_file', arguments: {} },
        };
      }),
      { isMutating: () => false, execute },
      { createId: ids() },
    );
    const runId = await runtime.start({
      projectId: 'project',
      threadId: 'thread',
      input: { message: 'Hi', mode: 'ask' },
    });
    await Promise.resolve();
    await runtime.cancel(runId);
    release();
    await runtime.wait(runId);
    expect(execute).not.toHaveBeenCalled();
    const events = await sink.listRun(runId);
    expect(events.some((event) => event.type === 'run.cancelled')).toBe(true);
    expect(events.some((event) => event.type === 'run.completed')).toBe(false);
  });

  it.each(['ask', 'plan'] as const)(
    'makes %s technically unable to invoke mutation tools',
    async (mode) => {
      const sink = new MemoryEventSink();
      const execute = vi.fn(async () => ({}));
      const runtime = new AgentRuntime(
        sink,
        provider(async function* () {
          yield {
            type: 'tool.call',
            call: { id: 'mutate', name: 'propose_file_changes', arguments: {} },
          };
        }),
        { isMutating: () => true, execute },
        { createId: ids() },
      );
      const runId = await runtime.start({
        projectId: 'project',
        threadId: 'thread',
        input: { message: 'mutate', mode },
      });
      await runtime.wait(runId);
      expect(execute).not.toHaveBeenCalled();
      expect((await sink.listRun(runId)).some(
        (event) => event.type === 'tool.validation_failed',
      )).toBe(true);
    },
  );

  it('queues steering as a bounded next turn', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const messages: string[] = [];
    const sink = new MemoryEventSink();
    const runtime = new AgentRuntime(
      sink,
      provider(async function* (request) {
        messages.push(request.message);
        if (request.turn === 1) await blocked;
        yield { type: 'text.delta', delta: request.message };
      }),
      noTools,
      { createId: ids() },
    );
    const runId = await runtime.start({
      projectId: 'project',
      threadId: 'thread',
      input: { message: 'first', mode: 'ask' },
    });
    runtime.steer(runId, 'second');
    release();
    await runtime.wait(runId);
    expect(messages).toEqual(['first', 'second']);
  });
});

describe('event durability boundary', () => {
  it('notifies subscribers only after append resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const stored: AgentEventV1[] = [];
    const sink = {
      append: async (event: AgentEventV1) => {
        await gate;
        stored.push(event);
        return true;
      },
      listRun: async () => stored,
      listThread: async () => stored,
    };
    const observed: AgentEventV1[] = [];
    const runtime = new AgentRuntime(
      sink,
      provider(async function* (): AsyncIterable<RuntimeProviderChunk> {}),
      noTools,
      { createId: ids() },
    );
    runtime.subscribe((event) => observed.push(event));
    const starting = runtime.start({
      projectId: 'project',
      threadId: 'thread',
      input: { message: 'Hi', mode: 'ask' },
    });
    await Promise.resolve();
    expect(observed).toHaveLength(0);
    release();
    const runId = await starting;
    await runtime.wait(runId);
    expect(observed.length).toBeGreaterThan(0);
    expect(stored.length).toBe(observed.length);
  });
});
