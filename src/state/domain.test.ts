import { describe, expect, it } from 'vitest';

import {
  createAgentEventV1,
  type AgentEventInputV1,
  type AgentEventPayloadsV1,
  type AgentEventTypeV1,
  type AgentEventV1,
} from '../contracts/events';
import { SourError } from '../contracts/errors';
import {
  createAgentDomainState,
  reduceAgentEvent,
  replayAgentEvents,
  selectVisibleAgentState,
} from './domain';

function event<T extends AgentEventTypeV1>(
  type: T,
  sequence: number,
  payload: AgentEventPayloadsV1[T],
  overrides: Partial<{
    id: string;
    projectId: string;
    threadId: string;
    runId: string;
    createdAt: number;
    causationId: string;
    correlationId: string;
  }> = {},
): AgentEventV1<T> {
  return createAgentEventV1({
    id: `event-${sequence}`,
    type,
    projectId: 'project-1',
    threadId: 'thread-1',
    runId: 'run-1',
    sequence,
    createdAt: 1_700_000_000_000 + sequence,
    correlationId: 'correlation-1',
    payload,
    ...overrides,
  } as unknown as AgentEventInputV1<T>);
}

function runCreated(sequence = 0): AgentEventV1<'run.created'> {
  return event('run.created', sequence, {
    input: {
      message: 'Build the feature.',
      mode: 'write',
      providerId: 'provider-1',
      modelId: 'model-1',
    },
  });
}

