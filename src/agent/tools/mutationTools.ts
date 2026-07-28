import { containsSecret } from '../../security/redaction';
import { PROPOSAL_LIMITS, parseFileChangeProposal, proposalPaths } from '../mutations/proposal';
import type { FileChangeProposalV1 } from '../mutations/proposal';
import type { ToolContext, ToolDescriptor, ToolInputSchema } from './types';
import { toolValidationError } from './validation';

/**
 * The mutation half of the tool registry.
 *
 * Every descriptor here normalizes its arguments into one canonical proposal,
 * so there is a single representation to validate, digest, review, approve, and
 * apply. The handlers deliberately return data and nothing else: creating a
 * proposal must never touch the filesystem, which is what lets Write mode draft
 * a change without the change existing yet.
 *
 * `risk` lives on the immutable descriptor, so a provider cannot present a
 * mutating tool as a read one — the registry is asked, never the caller.
 */

const objectSchema = (
  properties: Record<string, Readonly<Record<string, unknown>>>,
  required: readonly string[]
): ToolInputSchema =>
  Object.freeze({
    type: 'object' as const,
    properties: Object.freeze(properties),
    required,
    additionalProperties: false as const,
  });

const REASON = { type: 'string', maxLength: PROPOSAL_LIMITS.maxReasonLength };
const PATH = { type: 'string', maxLength: PROPOSAL_LIMITS.maxPathLength };
const HASH = { type: 'string', pattern: '^[a-f0-9]{64}$' };

/**
 * A proposal handler's result.
 *
 * The coordinator reads `proposal` from here; the summary text exists for the
 * transcript only and carries no authority.
 */
export interface ProposalToolResult {
  readonly kind: 'file_change_proposal';
  readonly proposal: FileChangeProposalV1;
  readonly applied: false;
  readonly note: string;
}

/**
 * Refuses a proposal that would write a known session credential into a file.
 *
 * Redacting it instead would silently corrupt the content the user approved,
 * so the proposal is rejected and the model is told why.
 */
function assertNoCredentials(proposal: FileChangeProposalV1): void {
  if (containsSecret(JSON.stringify(proposal))) {
    toolValidationError('credential_in_proposal');
  }
}

function result(proposal: FileChangeProposalV1): ProposalToolResult {
  return Object.freeze({
    kind: 'file_change_proposal' as const,
    proposal,
    applied: false,
    note: 'Proposed only. The user must review and approve it before anything changes.',
  });
}

/** Parses a whole proposal, mapping any failure to a tool validation error. */
function toProposal(value: unknown): FileChangeProposalV1 {
  try {
    return parseFileChangeProposal(value);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'proposal_invalid') throw error;
    toolValidationError('proposal_invalid');
  }
}

type AnyArguments = Record<string, unknown>;

function mutationTool(
  name: string,
  description: string,
  inputSchema: ToolInputSchema,
  build: (value: AnyArguments) => unknown
): ToolDescriptor<{ proposal: FileChangeProposalV1 } & Record<string, unknown>> {
  return {
    version: 1,
    name,
    description,
    risk: 'propose-mutation',
    inputSchema,
    validateArguments(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        toolValidationError('expected_object');
      }
      return { proposal: toProposal(build(value as AnyArguments)) };
    },
    run(arguments_, context: ToolContext) {
      // Scope is applied to the proposal, not just to reads: a change to an
      // excluded path is refused here, before it can ever reach review.
      for (const path of proposalPaths(arguments_.proposal)) {
        if (context.pathPolicy && !context.pathPolicy.allows(String(path))) {
          toolValidationError('path_not_in_scope', {
            path: String(path),
            reason: context.pathPolicy.reason(String(path)),
          });
        }
      }
      assertNoCredentials(arguments_.proposal);
      return result(arguments_.proposal);
    },
  };
}

export const proposeWriteFileTool = mutationTool(
  'propose_write_file',
  'Propose creating or replacing one file. Provide expectedHash when replacing existing content.',
  objectSchema(
    {
      path: PATH,
      content: { type: 'string', maxLength: PROPOSAL_LIMITS.maxContentBytes },
      reason: REASON,
      summary: { type: 'string', maxLength: PROPOSAL_LIMITS.maxSummaryLength },
      expectedHash: HASH,
      createOnly: { type: 'boolean' },
    },
    ['path', 'content', 'reason']
  ),
  (value) => ({
    summary: value.summary ?? `Update ${String(value.path)}`,
    changes: [
      {
        operation: 'write_file',
        path: value.path,
        content: value.content,
        reason: value.reason,
        ...(value.expectedHash === undefined ? {} : { expectedHash: value.expectedHash }),
        ...(value.createOnly === undefined ? {} : { createOnly: value.createOnly }),
      },
    ],
  })
);

