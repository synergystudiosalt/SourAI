import { parseAgentEventV1, type AgentEventV1 } from '../../contracts/events';
import type { RunInputV1 } from '../../contracts/commands';

export type RuntimeRunStatus =
  | 'idle'
  | 'preparing'
  | 'streaming'
  | 'awaiting_approval'
  | 'executing_tool'
  | 'verifying'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'completed';

export interface ReplayedRun {
  readonly runId: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly correlationId: string;
  readonly input: RunInputV1;
  readonly status: RuntimeRunStatus;
  readonly lastSequence: number;
  readonly draft: string;
  readonly completedMessages: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly providerRequestCount: number;
  readonly toolCallCount: number;
  readonly terminal: boolean;
}

export function replayRun(values: readonly unknown[]): ReplayedRun {
  const events = values.map(parseAgentEventV1).sort((a, b) => a.sequence - b.sequence);
  if (events.length === 0 || events[0].type !== 'run.created') {
    throw new Error('A run event stream must begin with run.created.');
  }
  const seen = new Map<string, string>();
  let expected = 0;
  let state: ReplayedRun | undefined;

  for (const event of events) {
    const fingerprint = JSON.stringify(event);
    const prior = seen.get(event.id);
    if (prior !== undefined) {
      if (prior !== fingerprint) throw new Error(`Conflicting event id: ${event.id}`);
      continue;
    }
    seen.set(event.id, fingerprint);
    if (event.sequence !== expected) {
      throw new Error(`Non-contiguous run sequence: expected ${expected}.`);
    }
    expected += 1;
    state = reduce(state, event);
  }
  return Object.freeze(state!);
}

function reduce(state: ReplayedRun | undefined, event: AgentEventV1): ReplayedRun {
  if (event.type === 'run.created') {
    if (state) throw new Error('run.created may only occur once.');
    return {
      runId: event.runId,
      projectId: event.projectId,
      threadId: event.threadId,
      correlationId: event.correlationId,
      input: event.payload.input,
      status: 'preparing',
      lastSequence: event.sequence,
      draft: '',
      completedMessages: [],
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      providerRequestCount: 0,
      toolCallCount: 0,
      terminal: false,
    };
  }
  if (!state) throw new Error('Missing run.created event.');
  if (
    event.runId !== state.runId ||
    event.projectId !== state.projectId ||
    event.threadId !== state.threadId
  ) {
    throw new Error('Run event envelope changed during replay.');
  }

  let next: ReplayedRun = { ...state, lastSequence: event.sequence };
  switch (event.type) {
    case 'run.status_changed':
      next = { ...next, status: mapStatus(event.payload.status) };
      break;
    case 'provider.request_started':
      next = {
        ...next,
        status: 'streaming',
        providerRequestCount: next.providerRequestCount + 1,
        draft: '',
      };
      break;
    case 'provider.output_delta':
      next = { ...next, draft: next.draft + event.payload.delta };
      break;
    case 'assistant.message_completed':
      next = {
        ...next,
        draft: '',
        completedMessages: [...next.completedMessages, event.payload.content],
      };
      break;
    case 'tool.proposed':
      next = { ...next, toolCallCount: next.toolCallCount + 1 };
      break;
    case 'approval.requested':
    case 'run.waiting_for_user':
      next = { ...next, status: 'awaiting_approval' };
      break;
    case 'tool.started':
      next = { ...next, status: 'executing_tool' };
      break;
    case 'tool.completed':
      next = { ...next, status: 'verifying' };
      break;
    case 'usage.changed':
      next = {
        ...next,
        inputTokens: event.payload.inputTokens,
        outputTokens: event.payload.outputTokens,
        estimatedCostUsd: event.payload.estimatedCostUsd ?? 0,
      };
      break;
    case 'run.completed':
      next = { ...next, status: 'completed', terminal: true };
      break;
    case 'run.failed':
      next = { ...next, status: 'failed', terminal: true };
      break;
    case 'run.cancelled':
      next = { ...next, status: 'cancelled', terminal: true };
      break;
  }
  return next;
}

function mapStatus(status: string): RuntimeRunStatus {
  switch (status) {
    case 'created': return 'preparing';
    case 'running': return 'streaming';
    case 'waiting_for_user': return 'awaiting_approval';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'failed';
  }
}
