import { describe, expect, it } from 'vitest';

import type { AgentEventV1 } from '../../contracts/events';
import { MemoryWorkspaceFileSystem } from '../../filesystem/memory/MemoryWorkspaceFileSystem';
import { workspacePath } from '../../filesystem';
import { ContextScope } from '../context/scope';
import { buildWorkspaceSnapshot, type WorkspaceSnapshotV1 } from '../context/snapshot';
import { MutationReviewer, type PendingReview, type ReviewSelection } from '../mutations/reviewer';
import { DeterministicFakeProvider } from '../providers/fakeProvider';
import type { ProviderStreamEvent } from '../providers/types';
import { MemoryEventSink } from '../replay';
import type { MutationReviewGate, MutationReviewReport } from '../runtime/types';
import { replayRun } from '../replay/replay';
import { replayAgentEvents } from '../../state/domain';
import { createAgentComposition } from './index';

/**
 * The complete production path, exercised end to end:
 * provider → tool → proposal → approval artifact → transaction → events.
 */

const digest = async (bytes: Uint8Array) =>
  bytes.byteLength.toString(16).padStart(64, '0').slice(0, 64);

const SEED = [
  { path: 'src/app.ts', content: 'one\ntwo\nthree\n' },
  { path: 'src/other.ts', content: 'other\n' },
];

async function snapshotOf(): Promise<WorkspaceSnapshotV1> {
  return buildWorkspaceSnapshot(
    'project-1',
    0,
    SEED.map((file) => ({ ...file, isLoaded: true })),
    ContextScope.projectDefault(),
    undefined,
    digest
  );
}

/** A reviewer driven by a scripted decision, standing in for the human. */
function gateFor(
  reviewer: MutationReviewer,
  decide: (review: PendingReview) => ReviewSelection | null
): MutationReviewGate & { readonly reviews: PendingReview[] } {
  const reviews: PendingReview[] = [];
  return {
    reviews,
    projectRevision: () => reviewer.filesystem.revision(),
    async review(request): Promise<MutationReviewReport> {
      const pending = await reviewer.prepare({
        approvalId: request.approvalId,
        proposalId: request.proposal.id,
        runId: request.runId,
        threadId: request.threadId,
        projectId: request.projectId,
        toolCallId: request.toolCallId,
        proposal: request.proposal.value,
      });
      reviews.push(pending);
      const selection = decide(pending);
      if (selection === null) {
        reviewer.deny(pending.approvalId);
        return { decision: 'denied', reason: 'The user declined.' };
      }
      const { outcome, digest: approvedDigest } = await reviewer.approve(pending, selection);
      return { decision: 'approved', digest: approvedDigest, outcome };
    },
  };
}

function proposalCall(args: unknown, id = 'call-1'): ProviderStreamEvent {
  return { type: 'tool_call', call: { id, name: 'propose_file_changes', arguments: args } };
}

async function run(options: {
  readonly scripts: readonly { readonly events: readonly ProviderStreamEvent[] }[];
  readonly decide?: (review: PendingReview) => ReviewSelection | null;
  readonly mode?: 'ask' | 'plan' | 'write';
  readonly withGate?: boolean;
}) {
  const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
  const reviewer = new MutationReviewer({ filesystem });
  const gate = gateFor(reviewer, options.decide ?? (() => ({})));
  const sink = new MemoryEventSink();
  const provider = new DeterministicFakeProvider(options.scripts);
  const composition = createAgentComposition({
    sink,
    snapshot: await snapshotOf(),
    scope: ContextScope.projectDefault(),
    providerId: 'fake',
    modelId: 'fake-model',
    contextPaths: ['src/app.ts'],
    provider,
    ...(options.withGate === false ? {} : { reviewGate: gate }),
  });
  const runId = await composition.runtime.start({
    projectId: 'project-1',
    threadId: 'thread-1',
    input: { message: 'Change the file', mode: options.mode ?? 'write' },
  });
  await composition.runtime.wait(runId);
  return {
    filesystem,
    reviewer,
    gate,
    composition,
    provider,
    runId,
    events: await sink.listRun(runId),
  };
}

