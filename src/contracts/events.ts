/**
 * Persisted agent events.
 *
 * The envelope is deliberately uniform: event IDs provide global idempotency,
 * while `sequence` is strictly monotonic within a run. Payloads contain visible
 * product state and normalized errors only; credentials and hidden reasoning
 * must never be placed in this contract.
 */

import {
  parseRunInputV1,
  type ApprovalDecision,
  type RunInputV1,
} from './commands';
import {
  SourError,
  type SourErrorCategory,
  type SourErrorData,
} from './errors';
import { redactString } from '../security/redaction';

export const AGENT_EVENT_VERSION = 1 as const;

export type RunStatusV1 =
  | 'created'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ApprovalRiskV1 = 'low' | 'medium' | 'high';

export interface TodoItemV1 {
  readonly id: string;
  readonly title: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export interface UsageV1 {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd?: number;
}

export interface AgentEventPayloadsV1 {
  readonly 'run.created': {
    readonly input: RunInputV1;
  };
  readonly 'run.status_changed': {
    readonly status: RunStatusV1;
  };
  readonly 'context.assembled': {
    readonly itemCount: number;
    readonly tokenEstimate?: number;
  };
  readonly 'context.compacted': {
    readonly beforeTokens: number;
    readonly afterTokens: number;
    readonly summaryMessageId?: string;
  };
  readonly 'provider.request_started': {
    readonly requestId: string;
    readonly providerId: string;
    readonly modelId: string;
  };
  readonly 'provider.output_delta': {
    readonly requestId: string;
    readonly delta: string;
  };
  readonly 'assistant.message_completed': {
    readonly messageId: string;
    readonly content: string;
    readonly modelId?: string;
  };
  readonly 'tool.proposed': {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly summary?: string;
  };
  readonly 'tool.validation_failed': {
    readonly toolCallId: string;
    readonly error: SourErrorData;
  };
  readonly 'proposal.created': {
    readonly proposalId: string;
    readonly toolCallId: string;
    readonly summary: string;
    readonly digest: string;
    readonly paths: readonly string[];
    readonly changeCount: number;
    readonly projectRevision: number;
  };
  readonly 'proposal.superseded': {
    readonly proposalId: string;
    readonly replacedByProposalId?: string;
    readonly reason: string;
  };
  readonly 'approval.requested': {
    readonly approvalId: string;
    readonly toolCallId?: string;
    readonly summary: string;
    readonly risk: ApprovalRiskV1;
    readonly proposalId?: string;
    readonly digest?: string;
    readonly paths?: readonly string[];
    readonly expiresAt?: number;
  };
  readonly 'approval.resolved': {
    readonly approvalId: string;
    readonly decision: ApprovalDecision;
    /** Digest actually approved, which differs when the user edited it. */
    readonly digest?: string;
    readonly reason?: string;
  };
  readonly 'approval.expired': {
    readonly approvalId: string;
  };
  readonly 'approval.consumed': {
    readonly approvalId: string;
    readonly transactionId: string;
  };
  readonly 'tool.started': {
    readonly toolCallId: string;
  };
  readonly 'tool.progress': {
    readonly toolCallId: string;
    readonly message: string;
    readonly percent?: number;
  };
  readonly 'tool.completed': {
    readonly toolCallId: string;
    readonly summary?: string;
    readonly artifactIds?: readonly string[];
  };
  readonly 'tool.failed': {
    readonly toolCallId: string;
    readonly error: SourErrorData;
  };
  readonly 'file.transaction_started': {
    readonly transactionId: string;
    readonly paths: readonly string[];
    readonly checkpointId?: string;
    readonly projectRevision?: number;
  };
  readonly 'file.transaction_completed': {
    readonly transactionId: string;
    readonly revision: number;
    readonly changedPaths: readonly string[];
    readonly checkpointId?: string;
    readonly previousRevision?: number;
  };
  readonly 'file.transaction_rolled_back': {
    readonly transactionId: string;
    readonly error: SourErrorData;
    readonly checkpointId?: string;
    readonly restored: boolean;
  };
  readonly 'verification.started': {
    readonly transactionId: string;
    readonly checks: readonly string[];
  };
  readonly 'verification.completed': {
    readonly transactionId: string;
    readonly results: readonly {
      readonly id: string;
      readonly label: string;
      readonly status: 'passed' | 'failed' | 'skipped' | 'unavailable';
      readonly detail: string;
    }[];
  };
  readonly 'restore.started': {
    readonly checkpointId: string;
  };
  readonly 'restore.completed': {
    readonly checkpointId: string;
    readonly revision: number;
    readonly restoredPaths: readonly string[];
  };
  readonly 'file.conflict': {
    readonly transactionId?: string;
    readonly path: string;
    readonly expectedHash?: string;
    readonly actualHash?: string;
  };
  readonly 'checkpoint.created': {
    readonly checkpointId: string;
    readonly revision: number;
  };
  readonly 'checkpoint.restored': {
    readonly checkpointId: string;
    readonly revision: number;
  };
  readonly 'todo.changed': {
    readonly items: readonly TodoItemV1[];
  };
  readonly 'usage.changed': UsageV1;
  readonly 'run.waiting_for_user': {
    readonly reason: string;
    readonly approvalId?: string;
  };
  readonly 'run.completed': {
    readonly finalMessageId?: string;
  };
  readonly 'run.failed': {
    readonly error: SourErrorData;
  };
  readonly 'run.cancelled': {
    readonly reason?: string;
  };
}

export type AgentEventTypeV1 = keyof AgentEventPayloadsV1;
export type AgentEventType = AgentEventTypeV1;

interface AgentEventBaseV1 {
  readonly id: string;
  readonly version: typeof AGENT_EVENT_VERSION;
  readonly projectId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly createdAt: number;
  readonly causationId?: string;
  readonly correlationId: string;
}

/** A discriminated union: checking `type` narrows the corresponding payload. */
export type AgentEventV1<T extends AgentEventTypeV1 = AgentEventTypeV1> = {
  readonly [K in T]: AgentEventBaseV1 & {
    readonly type: K;
    readonly payload: AgentEventPayloadsV1[K];
  };
}[T];

/** Current event contract. Persisted readers should still branch on `version`. */
export type AgentEvent = AgentEventV1;

export type AgentEventInputV1<T extends AgentEventTypeV1> = Omit<
  AgentEventV1<T>,
  'version'
>;

/** Typed constructor that installs the current schema version. */
export function createAgentEventV1<T extends AgentEventTypeV1>(
  event: AgentEventInputV1<T>,
): AgentEventV1<T> {
  return parseAgentEventV1({
    ...event,
    version: AGENT_EVENT_VERSION,
  }) as AgentEventV1<T>;
}

/**
 * Parses an event crossing a worker, storage, provider, or UI boundary.
 *
 * Every payload is rebuilt into its canonical schema. Unknown properties are
 * discarded, normalized errors are redacted again, and the result is deeply
 * frozen so callers cannot change an accepted event after ingestion.
 */
export function parseAgentEventV1(value: unknown): AgentEventV1 {
  const event = eventRecord(value, 'event');
  if (event.version !== AGENT_EVENT_VERSION) {
    throw invalidEvent('version', 'Unsupported agent event version.');
  }

  const type = parseEventType(event.type);
  const causationId =
    event.causationId === undefined
      ? undefined
      : eventString(event.causationId, 'causationId');
  const parsed = {
    id: eventString(event.id, 'id'),
    version: AGENT_EVENT_VERSION,
    projectId: eventString(event.projectId, 'projectId'),
    threadId: eventString(event.threadId, 'threadId'),
    runId: eventString(event.runId, 'runId'),
    sequence: eventInteger(event.sequence, 'sequence'),
    type,
    createdAt: eventNumber(event.createdAt, 'createdAt', 0),
    ...(causationId === undefined ? {} : { causationId }),
    correlationId: eventString(event.correlationId, 'correlationId'),
    payload: parseEventPayload(type, event.payload),
  };

  return deepFreezeEvent(parsed) as AgentEventV1;
}

export function isAgentEventV1(value: unknown): value is AgentEventV1 {
  try {
    parseAgentEventV1(value);
    return true;
  } catch {
    return false;
  }
}

function parseEventType(value: unknown): AgentEventTypeV1 {
  switch (value) {
    case 'run.created':
    case 'run.status_changed':
    case 'context.assembled':
    case 'context.compacted':
    case 'provider.request_started':
    case 'provider.output_delta':
    case 'assistant.message_completed':
    case 'tool.proposed':
    case 'tool.validation_failed':
    case 'proposal.created':
    case 'proposal.superseded':
    case 'approval.requested':
    case 'approval.resolved':
    case 'approval.expired':
    case 'approval.consumed':
    case 'tool.started':
    case 'tool.progress':
    case 'tool.completed':
    case 'tool.failed':
    case 'file.transaction_started':
    case 'file.transaction_completed':
    case 'file.transaction_rolled_back':
    case 'file.conflict':
    case 'checkpoint.created':
    case 'checkpoint.restored':
    case 'verification.started':
    case 'verification.completed':
    case 'restore.started':
    case 'restore.completed':
    case 'todo.changed':
    case 'usage.changed':
    case 'run.waiting_for_user':
    case 'run.completed':
    case 'run.failed':
    case 'run.cancelled':
      return value;
    default:
      throw invalidEvent('type', 'Unsupported agent event type.');
  }
}

function parseEventPayload(
  type: AgentEventTypeV1,
  value: unknown,
): AgentEventPayloadsV1[AgentEventTypeV1] {
  const payload = eventRecord(value, 'payload');

  switch (type) {
    case 'run.created':
      {
        const input = parseRunInputV1(payload.input);
        return { input: { ...input, message: redactString(input.message) } };
      }

    case 'run.status_changed':
      return { status: parseRunStatus(payload.status, 'payload.status') };

    case 'context.assembled':
      return {
        itemCount: eventInteger(payload.itemCount, 'payload.itemCount'),
        ...(payload.tokenEstimate === undefined
          ? {}
          : {
              tokenEstimate: eventInteger(
                payload.tokenEstimate,
                'payload.tokenEstimate',
              ),
            }),
      };

    case 'context.compacted':
      return {
        beforeTokens: eventInteger(
          payload.beforeTokens,
          'payload.beforeTokens',
        ),
        afterTokens: eventInteger(payload.afterTokens, 'payload.afterTokens'),
        ...(payload.summaryMessageId === undefined
          ? {}
          : {
              summaryMessageId: eventString(
                payload.summaryMessageId,
                'payload.summaryMessageId',
              ),
            }),
      };

    case 'provider.request_started':
      return {
        requestId: eventString(payload.requestId, 'payload.requestId'),
        providerId: eventString(payload.providerId, 'payload.providerId'),
        modelId: eventString(payload.modelId, 'payload.modelId'),
      };

    case 'provider.output_delta':
      return {
        requestId: eventString(payload.requestId, 'payload.requestId'),
        delta: eventString(payload.delta, 'payload.delta', true),
      };

    case 'assistant.message_completed':
      return {
        messageId: eventString(payload.messageId, 'payload.messageId'),
        content: eventString(payload.content, 'payload.content', true),
        ...(payload.modelId === undefined
          ? {}
          : { modelId: eventString(payload.modelId, 'payload.modelId') }),
      };

    case 'tool.proposed':
      return {
        toolCallId: eventString(payload.toolCallId, 'payload.toolCallId'),
        toolName: eventString(payload.toolName, 'payload.toolName'),
        ...(payload.summary === undefined
          ? {}
          : {
              summary: eventString(payload.summary, 'payload.summary', true),
            }),
      };

    case 'tool.validation_failed':
      return {
        toolCallId: eventString(payload.toolCallId, 'payload.toolCallId'),
        error: parseSourErrorData(payload.error, 'payload.error'),
      };

    case 'proposal.created':
      return {
        proposalId: eventString(payload.proposalId, 'payload.proposalId'),
        toolCallId: eventString(payload.toolCallId, 'payload.toolCallId'),
        summary: eventString(payload.summary, 'payload.summary', true),
        digest: eventString(payload.digest, 'payload.digest'),
        paths: eventStringArray(payload.paths, 'payload.paths'),
        changeCount: eventInteger(payload.changeCount, 'payload.changeCount'),
        projectRevision: eventInteger(
          payload.projectRevision,
          'payload.projectRevision',
        ),
      };

    case 'proposal.superseded':
      return {
        proposalId: eventString(payload.proposalId, 'payload.proposalId'),
        reason: eventString(payload.reason, 'payload.reason'),
        ...(payload.replacedByProposalId === undefined
          ? {}
          : {
              replacedByProposalId: eventString(
                payload.replacedByProposalId,
                'payload.replacedByProposalId',
              ),
            }),
      };

    case 'approval.requested':
      return {
        approvalId: eventString(payload.approvalId, 'payload.approvalId'),
        ...(payload.toolCallId === undefined
          ? {}
          : {
              toolCallId: eventString(
                payload.toolCallId,
                'payload.toolCallId',
              ),
            }),
        summary: eventString(payload.summary, 'payload.summary'),
        risk: parseApprovalRisk(payload.risk, 'payload.risk'),
        ...(payload.proposalId === undefined
          ? {}
          : { proposalId: eventString(payload.proposalId, 'payload.proposalId') }),
        ...(payload.digest === undefined
          ? {}
          : { digest: eventString(payload.digest, 'payload.digest') }),
        ...(payload.paths === undefined
          ? {}
          : { paths: eventStringArray(payload.paths, 'payload.paths') }),
        ...(payload.expiresAt === undefined
          ? {}
          : { expiresAt: eventNumber(payload.expiresAt, 'payload.expiresAt', 0) }),
      };

    case 'approval.resolved':
      return {
        approvalId: eventString(payload.approvalId, 'payload.approvalId'),
        decision: parseApprovalDecision(payload.decision, 'payload.decision'),
        ...(payload.digest === undefined
          ? {}
          : { digest: eventString(payload.digest, 'payload.digest') }),
        ...(payload.reason === undefined
          ? {}
          : { reason: eventString(payload.reason, 'payload.reason') }),
      };

    case 'approval.expired':
      return {
        approvalId: eventString(payload.approvalId, 'payload.approvalId'),
      };

    case 'approval.consumed':
      return {
        approvalId: eventString(payload.approvalId, 'payload.approvalId'),
        transactionId: eventString(
          payload.transactionId,
          'payload.transactionId',
        ),
      };

    case 'tool.started':
      return {
        toolCallId: eventString(payload.toolCallId, 'payload.toolCallId'),
      };

    case 'tool.progress':
      return {
        toolCallId: eventString(payload.toolCallId, 'payload.toolCallId'),
        message: eventString(payload.message, 'payload.message', true),
        ...(payload.percent === undefined
          ? {}
          : {
              percent: eventNumber(
                payload.percent,
                'payload.percent',
                0,
                100,
              ),
            }),
      };

    case 'tool.completed':
      return {
        toolCallId: eventString(payload.toolCallId, 'payload.toolCallId'),
        ...(payload.summary === undefined
          ? {}
          : {
              summary: eventString(payload.summary, 'payload.summary', true),
            }),
        ...(payload.artifactIds === undefined
          ? {}
          : {
              artifactIds: eventStringArray(
                payload.artifactIds,
                'payload.artifactIds',
              ),
            }),
      };

    case 'tool.failed':
      return {
        toolCallId: eventString(payload.toolCallId, 'payload.toolCallId'),
        error: parseSourErrorData(payload.error, 'payload.error'),
      };

    case 'file.transaction_started':
      return {
        transactionId: eventString(
          payload.transactionId,
          'payload.transactionId',
        ),
        paths: eventStringArray(payload.paths, 'payload.paths'),
        ...(payload.checkpointId === undefined
          ? {}
          : { checkpointId: eventString(payload.checkpointId, 'payload.checkpointId') }),
        ...(payload.projectRevision === undefined
          ? {}
          : {
              projectRevision: eventInteger(
                payload.projectRevision,
                'payload.projectRevision',
              ),
            }),
      };

    case 'file.transaction_completed':
      return {
        transactionId: eventString(
          payload.transactionId,
          'payload.transactionId',
        ),
        revision: eventInteger(payload.revision, 'payload.revision'),
        changedPaths: eventStringArray(
          payload.changedPaths,
          'payload.changedPaths',
        ),
        ...(payload.checkpointId === undefined
          ? {}
          : { checkpointId: eventString(payload.checkpointId, 'payload.checkpointId') }),
        ...(payload.previousRevision === undefined
          ? {}
          : {
              previousRevision: eventInteger(
                payload.previousRevision,
                'payload.previousRevision',
              ),
            }),
      };

    case 'file.transaction_rolled_back':
      return {
        transactionId: eventString(
          payload.transactionId,
          'payload.transactionId',
        ),
        error: parseSourErrorData(payload.error, 'payload.error'),
        restored: payload.restored === true,
        ...(payload.checkpointId === undefined
          ? {}
          : { checkpointId: eventString(payload.checkpointId, 'payload.checkpointId') }),
      };

    case 'verification.started':
      return {
        transactionId: eventString(
          payload.transactionId,
          'payload.transactionId',
        ),
        checks: eventStringArray(payload.checks, 'payload.checks'),
      };

    case 'verification.completed':
      return {
        transactionId: eventString(
          payload.transactionId,
          'payload.transactionId',
        ),
        results: eventArray(payload.results, 'payload.results').map(
          (item, index) => parseVerificationResult(item, `payload.results[${index}]`),
        ),
      };

    case 'restore.started':
      return {
        checkpointId: eventString(payload.checkpointId, 'payload.checkpointId'),
      };

    case 'restore.completed':
      return {
        checkpointId: eventString(payload.checkpointId, 'payload.checkpointId'),
        revision: eventInteger(payload.revision, 'payload.revision'),
        restoredPaths: eventStringArray(
          payload.restoredPaths,
          'payload.restoredPaths',
        ),
      };

    case 'file.conflict':
      return {
        ...(payload.transactionId === undefined
          ? {}
          : {
              transactionId: eventString(
                payload.transactionId,
                'payload.transactionId',
              ),
            }),
        path: eventString(payload.path, 'payload.path'),
        ...(payload.expectedHash === undefined
          ? {}
          : {
              expectedHash: eventString(
                payload.expectedHash,
                'payload.expectedHash',
              ),
            }),
        ...(payload.actualHash === undefined
          ? {}
          : {
              actualHash: eventString(
                payload.actualHash,
                'payload.actualHash',
              ),
            }),
      };

    case 'checkpoint.created':
    case 'checkpoint.restored':
      return {
        checkpointId: eventString(
          payload.checkpointId,
          'payload.checkpointId',
        ),
        revision: eventInteger(payload.revision, 'payload.revision'),
      };

    case 'todo.changed': {
      const items = eventArray(payload.items, 'payload.items').map(
        (item, index) =>
          parseTodoItem(item, `payload.items[${index}]`),
      );
      assertUniqueStrings(
        items.map((item) => item.id),
        'payload.items',
      );
      return { items };
    }

    case 'usage.changed':
      return parseUsage(payload, 'payload');

    case 'run.waiting_for_user':
      return {
        reason: eventString(payload.reason, 'payload.reason'),
        ...(payload.approvalId === undefined
          ? {}
          : {
              approvalId: eventString(
                payload.approvalId,
                'payload.approvalId',
              ),
            }),
      };

    case 'run.completed':
      return payload.finalMessageId === undefined
        ? {}
        : {
            finalMessageId: eventString(
              payload.finalMessageId,
              'payload.finalMessageId',
            ),
          };

    case 'run.failed':
      return { error: parseSourErrorData(payload.error, 'payload.error') };

    case 'run.cancelled':
      return payload.reason === undefined
        ? {}
        : {
            reason: eventString(payload.reason, 'payload.reason', true),
          };
  }
}

function parseRunStatus(value: unknown, field: string): RunStatusV1 {
  if (
    value === 'created' ||
    value === 'running' ||
    value === 'waiting_for_user' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value;
  }
  throw invalidEvent(field, 'Invalid run status.');
}

function parseApprovalRisk(value: unknown, field: string): ApprovalRiskV1 {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw invalidEvent(field, 'Invalid approval risk.');
}

function parseApprovalDecision(
  value: unknown,
  field: string,
): ApprovalDecision {
  if (value === 'approved' || value === 'denied') return value;
  throw invalidEvent(field, 'Invalid approval decision.');
}

function parseTodoItem(value: unknown, field: string): TodoItemV1 {
  const item = eventRecord(value, field);
  const status = item.status;
  if (
    status !== 'pending' &&
    status !== 'in_progress' &&
    status !== 'completed'
  ) {
    throw invalidEvent(`${field}.status`, 'Invalid todo status.');
  }
  return {
    id: eventString(item.id, `${field}.id`),
    title: eventString(item.title, `${field}.title`),
    status,
  };
}

function parseVerificationResult(
  value: unknown,
  field: string,
): AgentEventPayloadsV1['verification.completed']['results'][number] {
  const item = eventRecord(value, field);
  const status = item.status;
  if (
    status !== 'passed' &&
    status !== 'failed' &&
    status !== 'skipped' &&
    status !== 'unavailable'
  ) {
    throw invalidEvent(`${field}.status`, 'Invalid verification status.');
  }
  return {
    id: eventString(item.id, `${field}.id`),
    label: eventString(item.label, `${field}.label`),
    status,
    detail: eventString(item.detail, `${field}.detail`, true),
  };
}

function parseUsage(
  value: unknown,
  field: string,
): UsageV1 {
  const usage = eventRecord(value, field);
  return {
    inputTokens: eventInteger(usage.inputTokens, `${field}.inputTokens`),
    outputTokens: eventInteger(usage.outputTokens, `${field}.outputTokens`),
    ...(usage.estimatedCostUsd === undefined
      ? {}
      : {
          estimatedCostUsd: eventNumber(
            usage.estimatedCostUsd,
            `${field}.estimatedCostUsd`,
            0,
          ),
        }),
  };
}

function parseSourErrorData(value: unknown, field: string): SourErrorData {
  const error = eventRecord(value, field);
  const category = parseErrorCategory(
    error.causeCategory,
    `${field}.causeCategory`,
  );
  if (typeof error.retryable !== 'boolean') {
    throw invalidEvent(`${field}.retryable`, 'Expected a boolean.');
  }
  const details =
    error.details === undefined
      ? undefined
      : eventRecord(error.details, `${field}.details`);

  return new SourError({
    code: parseErrorCode(error.code, `${field}.code`),
    message: eventString(error.message, `${field}.message`),
    causeCategory: category,
    retryable: error.retryable,
    ...(error.userAction === undefined
      ? {}
      : {
          userAction: eventString(
            error.userAction,
            `${field}.userAction`,
          ),
        }),
    ...(details === undefined ? {} : { details }),
  }).toData();
}

function parseErrorCode(value: unknown, field: string): string {
  const code = eventString(value, field);
  if (
    !/^[a-z][a-z0-9_]{0,63}$/.test(code) ||
    redactString(code) !== code
  ) {
    throw invalidEvent(field, 'Invalid normalized error code.');
  }
  return code;
}

function parseErrorCategory(
  value: unknown,
  field: string,
): SourErrorCategory {
  if (
    value === 'provider' ||
    value === 'policy' ||
    value === 'filesystem' ||
    value === 'runtime' ||
    value === 'git' ||
    value === 'storage' ||
    value === 'network' ||
    value === 'validation' ||
    value === 'unsupported' ||
    value === 'cancelled'
  ) {
    return value;
  }
  throw invalidEvent(field, 'Invalid error category.');
}

function eventRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEvent(field, 'Expected an object.');
  }

  try {
    const output = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable) continue;
      if (!('value' in descriptor)) {
        throw invalidEvent(
          `${field}.${key}`,
          'Accessors are not valid contract data.',
        );
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch (cause) {
    if (cause instanceof SourError) throw cause;
    throw invalidEvent(field, 'The object could not be inspected.', cause);
  }
}

function eventArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw invalidEvent(field, 'Expected an array.');
  }
  try {
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !('value' in descriptor)) {
        throw invalidEvent(
          `${field}[${index}]`,
          'Array entries must be plain data.',
        );
      }
      return descriptor.value;
    });
  } catch (cause) {
    if (cause instanceof SourError) throw cause;
    throw invalidEvent(field, 'The array could not be inspected.', cause);
  }
}

function eventString(
  value: unknown,
  field: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    throw invalidEvent(field, 'Expected a string.');
  }
  return redactString(value);
}

function eventStringArray(
  value: unknown,
  field: string,
): readonly string[] {
  return eventArray(value, field).map((item, index) =>
    eventString(item, `${field}[${index}]`),
  );
}

function assertUniqueStrings(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw invalidEvent(field, 'Duplicate identifiers are not allowed.');
  }
}

function eventInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw invalidEvent(field, 'Expected a non-negative safe integer.');
  }
  return value;
}

function eventNumber(
  value: unknown,
  field: string,
  minimum?: number,
  maximum?: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum) ||
    (maximum !== undefined && value > maximum)
  ) {
    throw invalidEvent(field, 'Expected a finite number in range.');
  }
  return value;
}

function invalidEvent(
  field: string,
  message: string,
  cause?: unknown,
): SourError {
  return new SourError({
    code: 'agent_event_invalid',
    message,
    causeCategory: 'validation',
    retryable: false,
    userAction: 'Discard this event and rebuild it from trusted domain data.',
    details: { field },
    cause,
  });
}

function deepFreezeEvent<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeEvent(child, seen);
  }
  return Object.freeze(value);
}
