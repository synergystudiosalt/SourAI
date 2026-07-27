import {
  AGENT_EVENT_VERSION,
  parseAgentEventV1,
  type AgentEventV1,
  type ApprovalRiskV1,
  type RunStatusV1,
  type TodoItemV1,
  type UsageV1,
} from '../contracts/events';
import type { ApprovalDecision, RunInputV1 } from '../contracts/commands';
import { SourError, type SourErrorData } from '../contracts/errors';

export const AGENT_DOMAIN_STATE_VERSION = 1 as const;

export interface AssistantMessageStateV1 {
  readonly id: string;
  readonly role: 'assistant';
  readonly content: string;
  readonly modelId?: string;
  readonly createdAt: number;
}

export interface ToolCallStateV1 {
  readonly id: string;
  readonly name: string;
  readonly status:
    | 'proposed'
    | 'validation_failed'
    | 'running'
    | 'completed'
    | 'failed';
  readonly summary?: string;
  readonly progressMessage?: string;
  readonly progressPercent?: number;
  readonly artifactIds: readonly string[];
  readonly error?: SourErrorData;
}

export interface ApprovalStateV1 {
  readonly id: string;
  readonly toolCallId?: string;
  readonly summary: string;
  readonly risk: ApprovalRiskV1;
  readonly status: 'pending' | ApprovalDecision;
}

export interface FileTransactionStateV1 {
  readonly id: string;
  readonly status: 'started' | 'completed';
  readonly paths: readonly string[];
  readonly revision?: number;
  readonly changedPaths: readonly string[];
}

export interface CheckpointStateV1 {
  readonly id: string;
  readonly revision: number;
  readonly createdAt?: number;
  readonly restoredAt?: number;
}

export interface ContextStateV1 {
  readonly itemCount?: number;
  readonly tokenEstimate?: number;
  readonly compaction?: {
    readonly beforeTokens: number;
    readonly afterTokens: number;
    readonly summaryMessageId?: string;
  };
}

export interface ProviderRequestStateV1 {
  readonly requestId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly startedAt: number;
}

export interface FileConflictStateV1 {
  readonly transactionId?: string;
  readonly path: string;
  readonly expectedHash?: string;
  readonly actualHash?: string;
  readonly createdAt: number;
}

export interface RunStateV1 {
  readonly id: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly correlationId: string;
  readonly status: RunStatusV1;
  readonly input: RunInputV1;
  readonly lastSequence: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly assistantDraft: string;
  readonly messages: readonly AssistantMessageStateV1[];
  readonly context: ContextStateV1;
  readonly providerRequest?: ProviderRequestStateV1;
  readonly tools: Readonly<Record<string, ToolCallStateV1>>;
  readonly approvals: Readonly<Record<string, ApprovalStateV1>>;
  readonly fileTransactions: Readonly<Record<string, FileTransactionStateV1>>;
  readonly fileConflicts: readonly FileConflictStateV1[];
  readonly checkpoints: Readonly<Record<string, CheckpointStateV1>>;
  readonly todos: readonly TodoItemV1[];
  readonly usage: UsageV1;
  readonly waitingReason?: string;
  readonly finalMessageId?: string;
  readonly cancellationReason?: string;
  readonly error?: SourErrorData;
}

