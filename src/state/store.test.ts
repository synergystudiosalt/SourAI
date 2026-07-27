import { describe, expect, it, vi } from 'vitest';

import {
  createAgentEventV1,
  type AgentEventInputV1,
  type AgentEventPayloadsV1,
  type AgentEventTypeV1,
  type AgentEventV1,
} from '../contracts/events';
import { replayAgentEvents, selectVisibleAgentState } from './domain';
import { createAgentDomainStore } from './store';

function event<T extends AgentEventTypeV1>(
  type: T,
  sequence: number,
  payload: AgentEventPayloadsV1[T],
  id = `event-${sequence}`,
): AgentEventV1<T> {
  return createAgentEventV1({
    id,
    type,
    projectId: 'project-1',
    threadId: 'thread-1',
    runId: 'run-1',
    sequence,
    createdAt: 2_000 + sequence,
    correlationId: 'correlation-1',
    payload,
  } as unknown as AgentEventInputV1<T>);
}

function stream(): AgentEventV1[] {
  return [
    event('run.created', 0, {
      input: { message: 'Answer this.', mode: 'ask' },
    }),
    event('run.status_changed', 1, { status: 'running' }),
    event('provider.request_started', 2, {
      requestId: 'provider-request-1',
      providerId: 'provider-1',
      modelId: 'model-1',
    }),
    event('provider.output_delta', 3, {
      requestId: 'provider-request-1',
      delta: 'Answer',
    }),
    event('assistant.message_completed', 4, {
      messageId: 'message-1',
      content: 'Answer',
    }),
    event('run.completed', 5, { finalMessageId: 'message-1' }),
  ];
}

describe('createAgentDomainStore', () => {
  it('reconstructs the same visible state as direct event replay', () => {
    const events = stream();
    const store = createAgentDomainStore();

    for (const item of events) {
      expect(store.dispatch(item)).toBe(true);
    }

    expect(store.getVisibleState()).toEqual(
      selectVisibleAgentState(replayAgentEvents(events)),
    );
  });

  it('does not notify subscribers for duplicate event IDs', () => {
    const store = createAgentDomainStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const created = stream()[0];

    expect(store.dispatch(created)).toBe(true);
    expect(store.dispatch(created)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(
      store.dispatch(event('run.status_changed', 1, { status: 'running' })),
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('applies batches atomically when a later event is invalid', () => {
    const store = createAgentDomainStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const events = stream();
    const stale = event(
      'usage.changed',
      0,
      { inputTokens: 1, outputTokens: 1 },
      'stale-event',
    );

    expect(() => store.dispatchMany([events[0], events[1], stale])).toThrow();
    expect(store.getVisibleState().runs['run-1']).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies once for an accepted batch and counts only new IDs', () => {
    const events = stream();
    const store = createAgentDomainStore([events[0]]);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.dispatchMany([events[0], events[1], events[2]])).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getVisibleState().runs['run-1'].lastSequence).toBe(2);
  });

  it('returns deeply immutable snapshots without replay metadata', () => {
    const events = stream();
    const store = createAgentDomainStore(events);
    const state = store.getState();
    const visible = store.getVisibleState();
    const run = visible.runs['run-1'];

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(visible)).toBe(true);
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.messages)).toBe(true);
    expect('processedEventIds' in state).toBe(false);
    expect('lastSequenceByRun' in state).toBe(false);
    expect(Reflect.set(run, 'lastSequence', 999)).toBe(false);
    expect(() =>
      (run.messages as unknown as Array<unknown>).push({}),
    ).toThrow();

    expect(store.dispatch(structuredClone(events[0]))).toBe(false);
    expect(store.getVisibleState().runs['run-1'].lastSequence).toBe(5);
  });
});
