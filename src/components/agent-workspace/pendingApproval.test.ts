import { describe, expect, it } from 'vitest';

import { createAgentEventV1, type AgentEventV1 } from '../../contracts/events';
import { pendingApprovalFromEvents } from './AgentWorkspace';

/**
 * Deciding, from the event log alone, whether a review is still open.
 *
 * This is what a reload consults before restoring an approval card, so a
 * settled or abandoned approval must never come back.
 */

let sequence = 0;

function event<T extends AgentEventV1['type']>(
  type: T,
  payload: unknown,
  runId = 'run-1'
): AgentEventV1 {
  return createAgentEventV1({
    id: `event-${++sequence}`,
    projectId: 'project-1',
    threadId: 'thread-1',
    runId,
    correlationId: runId,
    sequence: sequence,
    createdAt: sequence,
    type,
    payload,
  } as never);
}

const requested = (approvalId = 'approval-1', runId = 'run-1') =>
  event(
    'approval.requested',
    {
      approvalId,
      toolCallId: 'call-1',
      summary: 'Change a file',
      risk: 'medium',
      proposalId: 'proposal-1',
      digest: 'a'.repeat(64),
      paths: ['src/app.ts'],
    },
    runId
  );

describe('pendingApprovalFromEvents', () => {
  it('finds an approval that was never settled', () => {
    expect(pendingApprovalFromEvents([requested()])).toEqual({
      approvalId: 'approval-1',
      proposalId: 'proposal-1',
    });
  });

  it('ignores an approval that was resolved', () => {
    expect(
      pendingApprovalFromEvents([
        requested(),
        event('approval.resolved', { approvalId: 'approval-1', decision: 'approved' }),
      ])
    ).toBeUndefined();
  });

  it('ignores an approval that was denied, expired, or consumed', () => {
    for (const settled of [
      event('approval.resolved', { approvalId: 'approval-1', decision: 'denied' }),
      event('approval.expired', { approvalId: 'approval-1' }),
      event('approval.consumed', { approvalId: 'approval-1', transactionId: 'tx-1' }),
    ]) {
      expect(pendingApprovalFromEvents([requested(), settled])).toBeUndefined();
    }
  });

  it('ignores an approval whose run was cancelled or failed', () => {
    expect(
      pendingApprovalFromEvents([requested(), event('run.cancelled', { reason: 'stopped' })])
    ).toBeUndefined();
    expect(
      pendingApprovalFromEvents([
        requested(),
        event('run.failed', {
          error: {
            code: 'x',
            message: 'failed',
            retryable: false,
            causeCategory: 'runtime',
          },
        }),
      ])
    ).toBeUndefined();
  });

  it('returns the still-open approval when an earlier one was settled', () => {
    expect(
      pendingApprovalFromEvents([
        requested('approval-1'),
        event('approval.resolved', { approvalId: 'approval-1', decision: 'denied' }),
        requested('approval-2'),
      ])
    ).toMatchObject({ approvalId: 'approval-2' });
  });

  it('ignores a legacy approval that carries no proposal', () => {
    expect(
      pendingApprovalFromEvents([
        event('approval.requested', {
          approvalId: 'approval-legacy',
          summary: 'Something',
          risk: 'low',
        }),
      ])
    ).toBeUndefined();
  });
});
