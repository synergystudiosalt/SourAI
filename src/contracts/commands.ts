/**
 * Commands are client intents. They are versioned independently from events so
 * a persisted queue or another browser context can reject incompatible input.
 *
 * Commands contain only structured-cloneable data. Execution results belong in
 * the event stream, never in a command object.
 */

import { SourError } from './errors';

export const AGENT_COMMAND_VERSION = 1 as const;

export type RunMode = 'ask' | 'plan' | 'write';
export type ApprovalDecision = 'approved' | 'denied';

export interface RunInputV1 {
  readonly message: string;
  readonly mode: RunMode;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly attachmentIds?: readonly string[];
}

interface AgentCommandBaseV1 {
  readonly version: typeof AGENT_COMMAND_VERSION;
  readonly requestId: string;
  readonly createdAt: number;
}

export interface RunStartCommandV1 extends AgentCommandBaseV1 {
  readonly type: 'run.start';
  readonly projectId: string;
  readonly threadId: string;
  readonly input: RunInputV1;
}

export interface RunCancelCommandV1 extends AgentCommandBaseV1 {
  readonly type: 'run.cancel';
  readonly runId: string;
}

export interface RunSteerCommandV1 extends AgentCommandBaseV1 {
  readonly type: 'run.steer';
  readonly runId: string;
  readonly message: string;
}

export interface ApprovalResolveCommandV1 extends AgentCommandBaseV1 {
  readonly type: 'approval.resolve';
  readonly approvalId: string;
  readonly decision: ApprovalDecision;
}

export interface RunResumeCommandV1 extends AgentCommandBaseV1 {
  readonly type: 'run.resume';
  readonly runId: string;
}

export type AgentCommandV1 =
  | RunStartCommandV1
  | RunCancelCommandV1
  | RunSteerCommandV1
  | ApprovalResolveCommandV1
  | RunResumeCommandV1;

/** Current command contract. Consumers should still branch on `version`. */
export type AgentCommand = AgentCommandV1;

/**
 * Parses an untrusted command at a worker, storage, or UI boundary.
 * Unknown properties are discarded and the canonical result is deeply frozen.
 */
export function parseAgentCommandV1(value: unknown): AgentCommandV1 {
  const command = commandRecord(value, 'command');
  if (command.version !== AGENT_COMMAND_VERSION) {
    throw invalidCommand('version', 'Unsupported agent command version.');
  }

  const base = {
    version: AGENT_COMMAND_VERSION,
    requestId: commandString(command.requestId, 'requestId'),
    createdAt: commandNumber(command.createdAt, 'createdAt', { minimum: 0 }),
  } as const;

  let parsed: AgentCommandV1;
  switch (command.type) {
    case 'run.start':
      parsed = {
        ...base,
        type: 'run.start',
        projectId: commandString(command.projectId, 'projectId'),
        threadId: commandString(command.threadId, 'threadId'),
        input: parseRunInputV1(command.input),
      };
      break;
    case 'run.cancel':
      parsed = {
        ...base,
        type: 'run.cancel',
        runId: commandString(command.runId, 'runId'),
      };
      break;
    case 'run.steer':
      parsed = {
        ...base,
        type: 'run.steer',
        runId: commandString(command.runId, 'runId'),
        message: commandString(command.message, 'message'),
      };
      break;
    case 'approval.resolve':
      parsed = {
        ...base,
        type: 'approval.resolve',
        approvalId: commandString(command.approvalId, 'approvalId'),
        decision: parseApprovalDecision(command.decision, 'decision'),
      };
      break;
    case 'run.resume':
      parsed = {
        ...base,
        type: 'run.resume',
        runId: commandString(command.runId, 'runId'),
      };
      break;
    default:
      throw invalidCommand('type', 'Unsupported agent command type.');
  }

  return deepFreezeCommand(parsed);
}

export function isAgentCommandV1(value: unknown): value is AgentCommandV1 {
  try {
    parseAgentCommandV1(value);
    return true;
  } catch {
    return false;
  }
}

export function parseRunInputV1(value: unknown): RunInputV1 {
  const input = commandRecord(value, 'input');
  const attachmentIds =
    input.attachmentIds === undefined
      ? undefined
      : commandStringArray(input.attachmentIds, 'attachmentIds');

  return deepFreezeCommand({
    message: commandString(input.message, 'input.message'),
    mode: parseRunMode(input.mode, 'input.mode'),
    ...(input.providerId === undefined
      ? {}
      : { providerId: commandString(input.providerId, 'input.providerId') }),
    ...(input.modelId === undefined
      ? {}
      : { modelId: commandString(input.modelId, 'input.modelId') }),
    ...(attachmentIds === undefined ? {} : { attachmentIds }),
  });
}

function parseRunMode(value: unknown, field: string): RunMode {
  if (value === 'ask' || value === 'plan' || value === 'write') return value;
  throw invalidCommand(field, 'Invalid run mode.');
}

function parseApprovalDecision(
  value: unknown,
  field: string,
): ApprovalDecision {
  if (value === 'approved' || value === 'denied') return value;
  throw invalidCommand(field, 'Invalid approval decision.');
}

function commandRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidCommand(field, 'Expected an object.');
  }
  try {
    const output = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable) continue;
      if (!('value' in descriptor)) {
        throw invalidCommand(
          `${field}.${key}`,
          'Accessors are not valid contract data.',
        );
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch (cause) {
    if (cause instanceof SourError) throw cause;
    throw invalidCommand(field, 'The object could not be inspected.', cause);
  }
}

function commandString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidCommand(field, 'Expected a non-empty string.');
  }
  return value;
}

function commandStringArray(value: unknown, field: string): readonly string[] {
  return commandArray(value, field).map((item, index) =>
    commandString(item, `${field}[${index}]`),
  );
}

function commandArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw invalidCommand(field, 'Expected an array.');
  }
  try {
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !('value' in descriptor)) {
        throw invalidCommand(
          `${field}[${index}]`,
          'Array entries must be plain data.',
        );
      }
      return descriptor.value;
    });
  } catch (cause) {
    if (cause instanceof SourError) throw cause;
    throw invalidCommand(field, 'The array could not be inspected.', cause);
  }
}

function commandNumber(
  value: unknown,
  field: string,
  options: { minimum?: number } = {},
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (options.minimum !== undefined && value < options.minimum)
  ) {
    throw invalidCommand(field, 'Expected a finite number.');
  }
  return value;
}

function invalidCommand(
  field: string,
  message: string,
  cause?: unknown,
): SourError {
  return new SourError({
    code: 'agent_command_invalid',
    message,
    causeCategory: 'validation',
    retryable: false,
    userAction: 'Discard this command and create it again.',
    details: { field },
    cause,
  });
}

function deepFreezeCommand<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeCommand(child, seen);
  }
  return Object.freeze(value);
}
