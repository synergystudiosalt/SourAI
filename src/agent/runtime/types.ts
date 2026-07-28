import type { RunInputV1, RunMode } from '../../contracts/commands';
import type { SourErrorData } from '../../contracts/errors';
import type { AgentEventV1, UsageV1 } from '../../contracts/events';
import type { RunBudgetLimits } from '../budgets';

export interface RuntimeProviderRequest {
  readonly runId: string;
  readonly turn: number;
  readonly input: RunInputV1;
  readonly message: string;
  readonly previousAssistantMessages: readonly string[];
  readonly partialAssistantMessage?: string;
  /**
   * Results of tools the provider called on the previous turn, already
   * validated, redacted, and bounded by the runtime.
   */
  readonly toolResults?: readonly string[];
  readonly signal: AbortSignal;
}

export type RuntimeProviderChunk =
  | { readonly type: 'text.delta'; readonly delta: string; readonly outputTokens?: number }
  | { readonly type: 'usage'; readonly usage: UsageV1 }
  | {
      readonly type: 'tool.call';
      readonly call: {
        readonly id: string;
        readonly name: string;
        readonly arguments: unknown;
        readonly summary?: string;
      };
    };

export interface RuntimeProvider {
  readonly id: string;
  readonly modelId: string;
  stream(request: RuntimeProviderRequest): AsyncIterable<RuntimeProviderChunk>;
}

export interface RuntimeToolResult {
  readonly summary?: string;
  readonly artifactIds?: readonly string[];
  /** Redacted, structured result returned to the provider on the next turn. */
  readonly output?: unknown;
  /**
   * Present when the tool produced a workspace change proposal.
   *
   * The executor derives this from the trusted registry descriptor, so a tool
   * cannot claim its output is a proposal — or hide that it is one.
   */
  readonly proposal?: RuntimeProposal;
}

export interface RuntimeProposal {
  readonly id: string;
  readonly digest: string;
  readonly paths: readonly string[];
  readonly changeCount: number;
  readonly summary: string;
  /** Canonical proposal data for the reviewer. */
  readonly value: unknown;
}

export interface MutationReviewRequest {
  readonly runId: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly approvalId: string;
  readonly proposal: RuntimeProposal;
  readonly projectRevision: number;
  readonly signal: AbortSignal;
}

export type MutationApplyReport =
  | {
      readonly status: 'applied';
      readonly transactionId: string;
      readonly checkpointId: string;
      readonly previousRevision: number;
      readonly revision: number;
      readonly changedPaths: readonly string[];
      readonly verification: readonly {
        readonly id: string;
        readonly label: string;
        readonly status: 'passed' | 'failed' | 'skipped' | 'unavailable';
        readonly detail: string;
      }[];
    }
  | {
      readonly status: 'conflict';
      readonly conflicts: readonly {
        readonly path: string;
        readonly reason: string;
        readonly expectedHash?: string;
        readonly actualHash?: string;
      }[];
    }
  | {
      readonly status: 'failed';
      readonly error: SourErrorData;
      readonly rolledBack: boolean;
      readonly checkpointId?: string;
      readonly transactionId?: string;
    };

export interface MutationReviewReport {
  readonly decision: 'approved' | 'denied' | 'expired';
  /** Digest actually approved; differs from the proposal when it was edited. */
  readonly digest?: string;
  readonly reason?: string;
  readonly expiresAt?: number;
  readonly transactionId?: string;
  readonly outcome?: MutationApplyReport;
}

/**
 * The reviewer that stands between a proposal and the workspace.
 *
 * It is supplied by the composition root and is the only thing that can
 * authorize a mutation. The runtime never decides for itself, and neither the
 * model nor a tool can reach this interface.
 */
export interface MutationReviewGate {
  review(request: MutationReviewRequest): Promise<MutationReviewReport>;
  /** The revision a proposal is being made against. */
  projectRevision(): Promise<number>;
}

export interface RuntimeToolExecutor {
  isMutating(toolName: string): boolean;
  execute(
    call: Extract<RuntimeProviderChunk, { type: 'tool.call' }>['call'],
    context: { readonly runId: string; readonly mode: RunMode; readonly signal: AbortSignal },
  ): Promise<RuntimeToolResult>;
}

export interface RuntimeOptions {
  readonly budgets?: Partial<RunBudgetLimits>;
  readonly now?: () => number;
  readonly createId?: () => string;
  /** Absent means this composition cannot mutate at all. */
  readonly reviewGate?: MutationReviewGate;
}

export interface StartRunRequest {
  readonly projectId: string;
  readonly threadId: string;
  readonly input: RunInputV1;
}

export interface RuntimeSubscription {
  (event: AgentEventV1): void;
}
