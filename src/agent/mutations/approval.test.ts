import { beforeEach, describe, expect, it } from 'vitest';

import { ApprovalCoordinator, approvalMetadata, type ApprovalArtifactV1 } from './approval';
import { parseFileChangeProposal, proposalDigest } from './proposal';

const proposal = parseFileChangeProposal({
  summary: 'Add a greeting',
  changes: [{ operation: 'write_file', path: 'src/app.ts', content: 'hello', reason: 'why' }],
});

const otherProposal = parseFileChangeProposal({
  summary: 'Add a greeting',
  changes: [{ operation: 'write_file', path: 'src/app.ts', content: 'goodbye', reason: 'why' }],
});

const context = (overrides: Partial<Parameters<ApprovalCoordinator['consume']>[1]> = {}) => ({
  projectId: 'project-1',
  threadId: 'thread-1',
  runId: 'run-1',
  toolCallId: 'call-1',
  proposalDigest: '',
  projectRevision: 7,
  ...overrides,
});

describe('ApprovalCoordinator', () => {
  let now = 1_000;
  let coordinator: ApprovalCoordinator;

  const request = () =>
    coordinator.request({
      proposal,
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      projectRevision: 7,
    });

  beforeEach(() => {
    now = 1_000;
    let counter = 0;
    coordinator = new ApprovalCoordinator({
      now: () => now,
      createId: () => `id-${++counter}`,
      ttlMs: 60_000,
    });
  });

  it('issues an artifact that consumes exactly once', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);

    expect(() =>
      coordinator.consume(artifact, context({ proposalDigest: artifact.proposalDigest }))
    ).not.toThrow();
    expect(() =>
      coordinator.consume(artifact, context({ proposalDigest: artifact.proposalDigest }))
    ).toThrowError(/already been used/);
  });

  it('rejects a forged artifact that the model could construct', async () => {
    const pending = await request();
    const forged: ApprovalArtifactV1 = {
      version: 1,
      approvalId: pending.approvalId,
      proposalId: pending.proposalId,
      proposalDigest: await proposalDigest(proposal),
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      projectRevision: 7,
      paths: ['src/app.ts'],
      issuedAt: now,
      expiresAt: now + 60_000,
      nonce: 'guessed-nonce',
    };

    expect(() =>
      coordinator.consume(forged, context({ proposalDigest: forged.proposalDigest }))
    ).toThrowError(/could not be verified/);
  });

  it('rejects an artifact for an approval that was never requested', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);
    const impostor = { ...artifact, approvalId: 'never-issued' };

    expect(() =>
      coordinator.consume(impostor, context({ proposalDigest: artifact.proposalDigest }))
    ).toThrowError(/not issued by this session/);
  });

  it('expires an approval that is used too late', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);
    now += 60_001;

    expect(() =>
      coordinator.consume(artifact, context({ proposalDigest: artifact.proposalDigest }))
    ).toThrowError(/expired/);
  });

  it('refuses to issue an artifact after expiry', async () => {
    const pending = await request();
    now += 60_001;
    await expect(coordinator.approve(pending.approvalId, proposal)).rejects.toThrow(/expired/);
  });

  it('keeps a denial denied', async () => {
    const pending = await request();
    coordinator.deny(pending.approvalId);

    expect(coordinator.isDenied(pending.approvalId)).toBe(true);
    await expect(coordinator.approve(pending.approvalId, proposal)).rejects.toThrow(/denied/);
  });

  it('invalidates the approval when the proposal is edited', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);
    const editedDigest = await proposalDigest(otherProposal);

    expect(() =>
      coordinator.consume(artifact, context({ proposalDigest: editedDigest }))
    ).toThrowError(/does not match this change/);
  });

  it('binds an artifact issued for an edited proposal to that edit only', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, otherProposal);

    const originalDigest = await proposalDigest(proposal);
    expect(artifact.proposalDigest).toBe(await proposalDigest(otherProposal));
    expect(() =>
      coordinator.consume(artifact, context({ proposalDigest: originalDigest }))
    ).toThrow();
  });

  it('refuses to cross project, thread, run, or tool-call boundaries', async () => {
    for (const override of [
      { projectId: 'project-2' },
      { threadId: 'thread-2' },
      { runId: 'run-2' },
      { toolCallId: 'call-2' },
    ]) {
      const pending = await request();
      const artifact = await coordinator.approve(pending.approvalId, proposal);
      expect(() =>
        coordinator.consume(
          artifact,
          context({ proposalDigest: artifact.proposalDigest, ...override })
        )
      ).toThrowError(/does not match this change/);
    }
  });

  it('refuses when the project revision moved after approval', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);

    expect(() =>
      coordinator.consume(
        artifact,
        context({ proposalDigest: artifact.proposalDigest, projectRevision: 8 })
      )
    ).toThrowError(/project changed after this approval/i);
  });

  it('survives a double submit without applying twice', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);
    const attempt = () => {
      try {
        coordinator.consume(artifact, context({ proposalDigest: artifact.proposalDigest }));
        return 'ok';
      } catch {
        return 'rejected';
      }
    };

    // Consumption is synchronous, so no await can interleave between the two.
    expect([attempt(), attempt()]).toEqual(['ok', 'rejected']);
  });

  it('checks bindings against its own record, not against the artifact', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);

    // A caller that alters the artifact *and* matches its context to the
    // alteration still fails: the coordinator compares both against what it
    // recorded when the approval was requested.
    for (const field of ['projectId', 'threadId', 'runId', 'toolCallId'] as const) {
      expect(() =>
        coordinator.consume(
          { ...artifact, [field]: 'switched' },
          context({ proposalDigest: artifact.proposalDigest, [field]: 'switched' })
        )
      ).toThrowError(/does not match this change/);
    }

    expect(() =>
      coordinator.consume(
        { ...artifact, projectRevision: 99 },
        context({ proposalDigest: artifact.proposalDigest, projectRevision: 99 })
      )
    ).toThrowError(/project changed/i);

    // The untampered artifact still works, so the checks are not vacuous.
    expect(() =>
      coordinator.consume(artifact, context({ proposalDigest: artifact.proposalDigest }))
    ).not.toThrow();
  });

  it('refuses a digest that was never the one issued', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);
    const otherDigest = await proposalDigest(otherProposal);

    expect(() =>
      coordinator.consume(
        { ...artifact, proposalDigest: otherDigest },
        context({ proposalDigest: otherDigest })
      )
    ).toThrowError(/does not match this change/);
  });

  it('never exposes the nonce in persistable metadata', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);
    const metadata = approvalMetadata(pending);

    expect(JSON.stringify(metadata)).not.toContain(artifact.nonce);
    expect(Object.keys(metadata)).not.toContain('nonce');
  });

  it('forgets a run so a later run cannot reuse its approvals', async () => {
    const pending = await request();
    const artifact = await coordinator.approve(pending.approvalId, proposal);
    coordinator.forgetRun('run-1');

    expect(() =>
      coordinator.consume(artifact, context({ proposalDigest: artifact.proposalDigest }))
    ).toThrowError(/not issued by this session/);
  });
});
