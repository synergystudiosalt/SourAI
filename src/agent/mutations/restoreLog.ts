import { createAgentEventV1, type AgentEventTypeV1, type AgentEventPayloadsV1 } from '../../contracts/events';
import type { RuntimeEventSink } from '../replay';

/**
 * Records an undo in the durable log.
 *
 * Restoring a checkpoint is a user-initiated operation that happens after the
 * run that produced the checkpoint has finished, so it is recorded as its own
 * short run rather than appended to a terminal one. Without this, the audit
 * trail would show a change being applied and never show it being taken back.
 */
export interface RestoreLogInput {
  readonly sink: RuntimeEventSink;
  readonly projectId: string;
  readonly threadId: string;
  readonly checkpointId: string;
  readonly createId?: () => string;
  readonly now?: () => number;
}

export async function recordCheckpointRestore(
  input: RestoreLogInput,
  restore: () => Promise<{ readonly revision: number; readonly restoredPaths: readonly string[] }>
): Promise<{ readonly runId: string; readonly revision: number }> {
  const createId = input.createId ?? (() => crypto.randomUUID());
  const now = input.now ?? Date.now;
  const runId = createId();
  let sequence = 0;

  const append = async <T extends AgentEventTypeV1>(
    type: T,
    payload: AgentEventPayloadsV1[T]
  ): Promise<void> => {
    await input.sink.append(
      createAgentEventV1({
        id: createId(),
        projectId: input.projectId,
        threadId: input.threadId,
        runId,
        correlationId: runId,
        sequence: sequence++,
        createdAt: now(),
        type,
        payload,
      })
    );
  };

  await append('run.created', {
    input: { message: 'Undo the last applied change', mode: 'write' },
  });
  await append('run.status_changed', { status: 'running' });
  await append('restore.started', { checkpointId: input.checkpointId });

  try {
    const result = await restore();
    await append('checkpoint.restored', {
      checkpointId: input.checkpointId,
      revision: result.revision,
    });
    await append('restore.completed', {
      checkpointId: input.checkpointId,
      revision: result.revision,
      restoredPaths: [...result.restoredPaths],
    });
    await append('run.completed', {});
    return { runId, revision: result.revision };
  } catch (error) {
    await append('run.failed', {
      error: {
        code: 'restore_failed',
        message: error instanceof Error ? error.message : 'The checkpoint could not be restored.',
        retryable: false,
        causeCategory: 'runtime',
      },
    });
    throw error;
  }
}
