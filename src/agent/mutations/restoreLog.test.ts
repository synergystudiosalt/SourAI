import { describe, expect, it } from 'vitest';

import { replayAgentEvents } from '../../state/domain';
import { MemoryEventSink } from '../replay';
import { recordCheckpointRestore } from './restoreLog';

const sinkInput = (sink: MemoryEventSink) => ({
  sink,
  projectId: 'project-1',
  threadId: 'thread-1',
  checkpointId: 'checkpoint-1',
});

describe('recordCheckpointRestore', () => {
  it('records an undo as its own replayable run', async () => {
    const sink = new MemoryEventSink();

    const { runId, revision } = await recordCheckpointRestore(sinkInput(sink), async () => ({
      revision: 7,
      restoredPaths: ['src/app.ts'],
    }));

    const events = await sink.listRun(runId);
    expect(events.map((event) => event.type)).toEqual([
      'run.created',
      'run.status_changed',
      'restore.started',
      'checkpoint.restored',
      'restore.completed',
      'run.completed',
    ]);
    expect(revision).toBe(7);

    const state = replayAgentEvents(events).visible;
    expect(state.runs[runId].status).toBe('completed');
    expect(state.runs[runId].checkpoints['checkpoint-1'].restoredAt).toBeGreaterThan(0);
  });

  it('records a failed restore and rethrows', async () => {
    const sink = new MemoryEventSink();

    await expect(
      recordCheckpointRestore(sinkInput(sink), async () => {
        throw new Error('checkpoint is gone');
      })
    ).rejects.toThrow('checkpoint is gone');

    const events = await sink.listThread('thread-1');
    expect(events.at(-1)?.type).toBe('run.failed');
    expect(() => replayAgentEvents(events)).not.toThrow();
  });
});
