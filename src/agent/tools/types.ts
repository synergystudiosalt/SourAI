import type { RedactedValue } from '../../security/redaction';
import type { WorkspaceFileSystem, WorkspacePath } from '../../filesystem';
import type { FileChangeProposalV1 } from '../mutations/proposal';

export const TOOL_PROTOCOL_VERSION = 1 as const;

export type AgentProfile = 'ask' | 'plan' | 'write';
export type ToolRisk = 'read' | 'propose-mutation';

export interface ToolInputSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

export interface StructuredToolCall {
  readonly version: typeof TOOL_PROTOCOL_VERSION;
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface Diagnostic {
  readonly path?: string;
  readonly severity: 'error' | 'warning' | 'info' | 'hint';
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly source?: string;
}

/**
 * Trusted path policy for the run.
 *
 * Supplied by the composition root, never by tool arguments, so a proposal
 * cannot name a credential file even if the model asks for one.
 */
export interface PathPolicy {
  allows(path: string): boolean;
  reason(path: string): string;
}

export interface ToolContext {
  readonly filesystem: WorkspaceFileSystem;
  readonly pathPolicy?: PathPolicy;
  readonly listOpenFiles?: () => readonly string[] | Promise<readonly string[]>;
  readonly inspectDiagnostics?: () => readonly Diagnostic[] | Promise<readonly Diagnostic[]>;
}

export interface ToolExecutionOptions {
  readonly profile: AgentProfile;
}

export interface ToolDescriptor<TArguments extends Record<string, unknown> = Record<string, unknown>> {
  readonly version: typeof TOOL_PROTOCOL_VERSION;
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRisk;
  /** Provider-facing schema; runtime validation remains authoritative. */
  readonly inputSchema?: ToolInputSchema;
  readonly validateArguments: (value: unknown) => TArguments;
  readonly run: (arguments_: TArguments, context: ToolContext) => unknown | Promise<unknown>;
}

export type ToolExecutionResult = {
  readonly callId: string;
  readonly toolName: string;
  readonly status: 'ok';
  readonly output: RedactedValue;
  /**
   * The validated proposal, when this tool produced one.
   *
   * Review needs the exact content that would be written, so this is not
   * redacted — which is safe because a proposal containing a known credential
   * is refused outright at creation. Only `output` reaches events and
   * transcripts.
   */
  readonly proposal?: FileChangeProposalV1;
};

export interface FileChangeProposal {
  readonly summary: string;
  readonly changes: readonly ProposedFileChange[];
}

export type ProposedFileChange =
  | {
      readonly type: 'write';
      readonly path: WorkspacePath;
      readonly content: string;
      readonly expectedHash?: string;
    }
  | {
      readonly type: 'delete';
      readonly path: WorkspacePath;
      readonly expectedHash?: string;
    }
  | {
      readonly type: 'move';
      readonly from: WorkspacePath;
      readonly to: WorkspacePath;
      readonly expectedHash?: string;
    };