const types = (events: readonly AgentEventV1[]) => events.map((event) => event.type);

async function hashOf(filesystem: MemoryWorkspaceFileSystem, path: string) {
  return (await filesystem.stat(workspacePath(path))).contentHash ?? '';
}

describe('mutation flow', () => {
  it('carries a proposal through review to an applied, verified transaction', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    const hash = await hashOf(filesystem, 'src/app.ts');
    const result = await run({
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Shout the second line',
              verification: ['npm test'],
              changes: [
                {
                  operation: 'patch_file',
                  path: 'src/app.ts',
                  expectedHash: hash,
                  reason: 'clarity',
                  hunks: [{ startLine: 2, originalLines: ['two'], replacementLines: ['TWO'] }],
                },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        {
          events: [
            { type: 'text_delta', text: 'Done.' },
            { type: 'completed', finishReason: 'stop' },
          ],
        },
      ],
    });

    expect(result.filesystem.readText('src/app.ts')).toBe('one\nTWO\nthree\n');
    expect(types(result.events)).toEqual(
      expect.arrayContaining([
        'proposal.created',
        'approval.requested',
        'run.waiting_for_user',
        'approval.resolved',
        'checkpoint.created',
        'file.transaction_started',
        'approval.consumed',
        'file.transaction_completed',
        'verification.started',
        'verification.completed',
        'run.completed',
      ])
    );

    // The model is handed the recorded outcome, not its own claim about it.
    const followUp = result.provider.requests[1].messages.map((m) => m.content).join('\n');
    expect(followUp).toContain('"applied":true');
    expect(followUp).toContain('src/app.ts');
  });

  it('replays into the same approval and transaction state', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    const hash = await hashOf(filesystem, 'src/app.ts');
    const result = await run({
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Edit',
              changes: [
                {
                  operation: 'patch_file',
                  path: 'src/app.ts',
                  expectedHash: hash,
                  reason: 'r',
                  hunks: [{ startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] }],
                },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
      ],
    });

    const state = replayAgentEvents(result.events).visible;
    const runState = state.runs[result.runId];
    const approval = Object.values(runState.approvals)[0];
    const transaction = Object.values(runState.fileTransactions)[0];

    expect(approval.status).toBe('consumed');
    expect(transaction.status).toBe('completed');
    expect(transaction.changedPaths).toContain('src/app.ts');
    expect(transaction.verification.some((check) => check.status === 'passed')).toBe(true);
    expect(replayRun(result.events).terminal).toBe(true);
  });

  it('applies nothing when the user denies', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    const hash = await hashOf(filesystem, 'src/app.ts');
    const result = await run({
      decide: () => null,
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Edit',
              changes: [
                {
                  operation: 'patch_file',
                  path: 'src/app.ts',
                  expectedHash: hash,
                  reason: 'r',
                  hunks: [{ startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] }],
                },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
      ],
    });

    expect(result.filesystem.readText('src/app.ts')).toBe('one\ntwo\nthree\n');
    const resolved = result.events.find((event) => event.type === 'approval.resolved');
    expect(resolved?.payload).toMatchObject({ decision: 'denied' });
    expect(types(result.events)).not.toContain('file.transaction_completed');

    const state = replayAgentEvents(result.events).visible;
    expect(Object.values(state.runs[result.runId].approvals)[0].status).toBe('denied');
  });

  it('applies only the hunks the reviewer kept', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    const hash = await hashOf(filesystem, 'src/app.ts');
    const result = await run({
      decide: (review) => ({ hunks: { 'src/app.ts': [review.files[0].hunks[0].id] } }),
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Two edits',
              changes: [
                {
                  operation: 'patch_file',
                  path: 'src/app.ts',
                  expectedHash: hash,
                  reason: 'r',
                  hunks: [
                    { startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] },
                    { startLine: 3, originalLines: ['three'], replacementLines: ['THREE'] },
                  ],
                },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
      ],
    });

    expect(result.filesystem.readText('src/app.ts')).toBe('ONE\ntwo\nthree\n');
    // Approving a narrower change supersedes the one that was proposed.
    expect(types(result.events)).toContain('proposal.superseded');
  });

  it.each(['ask', 'plan'] as const)('refuses a mutation tool in %s mode', async (mode) => {
    const result = await run({
      mode,
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Edit',
              changes: [
                { operation: 'write_file', path: 'src/new.ts', content: 'x\n', reason: 'r' },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
      ],
    });

    expect(result.filesystem.readText('src/new.ts')).toBeUndefined();
    expect(types(result.events)).toContain('tool.validation_failed');
    expect(types(result.events)).not.toContain('proposal.created');
    expect(types(result.events)).not.toContain('file.transaction_completed');
    expect(result.gate.reviews).toHaveLength(0);

    // The model was not even offered a mutation tool in this profile.
    const offered = result.provider.requests[0].tools?.map((tool) => tool.name) ?? [];
    expect(offered).toContain('read_file');
    expect(offered).not.toContain('propose_file_changes');
  });

  it('offers no mutation tool at all when there is no reviewer', async () => {
    const result = await run({
      withGate: false,
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Edit',
              changes: [
                { operation: 'write_file', path: 'src/new.ts', content: 'x\n', reason: 'r' },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
      ],
    });

    expect(result.composition.capabilities.toolNames).not.toContain('propose_file_changes');
    expect(result.composition.capabilities.mutation.available).toBe(false);
    expect(result.filesystem.readText('src/new.ts')).toBeUndefined();
    expect(types(result.events)).toContain('tool.failed');
  });

  it('records a conflict instead of overwriting a file that changed', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    const staleHash = await hashOf(filesystem, 'src/app.ts');
    const result = await run({
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Edit',
              changes: [
                {
                  operation: 'patch_file',
                  path: 'src/app.ts',
                  expectedHash: staleHash,
                  reason: 'r',
                  // Anchored to text this file does not contain.
                  hunks: [{ startLine: 1, originalLines: ['nonexistent'], replacementLines: ['x'] }],
                },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
      ],
    });

    expect(result.filesystem.readText('src/app.ts')).toBe('one\ntwo\nthree\n');
    expect(types(result.events)).toContain('file.conflict');
    expect(types(result.events)).not.toContain('file.transaction_completed');
  });

  it('never lets a proposal name a path outside the run scope', async () => {
    const result = await run({
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Write a credential file',
              changes: [
                { operation: 'write_file', path: '.env', content: 'KEY=1\n', reason: 'r' },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
      ],
    });

    expect(result.filesystem.readText('.env')).toBeUndefined();
    expect(types(result.events)).toContain('tool.failed');
    expect(result.gate.reviews).toHaveLength(0);
  });

  it('never lets a traversal path reach the filesystem', async () => {
    const result = await run({
      scripts: [
        {
          events: [
            proposalCall({
              summary: 'Escape the project',
              changes: [
                { operation: 'write_file', path: '../escape.ts', content: 'x', reason: 'r' },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
        { events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] },
      ],
    });

    expect(types(result.events)).toContain('tool.failed');
    expect(result.gate.reviews).toHaveLength(0);
    expect(await result.filesystem.revision()).toBe(0);
  });

  it('refuses a proposal that would write a session credential into a file', async () => {
    const { registerSecret, unregisterSecret } = await import('../../security/redaction');
    registerSecret('sk-canary-value-1234567890');
    try {
      const result = await run({
        scripts: [
          {
            events: [
              proposalCall({
                summary: 'Save the key',
                changes: [
                  {
                    operation: 'write_file',
                    path: 'src/config.ts',
                    content: 'export const key = "sk-canary-value-1234567890";\n',
                    reason: 'r',
                  },
                ],
              }),
              { type: 'completed', finishReason: 'tool_calls' },
            ],
          },
          {
            events: [{ type: 'text_delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }],
          },
        ],
      });

      expect(result.filesystem.readText('src/config.ts')).toBeUndefined();
      expect(types(result.events)).toContain('tool.failed');
      expect(JSON.stringify(result.events)).not.toContain('sk-canary-value-1234567890');
    } finally {
      unregisterSecret('sk-canary-value-1234567890');
    }
  });

  it('records a transaction that committed just as the run was cancelled', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    const hash = await hashOf(filesystem, 'src/app.ts');
    const reviewer = new MutationReviewer({ filesystem });
    const sink = new MemoryEventSink();
    let cancel: (() => void) | undefined;

    const gate: MutationReviewGate = {
      projectRevision: () => filesystem.revision(),
      async review(request) {
        const pending = await reviewer.prepare({
          approvalId: request.approvalId,
          proposalId: request.proposal.id,
          runId: request.runId,
          threadId: request.threadId,
          projectId: request.projectId,
          toolCallId: request.toolCallId,
          proposal: request.proposal.value,
        });
        const { outcome, digest: approved } = await reviewer.approve(pending, {});
        // The user hits Stop in the moment between commit and report.
        cancel?.();
        return { decision: 'approved', digest: approved, outcome };
      },
    };

    const composition = createAgentComposition({
      sink,
      snapshot: await snapshotOf(),
      scope: ContextScope.projectDefault(),
      providerId: 'fake',
      modelId: 'fake-model',
      contextPaths: ['src/app.ts'],
      reviewGate: gate,
      provider: new DeterministicFakeProvider([
        {
          events: [
            proposalCall({
              summary: 'Edit',
              changes: [
                {
                  operation: 'patch_file',
                  path: 'src/app.ts',
                  expectedHash: hash,
                  reason: 'r',
                  hunks: [{ startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] }],
                },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
      ]),
    });

    const runId = await composition.runtime.start({
      projectId: 'project-1',
      threadId: 'thread-1',
      input: { message: 'Change it', mode: 'write' },
    });
    cancel = () => void composition.runtime.cancel(runId);
    await composition.runtime.wait(runId);

    // The change really happened, so the log says so even though the run stopped.
    expect(filesystem.readText('src/app.ts')).toBe('ONE\ntwo\nthree\n');
    const events = await sink.listRun(runId);
    expect(types(events)).toContain('file.transaction_completed');
    expect(types(events)).toContain('run.cancelled');
    expect(() => replayAgentEvents(events)).not.toThrow();
  });

  it('leaves the workspace untouched when the run is cancelled during review', async () => {
    const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
    const hash = await hashOf(filesystem, 'src/app.ts');
    const reviewer = new MutationReviewer({ filesystem });
    const sink = new MemoryEventSink();
    let cancel: (() => void) | undefined;

    const gate: MutationReviewGate = {
      projectRevision: () => filesystem.revision(),
      review: (request) =>
        new Promise<MutationReviewReport>((resolve) => {
          // The user walks away; the run is stopped while the card is open.
          request.signal.addEventListener('abort', () =>
            resolve({ decision: 'denied', reason: 'The run was cancelled.' })
          );
          cancel?.();
        }),
    };

    const composition = createAgentComposition({
      sink,
      snapshot: await snapshotOf(),
      scope: ContextScope.projectDefault(),
      providerId: 'fake',
      modelId: 'fake-model',
      contextPaths: ['src/app.ts'],
      reviewGate: gate,
      provider: new DeterministicFakeProvider([
        {
          events: [
            proposalCall({
              summary: 'Edit',
              changes: [
                {
                  operation: 'patch_file',
                  path: 'src/app.ts',
                  expectedHash: hash,
                  reason: 'r',
                  hunks: [{ startLine: 1, originalLines: ['one'], replacementLines: ['ONE'] }],
                },
              ],
            }),
            { type: 'completed', finishReason: 'tool_calls' },
          ],
        },
      ]),
    });

    const runId = await composition.runtime.start({
      projectId: 'project-1',
      threadId: 'thread-1',
      input: { message: 'Change it', mode: 'write' },
    });
    cancel = () => void composition.runtime.cancel(runId);
    await composition.runtime.wait(runId);

    expect(filesystem.readText('src/app.ts')).toBe('one\ntwo\nthree\n');
    expect(await filesystem.revision()).toBe(0);
    expect(reviewer.filesystem.readText('src/app.ts')).toBe('one\ntwo\nthree\n');
  });
});
