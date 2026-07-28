import { parseAgentCommandV1, type AgentCommandV1 } from '../../contracts/commands';
import { normalizeError, type SourErrorData } from '../../contracts/errors';
import { parseAgentEventV1, type AgentEventV1 } from '../../contracts/events';
import type { AgentCapabilityReportV1 } from '../composition/capabilities';
import type { EgressPlan } from '../composition/prompt';
import type { AgentRuntime } from '../runtime';

/** Composition inputs. Validated inside the worker before anything is built. */
export interface AgentWorkerInitV1 {
  readonly projectId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly snapshot: unknown;
  readonly scope?: unknown;
  readonly contextPaths?: readonly string[];
  readonly openFiles?: readonly string[];
  /** True only when the host has a reviewer able to apply a transaction. */
  readonly canReviewMutations?: boolean;
  readonly consent?: {
    readonly endpoint: string;
    readonly host: string;
    readonly modelId: string;
    readonly grantedAt: number;
  };
}

export type AgentWorkerRequest =
  | { readonly kind: 'init'; readonly init: AgentWorkerInitV1 }
  | {
      readonly kind: 'command';
      readonly command: AgentCommandV1;
      /**
       * Ephemeral BYOK value for this request only. It is never part of the
       * command, so it cannot reach the event log, replay, or an export.
       */
      readonly credential?: string;
    }
  /** The user approved and the host has begun applying; cancellation is late. */
  | { readonly kind: 'mutation.applying'; readonly approvalId: string }
  /** The host's decision on a proposal, plus what applying it actually did. */
  | {
      readonly kind: 'mutation.reviewed';
      readonly approvalId: string;
      readonly report: unknown;
    }
  /** Current workspace revision, pushed whenever the project changes. */
  | { readonly kind: 'workspace.revision'; readonly revision: number };

export interface MutationReviewMessageV1 {
  readonly approvalId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly projectRevision: number;
  readonly proposal: {
    readonly id: string;
    readonly digest: string;
    readonly summary: string;
    readonly paths: readonly string[];
    readonly changeCount: number;
    readonly value: unknown;
  };
}

export type AgentWorkerResponse =
  | { readonly kind: 'worker.ready'; readonly capabilities: AgentCapabilityReportV1 }
  | { readonly kind: 'worker.degraded'; readonly error: SourErrorData }
  | { readonly kind: 'egress.planned'; readonly plan: EgressPlan }
  | { readonly kind: 'mutation.review'; readonly request: MutationReviewMessageV1 }
  | { readonly kind: 'event'; readonly event: AgentEventV1 }
  | { readonly kind: 'command.accepted'; readonly requestId: string; readonly runId?: string }
  | { readonly kind: 'command.rejected'; readonly requestId?: string; readonly error: SourErrorData };

export interface WorkerMessagePort {
  postMessage(message: AgentWorkerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

export interface AttachAgentWorkerOptions {
  /**
   * Invoked with each accepted command envelope before dispatch, so the host
   * can install a per-request credential without persisting it.
   */
  readonly onCommandEnvelope?: (envelope: {
    readonly command: AgentCommandV1;
    readonly credential?: string;
  }) => void;
}

export function attachAgentWorker(
  runtime: AgentRuntime,
  port: WorkerMessagePort,
  options: AttachAgentWorkerOptions = {}
): () => void {
  const requests = new Map<string, Promise<AgentWorkerResponse>>();
  let commandTail: Promise<void> = Promise.resolve();
  const unsubscribe = runtime.subscribe((event) => {
    port.postMessage({ kind: 'event', event: parseAgentEventV1(event) });
  });
  const onMessage = (message: MessageEvent<unknown>) => {
    const envelope = asRecord(message.data);
    // Other envelope kinds belong to the worker host, not to this runtime.
    if (!envelope || envelope.kind !== 'command') return;
    commandTail = commandTail
      .then(async () => {
        const command = parseAgentCommandV1(envelope.command);
        options.onCommandEnvelope?.({
          command,
          ...(typeof envelope.credential === 'string' ? { credential: envelope.credential } : {}),
        });
        let operation = requests.get(command.requestId);
        if (!operation) {
          operation = dispatch(runtime, command);
          requests.set(command.requestId, operation);
          if (requests.size > 1_000) requests.delete(requests.keys().next().value!);
        }
        port.postMessage(await operation);
      })
      .catch((cause) => {
        port.postMessage({
          kind: 'command.rejected',
          error: normalizeError(cause, {
            code: 'worker_command_rejected',
            message: 'The worker rejected the command.',
            causeCategory: 'validation',
            retryable: false,
          }).toData(),
        });
      });
  };
  port.addEventListener('message', onMessage);
  return () => {
    unsubscribe();
    port.removeEventListener('message', onMessage);
  };
}

async function dispatch(
  runtime: AgentRuntime,
  command: AgentCommandV1,
): Promise<AgentWorkerResponse> {
  try {
    const result = await runtime.dispatch(command);
    return {
      kind: 'command.accepted',
      requestId: command.requestId,
      ...(result.runId ? { runId: result.runId } : {}),
    };
  } catch (cause) {
    return {
      kind: 'command.rejected',
      requestId: command.requestId,
      error: normalizeError(cause, {
        code: 'worker_command_rejected',
        message: 'The worker rejected the command.',
        causeCategory: 'validation',
        retryable: false,
      }).toData(),
    };
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
