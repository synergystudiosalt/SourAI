import { SourError, normalizeError } from '../../contracts/errors';
import { redactValue, type RedactedValue } from '../../security/redaction';
import { authorizeTool } from '../policy';
import { proposalFromToolOutput } from './mutationTools';
import { ToolRegistry } from './registry';
import type { ToolContext, ToolExecutionOptions, ToolExecutionResult } from './types';
import { validateStructuredToolCall } from './validation';

export const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;

function boundedRedactedOutput(value: unknown): RedactedValue {
  const redacted = redactValue(value);
  const serialized = JSON.stringify(redacted);
  if (new TextEncoder().encode(serialized).byteLength <= MAX_TOOL_OUTPUT_BYTES) return redacted;
  // The preview is taken only after redaction. JSON string truncation is
  // diagnostic text, not reparsed structured data.
  return {
    truncated: true,
    // One JS code unit can require up to four UTF-8 bytes. Keeping the preview
    // below one quarter of the byte ceiling provides a hard upper bound.
    preview: serialized.slice(0, Math.floor(MAX_TOOL_OUTPUT_BYTES / 4) - 256),
  };
}

export async function executeStructuredToolCall(
  input: unknown,
  context: ToolContext,
  options: ToolExecutionOptions,
  registry = new ToolRegistry()
): Promise<ToolExecutionResult> {
  const call = validateStructuredToolCall(input);
  const descriptor = registry.get(call.name);
  // Capability policy is checked from the descriptor's own risk before the
  // arguments are even parsed, so an Ask-mode call cannot reach a mutation
  // tool's parser, let alone its handler.
  authorizeTool(options.profile, descriptor.risk);
  const arguments_ = descriptor.validateArguments(call.arguments);

  try {
    const raw = await descriptor.run(arguments_, context);
    // A proposal is carried in a typed field rather than as a raw payload:
    // handler output for read tools can contain file content and is only ever
    // exposed in redacted form.
    const proposal = descriptor.risk === 'read' ? undefined : proposalFromToolOutput(raw);
    return Object.freeze({
      callId: call.id,
      toolName: call.name,
      status: 'ok',
      output: boundedRedactedOutput(raw),
      ...(proposal ? { proposal } : {}),
    });
  } catch (error) {
    if (error instanceof SourError) throw error;
    throw normalizeError(error, {
      code: 'tool_execution_failed',
      message: `Tool "${descriptor.name}" failed.`,
      causeCategory: 'runtime',
      details: { toolName: descriptor.name },
    });
  }
}