describe('reduceAgentEvent', () => {
  it('derives visible run state from lifecycle events', () => {
    const events: AgentEventV1[] = [
      runCreated(),
      event('run.status_changed', 1, { status: 'running' }),
      event('provider.request_started', 2, {
        requestId: 'provider-request-1',
        providerId: 'provider-1',
        modelId: 'model-1',
      }),
      event('provider.output_delta', 3, {
        requestId: 'provider-request-1',
        delta: 'Hel',
      }),
      event('provider.output_delta', 4, {
        requestId: 'provider-request-1',
        delta: 'lo',
      }),
      event('assistant.message_completed', 5, {
        messageId: 'message-1',
        content: 'Hello',
        modelId: 'model-1',
      }),
      event('tool.proposed', 6, {
        toolCallId: 'tool-1',
        toolName: 'workspace.write',
        summary: 'Write one file',
      }),
      event('approval.requested', 7, {
        approvalId: 'approval-1',
        toolCallId: 'tool-1',
        summary: 'Allow one workspace write',
        risk: 'medium',
      }),
      event('approval.resolved', 8, {
        approvalId: 'approval-1',
        decision: 'approved',
      }),
      event('tool.started', 9, { toolCallId: 'tool-1' }),
      event('tool.progress', 10, {
        toolCallId: 'tool-1',
        message: 'Writing',
        percent: 50,
      }),
      event('tool.completed', 11, {
        toolCallId: 'tool-1',
        summary: 'File written',
        artifactIds: ['artifact-1'],
      }),
      event('file.transaction_started', 12, {
        transactionId: 'transaction-1',
        paths: ['src/new.ts'],
      }),
      event('file.transaction_completed', 13, {
        transactionId: 'transaction-1',
        revision: 2,
        changedPaths: ['src/new.ts'],
      }),
      event('checkpoint.created', 14, {
        checkpointId: 'checkpoint-1',
        revision: 2,
      }),
      event('todo.changed', 15, {
        items: [
          { id: 'todo-1', title: 'Verify the change', status: 'completed' },
        ],
      }),
      event('usage.changed', 16, {
        inputTokens: 250,
        outputTokens: 80,
        estimatedCostUsd: 0.02,
      }),
      event('run.completed', 17, { finalMessageId: 'message-1' }),
    ];

    const state = replayAgentEvents(events);
    const visible = selectVisibleAgentState(state);
    const run = visible.runs['run-1'];

    expect(visible.threads['thread-1'].runIds).toEqual(['run-1']);
    expect(run.status).toBe('completed');
    expect(run.assistantDraft).toBe('');
    expect(run.messages).toEqual([
      {
        id: 'message-1',
        role: 'assistant',
        content: 'Hello',
        modelId: 'model-1',
        createdAt: 1_700_000_000_005,
      },
    ]);
    expect(run.tools['tool-1']).toMatchObject({
      status: 'completed',
      progressPercent: 100,
      artifactIds: ['artifact-1'],
    });
    expect(run.approvals['approval-1'].status).toBe('approved');
    expect(run.fileTransactions['transaction-1']).toMatchObject({
      status: 'completed',
      revision: 2,
      changedPaths: ['src/new.ts'],
    });
    expect(run.todos[0].status).toBe('completed');
    expect(run.usage).toEqual({
      inputTokens: 250,
      outputTokens: 80,
      estimatedCostUsd: 0.02,
    });
    expect(run.lastSequence).toBe(17);
  });

  it('ignores an exact duplicate but rejects a conflicting reuse of its ID', () => {
    const created = runCreated();
    const state = reduceAgentEvent(createAgentDomainState(), created);

    expect(reduceAgentEvent(state, structuredClone(created))).toBe(state);
    expect(() =>
      reduceAgentEvent(state, { ...created, sequence: 99 }),
    ).toThrowError(expect.objectContaining({ code: 'event_id_conflict' }));
  });

  it('allows sequence gaps but rejects equal or decreasing sequences', () => {
    const created = runCreated(3);
    const running = event('run.status_changed', 10, { status: 'running' });
    const state = replayAgentEvents([created, running]);
    const stale = event(
      'usage.changed',
      9,
      { inputTokens: 1, outputTokens: 1 },
      { id: 'stale-event' },
    );

    expect(state.visible.runs['run-1'].lastSequence).toBe(10);

    try {
      reduceAgentEvent(state, stale);
      throw new Error('Expected the stale event to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(SourError);
      expect((error as SourError).code).toBe('event_sequence_non_monotonic');
      expect((error as SourError).causeCategory).toBe('validation');
    }
  });

  it('rejects events before run creation and events that change run context', () => {
    const beforeCreation = event('run.status_changed', 0, {
      status: 'running',
    });
    expect(() =>
      reduceAgentEvent(createAgentDomainState(), beforeCreation),
    ).toThrowError(
      expect.objectContaining({ code: 'event_run_not_created' }),
    );

    const createdState = reduceAgentEvent(
      createAgentDomainState(),
      runCreated(),
    );
    const wrongThread = event(
      'run.status_changed',
      1,
      { status: 'running' },
      { id: 'wrong-thread-event', threadId: 'thread-2' },
    );

    expect(() => reduceAgentEvent(createdState, wrongThread)).toThrowError(
      expect.objectContaining({
        code: 'event_run_context_mismatch',
      }),
    );
  });

  it('copies event-owned arrays and objects into derived state', () => {
    const attachmentIds = ['attachment-1'];
    const created = event('run.created', 0, {
      input: {
        message: 'Use this attachment.',
        mode: 'ask',
        attachmentIds,
      },
    });
    const todoItems = [
      {
        id: 'todo-1',
        title: 'Original title',
        status: 'pending' as const,
      },
    ];
    const running = event('run.status_changed', 1, { status: 'running' });
    const todoChanged = event('todo.changed', 2, { items: todoItems });
    const state = replayAgentEvents([created, running, todoChanged]);

    attachmentIds.push('attachment-2');
    todoItems[0].title = 'Mutated title';

    const run = state.visible.runs['run-1'];
    expect(run.input.attachmentIds).toEqual(['attachment-1']);
    expect(run.todos[0].title).toBe('Original title');
  });

  it('rejects entity ID reuse, including reuse in another run', () => {
    const runA = [
      event(
        'run.created',
        0,
        { input: { message: 'A', mode: 'ask' } },
        { id: 'run-a-created', runId: 'run-a', correlationId: 'run-a-correlation' },
      ),
      event(
        'run.status_changed',
        1,
        { status: 'running' },
        { id: 'run-a-running', runId: 'run-a', correlationId: 'run-a-correlation' },
      ),
      event(
        'assistant.message_completed',
        2,
        { messageId: 'shared-message', content: 'A' },
        { id: 'run-a-message', runId: 'run-a', correlationId: 'run-a-correlation' },
      ),
    ];
    const runB = [
      event(
        'run.created',
        0,
        { input: { message: 'B', mode: 'ask' } },
        { id: 'run-b-created', runId: 'run-b', correlationId: 'run-b-correlation' },
      ),
      event(
        'run.status_changed',
        1,
        { status: 'running' },
        { id: 'run-b-running', runId: 'run-b', correlationId: 'run-b-correlation' },
      ),
    ];
    const state = replayAgentEvents([...runA, ...runB]);
    const reusedMessage = event(
      'assistant.message_completed',
      2,
      { messageId: 'shared-message', content: 'B' },
      { id: 'run-b-message', runId: 'run-b', correlationId: 'run-b-correlation' },
    );

    expect(() => reduceAgentEvent(state, reusedMessage)).toThrowError(
      expect.objectContaining({ code: 'event_entity_id_reused' }),
    );
  });

  it('rejects illegal run, terminal, and tool lifecycle transitions', () => {
    const createdState = reduceAgentEvent(
      createAgentDomainState(),
      runCreated(),
    );
    expect(() =>
      reduceAgentEvent(
        createdState,
        event('run.completed', 1, {}),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'event_run_transition_invalid' }),
    );

    const runningState = reduceAgentEvent(
      createdState,
      event('run.status_changed', 1, { status: 'running' }),
    );
    const terminalState = reduceAgentEvent(
      runningState,
      event('run.completed', 2, {}),
    );
    expect(() =>
      reduceAgentEvent(
        terminalState,
        event(
          'usage.changed',
          3,
          { inputTokens: 2, outputTokens: 1 },
          { id: 'post-terminal-event' },
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: 'event_run_terminal' }));

    const proposedState = reduceAgentEvent(
      runningState,
      event(
        'tool.proposed',
        2,
        { toolCallId: 'tool-1', toolName: 'workspace.write' },
        { id: 'tool-proposed-event' },
      ),
    );
    expect(() =>
      reduceAgentEvent(
        proposedState,
        event(
          'tool.progress',
          3,
          { toolCallId: 'tool-1', message: 'Too early' },
          { id: 'tool-progress-event' },
        ),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'event_tool_transition_invalid' }),
    );
  });

  it('derives thread timestamps and serialization independently of run order', () => {
    const laterRun = event(
      'run.created',
      0,
      { input: { message: 'Later', mode: 'ask' } },
      {
        id: 'later-run-created',
        runId: 'run-z',
        correlationId: 'correlation-z',
        createdAt: 200,
      },
    );
    const earlierRun = event(
      'run.created',
      0,
      { input: { message: 'Earlier', mode: 'ask' } },
      {
        id: 'earlier-run-created',
        runId: 'run-a',
        correlationId: 'correlation-a',
        createdAt: 100,
      },
    );

    const forward = replayAgentEvents([laterRun, earlierRun]).visible;
    const reverse = replayAgentEvents([earlierRun, laterRun]).visible;

    expect(forward).toEqual(reverse);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse));
    expect(forward.threads['thread-1']).toMatchObject({
      runIds: ['run-a', 'run-z'],
      createdAt: 100,
      updatedAt: 200,
    });
  });

  it('clones mutable events at ingestion and deeply freezes visible state', () => {
    const mutableAttachments = ['attachment-1'];
    const mutableEvent = {
      id: 'mutable-created',
      version: 1,
      type: 'run.created',
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'mutable-run',
      sequence: 0,
      createdAt: 10,
      correlationId: 'mutable-correlation',
      payload: {
        input: {
          message: 'Original',
          mode: 'ask',
          attachmentIds: mutableAttachments,
        },
      },
    } as AgentEventV1<'run.created'>;
    const state = reduceAgentEvent(createAgentDomainState(), mutableEvent);

    mutableAttachments.push('attachment-2');
    (
      mutableEvent.payload.input as { message: string }
    ).message = 'Changed';

    const visibleRun = state.visible.runs['mutable-run'];
    expect(visibleRun.input.message).toBe('Original');
    expect(visibleRun.input.attachmentIds).toEqual(['attachment-1']);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.visible)).toBe(true);
    expect(Object.isFrozen(visibleRun)).toBe(true);
    expect(Object.isFrozen(visibleRun.input.attachmentIds)).toBe(true);
    expect(Reflect.set(visibleRun, 'status', 'completed')).toBe(false);
    expect('processedEventIds' in state).toBe(false);
    expect('lastSequenceByRun' in state).toBe(false);
  });
});