export interface ThreadStateV1 {
  readonly id: string;
  readonly projectId: string;
  readonly runIds: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AgentVisibleStateV1 {
  readonly version: typeof AGENT_DOMAIN_STATE_VERSION;
  readonly threads: Readonly<Record<string, ThreadStateV1>>;
  readonly runs: Readonly<Record<string, RunStateV1>>;
}

/**
 * Replay metadata is kept beside visible state. It is not persisted as a
 * second source of truth: replay always rebuilds it from the event stream.
 */
export interface AgentDomainStateV1 {
  readonly visible: AgentVisibleStateV1;
}

type EntityKind =
  | 'run'
  | 'provider_request'
  | 'assistant_message'
  | 'tool_call'
  | 'approval'
  | 'file_transaction'
  | 'checkpoint';

interface ReplayMetadata {
  readonly eventFingerprints: ReadonlyMap<string, string>;
  readonly lastSequenceByRun: ReadonlyMap<string, number>;
  readonly entityOwners: ReadonlyMap<string, string>;
}

/**
 * Replay/idempotency metadata is authoritative but intentionally unreachable
 * from returned state snapshots. A consumer cannot mutate a Set or record to
 * bypass duplicate, sequence, or entity checks.
 */
const replayMetadata = new WeakMap<AgentDomainStateV1, ReplayMetadata>();

export function createAgentDomainState(): AgentDomainStateV1 {
  const state = deepFreezeState({
    visible: {
      version: AGENT_DOMAIN_STATE_VERSION,
      threads: emptyRecord<ThreadStateV1>(),
      runs: emptyRecord<RunStateV1>(),
    },
  });
  replayMetadata.set(state, {
    eventFingerprints: new Map(),
    lastSequenceByRun: new Map(),
    entityOwners: new Map(),
  });
  return state;
}

export function selectVisibleAgentState(state: AgentDomainStateV1): AgentVisibleStateV1 {
  return state.visible;
}

/**
 * Pure event reducer.
 *
 * Duplicate IDs return the exact previous state object. A different event ID
 * must have a sequence greater than the last accepted event for that run.
 */
export function reduceAgentEvent(
  state: AgentDomainStateV1,
  event: AgentEventV1,
): AgentDomainStateV1 {
  const metadata = replayMetadata.get(state);
  if (metadata === undefined) {
    throw contractError(
      'event_state_unrecognized',
      'The domain state was not created by the agent reducer.',
      {},
    );
  }

  const acceptedEvent = parseAgentEventV1(event);
  assertValidEnvelope(acceptedEvent);
  const fingerprint = stableFingerprint(acceptedEvent);
  const previousFingerprint = metadata.eventFingerprints.get(acceptedEvent.id);
  if (previousFingerprint !== undefined) {
    if (previousFingerprint === fingerprint) return state;
    throw contractError(
      'event_id_conflict',
      'An event ID cannot identify two different events.',
      { eventId: acceptedEvent.id },
    );
  }

  const previousSequence = metadata.lastSequenceByRun.get(acceptedEvent.runId);
  if (
    previousSequence !== undefined &&
    acceptedEvent.sequence <= previousSequence
  ) {
    throw contractError(
      'event_sequence_non_monotonic',
      'The event sequence is not strictly increasing for this run.',
      {
        eventId: acceptedEvent.id,
        runId: acceptedEvent.runId,
        receivedSequence: acceptedEvent.sequence,
        previousSequence,
      },
    );
  }

  const previousRun = state.visible.runs[acceptedEvent.runId];
  let nextRun: RunStateV1;

  if (previousRun === undefined) {
    if (acceptedEvent.type !== 'run.created') {
      throw contractError(
        'event_run_not_created',
        'The first event for a run must create the run.',
        {
          eventId: acceptedEvent.id,
          runId: acceptedEvent.runId,
          eventType: acceptedEvent.type,
        },
      );
    }
    assertEntityIdAvailable(metadata, acceptedEvent);
    nextRun = createRun(acceptedEvent);
  } else {
    assertRunEnvelope(previousRun, acceptedEvent);
    if (acceptedEvent.type === 'run.created') {
      throw contractError(
        'event_run_already_created',
        'A run can only be created once.',
        { eventId: acceptedEvent.id, runId: acceptedEvent.runId },
      );
    }
    assertRunNotTerminal(previousRun, acceptedEvent);
    assertEntityIdAvailable(metadata, acceptedEvent);
    nextRun = applyRunEvent(previousRun, acceptedEvent);
  }

  const previousThread = state.visible.threads[acceptedEvent.threadId];
  if (
    previousThread !== undefined &&
    previousThread.projectId !== acceptedEvent.projectId
  ) {
    throw contractError(
      'event_thread_project_mismatch',
      'An event cannot move a thread to another project.',
      {
        eventId: acceptedEvent.id,
        threadId: acceptedEvent.threadId,
        expectedProjectId: previousThread.projectId,
        receivedProjectId: acceptedEvent.projectId,
      },
    );
  }

  const nextThread = deriveThread(
    previousThread,
    nextRun,
    acceptedEvent.createdAt,
  );
  const nextState = deepFreezeState({
    visible: {
      version: AGENT_DOMAIN_STATE_VERSION,
      threads: withRecord(
        state.visible.threads,
        acceptedEvent.threadId,
        nextThread,
      ),
      runs: withRecord(state.visible.runs, acceptedEvent.runId, nextRun),
    },
  });

  const eventFingerprints = new Map(metadata.eventFingerprints);
  eventFingerprints.set(acceptedEvent.id, fingerprint);
  const lastSequenceByRun = new Map(metadata.lastSequenceByRun);
  lastSequenceByRun.set(acceptedEvent.runId, acceptedEvent.sequence);
  const entityOwners = new Map(metadata.entityOwners);
  registerCreatedEntity(entityOwners, acceptedEvent);
  replayMetadata.set(nextState, {
    eventFingerprints,
    lastSequenceByRun,
    entityOwners,
  });

  return nextState;
}

export function replayAgentEvents(
  events: readonly AgentEventV1[],
  initialState: AgentDomainStateV1 = createAgentDomainState(),
): AgentDomainStateV1 {
  return events.reduce(reduceAgentEvent, initialState);
}

function createRun(event: AgentEventV1<'run.created'>): RunStateV1 {
  return {
    id: event.runId,
    projectId: event.projectId,
    threadId: event.threadId,
    correlationId: event.correlationId,
    status: 'created',
    input: cloneContractValue(event.payload.input, 'run input'),
    lastSequence: event.sequence,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    assistantDraft: '',
    messages: [],
    context: {},
    tools: emptyRecord<ToolCallStateV1>(),
    approvals: emptyRecord<ApprovalStateV1>(),
    fileTransactions: emptyRecord<FileTransactionStateV1>(),
    fileConflicts: [],
    checkpoints: emptyRecord<CheckpointStateV1>(),
    todos: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function applyRunEvent(run: RunStateV1, event: AgentEventV1): RunStateV1 {
  const base: RunStateV1 = {
    ...run,
    lastSequence: event.sequence,
    updatedAt: Math.max(run.updatedAt, event.createdAt),
  };

  switch (event.type) {
    case 'run.status_changed':
      assertRunTransition(run, event.payload.status, event);
      return { ...base, status: event.payload.status };

    case 'context.assembled':
      return {
        ...base,
        context: {
          ...run.context,
          itemCount: event.payload.itemCount,
          tokenEstimate: event.payload.tokenEstimate,
        },
      };

    case 'context.compacted':
      return {
        ...base,
        context: {
          ...run.context,
          tokenEstimate: event.payload.afterTokens,
          compaction: cloneContractValue(event.payload, 'context compaction'),
        },
      };

    case 'provider.request_started':
      return {
        ...base,
        providerRequest: {
          requestId: event.payload.requestId,
          providerId: event.payload.providerId,
          modelId: event.payload.modelId,
          startedAt: event.createdAt,
        },
      };

    case 'provider.output_delta':
      if (
        run.providerRequest === undefined ||
        run.providerRequest.requestId !== event.payload.requestId
      ) {
        throw contractError(
          'event_provider_request_mismatch',
          'Provider output must reference the active provider request.',
          {
            eventId: event.id,
            runId: event.runId,
            requestId: event.payload.requestId,
          },
        );
      }
      return {
        ...base,
        assistantDraft: run.assistantDraft + event.payload.delta,
      };

    case 'assistant.message_completed':
      return {
        ...base,
        assistantDraft: '',
        messages: [
          ...run.messages,
          {
            id: event.payload.messageId,
            role: 'assistant',
            content: event.payload.content,
            modelId: event.payload.modelId,
            createdAt: event.createdAt,
          },
        ],
      };

    case 'tool.proposed': {
      const tool: ToolCallStateV1 = {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        status: 'proposed',
        summary: event.payload.summary,
        artifactIds: [],
      };
      return {
        ...base,
        tools: withRecord(run.tools, tool.id, tool),
      };
    }

    case 'tool.validation_failed': {
      const tool = requireTool(run, event.payload.toolCallId, event);
      assertToolStatus(tool, ['proposed'], event);
      return {
        ...base,
        tools: withRecord(run.tools, tool.id, {
          ...tool,
          status: 'validation_failed',
          error: cloneContractValue(event.payload.error, 'tool validation error'),
        }),
      };
    }

    case 'approval.requested': {
      if (event.payload.toolCallId !== undefined) {
        const tool = requireTool(run, event.payload.toolCallId, event);
        assertToolStatus(tool, ['proposed'], event);
      }
      const approval: ApprovalStateV1 = {
        id: event.payload.approvalId,
        toolCallId: event.payload.toolCallId,
        summary: event.payload.summary,
        risk: event.payload.risk,
        status: 'pending',
      };
      return {
        ...base,
        approvals: withRecord(run.approvals, approval.id, approval),
      };
    }

    case 'approval.resolved': {
      const approval = requireApproval(run, event.payload.approvalId, event);
      if (approval.status !== 'pending') {
        throw contractError(
          'event_approval_already_resolved',
          'An approval can only be resolved once.',
          {
            eventId: event.id,
            runId: event.runId,
            approvalId: approval.id,
            approvalStatus: approval.status,
          },
        );
      }
      return {
        ...base,
        approvals: withRecord(run.approvals, approval.id, {
          ...approval,
          status: event.payload.decision,
        }),
      };
    }

    case 'tool.started': {
      const tool = requireTool(run, event.payload.toolCallId, event);
      assertToolStatus(tool, ['proposed'], event);
      const approval = Object.values(run.approvals).find(
        (candidate) => candidate.toolCallId === tool.id,
      );
      if (approval !== undefined && approval.status !== 'approved') {
        throw contractError(
          'event_tool_not_approved',
          'A tool cannot start before its approval is granted.',
          {
            eventId: event.id,
            runId: event.runId,
            toolCallId: tool.id,
            approvalId: approval.id,
            approvalStatus: approval.status,
          },
        );
      }
      return {
        ...base,
        tools: withRecord(run.tools, tool.id, { ...tool, status: 'running' }),
      };
    }

    case 'tool.progress': {
      const tool = requireTool(run, event.payload.toolCallId, event);
      assertToolStatus(tool, ['running'], event);
      return {
        ...base,
        tools: withRecord(run.tools, tool.id, {
          ...tool,
          progressMessage: event.payload.message,
          progressPercent: event.payload.percent,
        }),
      };
    }

    case 'tool.completed': {
      const tool = requireTool(run, event.payload.toolCallId, event);
      assertToolStatus(tool, ['running'], event);
      return {
        ...base,
        tools: withRecord(run.tools, tool.id, {
          ...tool,
          status: 'completed',
          summary: event.payload.summary ?? tool.summary,
          artifactIds: [...(event.payload.artifactIds ?? [])],
          progressPercent: 100,
        }),
      };
    }

    case 'tool.failed': {
      const tool = requireTool(run, event.payload.toolCallId, event);
      assertToolStatus(tool, ['running'], event);
      return {
        ...base,
        tools: withRecord(run.tools, tool.id, {
          ...tool,
          status: 'failed',
          error: cloneContractValue(event.payload.error, 'tool error'),
        }),
      };
    }

    case 'file.transaction_started': {
      const transaction: FileTransactionStateV1 = {
        id: event.payload.transactionId,
        status: 'started',
        paths: [...event.payload.paths],
        changedPaths: [],
      };
      return {
        ...base,
        fileTransactions: withRecord(
          run.fileTransactions,
          transaction.id,
          transaction,
        ),
      };
    }

    case 'file.transaction_completed': {
      const transaction = requireFileTransaction(
        run,
        event.payload.transactionId,
        event,
      );
      if (transaction.status !== 'started') {
        throw contractError(
          'event_file_transaction_already_completed',
          'A file transaction can only complete once.',
          {
            eventId: event.id,
            runId: event.runId,
            transactionId: transaction.id,
          },
        );
      }
      return {
        ...base,
        fileTransactions: withRecord(run.fileTransactions, transaction.id, {
          ...transaction,
          status: 'completed',
          revision: event.payload.revision,
          changedPaths: [...event.payload.changedPaths],
        }),
      };
    }

    case 'file.conflict':
      if (event.payload.transactionId !== undefined) {
        const transaction = requireFileTransaction(
          run,
          event.payload.transactionId,
          event,
        );
        if (transaction.status !== 'started') {
          throw contractError(
            'event_file_transaction_closed',
            'A completed file transaction cannot report a new conflict.',
            {
              eventId: event.id,
              runId: event.runId,
              transactionId: transaction.id,
            },
          );
        }
      }
      return {
        ...base,
        fileConflicts: [
          ...run.fileConflicts,
          {
            transactionId: event.payload.transactionId,
            path: event.payload.path,
            expectedHash: event.payload.expectedHash,
            actualHash: event.payload.actualHash,
            createdAt: event.createdAt,
          },
        ],
      };

    case 'checkpoint.created': {
      const checkpoint: CheckpointStateV1 = {
        id: event.payload.checkpointId,
        revision: event.payload.revision,
        createdAt: event.createdAt,
      };
      return {
        ...base,
        checkpoints: withRecord(run.checkpoints, checkpoint.id, checkpoint),
      };
    }

    case 'checkpoint.restored': {
      const previous = run.checkpoints[event.payload.checkpointId];
      if (previous === undefined) {
        throw contractError(
          'event_checkpoint_not_created',
          'A checkpoint must be created before it can be restored.',
          {
            eventId: event.id,
            runId: event.runId,
            checkpointId: event.payload.checkpointId,
          },
        );
      }
      const checkpoint: CheckpointStateV1 = {
        id: event.payload.checkpointId,
        revision: event.payload.revision,
        createdAt: previous?.createdAt,
        restoredAt: event.createdAt,
      };
      return {
        ...base,
        checkpoints: withRecord(run.checkpoints, checkpoint.id, checkpoint),
      };
    }

    case 'todo.changed':
      return {
        ...base,
        todos: cloneContractValue(event.payload.items, 'todo items'),
      };

    case 'usage.changed':
      return {
        ...base,
        usage: cloneContractValue(event.payload, 'usage'),
      };

    case 'run.waiting_for_user':
      assertRunTransition(run, 'waiting_for_user', event);
      if (event.payload.approvalId !== undefined) {
        const approval = requireApproval(
          run,
          event.payload.approvalId,
          event,
        );
        if (approval.status !== 'pending') {
          throw contractError(
            'event_waiting_approval_not_pending',
            'A run can only wait on a pending approval.',
            {
              eventId: event.id,
              runId: event.runId,
              approvalId: approval.id,
            },
          );
        }
      }
      return {
        ...base,
        status: 'waiting_for_user',
        waitingReason: event.payload.reason,
      };

    case 'run.completed':
      assertRunTransition(run, 'completed', event);
      if (
        event.payload.finalMessageId !== undefined &&
        !run.messages.some(
          (message) => message.id === event.payload.finalMessageId,
        )
      ) {
        throw contractError(
          'event_final_message_not_found',
          'The final message must belong to the completing run.',
          {
            eventId: event.id,
            runId: event.runId,
            finalMessageId: event.payload.finalMessageId,
          },
        );
      }
      return {
        ...base,
        status: 'completed',
        finalMessageId: event.payload.finalMessageId,
        waitingReason: undefined,
      };

    case 'run.failed':
      assertRunTransition(run, 'failed', event);
      return {
        ...base,
        status: 'failed',
        error: cloneContractValue(event.payload.error, 'run error'),
        waitingReason: undefined,
      };

    case 'run.cancelled':
      assertRunTransition(run, 'cancelled', event);
      return {
        ...base,
        status: 'cancelled',
        cancellationReason: event.payload.reason,
        waitingReason: undefined,
      };

    case 'run.created':
      throw contractError(
        'event_run_already_created',
        'A run can only be created once.',
        { eventId: event.id, runId: event.runId },
      );
  }
}

function deriveThread(
  thread: ThreadStateV1 | undefined,
  run: RunStateV1,
  eventCreatedAt: number,
): ThreadStateV1 {
  if (thread === undefined) {
    return {
      id: run.threadId,
      projectId: run.projectId,
      runIds: [run.id],
      createdAt: run.createdAt,
      updatedAt: eventCreatedAt,
    };
  }

  const runIds = thread.runIds.includes(run.id)
    ? thread.runIds
    : [...thread.runIds, run.id].sort();

  return {
    ...thread,
    runIds,
    createdAt: Math.min(thread.createdAt, run.createdAt),
    updatedAt: Math.max(thread.updatedAt, eventCreatedAt),
  };
}

function assertRunNotTerminal(
  run: RunStateV1,
  event: AgentEventV1,
): void {
  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled'
  ) {
    throw contractError(
      'event_run_terminal',
      'A terminal run cannot accept more events.',
      {
        eventId: event.id,
        runId: event.runId,
        runStatus: run.status,
        eventType: event.type,
      },
    );
  }
}

function assertRunTransition(
  run: RunStateV1,
  nextStatus: RunStatusV1,
  event: AgentEventV1,
): void {
  const allowed: Readonly<Record<RunStatusV1, readonly RunStatusV1[]>> = {
    created: ['running', 'failed', 'cancelled'],
    running: ['waiting_for_user', 'completed', 'failed', 'cancelled'],
    waiting_for_user: ['running', 'completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  if (!allowed[run.status].includes(nextStatus)) {
    throw contractError(
      'event_run_transition_invalid',
      'The requested run status transition is not allowed.',
      {
        eventId: event.id,
        runId: event.runId,
        currentStatus: run.status,
        nextStatus,
      },
    );
  }
}

function assertToolStatus(
  tool: ToolCallStateV1,
  allowed: readonly ToolCallStateV1['status'][],
  event: AgentEventV1,
): void {
  if (!allowed.includes(tool.status)) {
    throw contractError(
      'event_tool_transition_invalid',
      'The requested tool lifecycle transition is not allowed.',
      {
        eventId: event.id,
        runId: event.runId,
        toolCallId: tool.id,
        toolStatus: tool.status,
        eventType: event.type,
      },
    );
  }
}

function createdEntity(
  event: AgentEventV1,
): { readonly kind: EntityKind; readonly id: string } | undefined {
  switch (event.type) {
    case 'run.created':
      return { kind: 'run', id: event.runId };
    case 'provider.request_started':
      return { kind: 'provider_request', id: event.payload.requestId };
    case 'assistant.message_completed':
      return { kind: 'assistant_message', id: event.payload.messageId };
    case 'tool.proposed':
      return { kind: 'tool_call', id: event.payload.toolCallId };
    case 'approval.requested':
      return { kind: 'approval', id: event.payload.approvalId };
    case 'file.transaction_started':
      return { kind: 'file_transaction', id: event.payload.transactionId };
    case 'checkpoint.created':
      return { kind: 'checkpoint', id: event.payload.checkpointId };
    default:
      return undefined;
  }
}

function entityKey(kind: EntityKind, id: string): string {
  return `${kind}\u0000${id}`;
}

function assertEntityIdAvailable(
  metadata: ReplayMetadata,
  event: AgentEventV1,
): void {
  const entity = createdEntity(event);
  if (entity === undefined) return;
  const owner = metadata.entityOwners.get(entityKey(entity.kind, entity.id));
  if (owner !== undefined) {
    throw contractError(
      'event_entity_id_reused',
      'An entity ID cannot be created more than once.',
      {
        eventId: event.id,
        runId: event.runId,
        entityKind: entity.kind,
        entityId: entity.id,
        originalRunId: owner,
      },
    );
  }
}

function registerCreatedEntity(
  owners: Map<string, string>,
  event: AgentEventV1,
): void {
  const entity = createdEntity(event);
  if (entity !== undefined) {
    owners.set(entityKey(entity.kind, entity.id), event.runId);
  }
}

function assertValidEnvelope(event: AgentEventV1): void {
  if (
    event.version !== AGENT_EVENT_VERSION ||
    !isNonEmpty(event.id) ||
    !isNonEmpty(event.projectId) ||
    !isNonEmpty(event.threadId) ||
    !isNonEmpty(event.runId) ||
    !isNonEmpty(event.correlationId) ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 0 ||
    !Number.isFinite(event.createdAt)
  ) {
    throw contractError(
      'event_envelope_invalid',
      'The agent event envelope is invalid.',
      {
        eventId: event.id,
        eventType: event.type,
        eventVersion: event.version,
        sequence: event.sequence,
      },
    );
  }
}

function assertRunEnvelope(run: RunStateV1, event: AgentEventV1): void {
  if (
    run.projectId !== event.projectId ||
    run.threadId !== event.threadId ||
    run.correlationId !== event.correlationId
  ) {
    throw contractError(
      'event_run_context_mismatch',
      'An event cannot change the project, thread, or correlation of a run.',
      {
        eventId: event.id,
        runId: event.runId,
        expectedProjectId: run.projectId,
        receivedProjectId: event.projectId,
        expectedThreadId: run.threadId,
        receivedThreadId: event.threadId,
        expectedCorrelationId: run.correlationId,
        receivedCorrelationId: event.correlationId,
      },
    );
  }
}

function requireTool(
  run: RunStateV1,
  toolCallId: string,
  event: AgentEventV1,
): ToolCallStateV1 {
  const tool = run.tools[toolCallId];
  if (tool === undefined) {
    throw contractError(
      'event_tool_not_proposed',
      'A tool lifecycle event must follow its proposal.',
      { eventId: event.id, runId: event.runId, toolCallId },
    );
  }
  return tool;
}

function requireApproval(
  run: RunStateV1,
  approvalId: string,
  event: AgentEventV1,
): ApprovalStateV1 {
  const approval = run.approvals[approvalId];
  if (approval === undefined) {
    throw contractError(
      'event_approval_not_requested',
      'An approval resolution must follow its request.',
      { eventId: event.id, runId: event.runId, approvalId },
    );
  }
  return approval;
}

function requireFileTransaction(
  run: RunStateV1,
  transactionId: string,
  event: AgentEventV1,
): FileTransactionStateV1 {
  const transaction = run.fileTransactions[transactionId];
  if (transaction === undefined) {
    throw contractError(
      'event_file_transaction_not_started',
      'A file transaction completion must follow its start.',
      { eventId: event.id, runId: event.runId, transactionId },
    );
  }
  return transaction;
}

function cloneContractValue<T>(value: T, subject: string): T {
  try {
    return structuredClone(value);
  } catch (cause) {
    throw new SourError({
      code: 'event_payload_not_cloneable',
      message: `The ${subject} is not structured-cloneable.`,
      causeCategory: 'validation',
      retryable: false,
      details: { subject },
      cause,
    });
  }
}

function contractError(
  code: string,
  message: string,
  details: Record<string, unknown>,
): SourError {
  return new SourError({
    code,
    message,
    causeCategory: 'validation',
    retryable: false,
    userAction: 'The event log is inconsistent and should be rebuilt or reported.',
    details,
  });
}

function emptyRecord<T>(): Readonly<Record<string, T>> {
  return Object.freeze(Object.create(null) as Record<string, T>);
}

function withRecord<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T,
): Readonly<Record<string, T>> {
  const entries = Object.entries(record) as [string, T][];
  const existingIndex = entries.findIndex(([entryKey]) => entryKey === key);
  if (existingIndex >= 0) entries[existingIndex] = [key, value];
  else entries.push([key, value]);
  entries.sort(([left], [right]) => left.localeCompare(right));

  const next = Object.create(null) as Record<string, T>;
  for (const [entryKey, entryValue] of entries) {
    next[entryKey] = entryValue;
  }
  return Object.freeze(next);
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function stableFingerprint(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
    case 'boolean':
      return String(value);
    case 'undefined':
      return 'undefined';
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map(stableFingerprint).join(',')}]`;
      }
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${stableFingerprint(
              (value as Record<string, unknown>)[key],
            )}`,
        )
        .join(',')}}`;
    default:
      throw contractError(
        'event_fingerprint_invalid',
        'The event contains data that cannot be fingerprinted.',
        { valueType: typeof value },
      );
  }
}

function deepFreezeState<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeState(child, seen);
  }
  return Object.freeze(value);
}
