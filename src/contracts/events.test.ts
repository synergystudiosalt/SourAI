import { describe, expect, it } from 'vitest';

import {
  AGENT_COMMAND_VERSION,
  isAgentCommandV1,
  parseAgentCommandV1,
  type AgentCommandV1,
} from './commands';
import {
  AGENT_EVENT_VERSION,
  createAgentEventV1,
  isAgentEventV1,
  parseAgentEventV1,
  type AgentEventTypeV1,
  type AgentEventV1,
} from './events';
import { SourError } from './errors';
import { SECRET_CANARIES, expectNoSecrets } from '../test/assertions';

function rawEvent(type: string, payload: unknown, sequence = 0): unknown {
  return {
    id: `event-${sequence}`,
    version: 1,
    projectId: 'project-1',
    threadId: 'thread-1',
    runId: 'run-1',
    sequence,
    type,
    createdAt: 1_700_000_000_000 + sequence,
    correlationId: 'correlation-1',
    payload,
  };
}

describe('versioned agent contracts', () => {
  it('redacts secrets at the durable event boundary', () => {
    const event = parseAgentEventV1(
      rawEvent('run.created', {
        input: { message: 'Use API_KEY=super-private-value', mode: 'ask' },
      })
    );

    expect(JSON.stringify(event)).not.toContain('super-private-value');
    expect(JSON.stringify(event)).toContain('[redacted]');
  });

  it('keeps commands explicit and structured-cloneable', () => {
    const command: AgentCommandV1 = {
      version: AGENT_COMMAND_VERSION,
      type: 'run.start',
      requestId: 'request-1',
      createdAt: 1_700_000_000_000,
      projectId: 'project-1',
      threadId: 'thread-1',
      input: {
        message: 'Inspect the workspace.',
        mode: 'plan',
        providerId: 'provider-1',
        modelId: 'model-1',
        attachmentIds: ['attachment-1'],
      },
    };

    expect(structuredClone(command)).toEqual(command);
    expect(command.version).toBe(AGENT_COMMAND_VERSION);
  });

  it('constructs a discriminated V1 event with the version installed', () => {
    const event: AgentEventV1<'usage.changed'> = createAgentEventV1({
      id: 'event-1',
      type: 'usage.changed',
      projectId: 'project-1',
      threadId: 'thread-1',
      runId: 'run-1',
      sequence: 7,
      createdAt: 1_700_000_000_007,
      correlationId: 'correlation-1',
      payload: {
        inputTokens: 100,
        outputTokens: 25,
        estimatedCostUsd: 0.01,
      },
    });

    expect(event.version).toBe(AGENT_EVENT_VERSION);
    expect(event.payload.outputTokens).toBe(25);
    expect(structuredClone(event)).toEqual(event);
  });

  it('parses every V1 event payload into a deeply frozen canonical event', () => {
    const normalizedError = {
      code: 'provider_failed',
      message: 'The provider failed.',
      retryable: true,
      causeCategory: 'provider',
    };
    const payloads: Record<AgentEventTypeV1, unknown> = {
      'run.created': { input: { message: 'Start', mode: 'write' } },
      'run.status_changed': { status: 'running' },
      'context.assembled': { itemCount: 2, tokenEstimate: 100 },
      'context.compacted': { beforeTokens: 100, afterTokens: 20 },
      'provider.request_started': {
        requestId: 'provider-request-1',
        providerId: 'provider-1',
        modelId: 'model-1',
      },
      'provider.output_delta': {
        requestId: 'provider-request-1',
        delta: '',
      },
      'assistant.message_completed': {
        messageId: 'message-1',
        content: '',
      },
      'tool.proposed': { toolCallId: 'tool-1', toolName: 'workspace.read' },
      'tool.validation_failed': {
        toolCallId: 'tool-1',
        error: normalizedError,
      },
      'approval.requested': {
        approvalId: 'approval-1',
        toolCallId: 'tool-1',
        summary: 'Read one file',
        risk: 'low',
      },
      'approval.resolved': {
        approvalId: 'approval-1',
        decision: 'approved',
      },
      'proposal.created': {
        proposalId: 'proposal-1',
        toolCallId: 'tool-1',
        summary: 'Change one file',
        digest: 'a'.repeat(64),
        paths: ['src/file.ts'],
        changeCount: 1,
        projectRevision: 3,
      },
      'proposal.superseded': {
        proposalId: 'proposal-1',
        reason: 'The user edited the change.',
      },
      'approval.expired': { approvalId: 'approval-1' },
      'approval.consumed': {
        approvalId: 'approval-1',
        transactionId: 'transaction-1',
      },
      'file.transaction_rolled_back': {
        transactionId: 'transaction-1',
        error: normalizedError,
        restored: true,
      },
      'verification.started': {
        transactionId: 'transaction-1',
        checks: ['applied-content'],
      },
      'verification.completed': {
        transactionId: 'transaction-1',
        results: [
          {
            id: 'applied-content',
            label: 'Applied content matches',
            status: 'passed',
            detail: '1 file verified.',
          },
        ],
      },
      'restore.started': { checkpointId: 'checkpoint-1' },
      'restore.completed': {
        checkpointId: 'checkpoint-1',
        revision: 4,
        restoredPaths: ['src/file.ts'],
      },
      'tool.started': { toolCallId: 'tool-1' },
      'tool.progress': { toolCallId: 'tool-1', message: '', percent: 0 },
      'tool.completed': { toolCallId: 'tool-1', artifactIds: ['artifact-1'] },
      'tool.failed': { toolCallId: 'tool-1', error: normalizedError },
      'file.transaction_started': {
        transactionId: 'transaction-1',
        paths: ['src/file.ts'],
      },
      'file.transaction_completed': {
        transactionId: 'transaction-1',
        revision: 1,
        changedPaths: ['src/file.ts'],
      },
      'file.conflict': { transactionId: 'transaction-1', path: 'src/file.ts' },
      'checkpoint.created': { checkpointId: 'checkpoint-1', revision: 1 },
      'checkpoint.restored': { checkpointId: 'checkpoint-1', revision: 1 },
      'todo.changed': {
        items: [{ id: 'todo-1', title: 'Verify', status: 'pending' }],
      },
      'usage.changed': { inputTokens: 1, outputTokens: 2 },
      'run.waiting_for_user': {
        reason: 'Approval required',
        approvalId: 'approval-1',
      },
      'run.completed': { finalMessageId: 'message-1' },
      'run.failed': { error: normalizedError },
      'run.cancelled': {},
    };

    for (const [type, payload] of Object.entries(payloads)) {
      const parsed = parseAgentEventV1(rawEvent(type, payload));
      expect(parsed.type).toBe(type);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.payload)).toBe(true);
      expect(isAgentEventV1(parsed)).toBe(true);
    }
  });

  it('rejects malformed commands and event payloads with normalized errors', () => {
    const malformed: unknown[] = [
      rawEvent('unknown.event', {}),
      rawEvent('run.status_changed', { status: 'teleporting' }),
      rawEvent('context.assembled', { itemCount: -1 }),
      rawEvent('tool.progress', {
        toolCallId: 'tool-1',
        message: 'Working',
        percent: 101,
      }),
      rawEvent('todo.changed', {
        items: [{ id: 'todo-1', title: 'Verify', status: 'unknown' }],
      }),
      rawEvent('run.failed', {
        error: {
          code: 'x',
          message: 'x',
          retryable: 'yes',
          causeCategory: 'provider',
        },
      }),
    ];

    for (const value of malformed) {
      expect(() => parseAgentEventV1(value)).toThrow(SourError);
      expect(isAgentEventV1(value)).toBe(false);
    }

    const badCommand = {
      version: 1,
      type: 'run.start',
      requestId: 'request-1',
      createdAt: 1,
      projectId: 'project-1',
      threadId: 'thread-1',
      input: { message: 'Start', mode: 'unsafe' },
    };
    expect(() => parseAgentCommandV1(badCommand)).toThrow(SourError);
    expect(isAgentCommandV1(badCommand)).toBe(false);
  });

  it('redacts normalized error data and never echoes malformed secret values', () => {
    const parsed = parseAgentEventV1(
      rawEvent('run.failed', {
        error: {
          code: 'provider_failed',
          message: `Provider rejected ${SECRET_CANARIES.openai}`,
          retryable: false,
          userAction: `Replace ${SECRET_CANARIES.anthropic}`,
          details: { authorization: `Bearer ${SECRET_CANARIES.groq}` },
          causeCategory: 'provider',
        },
      }),
    );
    expectNoSecrets(parsed, 'parsed run failure event');

    let thrown: unknown;
    try {
      parseAgentCommandV1({
        version: 1,
        type: 'run.start',
        requestId: 'request-1',
        createdAt: 1,
        projectId: 'project-1',
        threadId: 'thread-1',
        input: {
          message: 'Start',
          mode: SECRET_CANARIES.google,
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SourError);
    expectNoSecrets(
      (thrown as SourError).toData(),
      'malformed command validation error',
    );

    let badErrorCode: unknown;
    try {
      parseAgentEventV1(
        rawEvent('run.failed', {
          error: {
            code: SECRET_CANARIES.groq,
            message: 'The provider failed.',
            retryable: false,
            causeCategory: 'provider',
          },
        }),
      );
    } catch (error) {
      badErrorCode = error;
    }
    expect(badErrorCode).toBeInstanceOf(SourError);
    expectNoSecrets(
      (badErrorCode as SourError).toData(),
      'malformed normalized error code',
    );
  });

  it('parses every command variant and freezes nested input', () => {
    const commands: unknown[] = [
      {
        version: 1,
        type: 'run.start',
        requestId: 'request-1',
        createdAt: 1,
        projectId: 'project-1',
        threadId: 'thread-1',
        input: {
          message: 'Start',
          mode: 'ask',
          attachmentIds: ['attachment-1'],
        },
      },
      {
        version: 1,
        type: 'run.cancel',
        requestId: 'request-2',
        createdAt: 2,
        runId: 'run-1',
      },
      {
        version: 1,
        type: 'run.steer',
        requestId: 'request-3',
        createdAt: 3,
        runId: 'run-1',
        message: 'Continue',
      },
      {
        version: 1,
        type: 'approval.resolve',
        requestId: 'request-4',
        createdAt: 4,
        approvalId: 'approval-1',
        decision: 'denied',
      },
      {
        version: 1,
        type: 'run.resume',
        requestId: 'request-5',
        createdAt: 5,
        runId: 'run-1',
      },
    ];

    for (const command of commands) {
      const parsed = parseAgentCommandV1(command);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(isAgentCommandV1(parsed)).toBe(true);
    }
    const start = parseAgentCommandV1(commands[0]);
    expect(start.type).toBe('run.start');
    if (start.type === 'run.start') {
      expect(Object.isFrozen(start.input)).toBe(true);
      expect(Object.isFrozen(start.input.attachmentIds)).toBe(true);
    }
  });
});
