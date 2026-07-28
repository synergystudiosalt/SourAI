import { describe, expect, it } from 'vitest';

import type { MutationReviewRequest } from '../runtime/types';
import { WorkerMutationGate } from './mutationGate';
import type { AgentWorkerResponse, WorkerMessagePort } from './protocol';

class FakePort implements WorkerMessagePort {
  readonly sent: AgentWorkerResponse[] = [];
  postMessage(message: AgentWorkerResponse): void {
    this.sent.push(message);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

function requestFor(controller = new AbortController()): MutationReviewRequest {
  return {
    approvalId: 'approval-1',
    runId: 'run-1',
    projectId: 'project-1',
    threadId: 'thread-1',
    toolCallId: 'call-1',
    toolName: 'propose_file_changes',
    projectRevision: 4,
    signal: controller.signal,
    proposal: {
      id: 'proposal-1',
      digest: 'a'.repeat(64),
      summary: 'Change a file',
      paths: ['src/app.ts'],
      changeCount: 1,
      value: { summary: 'Change a file', changes: [] },
    },
  };
}

const appliedReport = {
  decision: 'approved',
  digest: 'b'.repeat(64),
  outcome: {
    status: 'applied',
    transactionId: 'tx-1',
    checkpointId: 'checkpoint-1',
    previousRevision: 4,
    revision: 5,
    changedPaths: ['src/app.ts'],
    verification: [
      { id: 'applied-content', label: 'Applied content matches', status: 'passed', detail: 'ok' },
    ],
  },
};

describe('WorkerMutationGate', () => {
  it('asks the host to review and resolves with its decision', async () => {
    const port = new FakePort();
    const gate = new WorkerMutationGate(port);

    const pending = gate.review(requestFor());
    expect(port.sent[0]).toMatchObject({
      kind: 'mutation.review',
      request: { approvalId: 'approval-1', proposal: { summary: 'Change a file' } },
    });

    gate.resolve('approval-1', appliedReport);

    await expect(pending).resolves.toMatchObject({
      decision: 'approved',
      outcome: { status: 'applied', revision: 5 },
    });
  });

  it('ignores a duplicate decision for an already-settled review', async () => {
    const port = new FakePort();
    const gate = new WorkerMutationGate(port);
    const pending = gate.review(requestFor());

    gate.resolve('approval-1', appliedReport);
    // A repeated message must not settle anything a second time.
    gate.resolve('approval-1', { decision: 'denied' });

    await expect(pending).resolves.toMatchObject({ decision: 'approved' });
  });

  it('ignores a decision for an approval it never asked about', async () => {
    const port = new FakePort();
    const gate = new WorkerMutationGate(port);
    const pending = gate.review(requestFor());

    gate.resolve('someone-elses-approval', { decision: 'approved' });
    gate.resolve('approval-1', { decision: 'denied', reason: 'no thanks' });

    await expect(pending).resolves.toMatchObject({ decision: 'denied', reason: 'no thanks' });
  });

  it('treats an unreadable reply as a refusal, never as permission', async () => {
    for (const reply of [undefined, null, 'approved', { decision: 'maybe' }, { outcome: {} }]) {
      const gate = new WorkerMutationGate(new FakePort());
      const pending = gate.review(requestFor());
      gate.resolve('approval-1', reply);
      await expect(pending).resolves.toMatchObject({ decision: 'denied' });
    }
  });

  it('denies an outcome that is missing required fields rather than inventing them', async () => {
    const gate = new WorkerMutationGate(new FakePort());
    const pending = gate.review(requestFor());

    // An unparseable reply must settle the review, not leave the run hanging.
    gate.resolve('approval-1', {
      decision: 'approved',
      outcome: { status: 'applied', transactionId: 'tx-1' },
    });

    await expect(pending).resolves.toMatchObject({
      decision: 'denied',
      reason: expect.stringContaining('unusable result'),
    });
  });

  it('denies when the run is cancelled before the host commits', async () => {
    const controller = new AbortController();
    const gate = new WorkerMutationGate(new FakePort());
    const pending = gate.review(requestFor(controller));

    controller.abort();

    await expect(pending).resolves.toMatchObject({ decision: 'denied' });
  });

  it('waits for the real outcome when cancellation arrives after the host commits', async () => {
    const controller = new AbortController();
    const gate = new WorkerMutationGate(new FakePort());
    const pending = gate.review(requestFor(controller));

    gate.commit('approval-1');
    controller.abort();
    gate.resolve('approval-1', appliedReport);

    await expect(pending).resolves.toMatchObject({
      decision: 'approved',
      outcome: { status: 'applied' },
    });
  });

  it('denies outstanding reviews when the session is torn down', async () => {
    const gate = new WorkerMutationGate(new FakePort());
    const pending = gate.review(requestFor());

    gate.abandon('The agent session ended.');

    await expect(pending).resolves.toMatchObject({
      decision: 'denied',
      reason: 'The agent session ended.',
    });
  });

  it('only accepts a sane project revision from the host', async () => {
    const gate = new WorkerMutationGate(new FakePort());

    gate.setRevision(9);
    expect(await gate.projectRevision()).toBe(9);

    for (const bogus of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      gate.setRevision(bogus);
      expect(await gate.projectRevision()).toBe(9);
    }
  });
});
