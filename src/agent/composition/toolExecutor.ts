import { SourError } from '../../contracts/errors';
import type { RunMode } from '../../contracts/commands';
import {
  canonicalJson,
  proposalDigest,
  proposalPaths,
} from '../mutations/proposal';
import type { RuntimeToolExecutor, RuntimeToolResult } from '../runtime/types';
import { executeStructuredToolCall } from '../tools/executor';
import { ToolRegistry } from '../tools/registry';
import { TOOL_PROTOCOL_VERSION, type ToolContext } from '../tools/types';

/**
 * Connects the structured tool registry to the run loop.
 *
 * Risk comes from the registry descriptor, never from the provider's tool call
 * or from an executor flag, so a model cannot present a mutating tool as a read
 * and an unknown name fails closed as mutating.
 */
export class RegistryToolExecutor implements RuntimeToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly context: ToolContext,
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  isMutating(toolName: string): boolean {
    try {
      return this.registry.get(toolName).risk !== 'read';
    } catch {
      return true;
    }
  }

  async execute(
    call: { readonly id: string; readonly name: string; readonly arguments: unknown },
    context: { readonly runId: string; readonly mode: RunMode; readonly signal: AbortSignal }
  ): Promise<RuntimeToolResult> {
    if (context.signal.aborted) {
      throw new DOMException('The run was cancelled.', 'AbortError');
    }
    const result = await executeStructuredToolCall(
      {
        version: TOOL_PROTOCOL_VERSION,
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      },
      this.context,
      { profile: context.mode },
      this.registry
    );
    if (context.signal.aborted) {
      throw new DOMException('The run was cancelled.', 'AbortError');
    }
    // Whether a result is a proposal is decided by the registry descriptor and
    // a re-parse of the payload, never by anything the provider said.
    if (this.registry.isMutating(call.name)) {
      const proposal = result.proposal;
      if (!proposal) {
        throw new SourError({
          code: 'proposal_missing',
          message: 'A mutation tool must produce a reviewable proposal.',
          causeCategory: 'validation',
          retryable: false,
          details: { toolName: call.name },
        });
      }
      return {
        summary: proposal.summary,
        output: result.output,
        proposal: {
          id: this.createId(),
          digest: await proposalDigest(proposal),
          paths: proposalPaths(proposal).map(String),
          changeCount: proposal.changes.length,
          summary: proposal.summary,
          value: JSON.parse(canonicalJson(proposal)),
        },
      };
    }

    return {
      summary: `${call.name} completed`,
      output: result.output,
    };
  }
}