export const proposePatchTool = mutationTool(
  'propose_patch',
  'Propose a line patch to one file. Each hunk must quote the exact original lines it replaces.',
  objectSchema(
    {
      path: PATH,
      expectedHash: HASH,
      reason: REASON,
      summary: { type: 'string', maxLength: PROPOSAL_LIMITS.maxSummaryLength },
      hunks: {
        type: 'array',
        minItems: 1,
        maxItems: PROPOSAL_LIMITS.maxHunks,
        items: {
          type: 'object',
          properties: {
            startLine: { type: 'integer', minimum: 1 },
            originalLines: { type: 'array', items: { type: 'string' } },
            replacementLines: { type: 'array', items: { type: 'string' } },
          },
          required: ['startLine', 'originalLines', 'replacementLines'],
          additionalProperties: false,
        },
      },
    },
    ['path', 'expectedHash', 'reason', 'hunks']
  ),
  (value) => ({
    summary: value.summary ?? `Patch ${String(value.path)}`,
    changes: [
      {
        operation: 'patch_file',
        path: value.path,
        expectedHash: value.expectedHash,
        reason: value.reason,
        hunks: value.hunks,
      },
    ],
  })
);

export const proposeDeleteFileTool = mutationTool(
  'propose_delete_file',
  'Propose deleting one file.',
  objectSchema(
    {
      path: PATH,
      reason: REASON,
      summary: { type: 'string', maxLength: PROPOSAL_LIMITS.maxSummaryLength },
      expectedHash: HASH,
    },
    ['path', 'reason']
  ),
  (value) => ({
    summary: value.summary ?? `Delete ${String(value.path)}`,
    changes: [
      {
        operation: 'delete_file',
        path: value.path,
        reason: value.reason,
        ...(value.expectedHash === undefined ? {} : { expectedHash: value.expectedHash }),
      },
    ],
  })
);

export const proposeMoveFileTool = mutationTool(
  'propose_move_file',
  'Propose moving or renaming one file.',
  objectSchema(
    {
      from: PATH,
      to: PATH,
      reason: REASON,
      summary: { type: 'string', maxLength: PROPOSAL_LIMITS.maxSummaryLength },
      expectedHash: HASH,
    },
    ['from', 'to', 'reason']
  ),
  (value) => ({
    summary: value.summary ?? `Move ${String(value.from)} to ${String(value.to)}`,
    changes: [
      {
        operation: 'move_file',
        from: value.from,
        to: value.to,
        reason: value.reason,
        ...(value.expectedHash === undefined ? {} : { expectedHash: value.expectedHash }),
      },
    ],
  })
);

export const proposeCreateDirectoryTool = mutationTool(
  'propose_create_directory',
  'Propose creating one directory.',
  objectSchema(
    {
      path: PATH,
      reason: REASON,
      summary: { type: 'string', maxLength: PROPOSAL_LIMITS.maxSummaryLength },
    },
    ['path', 'reason']
  ),
  (value) => ({
    summary: value.summary ?? `Create ${String(value.path)}`,
    changes: [{ operation: 'create_directory', path: value.path, reason: value.reason }],
  })
);

export const proposeFileChangesTool = mutationTool(
  'propose_file_changes',
  'Propose several related file changes that must be applied together or not at all.',
  objectSchema(
    {
      summary: { type: 'string', maxLength: PROPOSAL_LIMITS.maxSummaryLength },
      changes: { type: 'array', minItems: 1, maxItems: PROPOSAL_LIMITS.maxChanges },
      verification: {
        type: 'array',
        maxItems: PROPOSAL_LIMITS.maxVerificationItems,
        items: { type: 'string', maxLength: 200 },
      },
    },
    ['summary', 'changes']
  ),
  (value) => value
);

export const MUTATION_TOOLS = Object.freeze([
  proposeFileChangesTool,
  proposeWriteFileTool,
  proposePatchTool,
  proposeDeleteFileTool,
  proposeMoveFileTool,
  proposeCreateDirectoryTool,
]);

/** Extracts a proposal from a tool result, or nothing if it was not one. */
export function proposalFromToolOutput(value: unknown): FileChangeProposalV1 | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'file_change_proposal') return undefined;
  try {
    return parseFileChangeProposal(record.proposal);
  } catch {
    return undefined;
  }
}
